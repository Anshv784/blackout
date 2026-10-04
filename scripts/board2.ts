import { Keypair } from "@solana/web3.js";
import { BlackoutClient } from "../app/src/chain/client.ts";
const c = new BlackoutClient(Keypair.generate());
const b = await c.fetchBoard();
console.log("board2 matches", b?.matches, b?.entries.map((e) => `${e.name || "?"}=${e.key.toBase58().slice(0, 4)} g${e.games} w${e.wins} k${e.kills}`));
