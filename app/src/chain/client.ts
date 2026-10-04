// Blackout chain client: base layer + Private ER (TEE) connections for one identity.
// Shared by the browser app and the node scripts.
import * as anchorNs from "@coral-xyz/anchor";
import {
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import { Buffer } from "buffer";
import bs58 from "bs58";
const bs58encode = (b: Uint8Array) => bs58.encode(b);
import {
  EPHEMERAL_VAULT_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  createTopUpEscrowInstruction,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  escrowPdaFromEscrowAuthority,
  getAuthToken,
  magicFeeVaultPdaFromValidator,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import idl from "../idl/blackout.json";
import { MAXP, decodeRoom, decodeView, decodeWorld, decodeRecording, decodeBoard, type Room } from "./layout";

// CJS (node/tsx) exposes the API on `default`, the browser build as named exports
const ns: any = anchorNs;
const BN = ns.BN ?? ns["default"]?.BN;
const BorshCoder = ns.BorshCoder ?? ns["default"]?.BorshCoder;

export const BASE_ENDPOINT = "https://rpc.magicblock.app/devnet";
export const TEE_ENDPOINT = "https://devnet-tee.magicblock.app";
export const TEE_WS = "wss://devnet-tee.magicblock.app";
export const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
export const PROGRAM_ID = new PublicKey((idl as any).address);
export const VRF_PROGRAM_ID = new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
export const VRF_EPHEMERAL_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
export const SLOT_HASHES = new PublicKey("SysvarS1otHashes111111111111111111111111111");
export const DELEGATION_PROGRAM_ID = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

const coder = new BorshCoder(idl as any);
const disc = (name: string) => Buffer.from((idl as any).instructions.find((i: any) => i.name === name).discriminator);
const IX_INPUT = disc("input");
const IX_TICK = disc("tick");

const u64le = (n: bigint | number) => {
  const b = Buffer.alloc(8);
  new DataView(b.buffer, b.byteOffset, 8).setBigUint64(0, BigInt(n), true);
  return b;
};
const pda = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

export const roomPda = (roomId: bigint | number) => pda([Buffer.from("room"), u64le(roomId)]);
export const worldPda = (roomId: bigint | number) => pda([Buffer.from("world"), u64le(roomId)]);
export const REC_CHUNKS = 5;
export const recPda = (roomId: bigint | number, chunk: number) => pda([Buffer.from("rec"), u64le(roomId), Buffer.from([chunk])]);
export const recPdas = (roomId: bigint | number) => Array.from({ length: REC_CHUNKS }, (_, c) => recPda(roomId, c));
export const viewPda = (roomId: bigint | number, seat: number) => pda([Buffer.from("view"), u64le(roomId), Buffer.from([seat])]);
export const bankPda = (roomId: bigint | number) => pda([Buffer.from("bank"), u64le(roomId)]);
export const boardPda = () => pda([Buffer.from("board2")]);
export const programIdentityPda = () => pda([Buffer.from("identity")]);
export const ticketPda = (roomId: bigint | number, matchNo: number, player: PublicKey) => {
  const m = Buffer.alloc(4);
  m.writeUInt32LE(matchNo, 0);
  return pda([Buffer.from("ticket"), u64le(roomId), m, player.toBuffer()]);
};

const ix = (name: string, args: Record<string, unknown>, keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]) =>
  new TransactionInstruction({ programId: PROGRAM_ID, keys, data: coder.instruction.encode(name, args) });
const w = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });

export interface TokenStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export class BlackoutClient {
  readonly base: Connection;
  private tee: Connection | null = null;
  private teeExpiry = 0;
  private blockhash: { hash: string; at: number } | null = null;
  tokenizedUrl = "";

  constructor(public readonly keypair: Keypair, private store?: TokenStore) {
    this.base = new Connection(BASE_ENDPOINT, "confirmed");
  }

  get publicKey() {
    return this.keypair.publicKey;
  }

  /** TEE connection authenticated as this identity — the only way to read private accounts. */
  async teeConn(): Promise<Connection> {
    if (this.tee && Date.now() < this.teeExpiry - 60_000) return this.tee;
    const cacheKey = `bo-tee-${this.publicKey.toBase58()}`;
    let auth: { token: string; expiresAt: number } | null = null;
    try {
      const c = this.store?.get(cacheKey);
      if (c) auth = JSON.parse(c);
    } catch {
      auth = null;
    }
    const exp = (a: { expiresAt: number }) => (a.expiresAt > 1e12 ? a.expiresAt : a.expiresAt * 1000);
    if (!auth || exp(auth) - Date.now() < 120_000) {
      auth = await getAuthToken(TEE_ENDPOINT, this.publicKey, (m: Uint8Array) =>
        Promise.resolve(nacl.sign.detached(m, this.keypair.secretKey)),
      );
      try {
        this.store?.set(cacheKey, JSON.stringify(auth));
      } catch {
        /* storage unavailable */
      }
    }
    this.tokenizedUrl = `${TEE_ENDPOINT}?token=${auth.token}`;
    this.tee = new Connection(this.tokenizedUrl, { wsEndpoint: `${TEE_WS}?token=${auth.token}`, commitment: "confirmed" });
    this.teeExpiry = exp(auth);
    return this.tee;
  }

  // ---------------------------------------------------------------- send

  /** Base-layer send with rebroadcast until confirmed (devnet drops txs under load). */
  async sendBase(ixs: TransactionInstruction[], signers: Keypair[] = []): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { blockhash, lastValidBlockHeight } = await this.base.getLatestBlockhash("confirmed");
      const tx = new Transaction().add(...ixs);
      tx.feePayer = this.publicKey;
      tx.recentBlockhash = blockhash;
      tx.sign(this.keypair, ...signers);
      const raw = tx.serialize();
      const sig = await this.base.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
      while ((await this.base.getBlockHeight("confirmed")) <= lastValidBlockHeight) {
        const st = (await this.base.getSignatureStatus(sig)).value;
        if (st?.err) throw new Error(`base tx failed ${JSON.stringify(st.err)} (${sig})`);
        if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return sig;
        await this.base.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
        await new Promise((res) => setTimeout(res, 1500));
      }
    }
    throw new Error("base tx expired 3 times");
  }

  private async freshBlockhash(conn: Connection) {
    if (!this.blockhash || Date.now() - this.blockhash.at > 15_000) {
      this.blockhash = { hash: (await conn.getLatestBlockhash()).blockhash, at: Date.now() };
    }
    return this.blockhash.hash;
  }

  async sendEr(ixs: TransactionInstruction[], opts: { confirm?: boolean; commitment?: Commitment } = {}): Promise<string> {
    const conn = await this.teeConn();
    const tx = new Transaction().add(...ixs);
    tx.feePayer = this.publicKey;
    tx.recentBlockhash = await this.freshBlockhash(conn);
    tx.sign(this.keypair);
    const sigBytes = tx.signature!;
    let sig: string;
    try {
      sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    } catch (e: any) {
      // an identical tx (same ix + blockhash) already landed — that's a success, not an error
      if (/already been processed/i.test(String(e?.message ?? e))) return bs58encode(sigBytes);
      // stale blockhash: refresh once and retry
      if (/blockhash not found/i.test(String(e?.message ?? e))) {
        this.blockhash = null;
        return this.sendEr(ixs, opts);
      }
      throw e;
    }
    if (opts.confirm === false) return sig;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const st = (await conn.getSignatureStatus(sig)).value;
      if (st) {
        if (st.err) {
          const t = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0 }).catch(() => null);
          const logs = t?.meta?.logMessages?.filter((l) => /Error|error|failed/.test(l)).slice(-3).join(" | ");
          throw new Error(`ER tx failed: ${JSON.stringify(st.err)} ${logs ?? ""} (${sig})`);
        }
        return sig;
      }
      await new Promise((res) => setTimeout(res, 40));
    }
    throw new Error(`ER tx not confirmed: ${sig}`);
  }

  // ---------------------------------------------------------------- reads

  async fetchRoom(roomId: bigint | number): Promise<Room | null> {
    const conn = await this.teeConn();
    const info = await conn.getAccountInfo(roomPda(roomId));
    return info ? decodeRoom(info.data) : null;
  }

  async fetchRoomBase(roomId: bigint | number): Promise<Room | null> {
    const info = await this.base.getAccountInfo(roomPda(roomId));
    return info ? decodeRoom(info.data) : null;
  }

  async fetchView(roomId: bigint | number, seat: number) {
    const conn = await this.teeConn();
    const info = await conn.getAccountInfo(viewPda(roomId, seat));
    return info ? decodeView(info.data) : null;
  }

  /** Readable only once the match is over and the permission flipped public. */
  async fetchWorld(roomId: bigint | number) {
    const conn = await this.teeConn();
    const info = await conn.getAccountInfo(worldPda(roomId));
    return info ? decodeWorld(info.data) : null;
  }

  async fetchRecording(roomId: bigint | number) {
    const conn = await this.teeConn();
    const infos = await conn.getMultipleAccountsInfo(recPdas(roomId));
    if (infos.some((i) => !i)) return null;
    return decodeRecording(infos.map((i) => i!.data));
  }

  async fetchBoard() {
    const info = await this.base.getAccountInfo(boardPda());
    return info ? decodeBoard(info.data) : null;
  }

  async onView(roomId: bigint | number, seat: number, cb: (data: Uint8Array) => void): Promise<() => void> {
    const conn = await this.teeConn();
    const id = conn.onAccountChange(viewPda(roomId, seat), (acc) => cb(acc.data), { commitment: "processed" });
    return () => {
      conn.removeAccountChangeListener(id).catch(() => {});
    };
  }

  async onRoom(roomId: bigint | number, cb: (room: Room) => void): Promise<() => void> {
    const conn = await this.teeConn();
    const id = conn.onAccountChange(roomPda(roomId), (acc) => cb(decodeRoom(acc.data)), { commitment: "processed" });
    return () => {
      conn.removeAccountChangeListener(id).catch(() => {});
    };
  }

  // ---------------------------------------------------------------- admin (base)

  async initBoard() {
    return this.sendBase([ix("init_board", {}, [w(boardPda()), w(this.publicKey, true), r(SystemProgram.programId)])]);
  }

  /** Create + fund + delegate a room to the TEE validator, and fund its action escrow. */
  createRoomIxs(roomId: bigint, stakeLamports: bigint, privateCode: number, prefund: number) {
    const room = roomPda(roomId);
    const create = ix("create_room", { room_id: new BN(roomId.toString()), stake: new BN(stakeLamports.toString()), private_code: privateCode, prefund: new BN(prefund) }, [
      w(room),
      w(bankPda(roomId)),
      w(this.publicKey, true),
      r(SystemProgram.programId),
    ]);
    const topUp = createTopUpEscrowInstruction(escrowPdaFromEscrowAuthority(room, 255), room, this.publicKey, 20_000_000, 255);
    const bufferPda = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(room, PROGRAM_ID);
    const recordPda = delegationRecordPdaFromDelegatedAccount(room);
    const metaPda = delegationMetadataPdaFromDelegatedAccount(room);
    const delegate = ix("delegate_room", { room_id: new BN(roomId.toString()) }, [
      w(bufferPda),
      w(recordPda),
      w(metaPda),
      w(room),
      r(this.publicKey, true),
      r(TEE_VALIDATOR),
      r(PROGRAM_ID),
      r(DELEGATION_PROGRAM_ID),
      r(SystemProgram.programId),
    ]);
    return [create, topUp, delegate];
  }

  setupCoreIx(roomId: bigint) {
    const room = roomPda(roomId);
    const world = worldPda(roomId);
    return ix("setup_core", {}, [
      w(room),
      w(world),
      w(permissionPdaFromAccount(world)),
      w(permissionPdaFromAccount(room)),
      w(this.publicKey, true),
      r(PERMISSION_PROGRAM_ID),
      w(EPHEMERAL_VAULT_ID),
      r(MAGIC_PROGRAM_ID),
    ]);
  }

  setupRecIx(roomId: bigint, chunk: number) {
    const rec = recPda(roomId, chunk);
    return ix("setup_rec", { chunk }, [
      w(roomPda(roomId)),
      w(rec),
      w(permissionPdaFromAccount(rec)),
      w(this.publicKey, true),
      r(PERMISSION_PROGRAM_ID),
      w(EPHEMERAL_VAULT_ID),
      r(MAGIC_PROGRAM_ID),
    ]);
  }

  setupViewIx(roomId: bigint, seat: number) {
    const view = viewPda(roomId, seat);
    return ix("setup_view", { seat }, [
      w(roomPda(roomId)),
      w(view),
      w(permissionPdaFromAccount(view)),
      w(this.publicKey, true),
      r(PERMISSION_PROGRAM_ID),
      w(EPHEMERAL_VAULT_ID),
      r(MAGIC_PROGRAM_ID),
    ]);
  }

  // ---------------------------------------------------------------- lobby (ER)

  joinIx(roomId: bigint, seat: number, name: string, payout: PublicKey | null, code = 0, ticket?: PublicKey) {
    const view = viewPda(roomId, seat);
    const nm = new Uint8Array(16);
    nm.set(new TextEncoder().encode(name.slice(0, 16)).slice(0, 16));
    return ix("join", { seat, name: Array.from(nm), payout: payout ?? PublicKey.default, code }, [
      w(roomPda(roomId)),
      w(view),
      w(permissionPdaFromAccount(view)),
      w(this.publicKey, true),
      r(ticket ?? PROGRAM_ID), // Anchor optional account: program id = None
      r(PERMISSION_PROGRAM_ID),
      w(EPHEMERAL_VAULT_ID),
      r(MAGIC_PROGRAM_ID),
    ]);
  }

  linkWalletIx(wallet: PublicKey) {
    return ix("link_wallet", {}, [w(boardPda()), r(this.publicKey, true), w(wallet, true)]);
  }

  claimIx(roomId: bigint, maxPlayers: number, unlisted: boolean) {
    return ix("claim_room", { max_players: maxPlayers, unlisted }, [r(this.publicKey, true), w(roomPda(roomId))]);
  }

  makeHostIx(roomId: bigint, seat: number) {
    return ix("make_host", { seat }, [r(this.publicKey, true), w(roomPda(roomId))]);
  }

  setSizeIx(roomId: bigint, maxPlayers: number) {
    return ix("set_size", { max_players: maxPlayers }, [r(this.publicKey, true), w(roomPda(roomId))]);
  }

  heartbeatIx(roomId: bigint) {
    return ix("heartbeat", {}, [r(this.publicKey, true), w(roomPda(roomId))]);
  }

  leaveIx(roomId: bigint, seat: number) {
    const view = viewPda(roomId, seat);
    return ix("leave", { seat }, [
      w(roomPda(roomId)),
      w(view),
      w(permissionPdaFromAccount(view)),
      w(this.publicKey, true),
      r(PERMISSION_PROGRAM_ID),
      w(EPHEMERAL_VAULT_ID),
      r(MAGIC_PROGRAM_ID),
    ]);
  }

  startIx(roomId: bigint, fillTo: number) {
    const keys = [
      w(this.publicKey, true),
      w(roomPda(roomId)),
      w(worldPda(roomId)),
      w(VRF_EPHEMERAL_QUEUE),
      r(MAGIC_PROGRAM_ID),
      r(programIdentityPda()),
      r(VRF_PROGRAM_ID),
      r(SLOT_HASHES),
      r(SystemProgram.programId),
    ];
    for (let s = 0; s < MAXP; s++) keys.push(w(viewPda(roomId, s)));
    for (const rp of recPdas(roomId)) keys.push(w(rp));
    return ix("start_match", { fill_to: fillTo, client_seed: Math.floor(Math.random() * 256) }, keys);
  }

  fallbackSeedIx(roomId: bigint) {
    return ix("fallback_seed", {}, [r(this.publicKey, true), w(roomPda(roomId)), w(worldPda(roomId))]);
  }

  /** Hot path: hand-encoded, never confirmed. */
  inputIx(roomId: bigint, dx: number, dy: number, aim: number, buttons: number, seq: number) {
    const data = Buffer.alloc(8 + 1 + 1 + 2 + 1 + 4);
    IX_INPUT.copy(data, 0);
    data.writeInt8(Math.max(-127, Math.min(127, Math.round(dx))), 8);
    data.writeInt8(Math.max(-127, Math.min(127, Math.round(dy))), 9);
    data.writeUInt16LE(aim & 0xffff, 10);
    data.writeUInt8(buttons & 0xff, 12);
    data.writeUInt32LE(seq >>> 0, 13);
    return new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [r(this.publicKey, true), r(roomPda(roomId)), w(worldPda(roomId))],
      data,
    });
  }

  tickIx(roomId: bigint) {
    const keys = [w(roomPda(roomId)), w(worldPda(roomId))];
    for (let s = 0; s < MAXP; s++) keys.push(w(viewPda(roomId, s)));
    for (const rp of recPdas(roomId)) keys.push(w(rp));
    return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.from(IX_TICK) });
  }

  private recPermKeys(roomId: bigint) {
    return recPdas(roomId).flatMap((rp) => [w(rp), w(permissionPdaFromAccount(rp))]);
  }

  /** `winnerPayout` null when a bot (or nobody) won — the bank stands in. */
  finishIx(roomId: bigint, winnerPayout: PublicKey | null) {
    const world = worldPda(roomId);
    return ix("finish", {}, [
      w(this.publicKey, true),
      w(roomPda(roomId)),
      w(world),
      w(permissionPdaFromAccount(world)),
      r(boardPda()),
      r(bankPda(roomId)),
      r(winnerPayout ?? bankPda(roomId)),
      r(PERMISSION_PROGRAM_ID),
      w(EPHEMERAL_VAULT_ID),
      r(MAGIC_PROGRAM_ID),
      w(MAGIC_CONTEXT_ID),
      w(magicFeeVaultPdaFromValidator(TEE_VALIDATOR)),
      ...this.recPermKeys(roomId),
    ]);
  }

  resetIx(roomId: bigint) {
    const world = worldPda(roomId);
    return ix("reset", {}, [
      r(this.publicKey, true),
      w(roomPda(roomId)),
      w(world),
      w(permissionPdaFromAccount(world)),
      r(PERMISSION_PROGRAM_ID),
      w(EPHEMERAL_VAULT_ID),
      r(MAGIC_PROGRAM_ID),
      ...this.recPermKeys(roomId),
    ]);
  }

  buyTicketIx(roomId: bigint, matchNo: number, payout: PublicKey) {
    return ix("buy_ticket", { room_id: new BN(roomId.toString()), match_no: matchNo, payout }, [
      r(roomPda(roomId)),
      w(bankPda(roomId)),
      w(ticketPda(roomId, matchNo, this.publicKey)),
      w(this.publicKey, true),
      r(SystemProgram.programId),
    ]);
  }
}

export const decoders = { decodeRoom, decodeView, decodeWorld, decodeRecording, decodeBoard };
