// Game feel: one-shot impulses the camera, HUD and effects read every frame.
export const feel = {
  shake: 0, // camera shake amplitude, decays
  recoil: 0, // camera kick from your own shots, decays
  hitAt: 0, // performance.now() of your last landed hit (crosshair hit marker)
  killAt: 0,
  hurtAt: 0,
  lightning: 0, // 0..1 sky flash
  /** your last pickup: when, what (loot kind), and where the crate stood (map units) */
  pickAt: 0,
  pickKind: 0,
  pickFrom: { x: 0, y: 0 },
  /** the gun's reload started (performance.now) and how long it takes (ms) */
  reloadAt: 0,
  reloadDur: 0,
};

export interface Banner {
  id: number;
  text: string;
  sub?: string;
  tone: "kill" | "event" | "danger";
  at: number;
}

let bannerId = 0;
const listeners = new Set<(b: Banner) => void>();
export function onBanner(f: (b: Banner) => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
export function banner(text: string, tone: Banner["tone"] = "event", sub?: string) {
  const b = { id: ++bannerId, text, sub, tone, at: performance.now() };
  listeners.forEach((f) => f(b));
}
