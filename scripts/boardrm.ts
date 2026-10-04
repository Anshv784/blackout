import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import fs from "fs"; import os from "os";
import { BlackoutClient, boardPda, PROGRAM_ID } from "../app/src/chain/client.ts";
import idl from "../app/src/idl/blackout.json" with { type: "json" };
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/blackout-devnet.json`, "utf8"))));
const c = new BlackoutClient(admin);
const disc = Buffer.from((idl as any).instructions.find((i: any) => i.name === "board_remove").discriminator);
for (const k of process.argv.slice(2)) {
  const ix = new TransactionInstruction({ programId: PROGRAM_ID, keys: [{ pubkey: boardPda(), isSigner: false, isWritable: true }, { pubkey: admin.publicKey, isSigner: true, isWritable: false }], data: Buffer.concat([disc, new PublicKey(k).toBuffer()]) });
  console.log("removed", k, await c.sendBase([ix]));
}
