// Shared mutable input state (keyboard, mouse, touch joysticks). Read every frame.
export const controls = {
  keys: new Set<string>(),
  fire: false,
  reload: false,
  mouseActive: false,
  touchMove: null as [number, number] | null,
  touchAim: null as number | null,
  touchFire: false,
  fireUntil: 0, // a click always fires for >= 3 server ticks
  reloadUntil: 0,
  fps: 0,
  view: ((typeof localStorage !== "undefined" && localStorage.getItem("bo-view-v2")) || "chase") as "chase" | "top",
  chaseAim: 0, // unused (kept for compatibility)
  camYaw: 0, // behind-view camera heading (radians), follows your aim
  onTarget: false, // an enemy is on your line of fire
  cursorX: -100,
  cursorY: -100,
  locked: false,
  // player-tunable camera (persisted)
  chaseDist: num("bo-chase-dist-v2", 7.5),
  chaseHeight: num("bo-chase-height-v2", 5.5),
  topZoom: num("bo-top-zoom", 14),
  sens: num("bo-sens", 36),
  laser: (() => {
    try {
      return localStorage.getItem("bo-laser") !== "0";
    } catch {
      return true;
    }
  })(),
};

export function setLaser(on: boolean) {
  controls.laser = on;
  try {
    localStorage.setItem("bo-laser", on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function num(key: string, d: number) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : d;
  } catch {
    return d;
  }
}

export function setSetting(k: "chaseDist" | "chaseHeight" | "topZoom" | "sens", v: number) {
  controls[k] = v;
  const keys = { chaseDist: "bo-chase-dist-v2", chaseHeight: "bo-chase-height-v2", topZoom: "bo-top-zoom", sens: "bo-sens" };
  try {
    localStorage.setItem(keys[k], String(v));
  } catch {
    /* ignore */
  }
}

/** Mouse wheel zooms whichever camera you're using. */
export function wheelZoom(deltaY: number) {
  const f = Math.exp(deltaY * 0.001);
  if (controls.view === "chase") {
    setSetting("chaseDist", Math.min(14, Math.max(2.5, controls.chaseDist * f)));
    setSetting("chaseHeight", Math.min(10, Math.max(1.8, controls.chaseHeight * f)));
  } else setSetting("topZoom", Math.min(28, Math.max(7, controls.topZoom * f)));
}

export function toggleView() {
  controls.view = controls.view === "chase" ? "top" : "chase";
  try {
    localStorage.setItem("bo-view-v2", controls.view);
  } catch {
    /* ignore */
  }
  if (controls.view === "top" && document.pointerLockElement) document.exitPointerLock();
}

let installed = false;
export function installKeyboard() {
  if (installed) return;
  installed = true;
  const norm = (k: string) => k.toLowerCase();
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    const k = norm(e.key);
    controls.keys.add(k);
    if (k === "v") toggleView();
    if (k === "m") import("./audio").then(({ audio }) => audio.toggleMute());
    if (k === "r") {
      controls.reload = true;
      controls.reloadUntil = performance.now() + 200;
    }
    if (k === " ") {
      controls.fire = true;
      controls.fireUntil = performance.now() + 160;
    }
  });
  window.addEventListener("keyup", (e) => {
    const k = norm(e.key);
    controls.keys.delete(k);
    if (k === "r") controls.reload = false;
    if (k === " ") controls.fire = false;
  });
  window.addEventListener("blur", () => {
    controls.keys.clear();
    controls.fire = false;
    controls.reload = false;
  });
}
