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
  quality: "auto" | "high" | "low"; // auto: picked from the device, then from the frame rate
  autoTier: "high" | "low"; // what auto settled on (remembered)
  exposure: number;
  names: boolean;
  netStats: boolean;
  mapSize: number;
  // audio
  sprintHold: boolean; // true: hold Shift to run; false: tap Shift (or double-tap W) to run
  wheelSwap: boolean; // mouse wheel swaps guns (else it zooms the camera)
  volume: number; // master, 0..1.5 (above 1 boosts)
  sfxVol: number; // guns, steps, hits, 0..1.5
  musicVol: number; // the night's ambience and music, 0..1.5
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
  quality: "auto",
  autoTier: detectTier(),
  exposure: 1.1,
  names: true,
  netStats: true,
  mapSize: 140,
  sprintHold: false,
  wheelSwap: true,
  volume: 0.8,
  sfxVol: 0.85,
  musicVol: 0.8,
};

const KEY = "bo-prefs-v1";

/** A first guess at what this device can run: phones, few cores, little memory, or a software /
 *  low-end GPU get Low. The game then corrects it from the real frame rate. */
export function detectTier(): "high" | "low" {
  try {
    if (matchMedia("(pointer: coarse)").matches) return "low";
    const cores = navigator.hardwareConcurrency || 4;
    const mem = (navigator as any).deviceMemory as number | undefined;
    if (cores <= 4 || (mem !== undefined && mem <= 4)) return "low";
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    const gpu = ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    if (/swiftshader|llvmpipe|software|microsoft basic|intel.*(hd|uhd) graphics [2-6]/i.test(gpu)) return "low";
    return "high";
  } catch {
    return "high";
  }
}

/** The graphics level in effect right now. */
export function gfx(p: { quality: Prefs["quality"]; autoTier: Prefs["autoTier"] } = prefs): "high" | "low" {
  return p.quality === "auto" ? p.autoTier : p.quality;
}

export const prefs: Prefs = (() => {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULT_PREFS };
  }
})();

// graphics became automatic: everyone moves to Auto once (they can still pick High or Low)
try {
  if (!localStorage.getItem("bo-gfx-auto-v1")) {
    prefs.quality = "auto";
    prefs.autoTier = detectTier();
    localStorage.setItem("bo-gfx-auto-v1", "1");
    localStorage.setItem(KEY, JSON.stringify(prefs));
  }
} catch {
  /* ignore */
}

// the mix was rebalanced (recorded sound, no boost): start everyone at the new comfortable level once
try {
  if (!localStorage.getItem("bo-vol-v3")) {
    prefs.volume = DEFAULT_PREFS.volume;
    prefs.sfxVol = DEFAULT_PREFS.sfxVol;
    prefs.musicVol = DEFAULT_PREFS.musicVol;
    localStorage.setItem("bo-vol-v3", "1");
    localStorage.setItem(KEY, JSON.stringify(prefs));
  }
} catch {
  /* ignore */
}

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
