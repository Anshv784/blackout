import { useEffect, useRef } from "react";
import { controls } from "../game/controls";

/** Replaces the cursor over the game; goes red when an enemy is on your line of fire. */
export function Crosshair() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = ref.current;
      if (!el) return;
      el.style.transform = `translate(${controls.cursorX}px, ${controls.cursorY}px)`;
      el.classList.toggle("hot", controls.onTarget);
      el.classList.toggle("firing", controls.fire);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="crosshair" ref={ref}>
      <i className="t" />
      <i className="b" />
      <i className="l" />
      <i className="r" />
      <b />
    </div>
  );
}
