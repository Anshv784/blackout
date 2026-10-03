// Push stuck rooms forward: finish ENDED rooms, reset REVEALED ones.
import { Keypair } from "@solana/web3.js";
import { BlackoutClient } from "../app/src/chain/client.ts";
import { ST_ENDED, ST_REVEALED, NO_SEAT, STATUS_NAME } from "../app/src/chain/layout.ts";
const c = new BlackoutClient(Keypair.generate());
for (const a of process.argv.slice(2)) {
  const id = BigInt(a);
  let r = await c.fetchRoom(id);
  if (r?.status === ST_ENDED) {
    const w = r.winner;
    console.log(a, "finish", await c.sendEr([c.finishIx(id, w !== NO_SEAT && r.isBot[w] === 0 ? r.payout[w] : null)]).catch((e) => e.message));
    await new Promise((res) => setTimeout(res, 1500));
    r = await c.fetchRoom(id);
  }
  if (r?.status === ST_REVEALED) console.log(a, "reset", await c.sendEr([c.resetIx(id)]).catch((e) => e.message));
  r = await c.fetchRoom(id);
  console.log(a, STATUS_NAME[r!.status], "seated", r!.nPlayers);
}
