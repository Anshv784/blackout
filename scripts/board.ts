import { Keypair, PublicKey } from "@solana/web3.js";
import { BlackoutClient, roomPda, boardPda, bankPda } from "../app/src/chain/client.ts";
import { escrowPdaFromEscrowAuthority } from "@magicblock-labs/ephemeral-rollups-sdk";
const c = new BlackoutClient(Keypair.generate());
const b = await c.fetchBoard();
console.log("board", boardPda().toBase58(), "matches", b?.matches, b?.entries.map((e) => `${e.key.toBase58().slice(0, 4)} w${e.wins} k${e.kills} g${e.games}`));
for (const id of process.argv.slice(2)) {
  const room = roomPda(BigInt(id));
  const esc = escrowPdaFromEscrowAuthority(room, 255);
  console.log("room", id, "escrow", esc.toBase58(), (await c.base.getBalance(esc)) / 1e9, "SOL; bank", (await c.base.getBalance(bankPda(BigInt(id)))) / 1e9);
  const sigs = await c.base.getSignaturesForAddress(boardPda(), { limit: 5 });
  console.log("board sigs", sigs.map((s) => `${s.signature.slice(0, 8)} err=${JSON.stringify(s.err)}`));
  const rs = await c.base.getSignaturesForAddress(room, { limit: 6 });
  for (const s of rs) {
    const t = await c.base.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
    console.log(" room tx", s.signature.slice(0, 10), "err", JSON.stringify(s.err), (t?.meta?.logMessages ?? []).filter((l) => /settle|Error|error|failed|Instruction:/.test(l)).slice(0, 6));
  }
}
