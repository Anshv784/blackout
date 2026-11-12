// Fair-play report: reads every staked night the program logged at payout (the NightRecord event)
// and flags wallets worth a look. Flags only: nothing here bans anyone.
//   npx tsx scripts/fairplay.ts            (last ~3000 program transactions)
//   npx tsx scripts/fairplay.ts --all      (also print every wallet's and pair's numbers)
// Thresholds (env): PAIR_MIN=5 nights together, WALLET_MIN=10 nights, WIN_RATE=0.5, KILLS_AVG=3
// Mainnet: VITE_CLUSTER=mainnet VITE_BASE_RPC=... VITE_PROGRAM_ID=... npx tsx scripts/fairplay.ts
import { Keypair, PublicKey } from "@solana/web3.js";
import { BorshEventCoder } from "@coral-xyz/anchor";
import idl from "../app/src/idl/blackout.json";
import { BlackoutClient, PROGRAM_ID } from "../app/src/chain/client.ts";
import { NO_SEAT } from "../app/src/chain/layout.ts";

const all = process.argv.includes("--all");
const LIMIT = Number(process.env.LIMIT ?? 3000);
const PAIR_MIN = Number(process.env.PAIR_MIN ?? 5);
const WALLET_MIN = Number(process.env.WALLET_MIN ?? 10);
const WIN_RATE = Number(process.env.WIN_RATE ?? 0.5);
const KILLS_AVG = Number(process.env.KILLS_AVG ?? 3);
const EMPTY = PublicKey.default.toBase58();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Night = { room: string; match: number; stake: number; winner: number; wallets: string[]; kills: number[]; feed: [number, number][] };

const c = new BlackoutClient(Keypair.generate());
async function logsOf(sig: string): Promise<{ meta: { logMessages: string[] } } | null> {
  for (let t = 0; t < 3; t++) {
    try {
      const res: any = await (c.base as any)._rpcRequest("getTransaction", [sig, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]);
      if (res.error) throw new Error(res.error.message);
      return res.result;
    } catch {
      await sleep(1500);
    }
  }
  return null;
}
const coder = new BorshEventCoder(idl as any);

// 1. the program's recent transactions
const sigs: string[] = [];
let before: string | undefined;
while (sigs.length < LIMIT) {
  const page = await c.base.getSignaturesForAddress(PROGRAM_ID, { before, limit: 1000 });
  if (!page.length) break;
  sigs.push(...page.filter((s) => !s.err).map((s) => s.signature));
  before = page[page.length - 1].signature;
}

// 2. the NightRecord events in them
const nights = new Map<string, Night>();
for (let i = 0; i < sigs.length; i += 20) {
  // only the logs are needed: raw requests, so newer transaction versions don't trip the decoder
  const txs = await Promise.all(sigs.slice(i, i + 20).map((sig) => logsOf(sig)));
  for (const tx of txs) {
    for (const line of tx?.meta?.logMessages ?? []) {
      if (!line.startsWith("Program data: ")) continue;
      const ev = (() => {
        try {
          return coder.decode(line.slice(14));
        } catch {
          return null;
        }
      })();
      if (!ev || ev.name.toLowerCase() !== "nightrecord") continue;
      const d: any = ev.data;
      const get = (a: string, b: string) => d[a] ?? d[b];
      const n: Night = {
        room: String(get("room_id", "roomId")),
        match: Number(get("match_no", "matchNo")),
        stake: Number(d.stake) / 1e9,
        winner: Number(d.winner),
        wallets: d.wallets.map((k: PublicKey) => k.toBase58()),
        kills: Array.from(d.kills as number[]).map(Number),
        feed: Array.from(get("feed_killer", "feedKiller") as number[]).map((k, j) => [Number(k), Number(get("feed_victim", "feedVictim")[j])] as [number, number]),
      };
      nights.set(`${n.room}/${n.match}`, n);
    }
  }
  if (i % 200 === 0) process.stdout.write(`\rreading ${Math.min(i + 20, sigs.length)}/${sigs.length} transactions…`);
  await sleep(150);
}
console.log(`\r${nights.size} staked nights found in ${sigs.length} transactions`);

// 3. per wallet and per pair
const board = await c.fetchBoard().catch(() => null);
const names = new Map((board?.entries ?? []).map((e) => [e.key.toBase58(), e.name] as const));
const label = (k: string) => `${names.get(k) || "?"} ${k.slice(0, 4)}…${k.slice(-4)}`;

type W = { nights: number; wins: number; kills: number; bigNights: number; bigWins: number };
const wallets = new Map<string, W>();
type P = { together: number; aKillsB: number; bKillsA: number; aWins: number; bWins: number };
const pairs = new Map<string, P>();

for (const n of nights.values()) {
  const seats = n.wallets.map((k, s) => [k, s] as const).filter(([k]) => k !== EMPTY);
  const big = seats.length >= 4;
  for (const [k, s] of seats) {
    const w = wallets.get(k) ?? { nights: 0, wins: 0, kills: 0, bigNights: 0, bigWins: 0 };
    w.nights++;
    w.kills += n.kills[s];
    if (n.winner === s) w.wins++;
    if (big) {
      w.bigNights++;
      if (n.winner === s) w.bigWins++;
    }
    wallets.set(k, w);
  }
  for (let i = 0; i < seats.length; i++)
    for (let j = i + 1; j < seats.length; j++) {
      let [[a, sa], [b, sb]] = [seats[i], seats[j]];
      if (a === b) continue; // one wallet in two seats
      if (a > b) [[a, sa], [b, sb]] = [[b, sb], [a, sa]];
      const key = `${a}|${b}`;
      const p = pairs.get(key) ?? { together: 0, aKillsB: 0, bKillsA: 0, aWins: 0, bWins: 0 };
      p.together++;
      for (const [killer, victim] of n.feed) {
        if (killer === NO_SEAT) continue;
        if (killer === sa && victim === sb) p.aKillsB++;
        if (killer === sb && victim === sa) p.bKillsA++;
      }
      if (n.winner === sa) p.aWins++;
      if (n.winner === sb) p.bWins++;
      pairs.set(key, p);
    }
}

// 4. flags
const flags: string[] = [];
for (const [key, p] of pairs) {
  if (p.together < PAIR_MIN || p.aKillsB + p.bKillsA > 0) continue;
  const [a, b] = key.split("|");
  const wa = wallets.get(a)!;
  const wb = wallets.get(b)!;
  // does one of them win much more often with the other at the table?
  const lift = (wins: number, w: W) => {
    const withRate = wins / p.together;
    const otherNights = w.nights - p.together;
    const withoutRate = otherNights > 0 ? (w.wins - wins) / otherNights : 0;
    return { withRate, withoutRate };
  };
  const la = lift(p.aWins, wa);
  const lb = lift(p.bWins, wb);
  const boosted = la.withRate >= la.withoutRate + 0.25 || lb.withRate >= lb.withoutRate + 0.25 || (p.aWins + p.bWins) / p.together >= 0.6;
  if (!boosted) continue;
  flags.push(
    `TEAMING?  ${label(a)} + ${label(b)}: ${p.together} nights together, never killed each other, ` +
      `wins together ${p.aWins}/${p.bWins} (${Math.round(la.withRate * 100)}% / ${Math.round(lb.withRate * 100)}% vs ${Math.round(la.withoutRate * 100)}% / ${Math.round(lb.withoutRate * 100)}% apart)`,
  );
}
for (const [k, w] of wallets) {
  if (w.nights < WALLET_MIN) continue;
  const bigRate = w.bigNights ? w.bigWins / w.bigNights : 0;
  const avg = w.kills / w.nights;
  if ((w.bigNights >= WALLET_MIN / 2 && bigRate > WIN_RATE) || avg >= KILLS_AVG)
    flags.push(`AIM?      ${label(k)}: ${w.nights} nights, won ${w.bigWins}/${w.bigNights} at 4+ player tables (${Math.round(bigRate * 100)}%), ${avg.toFixed(1)} kills a night`);
}

console.log(flags.length ? `\n${flags.length} to look at (flags, not proof):\n${flags.join("\n")}` : "\nNothing to flag.");

if (all) {
  console.log("\nwallets (nights · wins · kills/night · wins at 4+ tables):");
  for (const [k, w] of [...wallets].sort((x, y) => y[1].nights - x[1].nights))
    console.log(`  ${label(k)}  ${w.nights} · ${w.wins} · ${(w.kills / w.nights).toFixed(1)} · ${w.bigWins}/${w.bigNights}`);
  console.log("\npairs (nights together · kills on each other · wins):");
  for (const [key, p] of [...pairs].sort((x, y) => y[1].together - x[1].together).slice(0, 30)) {
    const [a, b] = key.split("|");
    console.log(`  ${label(a)} + ${label(b)}  ${p.together} · ${p.aKillsB}/${p.bKillsA} · ${p.aWins}/${p.bWins}`);
  }
}
