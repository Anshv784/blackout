import { useEffect, useRef, useState } from "react";
import { controls } from "../game/controls";
import { radToAngle } from "../game/sim";
import { audio } from "../game/audio";

/** Twin-stick touch: left = move, right = aim (auto-fire past 60%). */
export function TouchControls() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const on = () => setTouch(true);
    window.addEventListener("touchstart", on, { once: true });
    if (matchMedia("(pointer: coarse)").matches) setTouch(true);
    return () => window.removeEventListener("touchstart", on);
  }, []);
  if (!touch) return null;
  return (
    <>
      <Stick side="left" onMove={(x, y) => (controls.touchMove = x === 0 && y === 0 ? null : [x, y])} />
      <Stick
        side="right"
        onMove={(x, y, m) => {
          if (m < 0.15) {
            controls.touchFire = false;
            return;
          }
          controls.touchAim = radToAngle(Math.atan2(y, x));
          controls.touchFire = m > 0.6;
        }}
      />
      <button
        className="touch-reload"
        onTouchStart={() => {
          controls.reload = true;
          setTimeout(() => (controls.reload = false), 200);
        }}
      >
        ⟳
      </button>
    </>
  );
}

function Stick({ side, onMove }: { side: "left" | "right"; onMove: (x: number, y: number, mag: number) => void }) {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const id = useRef<number | null>(null);
  useEffect(() => {
    const el = base.current!;
    const R = 56;
    const update = (t: Touch) => {
      const r = el.getBoundingClientRect();
      let dx = t.clientX - (r.left + r.width / 2);
      let dy = t.clientY - (r.top + r.height / 2);
      const m = Math.hypot(dx, dy);
      if (m > R) {
        dx = (dx / m) * R;
        dy = (dy / m) * R;
      }
      knob.current!.style.transform = `translate(${dx}px, ${dy}px)`;
      onMove(dx / R, dy / R, Math.min(1, m / R));
    };
    const start = (e: TouchEvent) => {
      audio.unlock();
      const t = e.changedTouches[0];
      id.current = t.identifier;
      update(t);
      e.preventDefault();
    };
    const move = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) if (t.identifier === id.current) update(t);
      e.preventDefault();
    };
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches))
        if (t.identifier === id.current) {
          id.current = null;
          knob.current!.style.transform = "";
          onMove(0, 0, 0);
          if (side === "right") controls.touchAim = controls.touchAim;
        }
    };
    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [onMove, side]);
  return (
    <div className={`stick ${side}`} ref={base}>
      <div className="knob" ref={knob} />
    </div>
  );
}
