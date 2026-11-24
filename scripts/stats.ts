// Players so far (anonymous counter in worker/index.ts):
//   CLAIMS_URL=https://playblackout.fun npx tsx scripts/stats.ts [mainnet|devnet]
import fs from "fs";
import os from "os";
const base = process.env.CLAIMS_URL ?? "http://127.0.0.1:8787";
const local = base.includes("127.0.0.1") || base.includes("localhost");
const token = fs.readFileSync(`${os.homedir()}/.config/blackout/claims-admin-token${local ? "-local" : ""}.txt`, "utf8").trim();
const net = process.argv[2] ?? "mainnet";
const r = await fetch(`${base}/api/stats?net=${net}`, { headers: { authorization: `Bearer ${token}` } });
const s = await r.json();
if (!r.ok) throw new Error(JSON.stringify(s));
console.log(`${s.net}: ${s.players} players · ${s.returning} came back on another day · ${s.nights} nights`);
console.log(`active today ${s.today} · last 7 days ${s.last7}`);
for (const [d, n] of Object.entries(s.byFirstDay).sort()) console.log(`  new on ${d}: ${n}`);
