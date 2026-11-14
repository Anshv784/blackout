// One staked night at the 0.01 table with two throwaway wallets funded by the admin wallet, then
// everything is swept back to the admin wallet. Keys are saved first so nothing can be stranded.
// Run with the mainnet env (see docs/mainnet-runbook.md). Usage: tsx scripts/rehearse_mainnet.ts <keysFile> [fundSol]
import { Keypair, SystemProgram, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import fs from "fs";
import { BlackoutClient, ticketPda, IS_MAINNET, TREASURY } from "../app/src/chain/client.ts";
import { STATUS_NAME, ST_ENDED, ST_LIVE, NO_SEAT } from "../app/src/chain/layout.ts";

if (!IS_MAINNET) throw new Error("not mainnet env");
const keysFile = process.argv[2];
const fund = Math.round(Number(process.argv[3] ?? 0.0118) * LAMPORTS_PER_SOL);
const id = 11n; // the 0.01 SOL table
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const admin = new BlackoutClient(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ADMIN_KEY!, "utf8")))));
if (!admin.publicKey.equals(TREASURY)) throw new Error("admin key is not the treasury");

let A: BlackoutClient, B: BlackoutClient;
if (fs.existsSync(keysFile)) {
  const k = JSON.parse(fs.readFileSync(keysFile, "utf8"));
  A = new BlackoutClient(Keypair.fromSecretKey(Uint8Array.from(k.a)));
  B = new BlackoutClient(Keypair.fromSecretKey(Uint8Array.from(k.b)));
  console.log("reusing saved test wallets");
} else {
  const a = Keypair.generate(), b = Keypair.generate();
  fs.writeFileSync(keysFile, JSON.stringify({ a: Array.from(a.secretKey), b: Array.from(b.secretKey) }), { mode: 0o600 });
  A = new BlackoutClient(a);
  B = new BlackoutClient(b);
}
const bal = (p: PublicKey) => admin.base.getBalance(p);
console.log("A", A.publicKey.toBase58(), "\nB", B.publicKey.toBase58());
const adminStart = await bal(admin.publicKey);
console.log("admin start", adminStart / 1e9);

const mode = process.argv[4] ?? "play";
if (mode === "play") {
  if ((await bal(A.publicKey)) < fund)
    console.log("fund", await admin.sendBase([A, B].map((p) => SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: p.publicKey, lamports: fund }))));
  const base = (await A.fetchRoomBase(id))!;
  const matchNo = base.matchNo + 1;
  for (const p of [A, B]) console.log("ticket", await p.sendBase([p.buyTicketIx(id, matchNo, p.publicKey)]));
  await sleep(2000);
  let r = (await A.fetchRoom(id))!;
  console.log("room", STATUS_NAME[r.status], "stake", r.stake, "matchNo", r.matchNo);
  await A.sendEr([A.joinIx(id, 0, "REHEARSE-A", A.publicKey, 0, ticketPda(id, matchNo, A.publicKey))]);
  await B.sendEr([B.joinIx(id, 1, "REHEARSE-B", B.publicKey, 0, ticketPda(id, matchNo, B.publicKey))]);
  r = (await A.fetchRoom(id))!;
  console.log("pot", r.pot, "seated", r.nPlayers);
  const before = { a: await bal(A.publicKey), b: await bal(B.publicKey), admin: await bal(admin.publicKey) };
  console.log("waiting out the countdown…");
  for (let i = 0; i < 40; i++) {
    await sleep(5000);
    const ok = await B.sendEr([B.startIx(id, 0)]).then(() => true, () => false);
    if (ok) break;
  }
  let seq = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 9 * 60_000) {
    r = (await A.fetchRoom(id).catch(() => r))!;
    if (r.status === ST_ENDED) break;
    if (r.status === ST_LIVE)
      for (const p of [A, B]) {
        const a = Math.random() * 6.28;
        p.sendEr([p.inputIx(id, Math.cos(a) * 127, Math.sin(a) * 127, Math.floor(Math.random() * 65536), 1, ++seq)], { confirm: false }).catch(() => {});
      }
    await sleep(300);
  }
  console.log("ended:", STATUS_NAME[r.status], "winner", r.winner, r.names[r.winner], "pot", r.pot);
  const w = r.winner;
  console.log("finish", await A.sendEr(A.withBudget(A.finishIx(id, w !== NO_SEAT ? r.payout[w] : null))).catch((e) => e.message));
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const a = await bal(A.publicKey), b = await bal(B.publicKey);
    if (a !== before.a || b !== before.b) {
      await sleep(4000);
      const a2 = await bal(A.publicKey), b2 = await bal(B.publicKey), ad = await bal(admin.publicKey);
      console.log("PAID: A Δ", (a2 - before.a) / 1e9, "B Δ", (b2 - before.b) / 1e9, "admin Δ", (ad - before.admin) / 1e9);
      break;
    }
  }
  console.log("reset", await A.sendEr(A.withBudget(A.resetIx(id))).catch((e) => e.message));
} else if (mode === "finish") {
  // the night already ended (driven elsewhere): pay it out
  const r = (await A.fetchRoom(id))!;
  console.log("room", STATUS_NAME[r.status], "winner", r.winner, r.names[r.winner], "pot", r.pot);
  const before = { a: await bal(A.publicKey), b: await bal(B.publicKey), admin: await bal(admin.publicKey) };
  const w = r.winner;
  console.log("finish", await A.sendEr(A.withBudget(A.finishIx(id, w !== NO_SEAT ? r.payout[w] : null))).catch((e) => e.message));
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const a = await bal(A.publicKey), b = await bal(B.publicKey);
    if (a !== before.a || b !== before.b) {
      await sleep(5000);
      const a2 = await bal(A.publicKey), b2 = await bal(B.publicKey), ad = await bal(admin.publicKey);
      console.log("PAID: A Δ", (a2 - before.a) / 1e9, "B Δ", (b2 - before.b) / 1e9, "admin Δ", (ad - before.admin) / 1e9);
      break;
    }
  }
  console.log("reset", await A.sendEr(A.withBudget(A.resetIx(id))).catch((e) => e.message));
}

// close every ticket of theirs (rent back to them), then sweep both wallets to the admin wallet
// anyone may send close_ticket: the wallet with SOL pays the fee, each ticket's rent goes to its owner
const sender = (await bal(A.publicKey)) >= (await bal(B.publicKey)) ? A : B;
for (const p of [A, B]) {
  for (const t of await p.myTickets().catch(() => [])) {
    console.log("close ticket", t.pubkey.toBase58(), "consumed", t.consumed, await sender.sendBase([sender.closeTicketIx(t.roomId, t.pubkey, t.payout)]).catch((e) => e.message.slice(0, 120)));
  }
}
await sleep(3000);
for (const p of [A, B]) {
  const b = await bal(p.publicKey);
  if (b > 5000) console.log("sweep", (b - 5000) / 1e9, await p.sendBase([SystemProgram.transfer({ fromPubkey: p.publicKey, toPubkey: admin.publicKey, lamports: b - 5000 })]).catch((e) => e.message.slice(0, 160)));
}
await sleep(3000);
console.log("left in A", (await bal(A.publicKey)) / 1e9, "B", (await bal(B.publicKey)) / 1e9);
console.log("admin end", (await bal(admin.publicKey)) / 1e9, "net", ((await bal(admin.publicKey)) - adminStart) / 1e9);
process.exit(0);
