// The trailer: a ~34 s scripted cinematic in the real Yard. Everything is data:
// actors (paths, facing, shots, falls), camera shots (hard cuts), blasts and the zone.
// `globalThis.__introT = <seconds>` freezes it at a moment (used to review frames).
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";
import * as THREE from "three";
import { Arena } from "./Arena";
import { Meadow } from "./Meadow";
import { setActiveMap } from "../game/maps";
import { seatDefault } from "../game/look";
import { clipAt, storyTime, type Clip } from "../game/trailer";
import { Avatar, SEAT_COLORS } from "./Avatar";
import { TORCH_X } from "./Gun";
import { stillMotion, SOLDIER_URL, type Motion } from "./Soldier";
import { audio } from "../game/audio";
import { INTRO_LENGTH } from "../game/colors";
export { INTRO_LENGTH };

// ------------------------------------------------------------------ script
//
// One night across both maps, choreographed once and then cut like a launch trailer (game/trailer.ts).
// Act I, the Yard: 03:12 the grid fails. DUSK wakes among the containers and learns the one rule
// hiding from NYX's searching torch; WRAITH forgets it and dies. The Warden watches and tells no
// one. Act II, the Meadow: no walls, only grass. VEX kills GLOOM with a crossbow nobody hears.
// DUSK answers with a grenade, takes the silent bow, and in the last circle ends NYX, who kept
// his light on, standing under a lantern on the creek bridge. One walks out.

type V3 = [number, number, number];
type Win = [number, number];
type Key = { t: number; x: number; z: number; face: number }; // face: degrees, 0 = +x (east), 90 = +z (south)
interface Actor {
  name: string;
  seat: number; // colour
  weapon: number;
  /** the gun in hand changes at these times (picked up mid-scene) */
  weapons?: { t: number; w: number }[];
  show: Win[];
  keys: Key[];
  fire?: { t: number; at: string | V3; miss?: number }[];
  dead?: number; // shot at: falls back, gun drops
  throwAt?: number;
  lights?: Win[]; // flashlight on
  crouch?: Win[];
  sweep?: { from: number; to: number; amp: number; period: number }[]; // a searching torch
  nvg?: boolean;
}

/** the night switches from the Yard to the Meadow here, behind a lightning flash */
export const MAP_SWITCH = 33.0;

export const ACTORS: Actor[] = [
  {
    name: "DUSK", seat: 7, weapon: 3, weapons: [{ t: 51.0, w: 7 }], show: [[6, 22], [37.2, 41.5], [44.6, 51.5], [55, 70]],
    lights: [[9.8, 13]],
    crouch: [[6, 9.2], [13, 22], [37.2, 48.6], [50.6, 51.5], [55, 59.7]],
    keys: [
      // Act I: wakes in the container yard
      { t: 6, x: 6.5, z: 10.6, face: -20 }, { t: 12.9, x: 6.5, z: 10.6, face: -10 },
      // hides south of the containers while NYX passes on the other side
      { t: 13, x: 11.4, z: 13.45, face: -60 }, { t: 22, x: 11.4, z: 13.45, face: -80 },
      // Act II: crawling north through the tall grass, west of the creek
      { t: 37.2, x: 20.6, z: 29.4, face: -88 }, { t: 41.5, x: 20.3, z: 23.6, face: -95 },
      // stops in the grass, watches the hedge, throws
      { t: 44.6, x: 17.6, z: 19.6, face: 205 }, { t: 48.6, x: 17.6, z: 19.6, face: 202 },
      // runs to the body and takes the crossbow
      { t: 50.6, x: 11.2, z: 17.2, face: 200 }, { t: 51.5, x: 11.2, z: 17.2, face: 200 },
      // the last circle: low in the tall grass south of the bridge
      { t: 55, x: 31.5, z: 40.6, face: 218 }, { t: 59.6, x: 31.5, z: 40.6, face: 218 }, { t: 60.0, x: 31.5, z: 40.6, face: 219 },
      { t: 70, x: 31.5, z: 40.6, face: 219 },
    ],
    throwAt: 47.3,
    fire: [{ t: 60.0, at: "NYX" }],
  },
  {
    name: "NYX", seat: 1, weapon: 4, show: [[13, 22], [22, 29], [55, 70]],
    lights: [[13, 22], [55, 60.3]],
    keys: [
      // Act I, the hunter: walks the far side of the containers, torch searching
      { t: 13, x: 21.0, z: 10.5, face: 180 }, { t: 20.5, x: 14.0, z: 10.5, face: 180 }, { t: 21.9, x: 13.6, z: 10.5, face: 180 },
      // dark on the road, waiting
      { t: 22, x: 21.5, z: 17.0, face: 145 }, { t: 29, x: 21.5, z: 17.0, face: 145 },
      // Act II: on the south bridge, under the lantern, light on
      { t: 55, x: 25.3, z: 36.5, face: -40 }, { t: 58.6, x: 27.4, z: 36.6, face: -25 }, { t: 70, x: 27.4, z: 36.6, face: -25 },
    ],
    sweep: [{ from: 13, to: 21.9, amp: 32, period: 2.6 }, { from: 55.2, to: 60.2, amp: 28, period: 2.4 }],
    fire: [{ t: 26.4, at: "WRAITH", miss: 0.1 }],
    dead: 60.3,
  },
  {
    name: "WRAITH", seat: 2, weapon: 1, show: [[22, 29]], lights: [[22, 26.6]],
    keys: [{ t: 22, x: 10.5, z: 20.5, face: 0 }, { t: 25.0, x: 16.5, z: 20.5, face: 25 }, { t: 29, x: 16.5, z: 20.5, face: 35 }],
    fire: [{ t: 25.2, at: [21, 0, 23.5], miss: 1.2 }, { t: 25.45, at: [21, 0, 23.5], miss: 1.2 }, { t: 25.7, at: [21, 0, 23.5], miss: 1.2 }, { t: 25.95, at: [21, 0, 23.5], miss: 1.2 }],
    dead: 26.45,
  },
  {
    // Act II: walks the north field with his torch on, past the hedge gap
    name: "GLOOM", seat: 5, weapon: 2, show: [[41.5, 44.6]], lights: [[41.5, 43.8]],
    keys: [{ t: 41.5, x: 3.5, z: 13.5, face: 0 }, { t: 44.6, x: 9.6, z: 13.4, face: 5 }],
    dead: 43.75,
  },
  {
    // Act II: crouched behind the hedgerow with a crossbow; never lights up, never makes a sound
    name: "VEX", seat: 3, weapon: 7, show: [[41.5, 51.5]],
    crouch: [[41.5, 48.2]],
    keys: [{ t: 41.5, x: 10.1, z: 16.6, face: 230 }, { t: 43.3, x: 10.1, z: 16.6, face: 238 }, { t: 51.5, x: 10.1, z: 16.6, face: 238 }],
    fire: [{ t: 43.4, at: "GLOOM" }],
    dead: 48.25,
  },
];

type Cam = { from: number; to: number; p0: V3; p1: V3; l0: V3; l1: V3; follow?: string; fill?: number };
export const CAMS: Cam[] = [
  // ---- Act I, the Yard
  // 03:12, the district from above; the lights die
  { from: 0, to: 6, p0: [24, 40, 62], p1: [24, 26, 44], l0: [24, 0, 24], l1: [16, 0, 18] },
  // DUSK wakes on the wet ground: low, slow push in from the side
  { from: 6, to: 13, p0: [9.4, 0.7, 12.4], p1: [8.2, 0.95, 11.8], l0: [6.5, 0.7, 10.6], l1: [6.5, 1.15, 10.6], fill: 2.2 },
  // the hunter: NYX coming down the lane between the containers, torch searching
  { from: 13, to: 16.2, p0: [14.2, 1.35, 10.2], p1: [14.6, 1.35, 10.25], l0: [20.5, 1.3, 10.5], l1: [19.0, 1.3, 10.5], fill: 0.4 },
  // the other side of the container: DUSK low in the dark, the beam spilling over the top
  { from: 16.2, to: 19, p0: [9.6, 1.25, 15.4], p1: [9.9, 1.2, 15.2], l0: [13.8, 0.9, 12.6], l1: [13.8, 0.9, 12.5], fill: 0.7 },
  // high and close: the light passes a body-length from him
  { from: 19, to: 22, p0: [11.0, 7.5, 17.5], p1: [12.0, 8.2, 17.0], l0: [13.8, 0, 12.0], l1: [13.6, 0, 11.8], fill: 1.5 },
  // WRAITH walks in with his light on, sprays at a sound
  { from: 22, to: 25.4, p0: [-2.2, 1.6, 2.2], p1: [-2.0, 1.6, 2.0], l0: [3, 1.0, -1.2], l1: [3, 1.0, -1.4], follow: "WRAITH", fill: 1.2 },
  // reverse: behind NYX in the dark, WRAITH lit by his own torch and muzzle flashes
  { from: 25.4, to: 26.9, p0: [22.6, 1.6, 15.4], p1: [22.5, 1.55, 15.5], l0: [16.5, 1.0, 20.5], l1: [16.5, 1.0, 20.5] },
  // he goes down where he stood; his torch rolls away and lights him
  { from: 26.9, to: 29, p0: [1.6, 1.5, 2.4], p1: [1.9, 2.1, 2.7], l0: [-0.6, 0.2, -0.3], l1: [-0.6, 0.15, -0.3], follow: "WRAITH" },
  // the Warden over the water tower, the circle closing on the Yard
  { from: 29, to: 33, p0: [31, 4, 33], p1: [28, 8.5, 30], l0: [24, 8.5, 24], l1: [24, 10, 24] },
  // ---- Act II, the Meadow
  // night two: high over the fields, the creek a silver line, lanterns, fireflies
  { from: 33, to: 37.2, p0: [24, 30, 66], p1: [24, 15, 47], l0: [24, 0, 24], l1: [22, 0, 26], fill: 0 },
  // low in the tall grass behind DUSK as he crawls
  { from: 37.2, to: 41.5, p0: [0.55, 0.75, 1.9], p1: [0.5, 0.8, 1.7], l0: [-0.1, 0.45, -2.6], l1: [-0.1, 0.45, -2.6], follow: "DUSK", fill: 1.1 },
  // behind the hedge with VEX: GLOOM's torch on the far side of the gap
  { from: 41.5, to: 44.6, p0: [11.7, 0.85, 18.3], p1: [11.5, 0.9, 18.1], l0: [7.2, 0.9, 13.6], l1: [7.6, 0.9, 13.6], fill: 0.5 },
  // DUSK in the grass, the throw lined up on the hedge
  { from: 44.6, to: 48.6, p0: [19.4, 1.25, 20.6], p1: [19.2, 1.35, 20.4], l0: [11.0, 0.5, 16.6], l1: [10.6, 0.5, 16.6], fill: 0.9 },
  // the body, and the crossbow taken from it
  { from: 48.6, to: 51.5, p0: [13.4, 1.0, 18.7], p1: [12.9, 0.95, 18.4], l0: [10.6, 0.5, 16.8], l1: [10.8, 0.6, 16.9], fill: 1.0 },
  // the Warden over the Meadow, drawing the last circle round the bridge
  { from: 51.5, to: 55, p0: [27, 2.5, 56], p1: [27, 5.5, 50], l0: [27, 6, 37], l1: [27, 9.5, 37] },
  // the last circle: behind DUSK low in the grass, NYX on the bridge under the lantern
  { from: 55, to: 59.7, p0: [32.7, 1.25, 42.4], p1: [32.5, 1.3, 42.1], l0: [26.4, 1.05, 36.5], l1: [27.2, 1.05, 36.6], fill: 0.6 },
  // he rises: one bolt, no flash, no sound
  { from: 59.7, to: 61.6, p0: [29.6, 1.35, 33.9], p1: [29.8, 1.4, 33.7], l0: [27.4, 0.95, 36.8], l1: [27.4, 0.8, 36.8], fill: 0.8 },
  // close on the one who walks out, pulling away over the dark field
  { from: 61.6, to: 70, p0: [30.2, 1.35, 42.0], p1: [28.4, 3.4, 44.2], l0: [31.5, 1.15, 40.6], l1: [31.5, 0.9, 40.6], fill: 1.4 },
];

const BLASTS: { t: number; x: number; z: number }[] = [{ t: 48.2, x: 10.2, z: 16.7 }];
const NADES: { from: number; to: number; a: V3; b: V3 }[] = [{ from: 47.4, to: 48.2, a: [17.2, 1.5, 19.4], b: [10.2, 0.2, 16.7] }];
/** the aimed throw drawn before it's thrown (as in the game): DUSK lines it up */
const ARC = { from: 45.4, to: 47.35, a: [17.3, 1.4, 19.4] as V3, b: [10.2, 0.05, 16.7] as V3 };
const ZONES = [
  { from: 29.4, to: 33, r0: 30, r1: 18, x: 24, z: 24 },
  { from: 51.6, to: 57.5, r0: 24, r1: 9, x: 27, z: 37 },
];
const WARDENS = [
  { from: 29.4, to: 33, x: 24, z: 24 },
  { from: 51.6, to: 55, x: 27, z: 37 },
];
const TITLE_AT = INTRO_LENGTH;

// ------------------------------------------------------------------ helpers

function poseAt(a: Actor, t: number) {
  const k = a.keys;
  if (t <= k[0].t) return { x: k[0].x, z: k[0].z, face: k[0].face, v: 0 };
  for (let i = 0; i < k.length - 1; i++) {
    const p = k[i];
    const q = k[i + 1];
    if (t <= q.t) {
      const u = (t - p.t) / Math.max(1e-3, q.t - p.t);
      const dist = Math.hypot(q.x - p.x, q.z - p.z);
      const cut = dist > 4 && q.t - p.t < 0.5; // a reposition between scenes, not a walk
      return {
        x: cut ? (u < 0.5 ? p.x : q.x) : p.x + (q.x - p.x) * u,
        z: cut ? (u < 0.5 ? p.z : q.z) : p.z + (q.z - p.z) * u,
        face: p.face + (q.face - p.face) * u,
        v: cut ? 0 : dist / Math.max(1e-3, q.t - p.t),
      };
    }
  }
  const l = k[k.length - 1];
  return { x: l.x, z: l.z, face: l.face, v: 0 };
}
const actor = (n: string) => ACTORS.find((a) => a.name === n)!;
const inWin = (w: Win[] | undefined, t: number) => !!w && w.some(([a, b]) => t >= a && t < b);
/** a searching torch swings the whole body left and right while walking */
function faceAt(a: Actor, t: number, base: number) {
  const s = a.sweep?.find((w) => t >= w.from && t < w.to);
  if (!s) return base;
  return base + Math.sin(((t - s.from) / s.period) * Math.PI * 2) * s.amp;
}
const deg = (d: number) => (d * Math.PI) / 180;

// ------------------------------------------------------------------ actors

function ActorView({ a, t }: { a: Actor; t: React.MutableRefObject<number> }) {
  const g = useRef<THREE.Group>(null);
  const motion = useRef<Motion>(stillMotion());
  const spot = useRef<THREE.SpotLight>(null);
  const tgt = useMemo(() => new THREE.Object3D(), []);
  const tracer = useRef<THREE.Mesh>(null);
  const flash = useRef<THREE.PointLight>(null);
  const fired = useRef(new Set<number>());
  const { scene } = useThree();
  const weaponAt = (now: number) => (a.weapons ?? []).reduce((w, s) => (now >= s.t ? s.w : w), a.weapon);
  const [weapon, setWeapon] = useState(a.weapon);
  useEffect(() => {
    scene.add(tgt);
    if (spot.current) spot.current.target = tgt;
    return () => {
      scene.remove(tgt);
    };
  }, [scene, tgt]);
  useFrame(() => {
    const now = t.current;
    const w = weaponAt(now);
    if (w !== weapon) setWeapon(w);
    const dead = a.dead !== undefined && now >= a.dead;
    // a body stays exactly where and how it fell
    const p = poseAt(a, dead ? a.dead! : now);
    const on = inWin(a.show, now);
    const fa = deg(dead ? p.face : faceAt(a, now, p.face));
    if (g.current) {
      g.current.visible = on;
      g.current.position.set(p.x, 0, p.z);
      g.current.rotation.y = -fa;
    }
    const m = motion.current;
    m.speed = dead ? 0 : p.v > 3.2 ? 2 : p.v > 0.4 ? 1 : 0;
    m.crouch = inWin(a.crouch, now);
    // the fall is driven from the script clock so frozen frames show the right moment
    m.deadAt = dead ? performance.now() - (now - a.dead!) * 1000 : undefined;
    m.throwAt = a.throwAt !== undefined && now >= a.throwAt && now < a.throwAt + 0.45 ? performance.now() - (now - a.throwAt) * 1000 : 0;
    const shot = a.fire?.findIndex((f) => now >= f.t && now < f.t + 0.09) ?? -1;
    m.firing = shot >= 0;
    // flashlight
    const lit = inWin(a.lights, now) && !dead;
    m.torch = lit;
    const lw = a.lights?.find(([s0]) => now >= s0 && now < s0 + 0.3);
    const flick = lw ? (Math.random() > 0.45 ? 1 : 0.1) : 1; // a torch clicking on stutters
    // killed with the torch on: it drops beside the body and lights it along the ground
    const dropped = dead && inWin(a.lights, a.dead! - 0.01) && now > a.dead! + 0.5;
    // a torch lying on the ground casts no shadow: at that grazing angle it shimmers across the body
    if (spot.current) {
      const cast = (a.name === "DUSK" || a.name === "NYX") && !dropped && !TOUCH;
      if (spot.current.castShadow !== cast) spot.current.castShadow = cast;
    }
    if (spot.current && dropped) {
      spot.current.position.set(p.x + Math.cos(fa) * 0.55, 0.12, p.z + Math.sin(fa) * 0.55);
      tgt.position.set(p.x - Math.cos(fa) * 2.5, 0, p.z - Math.sin(fa) * 2.5);
      spot.current.intensity = 26; // steady: a flickering light on a body reads as the body shaking
      spot.current.color.set("#fff1d0");
    } else if (spot.current) {
      // from the torch under the barrel (the same spot the lens glows on the gun)
      const lens = -0.07 + 0.72 * ((TORCH_X[w] ?? 0.6) + 0.08);
      spot.current.position.set(p.x + Math.cos(fa) * lens, m.crouch ? 0.68 : 0.94, p.z + Math.sin(fa) * lens);
      spot.current.intensity = lit ? 48 * flick : 0;
      spot.current.color.set(a.nvg ? "#9dffb8" : "#fff1d0");
    }
    if (!dropped) tgt.position.set(p.x + Math.cos(fa) * 6, 0.3, p.z + Math.sin(fa) * 6);
    // gunfire: tracer to the target (or near it), muzzle flash, sound once
    if (tracer.current && flash.current) {
      const bolt = w === 7;
      tracer.current.visible = shot >= 0 && on;
      flash.current.intensity = shot >= 0 && on && !bolt ? 26 : 0;
      (tracer.current.material as THREE.MeshBasicMaterial).color.set(bolt ? "#8a8f98" : "#ffe6a8");
      tracer.current.scale.y = tracer.current.scale.z = bolt ? 0.45 : 1;
      if (shot >= 0) {
        const f = a.fire![shot];
        const to = typeof f.at === "string" ? poseAt(actor(f.at), now) : { x: f.at[0], z: f.at[2] };
        const miss = f.miss ?? 0;
        const tx = to.x + Math.sin(f.t * 13) * miss;
        const tz = to.z + Math.cos(f.t * 7) * miss;
        const mx = p.x + Math.cos(fa) * 0.75;
        const mz = p.z + Math.sin(fa) * 0.75;
        const len = Math.hypot(tx - mx, tz - mz);
        tracer.current.position.set((mx + tx) / 2, m.crouch ? 0.75 : 1.0, (mz + tz) / 2);
        tracer.current.rotation.set(0, -Math.atan2(tz - mz, tx - mx), 0);
        tracer.current.scale.x = len;
        flash.current.position.set(mx, 1.05, mz);
        if (!fired.current.has(shot)) {
          fired.current.add(shot);
          audio.shotAt(w, a.name === "DUSK" ? 1 : w === 7 ? 3 : 6, 0);
        }
      }
    }
  });
  return (
    <>
      <group ref={g} visible={false}>
        <Avatar color={SEAT_COLORS[a.seat]} weapon={weapon} motion={motion} ring={false} look={seatDefault(a.seat)} />
      </group>
      <spotLight ref={spot} angle={0.55} penumbra={0.35} distance={13} decay={1.05} intensity={0} castShadow={a.name === "DUSK" || a.name === "NYX"} shadow-bias={-0.0006} shadow-normalBias={0.04} />
      <pointLight ref={flash} color="#ffb347" distance={9} decay={1.3} intensity={0} />
      <mesh ref={tracer} visible={false}>
        <boxGeometry args={[1, 0.035, 0.035]} />
        <meshBasicMaterial color="#ffe6a8" toneMapped={false} />
      </mesh>
    </>
  );
}

/** A frag in flight, the blast, the smoke. */
function Blast({ t, n, b }: { t: React.MutableRefObject<number>; n: (typeof NADES)[number]; b: (typeof BLASTS)[number] }) {
  const nade = useRef<THREE.Mesh>(null);
  const blast = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const smoke = useRef<(THREE.Mesh | null)[]>([]);
  const boomed = useRef(false);
  useFrame(() => {
    const now = t.current;
    const k = (now - n.from) / (n.to - n.from);
    if (nade.current) {
      nade.current.visible = k > 0 && k < 1;
      const [ax, ay, az] = n.a;
      const [bx, by, bz] = n.b;
      nade.current.position.set(ax + (bx - ax) * k, ay + (by - ay) * k + Math.sin(k * Math.PI) * 1.4, az + (bz - az) * k);
    }
    const q = (now - b.t) / 0.45;
    if (blast.current) {
      blast.current.visible = q > 0 && q < 1;
      blast.current.position.set(b.x, 0.6, b.z);
      blast.current.scale.setScalar(0.3 + q * 2.0);
      (blast.current.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - q) * (1 - q);
    }
    if (light.current) {
      light.current.position.set(b.x, 1.3, b.z);
      light.current.intensity = q > 0 && q < 1 ? 45 * (1 - q) : 0;
    }
    smoke.current.forEach((m, i) => {
      if (!m) return;
      const s = (now - b.t - i * 0.07) / 2.4;
      m.visible = s > 0 && s < 1.4;
      m.position.set(b.x + Math.cos(i * 1.7) * s * 1.5, 0.6 + s * 1.9 + (i % 3) * 0.2, b.z + Math.sin(i * 1.7) * s * 1.5);
      m.scale.setScalar(0.5 + s * 1.7);
    });
    if (now >= b.t && now < b.t + 0.5 && !boomed.current) {
      boomed.current = true;
      audio.explosion(3);
    }
  });
  return (
    <>
      <mesh ref={nade} visible={false}>
        <sphereGeometry args={[0.09, 10, 8]} />
        <meshStandardMaterial color="#4b5d2a" />
      </mesh>
      <mesh ref={blast} visible={false}>
        <sphereGeometry args={[0.5, 20, 14]} />
        <meshBasicMaterial color="#ffb347" transparent toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <pointLight ref={light} color="#ffb070" distance={15} decay={1.2} intensity={0} />
      {Array.from({ length: 10 }, (_, i) => (
        <mesh key={i} ref={(el) => (smoke.current[i] = el)} visible={false}>
          <sphereGeometry args={[0.5, 12, 10]} />
          <meshStandardMaterial color="#3a3d44" transparent opacity={0.55} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}
function Blasts({ t }: { t: React.MutableRefObject<number> }) {
  return (
    <>
      {NADES.map((n, i) => (
        <Blast key={i} t={t} n={n} b={BLASTS[i]} />
      ))}
    </>
  );
}

/** The aimed throw lined up before it's thrown: the same dashed arc and landing ring as in a match. */
function ThrowArc({ t }: { t: React.MutableRefObject<number> }) {
  const line = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const [ax, ay, az] = ARC.a;
    const [bx, by, bz] = ARC.b;
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      pts.push(new THREE.Vector3(ax + (bx - ax) * u, ay + (by - ay) * u + Math.sin(u * Math.PI) * 1.4, az + (bz - az) * u));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: "#ff6b4a", dashSize: 0.22, gapSize: 0.14, transparent: true, depthTest: false, toneMapped: false }));
    l.computeLineDistances();
    l.renderOrder = 20;
    return l;
  }, []);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const now = t.current;
    const on = now >= ARC.from && now < ARC.to;
    const fade = on ? Math.min(1, (now - ARC.from) / 0.3) : 0;
    line.visible = on;
    (line.material as THREE.LineDashedMaterial).opacity = 0.9 * fade;
    if (ring.current) {
      ring.current.visible = on;
      ring.current.scale.setScalar(3 * (1 + Math.sin(now * 6) * 0.03));
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.8 * fade;
    }
  });
  return (
    <>
      <primitive object={line} />
      <mesh ref={ring} rotation-x={-Math.PI / 2} position={[ARC.b[0], 0.06, ARC.b[2]]} visible={false} renderOrder={21}>
        <ringGeometry args={[0.94, 1, 64]} />
        <meshBasicMaterial color="#ff6b4a" transparent depthTest={false} toneMapped={false} />
      </mesh>
    </>
  );
}

/** The zone wall sweeping in. */
function ZoneWall({ t, z: ZONE }: { t: React.MutableRefObject<number>; z: (typeof ZONES)[number] }) {
  const m = useRef<THREE.Mesh>(null);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `uniform float uTime; varying vec2 vUv; void main(){ float l = 0.5 + 0.5*sin(vUv.y*50.0 - uTime*5.0); float f = pow(1.0 - vUv.y, 1.4); gl_FragColor = vec4(0.65, 0.3, 1.0, (0.12 + 0.3*l) * f + smoothstep(0.08, 0.0, vUv.y) * 0.6); }`,
      }),
    [],
  );
  useFrame(({ clock }) => {
    const now = t.current;
    mat.uniforms.uTime.value = clock.elapsedTime;
    if (!m.current) return;
    const on = now >= ZONE.from && now < ZONE.to + 0.6;
    m.current.visible = on;
    const k = Math.min(1, Math.max(0, (now - ZONE.from) / (ZONE.to - ZONE.from)));
    const r = ZONE.r0 + (ZONE.r1 - ZONE.r0) * (k * (2 - k));
    m.current.scale.set(r, 1, r);
  });
  return (
    <mesh ref={m} position={[ZONE.x, 2.5, ZONE.z]} material={mat} visible={false}>
      <cylinderGeometry args={[1, 1, 5, 128, 1, true]} />
    </mesh>
  );
}

function Warden({ t, w: WARDEN }: { t: React.MutableRefObject<number>; w: (typeof WARDENS)[number] }) {
  const g = useRef<THREE.Group>(null);
  const eye = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Group>(null);
  const beamMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uA: { value: 0 } },
        vertexShader: `varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `uniform float uA; varying float vY; void main(){ float k = clamp(0.5 + vY/9.0, 0.0, 1.0); gl_FragColor = vec4(0.65,0.3,1.0, uA * k * 0.35); }`,
      }),
    [],
  );
  useFrame(() => {
    const now = t.current;
    const appear = Math.min(1, Math.max(0, (now - WARDEN.from) / 1.2));
    const gone = now > WARDEN.to - 0.3 ? Math.max(0, 1 - (now - WARDEN.to + 0.3) / 0.5) : 1;
    const s = appear * gone;
    if (g.current) {
      g.current.visible = s > 0.01 && now >= WARDEN.from - 0.1 && now < WARDEN.to + 0.4;
      g.current.scale.setScalar(0.2 + s * 0.8);
      g.current.rotation.y = now * 0.25;
      g.current.position.y = 9.8 + Math.sin(now * 0.8) * 0.3;
    }
    if (eye.current) (eye.current.material as THREE.MeshBasicMaterial).opacity = s;
    if (beam.current) {
      beam.current.rotation.z = Math.sin(now * 0.9) * 0.5;
      beam.current.rotation.x = Math.cos(now * 0.6) * 0.35;
    }
    beamMat.uniforms.uA.value = s;
  });
  return (
    <group ref={g} position={[WARDEN.x, 9.8, WARDEN.z]} visible={false}>
      <mesh>
        <icosahedronGeometry args={[1.6, 1]} />
        <meshBasicMaterial color="#a64dff" wireframe transparent opacity={0.6} toneMapped={false} />
      </mesh>
      <mesh ref={eye}>
        <sphereGeometry args={[0.55, 24, 16]} />
        <meshBasicMaterial color="#e6c8ff" transparent toneMapped={false} />
      </mesh>
      <pointLight color="#a64dff" intensity={6} distance={20} decay={1.2} />
      <group ref={beam}>
        <mesh material={beamMat} position={[0, -4.5, 0]}>
          <coneGeometry args={[3.2, 9, 32, 1, true]} />
        </mesh>
      </group>
    </group>
  );
}

// ------------------------------------------------------------------ direction

function Director({ t, onTime }: { t: React.MutableRefObject<number>; onTime: (s: number) => void }) {
  const { camera } = useThree();
  const lightning = useRef<THREE.DirectionalLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const fill = useRef<THREE.PointLight>(null);
  const start = useRef<number | null>(null);
  const cues = useRef(new Set<string>());
  const lastStep = useRef(-1);
  const lastClip = useRef<Clip | null>(null);
  // a cue only fires if its moment is actually shown (the cut skips most of the night)
  const cue = (key: string, at: number, f: () => void, clockNow = t.current) => {
    if (clockNow >= at && clockNow < at + 0.6 && !cues.current.has(key)) {
      cues.current.add(key);
      f();
    }
  };
  useFrame(({ clock }) => {
    if (start.current === null) start.current = clock.elapsedTime;
    const frozen = (globalThis as any).__introT;
    const adT = typeof frozen === "number" ? frozen : clock.elapsedTime - start.current;
    t.current = storyTime(adT);
    const clip = clipAt(adT);
    if (clip !== lastClip.current) {
      lastClip.current = clip;
      if (clip.heart !== undefined) audio.setHeartbeat(clip.heart);
      if (clip.zone !== undefined) audio.setZoneDanger(clip.zone);
    }
    const now = t.current;
    // camera: hard cuts, each with a small move
    const s = CAMS.find((c) => now < c.to) ?? CAMS[CAMS.length - 1];
    let k = Math.min(1, Math.max(0, (now - s.from) / (s.to - s.from)));
    k = k * (2 - k);
    const L = (a: V3, b: V3) => a.map((v, j) => v + (b[j] - v) * k) as V3;
    let pos = L(s.p0, s.p1);
    let look = L(s.l0, s.l1);
    if (s.follow) {
      const p = poseAt(actor(s.follow), now);
      pos = [p.x + pos[0], pos[1], p.z + pos[2]];
      look = [p.x + look[0], look[1], p.z + look[2]];
    }
    const B = BLASTS.find((b) => now > b.t && now < b.t + 0.55);
    const shake = B ? (1 - (now - B.t) / 0.55) * 0.14 : 0;
    camera.position.set(pos[0] + (Math.random() - 0.5) * shake, pos[1] + (Math.random() - 0.5) * shake, pos[2]);
    camera.lookAt(...look);
    if (fill.current) {
      fill.current.position.set(pos[0], pos[1] + 0.6, pos[2]);
      fill.current.intensity = s.fill ?? 0;
    }
    // the city's lights die early; lightning when the Warden wakes; light floods in for the title
    // the city's lights die at 03:12 and only come back for the title
    (globalThis as any).__boLightsOut = now > 3.1 && adT < TITLE_AT;
    const strikes = [2.9, 3.05, 29.6, MAP_SWITCH - 0.25, MAP_SWITCH - 0.08, 51.7];
    let li = 0;
    for (const st of strikes) if (now >= st && now < st + 0.16) li = 5 * (1 - (now - st) / 0.16);
    if (lightning.current) lightning.current.intensity = li;
    const on = adT > TITLE_AT ? Math.min(1, (adT - TITLE_AT) / 0.6) : 0;
    if (amb.current) amb.current.intensity = 0.04 + on * 0.55;
    // NYX's boots on the far side of the container, passing left to right of DUSK's ear
    for (const [w0, w1, cx] of [[13.4, 20.6, 15], [55.2, 58.6, 30]]) {
      if (now <= w0 || now >= w1) continue;
      const n = Math.floor((now - w0) / 0.6) + w0 * 100;
      if (n !== lastStep.current) {
        lastStep.current = n;
        const x = poseAt(actor("NYX"), now).x;
        audio.step(Math.max(-1, Math.min(1, (x - cx) / 6)), 0.55, false);
      }
    }
    cue("hum", 0.2, () => audio.powerDown(false));
    cue("dark", 3.1, () => {
      audio.powerDown(true); // with a deep horror hit
      audio.thunder(0.2);
    });
    cue("wake", 6.2, () => audio.hurt());
    cue("wolves", 4.2, () => audio.howl(-0.6, 0.7));
    cue("click", 9.8, () => audio.reload());
    cue("heart", 13.2, () => audio.setHeartbeat(0.9));
    cue("hunt", 13.6, () => audio.horror("bass", 0.5, { wet: 0.7 }));
    cue("heartoff", 21.6, () => audio.setHeartbeat(0.3));
    cue("fall1", 26.9, () => {
      audio.bodyFall(0.3, 0.8);
      audio.horror("mid", 0.8);
    });
    cue("warden", 29.6, () => {
      audio.setHeartbeat(0);
      audio.boom();
      audio.whisper(-0.6);
    });
    cue("zone", 29.8, () => audio.setZoneDanger(1));
    // the cut to night two: thunder over the fields, the Yard's dread gives way to wind
    cue("cut", MAP_SWITCH - 0.25, () => {
      audio.setZoneDanger(0);
      audio.thunder(0.6);
      audio.boom();
    });
    cue("meadow", MAP_SWITCH + 1.2, () => audio.howl(0.5, 0.45));
    cue("crawl", 37.4, () => audio.setHeartbeat(0.5));
    cue("gloomfall", 43.85, () => audio.bodyFall(-0.4, 0.5));
    cue("silence", 44.0, () => audio.horror("mid", 0.6, { wet: 0.8 }));
    cue("toss", 47.3, () => audio.toss(1));
    cue("clink", 48.0, () => audio.clink(-0.6, 0.3));
    cue("vexfall", 48.7, () => audio.bodyFall(-0.5, 0.6));
    cue("crawloff", 48.8, () => audio.setHeartbeat(0));
    cue("pickup", 50.9, () => audio.reload(7, 1));
    cue("warden2", 51.8, () => {
      audio.boom();
      audio.whisper(0.6);
    });
    cue("zone2", 51.9, () => audio.setZoneDanger(1));
    cue("heart2", 55.2, () => audio.setHeartbeat(1));
    cue("zone2off", 57.5, () => audio.setZoneDanger(0));
    cue("heart2off", 60.0, () => audio.setHeartbeat(0));
    cue("fall3", 60.75, () => audio.bodyFall(-0.2, 1));
    cue("walksout", 62.0, () => audio.horror("high", 0.75));
    cue("wolves2", 63.5, () => audio.howl(0.7, 0.4));
    // the ad's own beats: a hit on each feature card, the lights come on for the end card
    for (const at of [4.6, 7.6, 12.1, 14.6, 16.6, 18.9, 21.7, 23.5, 28.6]) cue(`hit${at}`, at, () => audio.boom(), adT);
    cue("lights", TITLE_AT, () => {
      audio.setHeartbeat(0);
      audio.setZoneDanger(0);
      audio.lightsOn();
      audio.boom();
    }, adT);
    onTime(adT);
  });
  return (
    <>
      <ambientLight ref={amb} intensity={0.04} color="#b8c6ff" />
      <hemisphereLight args={["#1a2550", "#000000", 0.08]} />
      <directionalLight ref={lightning} position={[6, 30, 4]} intensity={0} color="#cfd8ff" />
      {/* soft key light riding with the camera on close shots */}
      <pointLight ref={fill} color="#c9d4ff" distance={7} decay={1.4} intensity={0} />
    </>
  );
}

const TOUCH = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/** Act I plays in the Yard, Act II in the Meadow: the stage swaps at the lightning cut. */
function Stage({ t }: { t: React.MutableRefObject<number> }) {
  const [act, setAct] = useState(1);
  useFrame(() => {
    const want = t.current >= MAP_SWITCH - 0.05 ? 2 : 1;
    if (want !== act) {
      setActiveMap(want === 2 ? 1 : 0);
      setAct(want);
    }
  });
  useEffect(() => () => setActiveMap(0), []);
  return act === 2 ? <Meadow /> : <Arena />;
}

/** Mounts once the soldier model has loaded: compiles every shader up front (no stall on the
 *  first cut), then says so. The story's clock only starts after this. */
function Ready({ onReady }: { onReady: () => void }) {
  useGLTF(SOLDIER_URL);
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    try {
      gl.compile(scene, camera);
    } catch {
      /* compiling early is only an optimisation */
    }
    onReady();
  }, []);
  return null;
}

export function IntroScene({ onTime, onReady }: { onTime: (s: number) => void; onReady: () => void }) {
  const t = useRef(0);
  return (
    <Canvas
      // phones: no shadows, no MSAA, 1x pixels, no bloom pass; the story still reads, at a steady frame rate
      shadows={!TOUCH}
      dpr={TOUCH ? 1 : [1, 1.5]}
      camera={{ fov: 42, position: [24, 42, 60], near: 0.1, far: 200 }}
      gl={{ antialias: !TOUCH, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = TOUCH ? 1.35 : 1.2;
      }}
    >
      <color attach="background" args={["#010102"]} />
      <fog attach="fog" args={["#010102", 24, 72]} />
      <Suspense fallback={null}>
        <Ready onReady={onReady} />
        <Director t={t} onTime={onTime} />
        <Stage t={t} />
        {ACTORS.map((a) => (
          <ActorView key={a.name} a={a} t={t} />
        ))}
        <Blasts t={t} />
        <ThrowArc t={t} />
        {ZONES.map((z, i) => (
          <ZoneWall key={i} t={t} z={z} />
        ))}
        {WARDENS.map((w, i) => (
          <Warden key={i} t={t} w={w} />
        ))}
      </Suspense>
      {!TOUCH && (
        <EffectComposer multisampling={0}>
          <Bloom intensity={1.25} luminanceThreshold={0.2} mipmapBlur />
          <Noise opacity={0.07} premultiply />
          <Vignette offset={0.15} darkness={0.85} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
