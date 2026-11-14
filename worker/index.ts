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
const keyOf = (quest: number, wallet: string) => `claim:${quest}:${wallet}`;
const isAdmin = (req: Request, env: Env) => !!env.ADMIN_TOKEN && req.headers.get("authorization") === `Bearer ${env.ADMIN_TOKEN}`;

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/api/claim" && req.method === "POST") {
    const b = (await req.json().catch(() => null)) as { quest?: number; wallet?: string; post?: string; at?: number; sig?: string } | null;
    if (!b || typeof b.quest !== "number" || !QUESTS.has(b.quest)) return json({ error: "Unknown quest" }, 400);
    const wallet = String(b.wallet ?? "");
    const post = String(b.post ?? "").trim();
    const at = Number(b.at);
    if (!POST_RE.test(post) || post.length > 200) return json({ error: "Paste the link to your post on X (x.com/…/status/…)" }, 400);
    if (!Number.isFinite(at) || Math.abs(Date.now() - at) > 10 * 60_000) return json({ error: "Signature expired, try again" }, 400);
    if (!(await verify(wallet, claimMessage(b.quest, wallet, post, at), String(b.sig ?? "")))) return json({ error: "The wallet signature didn't check out" }, 400);
    const k = keyOf(b.quest, wallet);
    const prev = await env.CLAIMS.get(k);
    if (prev) {
      const p = JSON.parse(prev) as Claim;
      if (p.status !== "rejected") return json({ claim: p, already: true });
    }
    const claim: Claim = { quest: b.quest, wallet, post, at: Date.now(), status: "pending" };
    await env.CLAIMS.put(k, JSON.stringify(claim));
    return json({ claim });
  }
  if (url.pathname === "/api/claim" && req.method === "GET") {
    const quest = Number(url.searchParams.get("quest"));
    const wallet = url.searchParams.get("wallet") ?? "";
    const v = await env.CLAIMS.get(keyOf(quest, wallet));
    return json({ claim: v ? JSON.parse(v) : null });
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
    const b = (await req.json().catch(() => null)) as { quest?: number; wallet?: string; status?: Status; note?: string } | null;
    if (!b || !b.wallet || typeof b.quest !== "number" || (b.status !== "approved" && b.status !== "rejected")) return json({ error: "bad request" }, 400);
    const k = keyOf(b.quest, b.wallet);
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
