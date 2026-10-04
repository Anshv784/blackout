import { Keypair } from "@solana/web3.js";
import { BlackoutClient } from "../app/src/chain/client.ts";
const c = new BlackoutClient(Keypair.generate());
for (const id of process.argv.slice(2)) {
  const r = await c.fetchRoom(BigInt(id));
  console.log(id, r && { status: r.status, matchNo: r.matchNo, host: r.host.toBase58().slice(0, 6), seats: r.players.map((p, i) => (p.toBase58().startsWith("1111") ? "-" : `${r.names[i]}${r.isBot[i] ? "(bot)" : ""}`)) });
}
const b = await c.fetchBoard();
console.log("board3 matches", b?.matches, b?.entries.map((e) => `${e.name} w${e.wins} ${Number(e.earned) / 1e9}SOL`));
