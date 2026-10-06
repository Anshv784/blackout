// HUD icons: read at a glance, no words. Side-view gun silhouettes, gadget glyphs, small status icons.
// All 100x40 (guns) or 24x24 (glyphs), drawn with currentColor.

const GUN_PATHS: string[] = [
  // P92 pistol
  "M14 12h44l4 4v6H40l-4 12h-12l3-12H14z M24 22h10l-1 4h-8z",
  // UMP smg: body, stock, curved mag
  "M6 14h10l4-3h48l4 3h14v5H72v4H56l-3 13h-9l3-13H32l-4 6H18l2-6H6z M58 24h7l-2 8h-7z",
  // S12K shotgun: long barrel + box mag + pump
  "M4 13h22l6-3h52l10 3v5H84v3H40l-2 11h-9l2-11H26l-6 5H6z M48 21h14v4H48z",
  // M416: stock, receiver, curved mag, handguard, barrel
  "M2 15l14-4h14l4-3h34l4 3h18v3h10v3H86v3H58l-4 11h-8l3-11H38l-5 6H24l2-6H14L2 20z M50 22h8l-3 11h-8z M44 6h12v3H44z",
  // KAR98K: wooden stock, bolt, long barrel, scope
  "M2 17l18-5h20l4 2h56v4H44l-4 3H24l-8 7H6z M38 6h26v5H38z M42 11h4v3h-4z M56 11h4v3h-4z M56 18l4 6h-3l-3-5z",
];

export function GunIcon({ weapon, className = "" }: { weapon: number; className?: string }) {
  return (
    <svg className={`gun-icon ${className}`} viewBox="0 0 100 40" aria-hidden>
      <path d={GUN_PATHS[weapon] ?? GUN_PATHS[0]} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/** 1 frag · 2 smoke · 3 flashbang · 4 decoy · 5 sensor · 6 night vision */
export function GadgetIcon({ gadget, className = "" }: { gadget: number; className?: string }) {
  const c = "currentColor";
  return (
    <svg className={`gadget-icon ${className}`} viewBox="0 0 24 24" aria-hidden fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {gadget === 1 && (
        <>
          <ellipse cx="12" cy="14.5" rx="6" ry="7" fill={c} fillOpacity={0.25} />
          <path d="M9 7.5h6M12 7.5V5M15 5h3l1 2" />
          <path d="M8 12h8M8 16h8" strokeOpacity={0.6} />
        </>
      )}
      {gadget === 2 && (
        <>
          <rect x="8" y="7" width="8" height="14" rx="1.5" fill={c} fillOpacity={0.25} />
          <path d="M10 7V4.5h4V7M15 4.5h3" />
          <path d="M5 9c-1.5-2 0-4 2-3M19 9c1.5-2 0-4-2-3" strokeOpacity={0.6} />
        </>
      )}
      {gadget === 3 && (
        <>
          <rect x="8" y="6" width="8" height="15" rx="1.5" fill={c} fillOpacity={0.25} />
          <path d="M8 10.5h8M8 15.5h8M10 6V4h4v2" />
          <path d="M3 4l2 2M21 4l-2 2M2 12h2M22 12h-2" strokeOpacity={0.7} />
        </>
      )}
      {gadget === 4 && (
        <>
          <path d="M5 9h3l5-4v14l-5-4H5z" fill={c} fillOpacity={0.25} />
          <path d="M16 9c1.3 1.6 1.3 4.4 0 6M18.5 6.5c2.6 3 2.6 8 0 11" />
        </>
      )}
      {gadget === 5 && (
        <>
          <circle cx="12" cy="12" r="2" fill={c} />
          <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" />
        </>
      )}
      {gadget === 6 && (
        <>
          <rect x="3" y="9" width="18" height="7" rx="3" fill={c} fillOpacity={0.25} />
          <circle cx="8" cy="12.5" r="2.2" />
          <circle cx="16" cy="12.5" r="2.2" />
          <path d="M7 9V7h10v2" />
        </>
      )}
    </svg>
  );
}

export function VestIcon() {
  return (
    <svg className="mini-icon" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M8 3l-4 3v14h7v-6h2v6h7V6l-4-3-1 3c-1 1-3 1-4 0z" />
    </svg>
  );
}

export function CrossIcon() {
  return (
    <svg className="mini-icon" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />
    </svg>
  );
}

export function EyeIcon() {
  return (
    <svg className="mini-icon" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

/** single = 1 dot, auto = 3, pump = 2, bolt = a bar */
export function FireMode({ weapon }: { weapon: number }) {
  const n = [1, 3, 2, 3, 0][weapon] ?? 1;
  return (
    <span className="fire-mode" aria-hidden>
      {n === 0 ? <i className="bolt" /> : Array.from({ length: n }, (_, i) => <i key={i} />)}
    </span>
  );
}

/** the magazine as marks: full ones bright, spent ones dim (max 30 shown) */
export function AmmoTicks({ mag, max }: { mag: number; max: number }) {
  return (
    <span className={`ammo-ticks ${max > 12 ? "dense" : ""}`} aria-hidden>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < mag ? "on" : ""} />
      ))}
    </span>
  );
}
