// Admin: create the leaderboard and N rooms, delegate them to the TEE and set up their sealed accounts.
//   npx tsx scripts/admin.ts board
//   npx tsx scripts/admin.ts rooms 1 2 3        (free public rooms)
//   npx tsx scripts/admin.ts room <id> <stakeSOL> <code> [prefundSOL]
//      prefund = the room's own SOL for MagicBlock's fees: a staked night commits once to pay out
//      (~0.001 SOL each after the first 25). Default 0.005; mainnet staked tables: 0.05.
//   DAILY_PREFUND_SOL=0.05 npx tsx scripts/admin.ts daily   (the daily board commits about once a day)
//   npx tsx scripts/admin.ts close 1 2 3        (get the rooms' SOL back)
//   npx tsx scripts/admin.ts close-board
//   npx tsx scripts/admin.ts daily              (create + delegate the daily board)
// Mainnet: ADMIN_KEY=~/.config/solana/blackout-mainnet.json VITE_CLUSTER=mainnet VITE_BASE_RPC=... VITE_PROGRAM_ID=...
// Mainnet launch (6 free rooms, two staked tables; see app/src/config.ts):
//   rooms 1 2 3 4 5 6 · room 7 0.01 0 0.05 · room 8 0.05 0 0.05 · DAILY_PREFUND_SOL=0.05 daily
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import { BlackoutClient, roomPda, worldPda, recPda, viewPda, boardPda, dailyPda, DELEGATION_PROGRAM_ID } from "../app/src/chain/client.ts";

const keyFile = process.env.ADMIN_KEY ?? `${os.homedir()}/.config/solana/blackout-devnet.json`;
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyFile, "utf8"))));
const c = new BlackoutClient(admin);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setupRoom(id: bigint, stakeSol = 0, code = 0, prefundSol = 0.005) {
  const exists = await c.base.getAccountInfo(roomPda(id));
  if (!exists) {
    const sig = await c.sendBase(c.createRoomIxs(id, BigInt(Math.round(stakeSol * LAMPORTS_PER_SOL)), code, Math.round(prefundSol * LAMPORTS_PER_SOL)));
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
  else console.log("board", await c.initBoard(Math.round(Number(process.env.DAILY_PREFUND_SOL ?? 0.002) * LAMPORTS_PER_SOL)));
} else if (cmd === "rooms") {
  for (const a of args) await setupRoom(BigInt(a));
} else if (cmd === "room") {
  await setupRoom(BigInt(args[0]), Number(args[1] ?? 0), Number(args[2] ?? 0), Number(args[3] ?? 0.005));
} else if (cmd === "close") {
  // get a room's SOL back: hand it to Solana, wait for that, then close it
  for (const a of args) {
    const id = BigInt(a);
    console.log("undelegate", await c.sendEr([c.undelegateRoomIx(id)]));
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      const sig = await c.sendBase([c.closeRoomIx(id)]).catch(() => null);
      if (sig) {
        console.log(`room ${id} closed`, sig);
        break;
      }
    }
  }
} else if (cmd === "daily") {
  // the daily board is created with the staked board: an older board has to be closed first
  if (!(await c.base.getAccountInfo(dailyPda()))) {
    if (await c.base.getAccountInfo(boardPda())) console.log("close old board", await c.sendBase([c.closeBoardIx()]));
    const pre = Math.round(Number(process.env.DAILY_PREFUND_SOL ?? 0.002) * LAMPORTS_PER_SOL);
    console.log("boards", await c.initBoard(pre));
  }
  const owner = (await c.base.getAccountInfo(dailyPda()))!.owner.toBase58();
  if (owner !== DELEGATION_PROGRAM_ID.toBase58()) console.log("delegate daily", await c.sendBase([c.delegateDailyIx()]));
  const tee = await c.teeConn();
  for (let i = 0; i < 60 && !(await tee.getAccountInfo(dailyPda())); i++) await sleep(500);
  console.log("daily board on the TEE:", dailyPda().toBase58(), "ready", (await c.fetchDaily())?.ready);
} else if (cmd === "close-board") {
  console.log("board closed", await c.sendBase([c.closeBoardIx()]));
} else console.log("usage: board | rooms <ids...> | room <id> <stakeSol> <code> | close <ids...> | close-board");
