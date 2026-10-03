// Day-1 spike: privacy of ephemeral accounts + crank cadence on the TEE ER.
import anchor from "@coral-xyz/anchor";
const { BN, Program } = anchor;
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import fs from "fs";
import os from "os";
import {
  getAuthToken,
  permissionPdaFromAccount,
  PERMISSION_PROGRAM_ID,
  MAGIC_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import idl from "../target/idl/blackout.json" with { type: "json" };

const BASE = "https://rpc.magicblock.app/devnet";
const TEE = "https://devnet-tee.magicblock.app";
const VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const admin = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/blackout-devnet.json`, "utf8"))),
);
const member = Keypair.generate();
const outsider = Keypair.generate();
const base = new Connection(BASE, "confirmed");

async function teeConn(kp: Keypair) {
  const auth = await getAuthToken(TEE, kp.publicKey, (m) => Promise.resolve(nacl.sign.detached(m, kp.secretKey)));
  return new Connection(`${TEE}?token=${auth.token}`, "confirmed");
}

const wallet = {
  publicKey: admin.publicKey,
  signTransaction: async (t: any) => (t.sign(admin), t),
  signAllTransactions: async (ts: any[]) => (ts.forEach((t) => t.sign(admin)), ts),
};
const program = new Program(idl as any, new anchor.AnchorProvider(base, wallet as any, {}));
const pid = program.programId;
const roomId = new BN(Date.now());
const rid = roomId.toArrayLike(Buffer, "le", 8);
const room = PublicKey.findProgramAddressSync([Buffer.from("room"), rid], pid)[0];
const world = PublicKey.findProgramAddressSync([Buffer.from("world"), rid], pid)[0];
const view = PublicKey.findProgramAddressSync([Buffer.from("view"), rid, Buffer.from([0])], pid)[0];

async function sendEr(conn: Connection, ixs: TransactionInstruction[], signer: Keypair) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  return sendAndConfirmTransaction(conn, tx, [signer], { skipPreflight: true, commitment: "confirmed" });
}

async function main() {
  console.log("program", pid.toBase58(), "room", room.toBase58());
  const createIx = await program.methods.createRoom(roomId, new BN(0.02 * LAMPORTS_PER_SOL)).accounts({ payer: admin.publicKey } as any).instruction();
  const delIx = await program.methods.delegateRoom(roomId).accountsPartial({ payer: admin.publicKey, pda: room, validator: VALIDATOR }).instruction();
  const fund = SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: member.publicKey, lamports: 0.01 * LAMPORTS_PER_SOL });
  const sig = await sendAndConfirmTransaction(base, new Transaction().add(createIx, delIx, fund), [admin], { skipPreflight: true, commitment: "confirmed" });
  console.log("create+delegate", sig);

  const adminTee = await teeConn(admin);
  for (let i = 0; i < 40; i++) {
    if (await adminTee.getAccountInfo(room)) break;
    await sleep(500);
  }
  console.log("room on ER");

  const setupIx = await program.methods
    .setup(member.publicKey)
    .accountsPartial({
      room, world, view,
      worldPermission: permissionPdaFromAccount(world),
      viewPermission: permissionPdaFromAccount(view),
      roomPermission: permissionPdaFromAccount(room),
      payer: admin.publicKey,
      permissionProgram: PERMISSION_PROGRAM_ID,
      ephemeralVault: EPHEMERAL_VAULT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction();
  try {
    console.log("setup", await sendEr(adminTee, [setupIx], admin));
  } catch (e: any) {
    console.log("setup failed", e.message);
    const s = e.signature ?? e.message.match(/[1-9A-HJ-NP-Za-km-z]{80,}/)?.[0];
    if (s) console.log((await adminTee.getTransaction(s, { maxSupportedTransactionVersion: 0 }))?.meta?.logMessages);
    return;
  }
  await sleep(1500);

  const tickIx = await program.methods.tick().accountsPartial({ room, world, view }).instruction();
  const t0 = Date.now();
  const tsig = await sendEr(adminTee, [tickIx], admin);
  console.log("manual tick latency ms", Date.now() - t0, tsig);

  const memberTee = await teeConn(member);
  const outsiderTee = await teeConn(outsider);
  const show = async (label: string, c: Connection, pk: PublicKey) => {
    try {
      const i = await c.getAccountInfo(pk);
      console.log(label, i ? `DATA len=${i.data.length} head=${i.data.subarray(0, 16).toString("hex")}` : "null");
    } catch (e: any) {
      console.log(label, "ERR", e.message.slice(0, 120));
    }
  };
  await show("world  via admin(non-member)", adminTee, world);
  await show("world  via member", memberTee, world);
  await show("view   via member", memberTee, view);
  await show("view   via outsider", outsiderTee, view);
  await show("view   via admin", adminTee, view);
  await show("room   via outsider", outsiderTee, room);
  await show("world  via base", base, world);

  const s1 = await adminTee.getSlot();
  await sleep(2000);
  const s2 = await adminTee.getSlot();
  console.log("ER slots/sec", (s2 - s1) / 2);

  const schedIx = await program.methods
    .scheduleTicks(new BN(Date.now() % 1_000_000_000), new BN(50), new BN(200))
    .accountsPartial({ magicProgram: MAGIC_PROGRAM_ID, payer: admin.publicKey, room, world, view })
    .instruction();
  try {
    console.log("schedule", await sendEr(adminTee, [schedIx], admin));
  } catch (e: any) {
    console.log("schedule failed", e.message);
  }
  const readTicks = async () => {
    const i = await adminTee.getAccountInfo(room);
    if (!i) return null;
    const r = program.coder.accounts.decode("room", i.data);
    return { ticks: Number(r.ticks), slots: r.slots.map((x: any) => Number(x)) };
  };
  const a = await readTicks();
  const ta = Date.now();
  await sleep(5000);
  const b = await readTicks();
  const tb = Date.now();
  console.log("ticks before/after", a?.ticks, b?.ticks, "rate/s", ((b!.ticks - a!.ticks) * 1000) / (tb - ta));
  console.log("recent tick slots", b?.slots.slice().sort((x: number, y: number) => x - y));
  await show("view via member after crank", memberTee, view);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
