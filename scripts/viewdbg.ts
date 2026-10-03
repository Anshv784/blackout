import { Keypair } from "@solana/web3.js";
import { BlackoutClient } from "../app/src/chain/client.ts";
import { decodeView, STATUS_NAME } from "../app/src/chain/layout.ts";
const id = BigInt(process.argv[2]);
const c = new BlackoutClient(Keypair.generate());
const retry = async <T>(f: () => Promise<T>): Promise<T> => { for (let i = 0; ; i++) { try { return await f(); } catch (e) { if (i > 4) throw e; await new Promise((r) => setTimeout(r, 500)); } } };
let r = await retry(() => c.fetchRoom(id));
if (r!.status === 5) { await c.sendEr([c.resetIx(id)]); r = await c.fetchRoom(id); }
console.log("room", STATUS_NAME[r!.status], "seats", r!.players.map((p) => p.toBase58().slice(0, 4)).join(","));
const seat = r!.players.findIndex((p, i) => p.toBase58() === "11111111111111111111111111111111" && r!.isBot[i] === 0);
console.log("joining seat", seat, await c.sendEr([c.joinIx(id, seat, "DBG", null)]).catch((e) => e.message));
let n = 0;
await c.onView(id, seat, (d) => { const v = decodeView(d); if (n++ % 20 === 0) console.log("ws view tick", v.tick, "status", v.status, "alive", v.me.alive, "hp", v.me.hp, "pos", v.me.x, v.me.y); });
console.log("fetch view", JSON.stringify((await c.fetchView(id, seat))?.me));
console.log("start", await c.sendEr([c.startIx(id, 3)]).catch((e) => e.message));
for (let i = 0; i < 9; i++) { await new Promise((res) => setTimeout(res, 1000)); const vv = await retry(() => c.fetchView(id, seat)); console.log(`t+${i+1}s http view tick`, vv?.tick, "alive", vv?.me.alive, "hp", vv?.me.hp, "x", vv?.me.x, "place", vv?.place); }
const v = await retry(() => c.fetchView(id, seat));
console.log("after 9s fetch view tick", v?.tick, "alive", v?.me.alive, "hp", v?.me.hp, "ws msgs", n);
r = await retry(() => c.fetchRoom(id));
console.log("room", STATUS_NAME[r!.status], "tick", r!.tick, "alive", r!.alive.join(","), "aliveCount", r!.aliveCount);
process.exit(0);
