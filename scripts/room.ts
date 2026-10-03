import { Keypair } from "@solana/web3.js";
import { BlackoutClient } from "../app/src/chain/client.ts";
import { STATUS_NAME } from "../app/src/chain/layout.ts";
const c = new BlackoutClient(Keypair.generate());
for (const a of process.argv.slice(2)) {
  const r = await c.fetchRoom(BigInt(a));
  if (!r) { console.log(a, "missing"); continue; }
  console.log(`room ${a}: ${STATUS_NAME[r.status]} match=${r.matchNo} tick=${r.tick} mask=0x${r.readyMask.toString(16)} players=${r.players.map((p, i) => r.isBot[i] ? "BOT:" + r.names[i] : p.toBase58() === "11111111111111111111111111111111" ? "-" : r.names[i] || p.toBase58().slice(0, 4)).join(",")} alive=${r.aliveCount} winner=${r.winner} zone=${r.zone.r} seed=${r.seedRevealed}`);
}
