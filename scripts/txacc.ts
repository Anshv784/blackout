import { Connection } from "@solana/web3.js";
const c = new Connection("https://rpc.magicblock.app/devnet");
const sig = (await c.getSignaturesForAddress(new (await import("@solana/web3.js")).PublicKey(process.argv[2]), { limit: 10 })).find((s) => s.signature.startsWith(process.argv[3]))!.signature;
const t = await c.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
const keys = t!.transaction.message.getAccountKeys().staticAccountKeys.map((k) => k.toBase58());
const msg: any = t!.transaction.message;
for (const [i, ix] of msg.compiledInstructions.entries()) console.log("ix", i, keys[ix.programIdIndex], ix.accountKeyIndexes.map((k: number) => keys[k]));
console.log(t?.meta?.logMessages?.slice(0, 30).join("\n"));
