// A radial emote picker: opens round a point, slices for each emote, pick one or click away.
import { useEffect } from "react";
import { EMOTES } from "../game/look";

const ICON: Record<string, string> = { salute: "🫡", victory: "🏆", wave: "👋", taunt: "😤", dance: "🕺", clap: "👏" };

export function EmoteWheel({ x, y, current, onPick, onClose }: { x: number; y: number; current: number; onPick: (i: number) => void; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      const n = Number(e.key);
      if (n >= 1 && n <= EMOTES.length) onPick(n - 1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onPick, onClose]);
  const R = 92;
  // keep the whole wheel on screen
  const cx = Math.min(window.innerWidth - R - 50, Math.max(R + 50, x));
  const cy = Math.min(window.innerHeight - R - 50, Math.max(R + 50, y));
  return (
    <div className="ew-veil" onClick={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())}>
      <div className="ew" style={{ left: cx, top: cy }} onClick={(e) => e.stopPropagation()}>
        <div className="ew-ring" />
        {EMOTES.map((em, i) => {
          const a = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
          return (
            <button key={em.key} className={`ew-item ${current === i ? "on" : ""}`} style={{ transform: `translate(${Math.cos(a) * R}px, ${Math.sin(a) * R}px)` }} onClick={() => onPick(i)}>
              <span>{ICON[em.key] ?? "★"}</span>
              <b>{em.name}</b>
            </button>
          );
        })}
        <button className="ew-center" onClick={onClose}>
          EMOTE
          <small>esc</small>
        </button>
      </div>
    </div>
  );
}
