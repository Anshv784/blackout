// Admin: create the leaderboard and N rooms, delegate them to the TEE and set up their sealed accounts.
//   npx tsx scripts/admin.ts board
//   npx tsx scripts/admin.ts rooms 1 2 3        (free public rooms)
//   npx tsx scripts/admin.ts room <id> <stakeSOL> <code>
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import { BlackoutClient, roomPda, worldPda, recPda, viewPda, boardPda } from "../app/src/chain/client.ts";

const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/blackout-devnet.json`, "utf8"))));
const c = new BlackoutClient(admin);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setupRoom(id: bigint, stakeSol = 0, code = 0) {
  const exists = await c.base.getAccountInfo(roomPda(id));
  if (!exists) {
    const sig = await c.sendBase(c.createRoomIxs(id, BigInt(Math.round(stakeSol * LAMPORTS_PER_SOL)), code, (id >= 10n ? 0.04 : 0.06) * LAMPORTS_PER_SOL));
    console.log(`room ${id} created+delegated`, sig);
  } else console.log(`room ${id} exists (owner ${exists.owner.toBase58().slice(0, 8)})`);
  const tee = await c.teeConn();
  for (let i = 0; i < 60 && !(await tee.getAccountInfo(roomPda(id))); i++) await sleep(500);
  console.log(`room ${id} visible on TEE`);
  const mask = (await c.fetchRoom(id))!.readyMask;
  console.log(`ready mask 0x${mask.toString(16)}`);
  if (!(mask & 1)) console.log("setup_core", await c.sendEr([c.setupCoreIx(id)]));
  const recs = [0, 1, 2, 3, 4].filter((k) => !(mask & (1 << (1 + k))));
  if (recs.length) console.log("setup_rec", recs, await c.sendEr(recs.map((k) => c.setupRecIx(id, k))));
  for (const part of [[0, 1, 2, 3], [4, 5, 6, 7]]) {
    const seats = part.filter((k) => !(mask & (1 << (8 + k))));
    if (seats.length) console.log("setup_view", seats, await c.sendEr(seats.map((k) => c.setupViewIx(id, k))));
  }
  const room = await c.fetchRoom(id);
  console.log(`room ${id} ready: status=${room?.status} stake=${room?.stake} code=${room?.privateCode} mask=0x${room?.readyMask.toString(16)}`);
  console.log("  world readable by admin?", !!(await tee.getAccountInfo(worldPda(id))), " rec0?", !!(await tee.getAccountInfo(recPda(id, 0))));
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "board") {
  if (await c.base.getAccountInfo(boardPda())) console.log("board exists", boardPda().toBase58());
  else console.log("board", await c.initBoard());
} else if (cmd === "rooms") {
  for (const a of args) await setupRoom(BigInt(a));
} else if (cmd === "room") {
  await setupRoom(BigInt(args[0]), Number(args[1] ?? 0), Number(args[2] ?? 0));
} else console.log("usage: board | rooms <ids...> | room <id> <stakeSol> <code>");
