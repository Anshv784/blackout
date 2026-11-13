// "Staked night": choose your table. Each one shows its stake, who's waiting and what's in the pot,
// read live from the rooms (nothing here is hard-coded).
import type { Room } from "../chain/layout";
import { ST_LOBBY, STATUS_NAME } from "../chain/layout";
import { STAKED_ROOMS } from "../config";
import { stakersSeated, stakedStartAt } from "../game/session";
import { PRIZE_MIN_GAMES, PRIZE_STAKE, type Prize } from "../chain/layout";
import { todaysStandings } from "../game/prize";
import { useStore } from "../game/store";
import { Dots } from "./DailyPrize";

const sol = (lamports: bigint) => {
  const n = Number(lamports) / 1e9;
  return n.toFixed(n < 0.1 ? 2 : 1).replace(/\.?0+$/, "");
};

export function StakeChoice({ rooms, prize, onPick, onClose }: { rooms: Record<number, Room | null>; prize?: Prize | null; onPick: (id: number) => void; onClose: () => void }) {
  const wallet = useStore((s) => s.wallet);
  const myGames = (wallet && todaysStandings(prize ?? null).find((e) => e.key.toBase58() === wallet)?.games) || 0;
  const tables = STAKED_ROOMS.map((id) => [id, rooms[id] ?? null] as const)
    .filter((t): t is readonly [number, Room] => !!t[1])
    .sort((a, b) => Number(a[1].stake - b[1].stake));
  return (
    <div className="room-closed sc-overlay" onClick={onClose}>
      <div className="room-closed-card stake-choice" onClick={(e) => e.stopPropagation()}>
        <div className="vc-kicker">STAKED NIGHT</div>
        <h2>Choose your table</h2>
        <p>Everyone at a table puts in the same stake. The last one standing takes the pot, less a 10% fee.</p>
        <p className="sc-fee">
          <b>Where the 10% goes:</b> 3.5% of each 0.05 SOL pot builds the daily prize, a little keeps the tables running, and the rest is set aside for{" "}
          <b>future tournaments</b> with bigger prizes.
        </p>
        <p className="sc-note">Stakes aren't refunded. Leave before the night starts and your ticket stays good for a later night at the same stake.</p>
        <div className="sc-list">
          {tables.length === 0 && <div className="sc-empty">Reading the tables…</div>}
          {tables.map(([id, r]) => {
            const seated = stakersSeated(r);
            const open = r.status === ST_LOBBY && seated < r.maxPlayers;
            const at = stakedStartAt(r);
            const left = at === null ? null : Math.max(0, Math.ceil(at - Date.now() / 1000));
            const state =
              r.status !== ST_LOBBY
                ? `night in progress (${STATUS_NAME[r.status]?.toLowerCase()})`
                : seated >= r.maxPlayers
                  ? "table full"
                  : seated === 0
                    ? "empty: be the first to sit"
                    : left !== null
                      ? `${seated} waiting · starts in ${left}s`
                      : `${seated} waiting for one more`;
            return (
              <button key={id} className={`sc-table ${open ? "" : "busy"}`} disabled={!open} onClick={() => onPick(id)}>
                <b>{sol(r.stake)} SOL</b>
                <span>
                  {seated}/{r.maxPlayers} seated · {state}
                </span>
                <em>{open ? `pot up to ${sol(r.stake * BigInt(r.maxPlayers))} SOL` : "come back after this night"}</em>
                {r.stake === PRIZE_STAKE && (
                  <small className="sc-daily">
                    DAILY CHALLENGE <Dots n={myGames} />
                    {myGames >= PRIZE_MIN_GAMES ? " qualified for today's prize" : ` ${Math.min(myGames, PRIZE_MIN_GAMES)}/${PRIZE_MIN_GAMES} nights needed today`}
                  </small>
                )}
              </button>
            );
          })}
        </div>
        <div className="row center wrap">
          <button className="btn" onClick={onClose}>
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}
