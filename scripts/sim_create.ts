import { Keypair, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs"; import os from "os";
import { BlackoutClient } from "../app/src/chain/client.ts";
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/blackout-devnet.json`, "utf8"))));
const c = new BlackoutClient(admin);
const ixs = c.createRoomIxs(1n, 0n, 0, 0.06 * LAMPORTS_PER_SOL);
for (const set of [[ixs[0]], [ixs[0], ixs[1]], ixs]) {
  const tx = new Transaction().add(...set); tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await c.base.getLatestBlockhash()).blockhash; tx.sign(admin);
  const s = await c.base.simulateTransaction(tx);
  console.log(set.length, JSON.stringify(s.value.err), s.value.logs?.slice(-6));
}
