// "Where does the 10% go?": the house fee on a staked pot, split three ways and drawn, so players
// see it at a glance. Numbers mirror the program: config.rs FEE_BPS 1000, PRIZE_BPS 350 (0.05 table),
// TABLE_FUND_PER_NIGHT 0.001 SOL; the rest is BLACKOUT's share, set aside for future tournaments.
import { useEffect, useRef, useState } from "react";

const Coin = ({ size = 22 }: { size?: number }) => (
  <svg className="fs-coin" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
    <circle cx="16" cy="16" r="14" fill="#ffd166" stroke="#a8730f" strokeWidth="2.5" />
    <circle cx="16" cy="16" r="9.5" fill="none" stroke="#c48a17" strokeWidth="1.5" opacity=".7" />
    <text x="16" y="21" textAnchor="middle" fontSize="13" fontWeight="800" fill="#7a5410">◎</text>
  </svg>
);

const Pot = () => (
  <svg viewBox="0 0 48 44" aria-hidden>
    <path d="M8 16 Q4 30 12 38 Q16 42 24 42 Q32 42 36 38 Q44 30 40 16 Z" fill="#2a3044" />
    <path className="fs-gold" d="M9.5 22 Q24 18 38.5 22 Q40 30 35 37 Q31 41 24 41 Q17 41 13 37 Q8 30 9.5 22 Z" fill="#ffd166" />
    <rect x="5" y="12" width="38" height="6" rx="3" fill="#4b5371" />
    <circle className="fs-spark" cx="34" cy="7" r="2" fill="#fff1b8" />
  </svg>
);

const Battery = () => (
  <svg viewBox="0 0 48 44" aria-hidden>
    <rect x="6" y="10" width="34" height="26" rx="5" fill="#1d2a2a" stroke="#7fe3c4" strokeWidth="2.5" />
    <rect x="40" y="18" width="4" height="10" rx="1.5" fill="#7fe3c4" />
    <rect className="fs-charge" x="10" y="14" width="26" height="18" rx="2.5" fill="#7fe3c4" />
    <path d="M25 13 L17 25 h6 l-2 9 8-12 h-6 z" fill="#0d1a17" />
  </svg>
);

const Trophy = () => (
  <svg viewBox="0 0 48 44" aria-hidden>
    <path d="M14 5 H34 V18 Q34 29 24 31 Q14 29 14 18 Z" fill="#c9a8ff" stroke="#6d4fb0" strokeWidth="1.8" />
    <path d="M14 9 Q6 9 7 16 Q8 22 15 23" fill="none" stroke="#c9a8ff" strokeWidth="2.6" strokeLinecap="round" />
    <path d="M34 9 Q42 9 41 16 Q40 22 33 23" fill="none" stroke="#c9a8ff" strokeWidth="2.6" strokeLinecap="round" />
    <rect x="21" y="31" width="6" height="6" fill="#9c7ad9" />
    <rect x="15" y="37" width="18" height="5" rx="1.5" fill="#3b3352" />
    <path d="M24 10 l1.8 3.8 4.2.5 -3.1 2.9 .8 4.1 -3.7-2 -3.7 2 .8-4.1 -3.1-2.9 4.2-.5z" fill="#fff" opacity=".85" />
  </svg>
);

/** The split itself: a fee coin, then the three places it goes. */
export function FeeSplit({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`fee-split ${compact ? "compact" : ""}`}>
      <div className="fs-head">
        <Coin />
        <span>
          Where the <b>10% fee</b> goes
        </span>
      </div>
      <div className="fs-cols">
        <div className="fs-col prize">
          <div className="fs-icon">
            <Pot />
          </div>
          <b>3.5%</b>
          <span>Daily prize</span>
          <em>of every 0.05 SOL pot, for the day's best player</em>
        </div>
        <div className="fs-col fund">
          <div className="fs-icon">
            <Battery />
          </div>
          <b>0.001</b>
          <span>Table fuel</span>
          <em>SOL a night keeps every table running</em>
        </div>
        <div className="fs-col cup">
          <div className="fs-icon">
            <Trophy />
          </div>
          <b>The rest</b>
          <span>Tournaments</span>
          <em>saved for future tournaments with bigger prizes</em>
        </div>
      </div>
    </div>
  );
}

/** The home page's always-visible badge: tap it to see the split. */
export function FeeBadge() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="fee-badge-wrap" ref={ref}>
      <button className={`fee-badge ${open ? "on" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Coin size={20} />
        <span>
          Where does the <b>10% fee</b> go?
        </span>
        <span className="fb-mini" aria-hidden>
          <i className="p" />
          <i className="f" />
          <i className="c" />
        </span>
        <span className="fb-arrow" aria-hidden>
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div className="fee-pop">
          <FeeSplit />
        </div>
      )}
    </div>
  );
}
