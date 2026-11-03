// The daily challenge's rules, tested against a deployed program:
//   npx tsx scripts/e2e_daily.ts <freshRoomIdBase>      (uses 2 room ids; run `admin.ts daily` first)
// Each check prints PASS or FAIL; exits 1 if anything failed.
import { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import { BlackoutClient, roomPda, todayUtc, worldPda, recPda } from "../app/src/chain/client.ts";
import { ST_ENDED, ST_COUNTDOWN, ST_LIVE, ST_LOBBY } from "../app/src/chain/layout.ts";

const base = BigInt(process.argv[2] ?? 2000);
const keyFile = process.env.ADMIN_KEY ?? `${os.homedir()}/.config/solana/blackout-devnet.json`;
const admin = new BlackoutClient(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyFile, "utf8")))));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};
const rejects = async (name: string, f: () => Promise<unknown>) => {
  try {
    await f();
    check(name, false, "was accepted");
  } catch {
    check(name, true);
  }
};

async function makeRoom(id: bigint) {
  await admin.sendBase(admin.createRoomIxs(id, 0n, 0, 0.005 * LAMPORTS_PER_SOL));
  const tee = await admin.teeConn();
  for (let i = 0; i < 60 && !(await tee.getAccountInfo(roomPda(id))); i++) await sleep(500);
  await admin.sendEr([admin.setupCoreIx(id)]);
  await admin.sendEr([0, 1, 2, 3, 4].map((k) => admin.setupRecIx(id, k)));
  for (const part of [[0, 1, 2, 3], [4, 5, 6, 7]]) await admin.sendEr(part.map((k) => admin.setupViewIx(id, k)));
}
/** A player hosting a fresh private room alone, like the app's DAILY button does. */
async function host(id: bigint) {
  const p = new BlackoutClient(Keypair.generate());
  await p.sendEr([p.claimIx(id, 4, true, 777), p.joinIx(id, 0, "DAILY", null, 777)]);
  return p;
}
const signWith = (k: Keypair) => async (tx: Transaction) => {
  tx.partialSign(k);
  return tx;
};
const startDaily = (p: BlackoutClient, id: bigint, wallet: Keypair) =>
  p.sendEr([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), p.startDailyIx(id, wallet.publicKey)], { cosign: signWith(wallet) });

const [roomA, roomB] = [base, base + 1n];
await makeRoom(roomA);
await makeRoom(roomB);

// ---------------------------------------------------------------- today's seed
let d = await admin.fetchDaily();
if (d && d.day !== todayUtc()) {
  await admin.sendEr([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), admin.rollDailyIx()]);
  for (let i = 0; i < 40 && (await admin.fetchDaily())?.day !== todayUtc(); i++) await sleep(1000);
  d = await admin.fetchDaily();
}
check("today's seed is rolled by the VRF oracle", d?.day === todayUtc(), `day ${d?.day} vs ${todayUtc()}`);
await rejects("the seed can't be re-rolled the same day", () => admin.sendEr([admin.rollDailyIx()]));
const tee = await admin.teeConn();
const stranger = new BlackoutClient(Keypair.generate());
const secretSeen = await (await stranger.teeConn()).getAccountInfo((await import("../app/src/chain/client.ts")).dailySecretPda()).catch(() => null);
check("nobody can read today's seed", secretSeen === null);
void tee;

// ---------------------------------------------------------------- one try
const p = await host(roomA);
const wallet = Keypair.generate();
await rejects("the session key can't stand in for a wallet", () =>
  p.sendEr([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), p.startDailyIx(roomA, p.publicKey)], { cosign: signWith(p.keypair) }),
);
await rejects("a wallet that didn't sign can't be used", () => p.sendEr([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), p.startDailyIx(roomA, wallet.publicKey)]));
await startDaily(p, roomA, wallet);
let r = (await p.fetchRoom(roomA))!;
check("the daily starts straight away on the sealed seed (no VRF wait)", (r.status === ST_COUNTDOWN || r.status === ST_LIVE) && r.daily, `status ${r.status}`);
check("it's you and three bots", r.isBot.filter((b) => b === 1).length === 3 && r.maxPlayers === 4);
await rejects("the host can't end a daily night early", () => p.sendEr([p.endNowIx(roomA)]));
const p2 = await host(roomB);
await rejects("one try per wallet per day", () => startDaily(p2, roomB, wallet));

// ---------------------------------------------------------------- the night (idle: nobody sends input)
const end = Date.now() + 240_000;
while (Date.now() < end) {
  r = (await p.fetchRoom(roomA).catch(() => r))!;
  if (r.status === ST_ENDED) break;
  if (r.status === ST_COUNTDOWN || r.status === ST_LIVE) await p.sendEr([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), p.tickIx(roomA)], { confirm: false }).catch(() => {});
  await sleep(150);
}
check("the night ends", r.status === ST_ENDED);
await p.sendEr(p.withBudget(p.finishIx(roomA, null, true)));
d = await admin.fetchDaily();
const mine = d?.entries.find((e) => e.key.equals(wallet.publicKey));
check("the score is on today's board, under the wallet", !!mine, mine ? `score ${mine.score}, place #${mine.place}` : "missing");
check("going idle doesn't win the tie-break", !!mine && (r.alive[0] === 0 || mine.place === r.aliveCount), `place ${mine?.place}, survivors ${r.aliveCount}`);
const worldSeen = await (await stranger.teeConn()).getAccountInfo(worldPda(roomA)).catch(() => null);
const recSeen = await (await stranger.teeConn()).getAccountInfo(recPda(roomA, 0)).catch(() => null);
check("the replay is public but the World (today's map) stays sealed", worldSeen === null && recSeen !== null);
await p.sendEr(p.withBudget(p.resetIx(roomA)));
r = (await p.fetchRoom(roomA))!;
check("after the night the room is an ordinary room again", r.status === ST_LOBBY && !r.daily);

console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
