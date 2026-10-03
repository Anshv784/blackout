// End-to-end match on devnet: 2 unfunded players + bots, VRF, crank, privacy checks, finish + Magic Action, reset.
import fs from "fs";
//   npx tsx scripts/e2e.ts <roomId>
import { Keypair } from "@solana/web3.js";
import { BlackoutClient, viewPda, worldPda, recPda, roomPda } from "../app/src/chain/client.ts";
import { STATUS_NAME, ST_ENDED, ST_LIVE, ST_REVEALED, ST_LOBBY, NO_SEAT, decodeView } from "../app/src/chain/layout.ts";

const roomId = BigInt(process.argv[2] ?? 2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const A = new BlackoutClient(process.env.AKEY ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.AKEY, "utf8")))) : Keypair.generate());
const B = new BlackoutClient(Keypair.generate());
const spectator = new BlackoutClient(Keypair.generate());
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

async function canRead(c: BlackoutClient, pk: any) {
  const conn = await c.teeConn();
  return !!(await conn.getAccountInfo(pk).catch(() => null));
}

let room = await A.fetchRoom(roomId);
log("room", STATUS_NAME[room!.status], "mask", room!.readyMask.toString(16));
if (room!.status === ST_REVEALED) {
  log("reset leftover", await A.sendEr([A.resetIx(roomId)]));
  room = await A.fetchRoom(roomId);
}
const free = room!.players.map((p, i) => (p.equals(new Keypair().publicKey) ? -1 : i)); // placeholder
const empty = (i: number) => room!.players[i].toBase58() === "11111111111111111111111111111111" && room!.isBot[i] === 0;
const seats = [0, 1, 2, 3, 4, 5, 6, 7].filter(empty);
void free;
const [sa, sb] = seats;
log("joining seats", sa, sb);
log("A join", await A.sendEr([A.joinIx(roomId, sa, "ALPHA", null)]));
log("B join", await B.sendEr([B.joinIx(roomId, sb, "BRAVO", null)]));

// privacy before start
log("A reads own view:", await canRead(A, viewPda(roomId, sa)), "| A reads B view:", await canRead(A, viewPda(roomId, sb)), "| spectator reads world:", await canRead(spectator, worldPda(roomId)));

log("A start (fill to 6)", await A.sendEr([A.startIx(roomId, 6)]));
let seededAt = 0;
let liveAt = 0;
let views = 0;
let lastViewTick = 0;
const unsub = await A.onView(roomId, sa, (d) => {
  views++;
  lastViewTick = decodeView(d).tick;
});

let seq = 0;
let ended = false;
const ticksSeen: [number, number][] = [];
while (!ended && Date.now() - t0 < 240_000) {
  room = await A.fetchRoom(roomId);
  const st = room!.status;
  if (!seededAt && st >= 2) {
    seededAt = Date.now();
    log("seeded:", room!.seedRevealed === 2 ? "FALLBACK" : "VRF", "status", STATUS_NAME[st]);
  }
  if (!liveAt && st === ST_LIVE) {
    liveAt = Date.now();
    log("LIVE. alive", room!.aliveCount, "names", room!.names.join(","));
  }
  if (st === 1 && Date.now() - t0 > 25_000) {
    log("VRF slow -> fallback seed", await A.sendEr([A.fallbackSeedIx(roomId)]).catch((e) => e.message));
  }
  if (st === ST_LIVE) {
    ticksSeen.push([Date.now(), room!.tick]);
    for (const [c, s] of [[A, sa], [B, sb]] as const) {
      const a = Math.random() * Math.PI * 2;
      c.sendEr([c.inputIx(roomId, Math.cos(a) * 127, Math.sin(a) * 127, Math.floor(Math.random() * 65536), 1, ++seq)], { confirm: false }).catch(() => {});
      void s;
    }
    if (ticksSeen.length % 10 === 0) {
      const v = await A.fetchView(roomId, sa);
      log(`tick ${room!.tick} alive ${room!.aliveCount} zone r=${(room!.zone.r / 256).toFixed(1)} | A: hp ${v?.me.hp} pos (${((v?.me.x ?? 0) / 256).toFixed(1)},${((v?.me.y ?? 0) / 256).toFixed(1)}) sees ${v?.players.length} bullets ${v?.bullets.length} loot ${v?.loot.length} pings ${v?.pingHead} | ws views ${views} (last tick ${lastViewTick})`);
    }
  }
  if (st === ST_ENDED || st === ST_REVEALED) ended = true;
  await sleep(250);
}
unsub();
if (ticksSeen.length > 2) {
  const [ta, ka] = ticksSeen[0];
  const [tb, kb] = ticksSeen[ticksSeen.length - 1];
  log(`tick rate observed: ${(((kb - ka) * 1000) / (tb - ta)).toFixed(1)} /s`);
}
room = await A.fetchRoom(roomId);
log("ENDED status", STATUS_NAME[room!.status], "winner", room!.winner, room!.winner !== NO_SEAT ? room!.names[room!.winner] : "-", "places", room!.place.join(","), "kills", room!.kills.join(","));
log("feed", room!.feed.slice(0, Math.min(16, room!.feedHead)).map((f) => `${f.killer === 255 ? "ZONE" : room!.names[f.killer]}>${room!.names[f.victim]}`).join(" "));
log("spectator reads world BEFORE finish:", await canRead(spectator, worldPda(roomId)), "rec0:", await canRead(spectator, recPda(roomId, 0)));

if (room!.status === ST_ENDED) {
  const w = room!.winner;
  const winnerPayout = w !== NO_SEAT && room!.isBot[w] === 0 ? room!.payout[w] : null;
  log("finish", await A.sendEr([A.finishIx(roomId, winnerPayout)]));
}
await sleep(1500);
log("spectator reads world AFTER finish:", await canRead(spectator, worldPda(roomId)), "rec0:", await canRead(spectator, recPda(roomId, 0)));
const world = await spectator.fetchWorld(roomId);
log("world seed", world ? Buffer.from(world.seed).toString("hex").slice(0, 16) : null, "zone plan", world?.zone.map((z) => `(${(z.x / 256).toFixed(1)},${(z.y / 256).toFixed(1)} r${(z.r / 256).toFixed(0)})`).join(" "));
const rec = await spectator.fetchRecording(roomId);
log("recording frames", rec?.frames, "first frame", rec?.data[0]?.slice(0, 3));

for (let i = 0; i < 20; i++) {
  const base = await A.fetchRoomBase(roomId);
  const board = await A.fetchBoard();
  if (base && base.matchNo === room!.matchNo) {
    log("committed to Solana: base room match", base.matchNo, "status", STATUS_NAME[base.status], "| board matches", board?.matches, "entries", board?.entries.length);
    break;
  }
  await sleep(2000);
}
log("reset", await A.sendEr([A.resetIx(roomId)]).catch((e) => e.message));
room = await A.fetchRoom(roomId);
log("after reset", STATUS_NAME[room!.status], "seated", room!.nPlayers, "world readable by spectator:", await canRead(spectator, worldPda(roomId)));
// leave so the room is clean
for (const [c, s] of [[A, sa], [B, sb]] as const) if (room!.status === ST_LOBBY) await c.sendEr([c.leaveIx(roomId, s)]).catch(() => {});
log("done", roomPda(roomId).toBase58());
process.exit(0);
