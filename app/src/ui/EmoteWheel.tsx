// A radial emote picker: a segmented ring round a point, one slice per emote, line icons in the
// game's own style. Hover a slice to see its name in the centre; click to play it.
import { useEffect, useState } from "react";
import { EMOTES } from "../game/look";

/** 24x24 line glyphs (stroke = currentColor) */
const GLYPH: Record<string, JSX.Element> = {
  // a hand raised flat to the brow
  salute: (
    <>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M5 21v-3.5a4 4 0 0 1 8 0V21" />
      <path d="M11.6 6.8 19 4.2M12.4 8.6l6.3-1.6" />
    </>
  ),
  // a fist punched up, with a burst
  victory: (
    <>
      <path d="M9 21v-6.5h6V21" />
      <rect x="8.5" y="7.5" width="7" height="7" rx="1.6" />
      <path d="M8.5 10.3h7M8.5 12.6h7" />
      <path d="M12 2.5v2.2M6.6 4.2l1.3 1.6M17.4 4.2l-1.3 1.6" />
    </>
  ),
  // an open hand with motion lines
  wave: (
    <>
      <path d="M8 13V6.5a1.4 1.4 0 0 1 2.8 0V11M10.8 10V5a1.4 1.4 0 0 1 2.8 0v5.5M13.6 10.5V6.3a1.4 1.4 0 0 1 2.8 0V14a6 6 0 0 1-6 6h-.6a5.4 5.4 0 0 1-4.3-2.2L4 15.1a1.4 1.4 0 0 1 2.2-1.7L8 15.5" />
      <path d="M19.5 4.5c1 1 1.5 2.3 1.5 3.6M18.6 7.4c.4.4.6.9.6 1.4" />
    </>
  ),
  // beckoning: "come here"
  taunt: (
    <>
      <path d="M6 20v-6.5a2 2 0 0 1 2-2h5.5" />
      <path d="M13.5 11.5V8.4a1.5 1.5 0 0 1 3 0v1.4M16.5 9.8a1.5 1.5 0 0 1 3 0v3.2a7 7 0 0 1-7 7H9" />
      <path d="M3.5 7.5 6 5l2.5 2.5M6 5v5" />
    </>
  ),
  // a figure mid-move, with a note
  dance: (
    <>
      <circle cx="9" cy="4.8" r="2" />
      <path d="M9 7v6l-3 7M9 13l3.5 3-1 4.5M9 9.5 5 8M9 9.5l4-2.5" />
      <path d="M17 5v8.5" />
      <circle cx="15.6" cy="13.8" r="1.6" />
      <path d="M17 5l3 1" />
    </>
  ),
  // two palms meeting, with impact ticks
  clap: (
    <>
      <path d="M7.5 20.5 4.8 13a1.5 1.5 0 0 1 2.8-1l1.6 3.6V6.4a1.5 1.5 0 0 1 3 0v6.8" />
      <path d="M12.2 13.2V5.8a1.5 1.5 0 0 1 3 0v8.4a6.3 6.3 0 0 1-6.3 6.3" />
      <path d="M18.5 4.5l1.6-1.6M19.4 8l2.1-.4M17 2.2l.3-1.2" />
    </>
  ),
};

export function EmoteGlyph({ k, className = "" }: { k: string; className?: string }) {
  return (
    <svg className={`ew-glyph ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {GLYPH[k]}
    </svg>
  );
}

const R_OUT = 132;
const R_IN = 54;
const GAP = 0.035; // radians between slices

function slicePath(i: number, n: number) {
  const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 - Math.PI / n + GAP;
  const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - Math.PI / n - GAP;
  const p = (r: number, a: number) => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
  return `M ${p(R_IN, a0)} L ${p(R_OUT, a0)} A ${R_OUT} ${R_OUT} 0 0 1 ${p(R_OUT, a1)} L ${p(R_IN, a1)} A ${R_IN} ${R_IN} 0 0 0 ${p(R_IN, a0)} Z`;
}

export function EmoteWheel({ x, y, current, onPick, onClose }: { x: number; y: number; current: number; onPick: (i: number) => void; onClose: () => void }) {
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      const n = Number(e.key);
      if (n >= 1 && n <= EMOTES.length) onPick(n - 1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onPick, onClose]);
  const n = EMOTES.length;
  const S = R_OUT + 12;
  const cx = Math.min(window.innerWidth - S, Math.max(S, x));
  const cy = Math.min(window.innerHeight - S, Math.max(S, y));
  const shown = hover ?? current;
  return (
    <div className="ew-veil" onClick={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())}>
      <div className="ew" style={{ left: cx, top: cy }} onClick={(e) => e.stopPropagation()}>
        <svg className="ew-svg" width={S * 2} height={S * 2} viewBox={`${-S} ${-S} ${S * 2} ${S * 2}`}>
          <circle r={R_OUT + 6} className="ew-halo" />
          {EMOTES.map((em, i) => (
            <path
              key={em.key}
              d={slicePath(i, n)}
              className={`ew-slice ${hover === i ? "hot" : ""} ${current === i ? "on" : ""}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onPick(i)}
            />
          ))}
        </svg>
        {EMOTES.map((em, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          const r = (R_IN + R_OUT) / 2;
          return (
            <div key={em.key} className={`ew-label ${hover === i ? "hot" : ""} ${current === i ? "on" : ""}`} style={{ transform: `translate(calc(${Math.cos(a) * r}px - 50%), calc(${Math.sin(a) * r}px - 50%))` }}>
              <EmoteGlyph k={em.key} />
              <i>{i + 1}</i>
            </div>
          );
        })}
        <div className="ew-core">
          <b>{EMOTES[shown]?.name.toUpperCase()}</b>
          <small>{hover === null ? "pick an emote" : "click to play"}</small>
        </div>
      </div>
    </div>
  );
}
