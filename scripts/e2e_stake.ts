// Staked match: 2 funded players buy tickets on Solana, play, winner is paid by the Magic Action.
import { Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs"; import os from "os";
import { BlackoutClient, ticketPda } from "../app/src/chain/client.ts";
import { STATUS_NAME, ST_ENDED, ST_LIVE, NO_SEAT } from "../app/src/chain/layout.ts";
const id = BigInt(process.argv[2] ?? 5);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const admin = new BlackoutClient(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/blackout-devnet.json`, "utf8")))));
const A = new BlackoutClient(Keypair.generate()), B = new BlackoutClient(Keypair.generate());
await admin.sendBase([A, B].map((p) => SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: p.publicKey, lamports: 0.03 * LAMPORTS_PER_SOL })));
const base = (await A.fetchRoomBase(id))!;
const matchNo = base.matchNo + 1;
for (const p of [A, B]) console.log("ticket", await p.sendBase([p.buyTicketIx(id, matchNo, p.publicKey)]));
await sleep(2000);
let r = (await A.fetchRoom(id))!;
console.log("room", STATUS_NAME[r.status], "stake", r.stake, "matchNo", r.matchNo);
await A.sendEr([A.joinIx(id, 0, "STAKER-A", A.publicKey, 0, ticketPda(id, matchNo, A.publicKey))]);
await B.sendEr([B.joinIx(id, 1, "STAKER-B", B.publicKey, 0, ticketPda(id, matchNo, B.publicKey))]);
r = (await A.fetchRoom(id))!;
console.log("pot", r.pot, "seated", r.nPlayers);
const before = { a: await A.base.getBalance(A.publicKey), b: await A.base.getBalance(B.publicKey) };
await A.sendEr([A.startIx(id, 0)]);
let seq = 0;
while (true) {
  r = (await A.fetchRoom(id).catch(() => r))!;
  if (r.status === ST_ENDED) break;
  if (r.status === ST_LIVE) for (const p of [A, B]) { const a = Math.random() * 6.28; p.sendEr([p.inputIx(id, Math.cos(a) * 127, Math.sin(a) * 127, Math.floor(Math.random() * 65536), 1, ++seq)], { confirm: false }).catch(() => {}); }
  await sleep(300);
}
console.log("ended winner", r.winner, r.names[r.winner], "pot", r.pot);
const w = r.winner;
console.log("finish", await A.sendEr([A.finishIx(id, w !== NO_SEAT ? r.payout[w] : null)]));
for (let i = 0; i < 20; i++) {
  await sleep(2000);
  const a = await A.base.getBalance(A.publicKey), b = await A.base.getBalance(B.publicKey);
  if (a !== before.a || b !== before.b) { console.log("PAID: A Δ", (a - before.a) / 1e9, "B Δ", (b - before.b) / 1e9); break; }
}
console.log("reset", await A.sendEr([A.resetIx(id)]).catch((e) => e.message));
process.exit(0);
