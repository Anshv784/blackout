// BLACKOUT's Worker: serves the built app (assets) and a small claims API for MagicBlock Quests.
//
//   POST /api/claim            a player claims a quest: wallet + X post link, signed by the wallet
//   GET  /api/claim?quest&wallet   that claim's status (public)
//   GET  /api/claims?status=   every claim (admin)
//   POST /api/claims/review    approve / reject one claim (admin)
//
// Approving here only marks the claim. Pushing the completion to MagicBlock is done from the
// operator's own machine (scripts/quests.ts), so the MagicBlock API key never lives on this server.

interface Env {
  CLAIMS: KVNamespace;
  ADMIN_TOKEN: string;
}
// minimal types for the parts of the Workers runtime used here
interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  list(opts: { prefix?: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

/** Quests this site can verify. Keep in sync with app/src/game/quests.ts. */
const QUESTS = new Set([115]);

type Status = "pending" | "approved" | "rejected";
interface Claim {
  quest: number;
  wallet: string;
  post: string;
  at: number;
  status: Status;
  /** the quest week it counts for (see weekOf); missing on claims made before weekly claims */
  week?: number;
  note?: string;
  reviewedAt?: number;
}

export const claimMessage = (quest: number, wallet: string, post: string, at: number) =>
  `BLACKOUT quest claim\nquest: ${quest}\nwallet: ${wallet}\npost: ${post}\ntime: ${at}`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(s: string): Uint8Array | null {
  let n = 0n;
  for (const c of s) {
    const v = B58.indexOf(c);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const out: number[] = [];
  while (n > 0n) {
    out.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== "1") break;
    out.unshift(0);
  }
  return new Uint8Array(out);
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function verify(wallet: string, msg: string, sigB64: string) {
  const pk = base58(wallet);
  if (!pk || pk.length !== 32) return false;
  let sig: Uint8Array;
  try {
    sig = fromB64(sigB64);
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  const key = await crypto.subtle.importKey("raw", pk, { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", key, sig, new TextEncoder().encode(msg));
}

// an X post: x.com or twitter.com /<handle>/status/<id>
const POST_RE = /^https:\/\/(www\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{5,25}(\?\S*)?$/;
// Quests can be done again every week. A week runs Friday 08:00 UTC to the next Friday 08:00
// UTC, when MagicBlock Quests pays out. One claim per wallet per quest per week.
const WEEK_START = Date.UTC(2026, 0, 2, 8); // Fri 2 Jan 2026, 08:00 UTC
const WEEK_MS = 7 * 86_400_000;
const weekOf = (t: number) => Math.floor((t - WEEK_START) / WEEK_MS);
// claims made before weekly claims have no week in their key
const keyOf = (quest: number, wallet: string, week?: number) => (week === undefined ? `claim:${quest}:${wallet}` : `claim:${quest}:w${week}:${wallet}`);
const isAdmin = (req: Request, env: Env) => !!env.ADMIN_TOKEN && req.headers.get("authorization") === `Bearer ${env.ADMIN_TOKEN}`;

// ---- anonymous play counter: a night started by a browser's random session key (never a wallet).
// The key is hashed here; KV keeps one record per player: the first day, the last day and how many
// different days they played. /api/stats (admin) adds them up.
type Seen = { first: number; last: number; days: number; nights: number };
const utcDay = (t = Date.now()) => Math.floor(t / 86_400_000);
async function hashKey(key: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("blackout-seen:" + key)));
  return Array.from(d.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- friends-only staked tables (a soft lock: the site and app enforce it, the program doesn't).
// Tapping a staked table reserves it for a fresh code; only people with that code are let in by the
// site. The reservation lapses after RESV_SECS without a keep-alive, or is released when the night
// ends, so an unused table is always free again.
const RESV_SECS = 600;
type Resv = { room: number; code: number; at: number };
const netOf = (v: unknown) => (v === "mainnet" ? "mainnet" : "devnet");
const resvKey = (net: string, room: number) => `resv:${net}:${room}`;
const codeKey = (net: string, code: number) => `fcode:${net}:${code}`;
const newCode = () => 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % 0x3ffffffe); // 30 bits, never 0

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname.startsWith("/api/friends/")) {
    const b = req.method === "POST" ? ((await req.json().catch(() => ({}))) as { room?: number; code?: number; net?: string; rooms?: number[] }) : {};
    const net = netOf(b.net ?? url.searchParams.get("net"));
    const op = url.pathname.slice("/api/friends/".length);
    if (op === "status" && req.method === "GET") {
      // which of these tables are reserved right now (never the codes)
      const rooms = (url.searchParams.get("rooms") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 1000).slice(0, 20);
      const out: Record<number, boolean> = {};
      for (const r of rooms) out[r] = !!(await env.CLAIMS.get(resvKey(net, r)));
      return json({ reserved: out });
    }
    const room = Number(b.room);
    const code = Number(b.code);
    if (op === "reserve" && req.method === "POST") {
      if (!Number.isInteger(room) || room <= 0 || room > 1000) return json({ error: "bad room" }, 400);
      if (await env.CLAIMS.get(resvKey(net, room))) return json({ error: "busy" }, 409);
      const r: Resv = { room, code: newCode(), at: Date.now() };
      await env.CLAIMS.put(resvKey(net, room), JSON.stringify(r), { expirationTtl: RESV_SECS });
      await env.CLAIMS.put(codeKey(net, r.code), String(room), { expirationTtl: RESV_SECS });
      return json({ room, code: r.code });
    }
    if (op === "lookup" && req.method === "POST") {
      const v = Number.isInteger(code) && code > 0 ? await env.CLAIMS.get(codeKey(net, code)) : null;
      return v ? json({ room: Number(v) }) : json({ error: "no such code" }, 404);
    }
    if ((op === "keep" || op === "release") && req.method === "POST") {
      const v = await env.CLAIMS.get(resvKey(net, room));
      if (!v) return json({ ok: false, gone: true });
      const r = JSON.parse(v) as Resv;
      if (r.code !== code) return json({ error: "wrong code" }, 403);
      if (op === "keep") {
        await env.CLAIMS.put(resvKey(net, room), v, { expirationTtl: RESV_SECS });
        await env.CLAIMS.put(codeKey(net, code), String(room), { expirationTtl: RESV_SECS });
      } else {
        await env.CLAIMS.delete(resvKey(net, room));
        await env.CLAIMS.delete(codeKey(net, code));
      }
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  }
  if (url.pathname === "/api/seen" && req.method === "POST") {
    const b = (await req.json().catch(() => null)) as { key?: string; net?: string } | null;
    const key = String(b?.key ?? "");
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key)) return json({ ok: false }, 400);
    const net = b?.net === "devnet" ? "devnet" : "mainnet";
    const k = `seen:${net}:${await hashKey(key)}`;
    const today = utcDay();
    const prev = await env.CLAIMS.get(k);
    const s: Seen = prev ? JSON.parse(prev) : { first: today, last: today, days: 1, nights: 0 };
    if (prev && s.last !== today) {
      s.days += 1;
      s.last = today;
    }
    s.nights += 1;
    await env.CLAIMS.put(k, JSON.stringify(s));
    return json({ ok: true });
  }
  if (url.pathname === "/api/stats" && req.method === "GET") {
    if (!isAdmin(req, env)) return json({ error: "unauthorized" }, 401);
    const net = url.searchParams.get("net") === "devnet" ? "devnet" : "mainnet";
    const today = utcDay();
    const out = { net, players: 0, returning: 0, nights: 0, today: 0, last7: 0, byFirstDay: {} as Record<string, number> };
    let cursor: string | undefined;
    do {
      const page = await env.CLAIMS.list({ prefix: `seen:${net}:`, cursor });
      for (const key of page.keys) {
        const v = await env.CLAIMS.get(key.name);
        if (!v) continue;
        const s = JSON.parse(v) as Seen;
        out.players++;
        out.nights += s.nights;
        if (s.days >= 2) out.returning++;
        if (s.last === today) out.today++;
        if (today - s.last < 7) out.last7++;
        const d = new Date(s.first * 86_400_000).toISOString().slice(0, 10);
        out.byFirstDay[d] = (out.byFirstDay[d] ?? 0) + 1;
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return json(out);
  }
  if (url.pathname === "/api/claim" && req.method === "POST") {
    const b = (await req.json().catch(() => null)) as { quest?: number; wallet?: string; post?: string; at?: number; sig?: string } | null;
    if (!b || typeof b.quest !== "number" || !QUESTS.has(b.quest)) return json({ error: "Unknown quest" }, 400);
    const wallet = String(b.wallet ?? "");
    const post = String(b.post ?? "").trim();
    const at = Number(b.at);
    if (!POST_RE.test(post) || post.length > 200) return json({ error: "Paste the link to your post on X (x.com/…/status/…)" }, 400);
    if (!Number.isFinite(at) || Math.abs(Date.now() - at) > 10 * 60_000) return json({ error: "Signature expired, try again" }, 400);
    if (!(await verify(wallet, claimMessage(b.quest, wallet, post, at), String(b.sig ?? "")))) return json({ error: "The wallet signature didn't check out" }, 400);
    const week = weekOf(Date.now());
    const k = keyOf(b.quest, wallet, week);
    const prev = await env.CLAIMS.get(k);
    if (prev) {
      const p = JSON.parse(prev) as Claim;
      if (p.status !== "rejected") return json({ claim: p, already: true });
    }
    const claim: Claim = { quest: b.quest, wallet, post, at: Date.now(), status: "pending", week };
    await env.CLAIMS.put(k, JSON.stringify(claim));
    return json({ claim });
  }
  if (url.pathname === "/api/claim" && req.method === "GET") {
    const quest = Number(url.searchParams.get("quest"));
    const wallet = url.searchParams.get("wallet") ?? "";
    const week = weekOf(Date.now());
    const v = await env.CLAIMS.get(keyOf(quest, wallet, week));
    const nextWeekAt = WEEK_START + (week + 1) * WEEK_MS;
    return json({ claim: v ? JSON.parse(v) : null, week, nextWeekAt });
  }
  if (url.pathname === "/api/claims" && req.method === "GET") {
    if (!isAdmin(req, env)) return json({ error: "unauthorized" }, 401);
    const want = url.searchParams.get("status");
    const out: Claim[] = [];
    let cursor: string | undefined;
    do {
      const page = await env.CLAIMS.list({ prefix: "claim:", cursor });
      for (const k of page.keys) {
        const v = await env.CLAIMS.get(k.name);
        if (!v) continue;
        const c = JSON.parse(v) as Claim;
        if (!want || want === "all" || c.status === want) out.push(c);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    out.sort((a, b) => a.at - b.at);
    return json({ claims: out });
  }
  if (url.pathname === "/api/claims/review" && req.method === "POST") {
    if (!isAdmin(req, env)) return json({ error: "unauthorized" }, 401);
    const b = (await req.json().catch(() => null)) as { quest?: number; wallet?: string; week?: number; status?: Status; note?: string } | null;
    if (!b || !b.wallet || typeof b.quest !== "number" || (b.status !== "approved" && b.status !== "rejected")) return json({ error: "bad request" }, 400);
    const k = keyOf(b.quest, b.wallet, typeof b.week === "number" ? b.week : undefined);
    const v = await env.CLAIMS.get(k);
    if (!v) return json({ error: "no such claim" }, 404);
    const c = { ...(JSON.parse(v) as Claim), status: b.status, note: b.note, reviewedAt: Date.now() };
    await env.CLAIMS.put(k, JSON.stringify(c));
    return json({ claim: c });
  }
  return json({ error: "not found" }, 404);
}

export default {
  async fetch(req: Request, env: Env & { ASSETS: { fetch(r: Request): Promise<Response> } }): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return api(req, env, url);
    return env.ASSETS.fetch(req);
  },
};
