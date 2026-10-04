import { useEffect, useRef } from "react";
import { controls } from "../game/controls";
import { prefs, usePrefs } from "../game/prefs";

/** Replaces the cursor over the game; goes red when an enemy is on your line of fire. */
export function Crosshair() {
  const p = usePrefs();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = ref.current;
      if (!el) return;
      el.style.transform = `translate(${controls.cursorX}px, ${controls.cursorY}px) scale(${prefs.xSize})`;
      el.classList.toggle("hot", controls.onTarget);
      el.classList.toggle("firing", controls.fire);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className={`crosshair x-${p.xStyle}`} ref={ref}>
      <u />
      <i className="t" />
      <i className="b" />
      <i className="l" />
      <i className="r" />
      <b />
    </div>
  );
}
