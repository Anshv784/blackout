// Free lobbies can't be held forever (on a deployed program, takes ~11 minutes):
//   npx tsx scripts/e2e_lobby.ts <public room id> <private room id>
// A public lobby may be started by anyone after 5 minutes (bots fill the seats); a private one
// may be cleared by anyone after 10 minutes. Both rooms must be free (no live players).
import { Keypair } from "@solana/web3.js";
import { BlackoutClient } from "../app/src/chain/client.ts";
import { ST_LOBBY, ST_REVEALED, PUBLIC_LOBBY_MAX_SECS, PRIVATE_LOBBY_MAX_SECS, lobbyDeadline } from "../app/src/chain/layout.ts";

const [pub, priv] = process.argv.slice(2).map((a) => BigInt(a));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};
const tries = (f: () => Promise<unknown>) => f().then(() => true, () => false);
const hoarder = new BlackoutClient(Keypair.generate()); // holds both rooms and never starts
const outsider = new BlackoutClient(Keypair.generate()); // not seated anywhere

await hoarder.sendEr([hoarder.claimIx(pub, 4, false), hoarder.joinIx(pub, 0, "HOARD", null)]);
await hoarder.sendEr([hoarder.claimIx(priv, 4, true, 4242), hoarder.joinIx(priv, 0, "HOARD", null, 4242)]);
const opened = Date.now() / 1000;
const beat = setInterval(() => {
  for (const id of [pub, priv]) hoarder.sendEr([hoarder.heartbeatIx(id)], { confirm: false }).catch(() => {});
}, 8000);
const p0 = (await hoarder.fetchRoom(pub))!;
const q0 = (await hoarder.fetchRoom(priv))!;
check("the lobby clock starts when the room is created", Math.abs(p0.stakeDeadline - opened) < 30 && Math.abs(q0.stakeDeadline - opened) < 30, `${p0.stakeDeadline} / ${q0.stakeDeadline}`);
check("the app reads the limits", lobbyDeadline(p0) === p0.stakeDeadline + PUBLIC_LOBBY_MAX_SECS && lobbyDeadline(q0) === q0.stakeDeadline + PRIVATE_LOBBY_MAX_SECS);
check("an outsider can't start a public lobby early", !(await tries(() => outsider.sendEr([outsider.startIx(pub, 4)]))));
check("an outsider can't clear a private lobby early", !(await tries(() => outsider.sendEr([outsider.expireLobbyIx(priv)]))));
check("a public lobby can't be cleared like a private one", !(await tries(() => outsider.sendEr([outsider.expireLobbyIx(pub)]))));

const waitUntil = async (t: number) => {
  while (Date.now() / 1000 < t) await sleep(5000);
};
await waitUntil(p0.stakeDeadline + PUBLIC_LOBBY_MAX_SECS + 3);
check("after 5 minutes anyone can start the public lobby", await tries(() => outsider.sendEr([outsider.startIx(pub, 4)])));
let p = (await hoarder.fetchRoom(pub))!;
check("it starts with bots in the empty seats", p.status !== ST_LOBBY && p.nBots === 3, `status ${p.status}, ${p.nBots} bots`);
check("the private lobby is still waiting (10 minutes)", !(await tries(() => outsider.sendEr([outsider.expireLobbyIx(priv)]))));

await waitUntil(q0.stakeDeadline + PRIVATE_LOBBY_MAX_SECS + 3);
check("after 10 minutes anyone can clear the private lobby", await tries(() => outsider.sendEr([outsider.expireLobbyIx(priv)])));
const q = (await hoarder.fetchRoom(priv))!;
check("everyone is unseated and the host is gone", q.players.every((k, i) => q.isBot[i] === 1 || k.equals(q.players[7]) && k.toBase58() === "11111111111111111111111111111111") && q.host.toBase58() === "11111111111111111111111111111111");
const someone = new BlackoutClient(Keypair.generate());
check("the freed room can be created again by someone else", await tries(() => someone.sendEr([someone.claimIx(priv, 4, true, 777), someone.joinIx(priv, 0, "NEXT", null, 777)])));
await someone.sendEr([someone.leaveIx(priv, 0)]).catch(() => {});

// let the public night finish and free the room
clearInterval(beat);
for (let i = 0; i < 60; i++) {
  p = (await hoarder.fetchRoom(pub))!;
  if (p.status === ST_REVEALED) break;
  if (p.status === 4) await outsider.sendEr(outsider.withBudget(outsider.finishIx(pub, null))).catch(() => {});
  await sleep(5000);
}
for (let i = 0; i < 12 && p.status !== ST_LOBBY; i++) {
  await outsider.sendEr(outsider.withBudget(outsider.resetIx(pub))).catch(() => {});
  await sleep(5000);
  p = (await hoarder.fetchRoom(pub))!;
}
check("the public room's next lobby gets a fresh clock", p.status === ST_LOBBY && p.stakeDeadline > opened + PUBLIC_LOBBY_MAX_SECS, `status ${p.status}, opened ${p.stakeDeadline}`);
await hoarder.sendEr([hoarder.leaveIx(pub, 0)]).catch(() => {});
console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
