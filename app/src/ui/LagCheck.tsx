// Tells the player what is making the night stutter, in plain words: their network, their device
// (graphics), or the rollup itself. And a clear "reconnecting" banner instead of a silent freeze.
import { useEffect, useState } from "react";
import type { Session } from "../game/session";
import { controls } from "../game/controls";
import { useStore } from "../game/store";
import { gfx, prefs, setPref } from "../game/prefs";
import { ST_LIVE, ST_COUNTDOWN } from "../chain/layout";

type Verdict = { kind: "ok" | "net" | "device" | "server" | "lost"; text: string; tip?: string };

export function judge(fps: number, rtt: number, gap: number, stall: number, tps: number): Verdict {
  if (stall > 1500) return { kind: "lost", text: "RECONNECTING", tip: "no updates from the TEE for a moment" };
  if (fps > 0 && fps < 28) return { kind: "device", text: `DEVICE · ${fps} FPS`, tip: gfx() === "high" ? "graphics set to Low will help" : "close other apps or tabs" };
  if (tps > 0 && tps < 15) return { kind: "server", text: `ROLLUP · ${tps.toFixed(0)} TICKS/S`, tip: "the TEE is busy; it catches up by itself" };
  if (rtt > 380 || gap > 450) return { kind: "net", text: `NETWORK · ${Math.round(rtt)} MS`, tip: "a slow or jittery connection: others are drawn a little later to stay smooth" };
  return { kind: "ok", text: `SMOOTH · ${Math.round(rtt)} MS · ${fps} FPS` };
}

export function LagCheck({ session }: { session: Session }) {
  const tps = useStore((s) => s.stats.tps);
  const [v, setV] = useState<Verdict>({ kind: "ok", text: "" });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setInterval(() => {
      const st = session.room?.status;
      if (st !== ST_LIVE && st !== ST_COUNTDOWN) return setV({ kind: "ok", text: "" });
      // during the countdown nothing moves yet, so a quiet socket isn't a dropped one
      setV(judge(controls.fps, session.rtt, session.worstGap, st === ST_LIVE ? session.stalledFor : 0, tps));
    }, 500);
    return () => clearInterval(t);
  }, [session, tps]);
  if (!v.text) return null;
  return (
    <>
      {v.kind === "lost" && (
        <div className="reconnect">
          <i />
          <b>RECONNECTING</b>
          <small>your connection dropped for a moment · you're still in the night</small>
        </div>
      )}
      <button className={`lag-chip ${v.kind}`} onClick={() => setOpen((o) => !o)} onPointerDown={(e) => e.stopPropagation()}>
        <span className="dot" />
        {v.text}
      </button>
      {open && v.tip && (
        <div className="lag-tip" onPointerDown={(e) => e.stopPropagation()}>
          {v.tip}
          {v.kind === "device" && gfx() === "high" && (
            <button className="btn small" onClick={() => setPref("quality", "low")}>
              SWITCH TO LOW
            </button>
          )}
          {v.kind === "device" && prefs.quality === "low" && null}
        </div>
      )}
    </>
  );
}
