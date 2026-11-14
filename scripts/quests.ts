// Review MagicBlock Quests claims from #/claim and send the approved ones to MagicBlock.
//
//   npx tsx scripts/quests.ts list [pending|approved|rejected|all]
//   npx tsx scripts/quests.ts approve <wallet> [quest]        push to MagicBlock, then mark approved
//   npx tsx scripts/quests.ts reject <wallet> [quest] [note]
//
// CLAIMS_URL  where the site runs (default http://127.0.0.1:8787, the local wrangler dev;
//             use https://playblackout.fun once deployed)
// Admin token: ~/.config/blackout/claims-admin-token.txt (live) or …-local.txt (local)
// MagicBlock key: ~/.config/blackout/quest-key.txt, never on the server or in git
// DRY=1       approve without calling MagicBlock (testing)
import fs from "fs";
import os from "os";

const BASE = process.env.CLAIMS_URL ?? "http://127.0.0.1:8787";
const LOCAL = /127\.0\.0\.1|localhost/.test(BASE);
const read = (f: string) => fs.readFileSync(`${os.homedir()}/.config/blackout/${f}`, "utf8").trim();
const token = read(LOCAL ? "claims-admin-token-local.txt" : "claims-admin-token.txt");
const PUSH_URL = process.env.QUESTS_PUSH_URL ?? "https://quests.magicblock.app/api/validators/push";
const DEFAULT_QUEST = 115;

type Claim = { quest: number; wallet: string; post: string; at: number; status: string; note?: string };
const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${path}: ${r.status} ${j.error ?? ""}`);
    return j;
  });

const [cmd, a1, a2, ...rest] = process.argv.slice(2);
if (cmd === "list") {
  const { claims } = (await admin(`/api/claims?status=${a1 ?? "pending"}`)) as { claims: Claim[] };
  if (!claims.length) console.log(`no ${a1 ?? "pending"} claims`);
  for (const c of claims) console.log(`${new Date(c.at).toISOString().slice(0, 16)}  quest ${c.quest}  ${c.status.padEnd(8)}  ${c.wallet}\n    ${c.post}${c.note ? `\n    note: ${c.note}` : ""}`);
} else if (cmd === "approve" && a1) {
  const quest = Number(a2 ?? DEFAULT_QUEST);
  const { claim } = (await fetch(`${BASE}/api/claim?quest=${quest}&wallet=${a1}`).then((r) => r.json())) as { claim: Claim | null };
  if (!claim) throw new Error(`no claim for ${a1} on quest ${quest}`);
  if (claim.status === "approved") {
    console.log("already approved");
    process.exit(0);
  }
  if (process.env.DRY === "1") console.log("DRY: not sending to MagicBlock");
  else {
    const r = await fetch(PUSH_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${read("quest-key.txt")}`, "content-type": "application/json" },
      body: JSON.stringify({ payload: { quest, user: a1, timestamp: Date.now() } }),
    });
    const body = await r.text();
    if (!r.ok) throw new Error(`MagicBlock refused (${r.status}): ${body.slice(0, 300)}`);
    console.log("MagicBlock:", r.status, body.slice(0, 200));
  }
  await admin("/api/claims/review", { method: "POST", body: JSON.stringify({ quest, wallet: a1, status: "approved" }) });
  console.log(`approved ${a1} for quest ${quest}`);
} else if (cmd === "reject" && a1) {
  const quest = Number(a2 ?? DEFAULT_QUEST);
  await admin("/api/claims/review", { method: "POST", body: JSON.stringify({ quest, wallet: a1, status: "rejected", note: rest.join(" ") || undefined }) });
  console.log(`rejected ${a1} for quest ${quest}`);
} else console.log("usage: list [pending|approved|rejected|all] | approve <wallet> [quest] | reject <wallet> [quest] [note]");
