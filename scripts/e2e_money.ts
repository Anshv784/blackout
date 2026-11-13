// Real-money rules, tested for real against a deployed program:
//   npx tsx scripts/e2e_money.ts <freshRoomIdBase>
// Each check prints PASS or FAIL; the process exits 1 if anything failed.
// Uses 5 room ids from the base: staked table, free room, room to close, a second table at the
// same stake and one at a higher stake (for carrying unused tickets over).
import { ComputeBudgetProgram, Keypair, SystemProgram, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import { BlackoutClient, roomPda, bankPda, ticketPda, boardPda, recPda, prizePda, fundPda, TREASURY, PROGRAM_ID } from "../app/src/chain/client.ts";
import { STATUS_NAME, ST_ENDED, ST_LOBBY, ST_LIVE, ST_COUNTDOWN, prizeLeader } from "../app/src/chain/layout.ts";

const base = BigInt(process.argv[2] ?? 900);
const STAKE = 0.01;
const SEATS = 8;
const stakeLamports = BigInt(STAKE * LAMPORTS_PER_SOL);
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
const balance = (k: PublicKey) => admin.base.getBalance(k);

/** Bring a fresh room up: create, delegate, wait for the TEE, create its sealed accounts. */
async function makeRoom(id: bigint, stake: bigint) {
  await admin.sendBase(admin.createRoomIxs(id, stake, 0, 0.005 * LAMPORTS_PER_SOL));
  const tee = await admin.teeConn();
  for (let i = 0; i < 60 && !(await tee.getAccountInfo(roomPda(id))); i++) await sleep(500);
  await admin.sendEr([admin.setupCoreIx(id)]);
  await admin.sendEr([0, 1, 2, 3, 4].map((k) => admin.setupRecIx(id, k)));
  for (const part of [[0, 1, 2, 3], [4, 5, 6, 7]]) await admin.sendEr(part.map((k) => admin.setupViewIx(id, k)));
}

async function waitFor(c: BlackoutClient, id: bigint, want: number, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await c.fetchRoom(id).catch(() => null);
    if (r?.status === want) return r;
    if (r && (r.status === ST_COUNTDOWN || r.status === ST_LIVE)) await c.sendEr([c.tickIx(id)], { confirm: false }).catch(() => {});
    await sleep(250);
  }
  throw new Error(`room ${id} never reached ${STATUS_NAME[want]}`);
}

// ---------------------------------------------------------------- setup
const [stakedId, freeId, closeId, otherId, highId] = [base, base + 1n, base + 2n, base + 3n, base + 4n];
if (!(await admin.base.getAccountInfo(boardPda()))) await admin.initBoard();
if (!(await admin.base.getAccountInfo(prizePda()))) await admin.sendBase([admin.initPrizeIx()]);

const outsider = new BlackoutClient(Keypair.generate());
await admin.sendBase([SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: outsider.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL })]);
await rejects("outsider can't create a room", () => outsider.sendBase(outsider.createRoomIxs(base + 50n, 0n, 0, 0)));

const closeStart = await balance(admin.publicKey);
await makeRoom(closeId, 0n);
const closeSpent = closeStart - (await balance(admin.publicKey));
console.log(`one room costs ${closeSpent / LAMPORTS_PER_SOL} SOL to open`);

await makeRoom(stakedId, stakeLamports);
await makeRoom(freeId, 0n);
await makeRoom(otherId, stakeLamports);
await makeRoom(highId, stakeLamports * 5n);

const players = Array.from({ length: SEATS + 1 }, () => new BlackoutClient(Keypair.generate()));
const wallets = players.map(() => Keypair.generate().publicKey);
await admin.sendBase(players.slice(0, 5).map((p) => SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: p.publicKey, lamports: 0.015 * LAMPORTS_PER_SOL })));
await admin.sendBase(players.slice(5).map((p) => SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: p.publicKey, lamports: 0.015 * LAMPORTS_PER_SOL })));

// ---------------------------------------------------------------- tickets + lobby
const bankRent = await admin.base.getMinimumBalanceForRentExemption(33);
const matchNo = ((await admin.fetchRoom(stakedId))!.matchNo) + 1;
for (let i = 0; i < players.length; i++) await players[i].sendBase([players[i].buyTicketIx(stakedId, matchNo, wallets[i])]);
const bystander = players[SEATS]; // bought a ticket but never sits down
const seated = players.slice(0, SEATS);
const tk = (i: number) => ticketPda(stakedId, matchNo, players[i].publicKey);
check("bank holds every stake", BigInt(await balance(bankPda(stakedId))) === BigInt(bankRent) + stakeLamports * BigInt(players.length));
await sleep(2000);

await rejects("can't sit at a staked table without a ticket", () => seated[0].sendEr([seated[0].joinIx(stakedId, 0, "A", wallets[0], 0)]));
await rejects("can't sit using someone else's ticket", () => seated[0].sendEr([seated[0].joinIx(stakedId, 0, "A", wallets[0], 0, tk(1))]));
await rejects("an unused ticket can't be refunded", () => seated[0].sendBase([seated[0].closeTicketIx(stakedId, tk(0), wallets[0])]));
await rejects("winnings can't be sent to an account that can't take SOL (a program)", () =>
  outsider.sendBase([outsider.buyTicketIx(otherId, matchNo, PROGRAM_ID)]),
);
await rejects("a ticket still waiting for its night can't move yet", () =>
  seated[0].sendBase([seated[0].reuseTicketIx({ pubkey: tk(0), roomId: stakedId }, otherId, 1)]),
);

for (let i = 0; i < 4; i++) {
  // a different name each time, or the repeat is the same tx and the network drops it as a duplicate
  await seated[0].sendEr([seated[0].joinIx(stakedId, 0, `A${i}`, wallets[0], 0, tk(0))]);
  if (i < 3) {
    await sleep(500);
    await seated[0].sendEr([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: i + 1 }), seated[0].leaveIx(stakedId, 0)]);
    await sleep(500);
  }
}
let room = (await admin.fetchRoom(stakedId))!;
check("join/leave loop can't inflate the pot", room.pot === stakeLamports, `pot ${room.pot}`);
check("seat is paid to the ticket's wallet, whatever join claims", room.payout[0].equals(wallets[0]));

for (let i = 1; i < SEATS - 1; i++) await seated[i].sendEr([seated[i].joinIx(stakedId, i, `P${i}`, wallets[i], 0, tk(i))]);
room = (await admin.fetchRoom(stakedId))!;
check("a staked table has no host", room.host.equals(PublicKey.default));
check("countdown armed once two or more stakers sit", room.startSlot > 0n, `start_slot ${room.startSlot}`);
{
  const due = room.startSlot;
  await sleep(2000);
  await seated[1].sendEr([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 7 }), seated[1].leaveIx(stakedId, 1)]);
  await sleep(1500);
  await seated[1].sendEr([seated[1].joinIx(stakedId, 1, "P1b", wallets[1], 0, tk(1))]);
  room = (await admin.fetchRoom(stakedId))!;
  check("leaving and sitting back down doesn't restart the countdown", room.startSlot === due, `${room.startSlot} vs ${due}`);
}
await rejects("nobody can start a staked table before its countdown ends", () => seated[1].sendEr([seated[1].startIx(stakedId, 0)]));
await rejects("seat count can't be changed at a staked table (would skip the countdown)", () => seated[0].sendEr([seated[0].setSizeIx(stakedId, SEATS - 1)]));
await seated[SEATS - 1].sendEr([seated[SEATS - 1].joinIx(stakedId, SEATS - 1, `P${SEATS - 1}`, wallets[SEATS - 1], 0, tk(SEATS - 1))]);
room = (await admin.fetchRoom(stakedId))!;
check("pot is one stake per seat", room.pot === stakeLamports * BigInt(SEATS), `pot ${room.pot}`);

// full table: any seated staker may start it at once (no host)
await seated[5].sendEr([seated[5].startIx(stakedId, 0)]);
check("a full staked table starts at once, from any staker", (await admin.fetchRoom(stakedId))!.status !== ST_LOBBY);
await rejects("host can't end a staked night early (pot steal)", () => seated[0].sendEr([seated[0].endNowIx(stakedId)]));

// ---------------------------------------------------------------- play + settle
room = await waitFor(admin, stakedId, ST_ENDED, 120_000);
const winner = room.winner;
const winnerWallet = room.payout[winner];
check("a human won", winner < SEATS && winnerWallet.equals(wallets[winner]), `seat ${winner}`);
const before = await balance(winnerWallet);
const treasuryBefore = await balance(admin.publicKey);
const fundBefore = await balance(fundPda());
await rejects("finish refuses a wrong winner account", () => seated[1].sendEr([seated[1].finishIx(stakedId, wallets[(winner + 1) % SEATS])]));
await seated[1].sendEr([seated[1].finishIx(stakedId, winnerWallet)]);
let got = 0;
for (let i = 0; i < 40 && !got; i++) {
  await sleep(2000);
  got = (await balance(winnerWallet)) - before;
}
const pot = stakeLamports * BigInt(SEATS);
const fee = pot / 10n;
check("winner is paid the pot less 10%", BigInt(got) === pot - fee, `${got / LAMPORTS_PER_SOL} SOL`);
const earned = (await balance(admin.publicKey)) - treasuryBefore;
const funded = (await balance(fundPda())) - fundBefore;
check("the table fund gets 0.001 SOL of the fee", funded === 1_000_000, `${funded / LAMPORTS_PER_SOL} SOL`);
check("treasury receives the rest of the 10% fee", BigInt(earned) === fee - 1_000_000n, `${earned / LAMPORTS_PER_SOL} SOL`);

// ---------------------------------------------------------------- refunds
const ticket0 = await admin.base.getAccountInfo(tk(0));
const consumed = ticket0?.data[ticket0.data.length - 1] === 1;
check("settle marked seated tickets used", consumed);

const loser = (winner + 1) % SEATS;
const loserBefore = await balance(wallets[loser]);
await seated[loser].sendBase([seated[loser].closeTicketIx(stakedId, tk(loser), wallets[loser])]);
const loserGot = (await balance(wallets[loser])) - loserBefore;
check("a loser gets rent back but not their stake", BigInt(loserGot) < stakeLamports && loserGot > 0, `${loserGot / LAMPORTS_PER_SOL} SOL`);

const found = await bystander.myTickets();
check("the app can find a player's unused ticket", found.length === 1 && found[0].pubkey.equals(tk(SEATS)) && !found[0].consumed, `${found.length} found`);
await rejects("a ticket the night didn't use is still never refunded", () => outsider.sendBase([outsider.closeTicketIx(stakedId, tk(SEATS), wallets[SEATS])]));
await rejects("a spent ticket can't move to another night", () => seated[0].sendBase([seated[0].reuseTicketIx({ pubkey: tk(0), roomId: stakedId }, otherId, 1)]));
const highMatch = ((await admin.fetchRoomBase(highId))!.matchNo) + 1;
await rejects("an unused ticket can't pay for a seat at a different stake", () =>
  bystander.sendBase([bystander.reuseTicketIx({ pubkey: tk(SEATS), roomId: stakedId }, highId, highMatch)]),
);
// carry it to the other 0.01 table: no new stake, the stake moves bank to bank
const otherMatch = ((await admin.fetchRoomBase(otherId))!.matchNo) + 1;
const [bankA0, bankB0, byKey0] = [await balance(bankPda(stakedId)), await balance(bankPda(otherId)), await balance(bystander.publicKey)];
await bystander.sendBase([bystander.reuseTicketIx({ pubkey: tk(SEATS), roomId: stakedId }, otherId, otherMatch)]);
const moved = ticketPda(otherId, otherMatch, bystander.publicKey);
const [bankA1, bankB1, byKey1] = [await balance(bankPda(stakedId)), await balance(bankPda(otherId)), await balance(bystander.publicKey)];
check("an unused ticket moves to another same-stake table's next night", !(await admin.base.getAccountInfo(tk(SEATS))) && !!(await admin.base.getAccountInfo(moved)));
check("its stake moves with it, bank to bank", BigInt(bankA0 - bankA1) === stakeLamports && BigInt(bankB1 - bankB0) === stakeLamports, `${(bankA0 - bankA1) / 1e9} out, ${(bankB1 - bankB0) / 1e9} in`);
check("moving it costs no new stake (only the fee)", byKey0 - byKey1 < 20_000, `${byKey0 - byKey1} lamports`);
await sleep(2000);
await bystander.sendEr([bystander.joinIx(otherId, 0, "CARRIED", wallets[SEATS], 0, moved)]);
const otherRoom = (await admin.fetchRoom(otherId))!;
check("the moved ticket seats its player at the new table", otherRoom.players[0].equals(bystander.publicKey) && otherRoom.pot === stakeLamports);
await bystander.sendEr([bystander.leaveIx(otherId, 0)]);
await rejects("after leaving that lobby the ticket stays put until the table plays (no refund)", () =>
  bystander.sendBase([bystander.reuseTicketIx({ pubkey: moved, roomId: otherId }, stakedId, 99)]),
);
check("the first table's bank keeps only its rent", (await balance(bankPda(stakedId))) === bankRent, `${await balance(bankPda(stakedId))} vs ${bankRent}`);
await seated[0].sendEr([seated[0].resetIx(stakedId)]);
check("staked room goes back to the lobby", (await waitFor(admin, stakedId, ST_LOBBY)).nPlayers === 0);

// a stray transfer into the bank must not be able to block closing the room
await admin.sendBase([SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: bankPda(stakedId), lamports: 1000 })]);
await admin.sendEr([admin.undelegateRoomIx(stakedId)]);
await sleep(15_000);
await rejects("a room can't close while used tickets still hold players' rent", () => admin.sendBase([admin.closeRoomIx(stakedId)]));
for (let i = 0; i < SEATS; i++) await admin.sendBase([admin.closeTicketIx(stakedId, tk(i), wallets[i])]).catch(() => {});
check("every ticket hands its rent back", (await Promise.all(players.map((_, i) => admin.base.getAccountInfo(tk(i))))).every((a) => a === null));
let stakedClosed = false;
for (let i = 0; i < 30 && !stakedClosed; i++) {
  await sleep(2000);
  stakedClosed = await admin.sendBase([admin.closeRoomIx(stakedId)]).then(() => true, () => false);
}
check("sending SOL to a bank can't block closing its room", stakedClosed && !(await admin.base.getAccountInfo(bankPda(stakedId))));

// ---------------------------------------------------------------- the daily prize (0.05 SOL table)
// two players, paid to their own wallets so the winner could sign a claim; the night starts after
// the 60 s countdown (a 2-player night counts toward the 3 nights)
{
  const duo = [new BlackoutClient(Keypair.generate()), new BlackoutClient(Keypair.generate())];
  const highStake = stakeLamports * 5n;
  await admin.sendBase(duo.map((p) => SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: p.publicKey, lamports: highStake + BigInt(0.012 * LAMPORTS_PER_SOL) })));
  const hm = ((await admin.fetchRoom(highId))!.matchNo) + 1;
  for (const p of duo) await p.sendBase([p.buyTicketIx(highId, hm, p.publicKey)]);
  await sleep(2000);
  for (let i = 0; i < 2; i++) await duo[i].sendEr([duo[i].joinIx(highId, i, `Z${i}`, duo[i].publicKey, 0, ticketPda(highId, hm, duo[i].publicKey))]);
  const day = Math.floor(Date.now() / 86_400_000);
  const p0 = await admin.fetchPrize();
  const same = p0?.day === day;
  const entry0 = (k: PublicKey) => (same ? p0!.entries.find((e) => e.key.equals(k)) : undefined);
  const pot0 = same ? p0!.pot : 0n;
  let started = false;
  for (let i = 0; i < 40 && !started; i++) {
    await sleep(3000);
    started = await duo[0].sendEr([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100 + i }), duo[0].startIx(highId, 0)]).then(() => true, () => false);
  }
  check("a 2-player 0.05 table starts after its countdown", started);
  const hr = await waitFor(admin, highId, ST_ENDED, 180_000);
  const hw = hr.payout[hr.winner];
  const hpot = highStake * 2n;
  const hfee = hpot / 10n;
  const cut = (hpot * 350n) / 10_000n;
  const [tB, pB, wB, fB] = await Promise.all([balance(TREASURY), balance(prizePda()), balance(hw), balance(fundPda())]);
  await duo[0].sendEr([duo[0].finishIx(highId, hw)]);
  let paid = 0;
  for (let i = 0; i < 40 && !paid; i++) {
    await sleep(2000);
    paid = (await balance(hw)) - wB;
  }
  check("0.05 winner still gets the pot less 10%", BigInt(paid) === hpot - hfee, `${paid / LAMPORTS_PER_SOL} SOL`);
  const [tA, pA, fA] = await Promise.all([balance(TREASURY), balance(prizePda()), balance(fundPda())]);
  // the first 0.05 night of a new UTC day first closes the previous day: an unwon pot and an
  // unclaimed prize go to the fee wallet (that is the rule, not part of this night's split)
  let rolled = 0n;
  if (p0 && p0.day !== 0 && p0.day !== day) {
    // (an unclaimed prize is never forfeited: it stays on the owed list)
    const lead = prizeLeader(p0);
    const listFull = p0.owed.length >= 32 && !(lead >= 0 && p0.owed.some((o) => o.key.equals(p0.entries[lead].key)));
    // a pot nobody qualified for, or a prize that can't join a full owed list, goes to the fee wallet
    if (lead < 0 || p0.pot === 0n || listFull) rolled += p0.pot;
  }
  if (rolled > 0n) console.log(`(a new day: the previous day's ${Number(rolled) / 1e9} SOL went to the fee wallet first)`);
  check("the fee wallet gets 6.5% less the table fund's 0.001 at the 0.05 table", BigInt(tA - tB) === hfee - cut - 1_000_000n + rolled, `${(tA - tB) / LAMPORTS_PER_SOL} SOL`);
  check("the table fund gets 0.001 at the 0.05 table too", fA - fB === 1_000_000, `${(fA - fB) / LAMPORTS_PER_SOL} SOL`);
  check("the daily prize gets 3.5% at the 0.05 table", BigInt(pA - pB) === cut - rolled, `${(pA - pB) / LAMPORTS_PER_SOL} SOL`);
  const p1 = (await admin.fetchPrize())!;
  check("today's pot grows by the 3.5%", p1.day === day && p1.pot - pot0 === cut, `pot ${p1.pot}`);
  const ok = duo.every((p) => {
    const a = entry0(p.publicKey);
    const b = p1.entries.find((e) => e.key.equals(p.publicKey));
    const won = p.publicKey.equals(hw) ? hpot - hfee : 0n;
    return !!b && b.games === (a?.games ?? 0) + 1 && b.staked === (a?.staked ?? 0n) + highStake && b.won === (a?.won ?? 0n) + won;
  });
  check("both players' night, stake and winnings are recorded", ok);
  const lost = duo.find((p) => !p.publicKey.equals(hw))!.publicKey;
  const beatenNow = (k: PublicKey) => p1.entries.find((e) => e.key.equals(k))?.beaten ?? -1;
  check("the winner counts the loser as a player beaten (once)", beatenNow(hw) === 1 && beatenNow(lost) === 0, `${beatenNow(hw)} / ${beatenNow(lost)}`);
  const winnerClient = duo.find((p) => p.publicKey.equals(hw))!;
  await rejects("today's prize can't be claimed before the day ends", () => winnerClient.sendBase([winnerClient.claimPrizeIx(hw)]));
  const loser = duo.find((p) => !p.publicKey.equals(hw))!;
  await rejects("someone who didn't win can't claim the prize", () => loser.sendBase([loser.claimPrizeIx(loser.publicKey)]));
  await rejects("nobody can pay a prize to a wallet that isn't owed one", () => loser.sendBase([loser.claimPrizeIx(TREASURY, loser.publicKey)]));
  await duo[0].sendEr([duo[0].resetIx(highId)]).catch(() => {});
}

// ---------------------------------------------------------------- the table fund tops a table up
{
  const rent = await admin.base.getMinimumBalanceForRentExemption(0);
  const need = 20_000_000 + 5_000_000 + rent + 1_000_000 - (await balance(fundPda()));
  if (need > 0) await admin.sendBase([SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: fundPda(), lamports: need })]);
  const tee = await admin.teeConn();
  const [inRollup0, fund0] = await Promise.all([tee.getBalance(roomPda(otherId)), balance(fundPda())]);
  await rejects("only staked tables can be refilled", () => outsider.sendBase([outsider.refillTableIx(freeId)]));
  await outsider.sendBase([outsider.refillTableIx(otherId)]);
  let inRollup1 = inRollup0;
  for (let i = 0; i < 20 && inRollup1 === inRollup0; i++) {
    await sleep(3000);
    inRollup1 = await tee.getBalance(roomPda(otherId));
  }
  const fund1 = await balance(fundPda());
  check("a refill moves 0.02 SOL into the table's MagicBlock wallet", inRollup1 - inRollup0 === 20_000_000, `${(inRollup1 - inRollup0) / LAMPORTS_PER_SOL} SOL`);
  check("it comes out of the table fund (plus MagicBlock's small transfer cost)", fund0 - fund1 >= 20_000_000 && fund0 - fund1 <= 25_000_000, `${(fund0 - fund1) / LAMPORTS_PER_SOL} SOL`);
}

// ---------------------------------------------------------------- free rooms stay off Solana
const f = players[0];
const freeBefore = await admin.fetchRoomBase(freeId);
await f.sendEr([f.claimIx(freeId, 8, false)]);
await f.sendEr([f.joinIx(freeId, 0, "FREE", null, 0)]);
await f.sendEr([f.startIx(freeId, 8)]);
room = await waitFor(admin, freeId, ST_ENDED, 240_000);
const bal = await balance(roomPda(freeId));
await f.sendEr(f.withBudget(f.finishIx(freeId, null)));
await sleep(8000);
const freeAfter = await admin.fetchRoomBase(freeId);
check("free night finishes with no Solana commit", freeAfter?.matchNo === freeBefore?.matchNo && (await balance(roomPda(freeId))) === bal);
await f.sendEr(f.withBudget(f.resetIx(freeId)));
check("free room can start again", (await waitFor(admin, freeId, ST_LOBBY)).status === ST_LOBBY);
await rejects("host still can't use end_now outside a match", () => f.sendEr([f.endNowIx(freeId)]));

// ---------------------------------------------------------------- getting room money back
await rejects("outsider can't undelegate a room", () => outsider.sendEr([outsider.undelegateRoomIx(closeId)]));
await rejects("outsider can't close a room", () => outsider.sendBase([outsider.closeRoomIx(closeId)]));
const beforeClose = await balance(admin.publicKey);
await admin.sendEr([admin.undelegateRoomIx(closeId)]);
let closed = false;
for (let i = 0; i < 30 && !closed; i++) {
  await sleep(2000);
  try {
    await admin.sendBase([admin.closeRoomIx(closeId)]);
    closed = true;
  } catch {
    /* still undelegating */
  }
}
const back = (await balance(admin.publicKey)) - beforeClose;
check("closing a room returns its SOL", closed && back > 0, `${back / LAMPORTS_PER_SOL} SOL back of ${closeSpent / LAMPORTS_PER_SOL} spent`);

// clock skew between the rollup and Solana decides how much margin ticket expiry needs
const [erSlot, baseSlot] = await Promise.all([(await admin.teeConn()).getSlot(), admin.base.getSlot()]);
const [erTime, baseTime] = await Promise.all([(await admin.teeConn()).getBlockTime(erSlot).catch(() => null), admin.base.getBlockTime(baseSlot).catch(() => null)]);
console.log(`clocks: rollup ${erTime}, solana ${baseTime}, skew ${erTime && baseTime ? erTime - baseTime : "?"} s`);

console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
