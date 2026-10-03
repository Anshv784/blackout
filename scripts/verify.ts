import { Keypair } from "@solana/web3.js";
import { BlackoutClient } from "../app/src/chain/client.ts";
import { verifyMatch } from "../app/src/game/verify.ts";
const c = new BlackoutClient(Keypair.generate());
const id = BigInt(process.argv[2]);
const [room, world, rec] = [await c.fetchRoom(id), await c.fetchWorld(id), await c.fetchRecording(id)];
if (!room || !world || !rec) { console.log("not revealed", !!room, !!world, !!rec); process.exit(0); }
const occ = Array.from({ length: 8 }, (_, s) => room.isBot[s] === 1 || room.players[s].toBase58() !== "11111111111111111111111111111111");
console.log(verifyMatch(room, world, rec, occ));
