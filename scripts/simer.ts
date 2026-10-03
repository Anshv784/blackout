// Simulate an ER instruction and print logs (debug helper).
import { Keypair, Transaction } from "@solana/web3.js";
import fs from "fs"; import os from "os";
import { BlackoutClient } from "../app/src/chain/client.ts";
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/blackout-devnet.json`, "utf8"))));
const c = new BlackoutClient(admin);
const id = BigInt(process.argv[3] ?? 1);
const which = process.argv[2];
const ixs: any = { core: [c.setupCoreIx(id)], rec: [0,1,2,3,4].map((k) => c.setupRecIx(id, k)), rec0: [c.setupRecIx(id, 0)], view0: [c.setupViewIx(id, 0)], tick: [c.tickIx(id)], input: [c.inputIx(id, 1, 1, 0, 0, 1)] }[which];
const conn = await c.teeConn();
const tx = new Transaction().add(...ixs); tx.feePayer = admin.publicKey;
tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash; tx.sign(admin);
const s = await conn.simulateTransaction(tx);
console.log(JSON.stringify(s.value.err), s.value.logs);
