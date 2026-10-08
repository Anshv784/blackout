// Shared mutable input state (keyboard, mouse, touch joysticks). Read every frame.
export const controls = {
  keys: new Set<string>(),
  fire: false,
  reload: false,
  mouseActive: false,
  touchMove: null as [number, number] | null,
  touchAim: null as number | null,
  touchFire: false,
  touchSprint: false, // left stick pushed to the rim
  touchCrouch: false,
  touchJump: false,
  fireUntil: 0, // a click always fires for >= 3 server ticks
  gadgetHeld: 0, // performance.now() G (or the touch button) went down: aiming the throw; 0 = not held
  gadgetUntil: 0, // released: the throw goes out for a few ticks
  reloadUntil: 0,
  fps: 0,
  view: ((typeof localStorage !== "undefined" && localStorage.getItem("bo-view-v2")) || "chase") as "chase" | "top",
  chaseAim: 0, // unused (kept for compatibility)
  camYaw: 0, // third-person camera heading (radians); you face where it looks
  camPitch: 0.14, // camera tilt down (radians): mouse up looks further
  onTarget: false, // an enemy is on your line of fire
  // behind-view virtual cursor in normalized device coords (-1..1), moved by the mouse
  vcx: 0,
  vcy: 0.15,
  cursorX: -100,
  cursorY: -100,
  locked: false,
  menu: false,
  ads: false, // right mouse: aim down sights
  crouch: false, // C toggles (not Ctrl: Ctrl+W would close the tab)
  adsK: 0, // eased 0..1 // a settings/map overlay is open: game keys are ignored
  // player-tunable camera (persisted)
  chaseDist: num("bo-chase-dist-v3", 5.0),
  chaseHeight: num("bo-chase-height-v3", 4.0),
  topZoom: num("bo-top-zoom", 14),
  sens: num("bo-sens", 36),
  laser: (() => {
    try {
      return localStorage.getItem("bo-laser-v2") === "1"; // off by default
    } catch {
      return true;
    }
  })(),
};

export function setLaser(on: boolean) {
  controls.laser = on;
  try {
    localStorage.setItem("bo-laser-v2", on ? "1" : "0");
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
  const keys = { chaseDist: "bo-chase-dist-v3", chaseHeight: "bo-chase-height-v3", topZoom: "bo-top-zoom", sens: "bo-sens" };
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
    if (controls.menu) return;
    const k = norm(e.key);
    controls.keys.add(k);
    if (k === "v") toggleView();
    if (k === "m") import("./audio").then(({ audio }) => audio.toggleMute());
    if (k === "r") {
      controls.reload = true;
      controls.reloadUntil = performance.now() + 200;
    }
    if (k === "g" && !e.repeat) gadgetDown();
    if (k === "c" && !e.repeat) controls.crouch = !controls.crouch;
    if ((k === "shift" || k === " ") && !e.repeat) controls.crouch = false; // sprint / jump stands you up
    if (k === " ") e.preventDefault(); // Space jumps (and must not scroll the page)
  });
  window.addEventListener("keyup", (e) => {
    const k = norm(e.key);
    controls.keys.delete(k);
    if (k === "r") controls.reload = false;
    if (k === "g") gadgetUp();
  });
  window.addEventListener("blur", () => {
    controls.keys.clear();
    controls.fire = false;
    controls.reload = false;
    controls.gadgetHeld = 0;
  });
}

/** Hold to aim the throw (an arc shows where it lands), let go to throw. */
export function gadgetDown() {
  controls.gadgetHeld = performance.now();
}
export function gadgetUp() {
  if (!controls.gadgetHeld) return;
  controls.gadgetHeld = 0;
  controls.gadgetUntil = performance.now() + 160;
}
/** right-click / Esc while aiming a throw puts it away */
export function gadgetCancel() {
  controls.gadgetHeld = 0;
}
