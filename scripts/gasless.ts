import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import idl from "../target/idl/blackout.json" with { type: "json" };
const TEE = "https://devnet-tee.magicblock.app";
const room = new PublicKey(process.argv[2]);
const kp = Keypair.generate();
const auth = await getAuthToken(TEE, kp.publicKey, (m) => Promise.resolve(nacl.sign.detached(m, kp.secretKey)));
const conn = new Connection(`${TEE}?token=${auth.token}`, "confirmed");
const program = new anchor.Program(idl as any, { connection: conn } as any);
const pid = program.programId;
const info = await conn.getAccountInfo(room);
const r: any = program.coder.accounts.decode("room", info!.data);
const rid = new anchor.BN(r.roomId).toArrayLike(Buffer, "le", 8);
const world = PublicKey.findProgramAddressSync([Buffer.from("world"), rid], pid)[0];
const view = PublicKey.findProgramAddressSync([Buffer.from("view"), rid, Buffer.from([0])], pid)[0];
const ix = await program.methods.tick().accountsPartial({ room, world, view }).instruction();
const tx = new Transaction().add(ix);
tx.feePayer = kp.publicKey;
for (let i = 0; i < 3; i++) {
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  const t0 = performance.now();
  try {
    const raw = (tx.sign(kp), tx.serialize());
    const sig = await conn.sendRawTransaction(raw, { skipPreflight: true });
    const t1 = performance.now();
    let st = null;
    while (!st) { st = (await conn.getSignatureStatus(sig)).value; if (!st) await new Promise(r=>setTimeout(r,20)); }
    console.log("unfunded tx", sig.slice(0,10), "send ms", (t1-t0).toFixed(0), "processed ms", (performance.now()-t0).toFixed(0), "err", JSON.stringify(st.err));
  } catch (e: any) { console.log("fail", e.message.slice(0, 200)); }
}
const t0 = performance.now(); await conn.getSlot(); console.log("rpc rtt ms", (performance.now()-t0).toFixed(0));
