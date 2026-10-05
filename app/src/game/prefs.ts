// Player settings for the in-game menu. Persisted per browser; read every frame by the scene.
import { useSyncExternalStore } from "react";

export interface Prefs {
  // controls
  invertY: boolean;
  turnSpeed: number; // Q/E (and arrow keys in camera mode) turn rate multiplier
  arrows: "move" | "camera"; // arrow keys walk, or swing/tilt the camera
  autoTurn: boolean; // camera follows your aim when you point off to the side
  // camera
  fov: number;
  camSmooth: number; // 0 = snappy, 1 = floaty
  hitFlash: boolean;
  shake: boolean;
  weather: boolean;
  // crosshair
  xStyle: "cross" | "dot" | "circle";
  xColor: string;
  xSize: number;
  // display
  quality: "high" | "low";
  exposure: number;
  names: boolean;
  netStats: boolean;
  mapSize: number;
  // audio
  volume: number; // 0..1
}

export const DEFAULT_PREFS: Prefs = {
  invertY: false,
  turnSpeed: 1,
  arrows: "move",
  autoTurn: true,
  fov: 46,
  camSmooth: 0.55,
  hitFlash: true,
  shake: true,
  weather: true,
  xStyle: "cross",
  xColor: "#ffd166",
  xSize: 1,
  quality: "high",
  exposure: 1.1,
  names: true,
  netStats: true,
  mapSize: 140,
  volume: 0.7,
};

const KEY = "bo-prefs-v1";

export const prefs: Prefs = (() => {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULT_PREFS };
  }
})();

// the cross is the crosshair everyone starts with: reset older saved styles once
try {
  if (!localStorage.getItem("bo-xhair-cross")) {
    prefs.xStyle = "cross";
    prefs.xSize = DEFAULT_PREFS.xSize;
    prefs.xColor = DEFAULT_PREFS.xColor;
    localStorage.setItem("bo-xhair-cross", "1");
    localStorage.setItem(KEY, JSON.stringify(prefs));
  }
} catch {
  /* ignore */
}

const subs = new Set<() => void>();
let version = 0;

function save() {
  version++;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
  applyDom();
  subs.forEach((f) => f());
}

export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  prefs[k] = v;
  save();
}

export function resetPrefs() {
  Object.assign(prefs, DEFAULT_PREFS);
  save();
}

/** Re-render when any setting changes. */
export function usePrefs(): Prefs {
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => version,
  );
  return prefs;
}

/** Settings that are pure CSS: name tags, the net bar, minimap size, crosshair look. */
export function applyDom() {
  if (typeof document === "undefined") return;
  const b = document.body;
  b.classList.toggle("bo-hide-names", !prefs.names);
  b.classList.toggle("bo-hide-net", !prefs.netStats);
  b.style.setProperty("--map", `${prefs.mapSize}px`);
  b.style.setProperty("--xc", prefs.xColor);
  b.style.setProperty("--xs", String(prefs.xSize));
}
applyDom();
