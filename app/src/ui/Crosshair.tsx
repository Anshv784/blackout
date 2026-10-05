import { useEffect, useRef } from "react";
import { controls } from "../game/controls";
import { prefs, usePrefs } from "../game/prefs";
import { feel } from "../game/feel";
import { useStore } from "../game/store";

/** Replaces the cursor over the game; goes red when an enemy is on your line of fire. */
export function Crosshair() {
  const p = usePrefs();
  const ref = useRef<HTMLDivElement>(null);
  const scope = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = ref.current;
      if (!el) return;
      // aiming down sights tightens the reticle; the Kar98k looks through a scope
      const sniper = useStore.getState().view?.me.weapon === 4;
      const k = controls.adsK;
      el.style.transform = `translate(${controls.cursorX}px, ${controls.cursorY}px) scale(${prefs.xSize * (1 - k * 0.3)})`;
      const sc = scope.current;
      if (sc) {
        const on = sniper ? Math.max(0, (k - 0.5) * 2) : 0;
        sc.style.opacity = String(on);
        if (on > 0) {
          sc.style.setProperty("--sx", `${controls.cursorX}px`);
          sc.style.setProperty("--sy", `${controls.cursorY}px`);
        }
        el.style.opacity = on > 0.6 ? "0" : "1";
      }
      el.classList.toggle("hot", controls.onTarget);
      el.classList.toggle("firing", controls.fire);
      const since = performance.now() - feel.hitAt;
      el.classList.toggle("hitm", since < 180);
      el.classList.toggle("killm", performance.now() - feel.killAt < 400);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
      <div className="scope" ref={scope}>
        <i className="sh" />
        <i className="sv" />
      </div>
    <div className={`crosshair x-${p.xStyle}`} ref={ref}>
      <u />
      <em className="hm">
        <s />
        <s />
        <s />
        <s />
      </em>
      <i className="t" />
      <i className="b" />
      <i className="l" />
      <i className="r" />
      <b />
    </div>
    </>
  );
}
