// The daily challenge: the 0.05 SOL table's prize. Today's pot (3.5% of every 0.05 night, reset at
// midnight UTC), the three rules with a tick as each one is met, the top three, and the claim button
// for yesterday's winner.
import { useEffect, useRef, useState } from "react";
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

/** A pot of gold that fills as today's prize grows (full at 1 SOL), with a coin dropping in each
 *  time it goes up. */
function PrizePot({ lamports }: { lamports: bigint }) {
  const sol = Number(lamports) / 1e9;
  const fill = lamports > 0n ? 0.22 + 0.78 * Math.min(1, Math.sqrt(sol)) : 0;
  const [drops, setDrops] = useState(0);
  const prev = useRef(lamports);
  useEffect(() => {
    if (lamports > prev.current) setDrops((d) => d + 1);
    prev.current = lamports;
  }, [lamports]);
  // gold surface: from y 62 (empty) up to y 30 (brim)
  const top = 62 - 32 * fill;
  return (
    <svg className={`pz-jar ${fill > 0 ? "has" : ""}`} viewBox="0 0 80 76" aria-hidden>
      <defs>
        <clipPath id="pzBody">
          <path d="M14 30 Q8 48 18 64 Q24 72 40 72 Q56 72 62 64 Q72 48 66 30 Z" />
        </clipPath>
        <linearGradient id="pzGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe9a8" />
          <stop offset="0.45" stopColor="#ffd166" />
          <stop offset="1" stopColor="#c98a1c" />
        </linearGradient>
        <linearGradient id="pzIron" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1b1f2c" />
          <stop offset="0.35" stopColor="#3a4157" />
          <stop offset="1" stopColor="#141722" />
        </linearGradient>
      </defs>
      <path className="pz-jar-body" d="M14 30 Q8 48 18 64 Q24 72 40 72 Q56 72 62 64 Q72 48 66 30 Z" fill="url(#pzIron)" />
      <g clipPath="url(#pzBody)">
        <rect className="pz-jar-gold" x="0" y={top} width="80" height="80" fill="url(#pzGold)" />
        {fill > 0 && (
          <g className="pz-jar-coins">
            <ellipse cx="30" cy={top + 1} rx="7" ry="2.6" fill="#fff1c2" />
            <ellipse cx="46" cy={top + 2} rx="6" ry="2.3" fill="#ffe08a" />
            <ellipse cx="38" cy={top - 1.5} rx="6.5" ry="2.4" fill="#fff6d6" />
          </g>
        )}
      </g>
      <rect x="9" y="25" width="62" height="7" rx="3.5" fill="#4a5270" stroke="#262b3b" />
      <path d="M12 38 Q2 40 6 48" className="pz-jar-handle" />
      <path d="M68 38 Q78 40 74 48" className="pz-jar-handle" />
      {fill > 0 && (
        <g className="pz-jar-spark">
          <path d="M22 18 l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6z" />
          <path d="M58 12 l1.2 2.6 2.6 1.2 -2.6 1.2 -1.2 2.6 -1.2 -2.6 -2.6 -1.2 2.6 -1.2z" />
        </g>
      )}
      {drops > 0 && (
        <g key={drops} className="pz-jar-drop">
          <ellipse cx="40" cy="6" rx="5.5" ry="5.5" fill="#ffd166" stroke="#c98a1c" strokeWidth="1.2" />
          <text x="40" y="8.6" textAnchor="middle" fontSize="7" fontWeight="700" fill="#7a5410">◎</text>
        </g>
      )}
    </svg>
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
        <PrizePot lamports={pot} />
        <span>today's prize pot</span>
        <b>{solText(pot)} SOL</b>
        <em>
          {pot > 0n
            ? `= 3.5% of the ${solText((pot * 200n) / 7n)} SOL staked at the 0.05 SOL table today.`
            : "3.5% of every stake at the 0.05 SOL table today goes here."}{" "}
          Whoever beats the most different players takes it all.
        </em>
      </div>

      {claim.amount > 0n && (
        <div className="pz-claim">
          <div>
            <b>You won a daily prize</b>
            <span>{solText(claim.amount)} SOL is yours. It waits for you until you claim it.</span>
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
          Beat the most different players today
          {mine && (
            <em>
              you: {mine.beaten} {mine.beaten === 1 ? "player" : "players"} beaten{qualified ? ` · #${mineIdx + 1}` : ""}
            </em>
          )}
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
                <b title="different players beaten today">{e.beaten} beaten</b>
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
