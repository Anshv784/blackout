// Close every spent ticket, for any player, and hand its rent back. Anyone can run this: the rent
// only ever goes to each ticket's own wallet. Unused tickets (stakes are never refunded) are skipped.
//   ADMIN_KEY=<fee payer key file> npx tsx scripts/sweep_tickets.ts
import { Keypair } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import { BlackoutClient, PROGRAM_ID, TICKET_LEN } from "../app/src/chain/client.ts";

const keyFile = process.env.ADMIN_KEY ?? `${os.homedir()}/.config/solana/blackout-devnet.json`;
const c = new BlackoutClient(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyFile, "utf8")))));
const tickets = await c.base.getProgramAccounts(PROGRAM_ID, { filters: [{ dataSize: TICKET_LEN }] });
let closed = 0;
for (const { pubkey, account } of tickets) {
  const data = account.data;
  const roomId = new DataView(data.buffer, data.byteOffset).getBigUint64(8, true);
  const payout = new (pubkey.constructor as any)(data.subarray(52, 84));
  const sig = await c.sendBase([c.closeTicketIx(roomId, pubkey, payout)]).catch(() => null);
  if (sig) closed++;
}
console.log(`${closed} of ${tickets.length} tickets closed`);
process.exit(0);
