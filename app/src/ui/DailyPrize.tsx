// The daily challenge: the 0.05 SOL table's prize. Today's pot (2% of every 0.05 night, reset at
// midnight UTC), the three rules with a tick as each one is met, the top three, and the claim button
// for yesterday's winner.
import { useEffect, useState } from "react";
import { useStore } from "../game/store";
import { go } from "../App";
import { PRIZE_MIN_GAMES, type Prize } from "../chain/layout";
import { claimable, signedSol, solText, todaysPot, todaysStandings } from "../game/prize";

const untilMidnight = () => {
  const ms = 86_400_000 - (Date.now() % 86_400_000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export function Dots({ n, of = PRIZE_MIN_GAMES }: { n: number; of?: number }) {
  return (
    <span className="pz-dots" aria-label={`${Math.min(n, of)} of ${of}`}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < n ? "on" : ""} />
      ))}
    </span>
  );
}

function Rule({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className={done ? "done" : ""}>
      <span className="pz-tick">{done ? "✓" : ""}</span>
      <div>{children}</div>
    </li>
  );
}

export function DailyPrize({
  prize,
  names,
  onPlay,
  onClaim,
  claiming,
  className = "",
}: {
  prize: Prize | null;
  names: Map<string, string>;
  onPlay: () => void;
  onClaim: () => void;
  claiming: boolean;
  className?: string;
}) {
  const wallet = useStore((s) => s.wallet);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const pot = todaysPot(prize);
  const standings = todaysStandings(prize);
  const mineIdx = wallet ? standings.findIndex((e) => e.key.toBase58() === wallet) : -1;
  const mine = mineIdx >= 0 ? standings[mineIdx] : null;
  const games = mine?.games ?? 0;
  const qualified = games >= PRIZE_MIN_GAMES;
  const leading = qualified && mineIdx === 0;
  const claim = claimable(prize, wallet);
  const name = (k: string) => names.get(k) || `${k.slice(0, 4)}…${k.slice(-3)}`;
  return (
    <div className={`daily-card prize-card ${className}`}>
      <div className="dc-top">
        <span className="dc-badge">DAILY CHALLENGE</span>
        <span className="dc-timer">resets in {untilMidnight()}</span>
      </div>
      <div className="pz-pot">
        <span>today's prize</span>
        <b>{solText(pot)} SOL</b>
        <em>2% of every 0.05 SOL night today · the day's top earner takes it</em>
      </div>

      {claim.amount > 0n && (
        <div className="pz-claim">
          <div>
            <b>You won yesterday's prize</b>
            <span>{solText(claim.amount)} SOL is yours. Claim it before tomorrow's winner is decided.</span>
          </div>
          <button className="btn primary" onClick={onClaim} disabled={claiming}>
            {claiming ? "CLAIMING…" : "CLAIM PRIZE"}
          </button>
        </div>
      )}

      <ul className="pz-rules">
        <Rule done={!!wallet}>Connect a wallet</Rule>
        <Rule done={qualified}>
          Play {PRIZE_MIN_GAMES} nights at the 0.05 SOL table today <Dots n={games} />
        </Rule>
        <Rule done={leading}>
          Finish the day with the highest net profit
          {mine && <em>you: {signedSol(mine.profit)} SOL{qualified ? ` · #${mineIdx + 1}` : ""}</em>}
        </Rule>
      </ul>

      {standings.length > 0 && (
        <ol className="pz-top">
          {standings.slice(0, 3).map((e) => {
            const k = e.key.toBase58();
            return (
              <li key={k} className={`${k === wallet ? "me" : ""} ${e.games >= PRIZE_MIN_GAMES ? "" : "short"}`}>
                <span>{name(k)}</span>
                <Dots n={e.games} />
                <b>{signedSol(e.profit)}</b>
              </li>
            );
          })}
        </ol>
      )}

      <div className="pz-actions">
        <button className="btn primary dc-btn" onClick={onPlay}>
          PLAY THE 0.05 SOL TABLE
        </button>
        <button className="btn dc-btn pz-board" onClick={() => go("/board")}>
          TOP 10 →
        </button>
      </div>
    </div>
  );
}
