// The trailer: a ~34 s scripted cinematic in the real Yard. Everything is data:
// actors (paths, facing, shots, falls), camera shots (hard cuts), blasts and the zone.
// `globalThis.__introT = <seconds>` freezes it at a moment (used to review frames).
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";
import * as THREE from "three";
import { Arena } from "./Arena";
import { Avatar, SEAT_COLORS } from "./Avatar";
import { stillMotion, SOLDIER_URL, type Motion } from "./Soldier";
import { audio } from "../game/audio";
import { INTRO_LENGTH } from "../game/colors";
export { INTRO_LENGTH };

// ------------------------------------------------------------------ script
//
// THE LAST LIGHT. 03:12, the grid fails and eight strangers wake in the Yard. DUSK learns the
// one rule (a light shows you the way and shows everyone where you are) by hiding from NYX's
// torch, watches WRAITH forget it, outruns the zone, and wins the last duel by staying dark.

type V3 = [number, number, number];
type Win = [number, number];
type Key = { t: number; x: number; z: number; face: number }; // face: degrees, 0 = +x (east), 90 = +z (south)
interface Actor {
  name: string;
  seat: number; // colour
  weapon: number;
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

export const ACTORS: Actor[] = [
  {
    name: "DUSK", seat: 7, weapon: 3, show: [[6, 22], [34, 53]],
    lights: [[9.8, 13], [47.0, 53]],
    crouch: [[6, 9.2], [13, 22], [40, 45.2]],
    keys: [
      // wakes in the container yard
      { t: 6, x: 6.5, z: 10.6, face: -20 }, { t: 12.9, x: 6.5, z: 10.6, face: -10 },
      // hides south of the containers while NYX passes on the other side
      { t: 13, x: 11.4, z: 13.45, face: -60 }, { t: 22, x: 11.4, z: 13.45, face: -80 },
      // the zone: sprints east, throws at GLOOM
      { t: 34, x: 5.5, z: 26.5, face: 0 }, { t: 37.1, x: 17.4, z: 26.5, face: 0 }, { t: 39.9, x: 17.4, z: 26.5, face: 12 },
      // the duel: crouched in the dark behind the crates
      { t: 40, x: 29.6, z: 30.5, face: -20 }, { t: 45.1, x: 29.6, z: 30.5, face: -30 }, { t: 45.4, x: 29.6, z: 30.5, face: -47 }, { t: 53, x: 29.6, z: 30.5, face: -47 },
    ],
    throwAt: 37.25,
    fire: [{ t: 45.6, at: "NYX" }, { t: 45.85, at: "NYX" }],
  },
  {
    name: "NYX", seat: 1, weapon: 4, show: [[13, 22], [22, 29], [40, 53]],
    lights: [[13, 22], [40, 46]],
    keys: [
      // the hunter: walks the far side of the containers, torch searching
      { t: 13, x: 21.0, z: 10.5, face: 180 }, { t: 20.5, x: 14.0, z: 10.5, face: 180 }, { t: 21.9, x: 13.6, z: 10.5, face: 180 },
      // dark on the road, waiting
      { t: 22, x: 21.5, z: 17.0, face: 145 }, { t: 29, x: 21.5, z: 17.0, face: 145 },
      // the plaza: comes looking, passes the crates
      { t: 40, x: 37.5, z: 28.5, face: 180 }, { t: 45.1, x: 31.6, z: 28.4, face: 185 }, { t: 53, x: 31.6, z: 28.4, face: 185 },
    ],
    sweep: [{ from: 13, to: 21.9, amp: 32, period: 2.6 }, { from: 40.3, to: 45.2, amp: 38, period: 2.2 }],
    fire: [{ t: 26.4, at: "WRAITH", miss: 0.1 }],
    dead: 45.9,
  },
  {
    name: "WRAITH", seat: 2, weapon: 1, show: [[22, 29]], lights: [[22, 26.6]],
    keys: [{ t: 22, x: 10.5, z: 20.5, face: 0 }, { t: 25.0, x: 16.5, z: 20.5, face: 25 }, { t: 29, x: 16.5, z: 20.5, face: 35 }],
    fire: [{ t: 25.2, at: [21, 0, 23.5], miss: 1.2 }, { t: 25.45, at: [21, 0, 23.5], miss: 1.2 }, { t: 25.7, at: [21, 0, 23.5], miss: 1.2 }, { t: 25.95, at: [21, 0, 23.5], miss: 1.2 }],
    dead: 26.45,
  },
  {
    name: "GLOOM", seat: 5, weapon: 2, show: [[34, 40]], lights: [[34, 38.2]],
    keys: [{ t: 34, x: 23.5, z: 28.2, face: 200 }, { t: 37, x: 21.6, z: 27.6, face: 185 }, { t: 40, x: 21.6, z: 27.6, face: 185 }],
    dead: 38.15,
  },
];

type Cam = { from: number; to: number; p0: V3; p1: V3; l0: V3; l1: V3; follow?: string; fill?: number };
export const CAMS: Cam[] = [
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
  // the Warden over the water tower
  { from: 29, to: 34, p0: [31, 4, 33], p1: [28, 8.5, 30], l0: [24, 8.5, 24], l1: [24, 10, 24] },
  // the zone: running alongside DUSK
  { from: 34, to: 37.1, p0: [3.0, 1.25, -2.0], p1: [2.8, 1.3, -1.8], l0: [0, 1.0, 0], l1: [0, 1.0, 0], follow: "DUSK", fill: 1.4 },
  // the frag: behind him as it lands on GLOOM
  { from: 37.1, to: 40, p0: [15.6, 1.75, 25.3], p1: [15.2, 2.2, 24.9], l0: [21.6, 0.8, 27.6], l1: [21.6, 0.6, 27.6] },
  // the duel: low behind DUSK in the dark, NYX's light coming
  { from: 40, to: 45.2, p0: [27.6, 0.85, 32.0], p1: [27.8, 0.9, 31.9], l0: [34.0, 1.0, 28.4], l1: [32.4, 1.0, 28.4] },
  // he rises and fires
  { from: 45.2, to: 47, p0: [33.0, 1.3, 31.6], p1: [33.2, 1.35, 31.8], l0: [30.4, 1.0, 29.4], l1: [30.4, 1.0, 29.4], fill: 1.0 },
  // close on the one who walks out, pulling away
  { from: 47, to: 53, p0: [30.9, 1.45, 29.6], p1: [33.0, 3.0, 31.8], l0: [29.6, 1.25, 30.5], l1: [29.6, 1.0, 30.5], fill: 1.6 },
];

const BLASTS: { t: number; x: number; z: number }[] = [{ t: 38.15, x: 21.5, z: 27.5 }];
const NADE = { from: 37.35, to: 38.15, a: [17.8, 1.5, 26.5] as V3, b: [21.5, 0.2, 27.5] as V3 };
const ZONE = { from: 33.8, to: 40, r0: 30, r1: 14, x: 24, z: 24 };
const WARDEN = { from: 29.4, to: 34 };
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
  const beam = useRef<THREE.Mesh>(null);
  const flash = useRef<THREE.PointLight>(null);
  const fired = useRef(new Set<number>());
  const beamMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uA: { value: 0 } },
        // cone along y: the tip (the torch) at +y, fading out toward the wide end
        // soft: faces seen edge-on (the cone's outline) fade out, so it reads as a haze, not a wedge
        vertexShader: `varying float vY; varying float vFace; void main(){ vY = position.y; vec4 mv = modelViewMatrix*vec4(position,1.0); vFace = abs(dot(normalize(normalMatrix*normal), normalize(-mv.xyz))); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `uniform float uA; varying float vY; varying float vFace; void main(){ float k = clamp(0.5 + vY/6.0, 0.0, 1.0); gl_FragColor = vec4(1.0,0.93,0.78, uA * k * k * vFace * vFace * 0.07); }`,
      }),
    [],
  );
  const { scene } = useThree();
  useEffect(() => {
    scene.add(tgt);
    if (spot.current) spot.current.target = tgt;
    return () => {
      scene.remove(tgt);
    };
  }, [scene, tgt]);
  useFrame(() => {
    const now = t.current;
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
    const lw = a.lights?.find(([s0]) => now >= s0 && now < s0 + 0.3);
    const flick = lw ? (Math.random() > 0.45 ? 1 : 0.1) : 1; // a torch clicking on stutters
    // killed with the torch on: it drops beside the body and lights it along the ground
    const dropped = dead && inWin(a.lights, a.dead! - 0.01) && now > a.dead! + 0.5;
    if (spot.current && dropped) {
      spot.current.position.set(p.x + Math.cos(fa) * 0.55, 0.12, p.z + Math.sin(fa) * 0.55);
      tgt.position.set(p.x - Math.cos(fa) * 2.5, 0, p.z - Math.sin(fa) * 2.5);
      spot.current.intensity = 26; // steady: a flickering light on a body reads as the body shaking
      spot.current.color.set("#fff1d0");
    } else if (spot.current) {
      spot.current.position.set(p.x + Math.cos(fa) * 0.2, m.crouch ? 1.1 : 1.6, p.z + Math.sin(fa) * 0.2);
      spot.current.intensity = lit ? 48 * flick : 0;
      spot.current.color.set(a.nvg ? "#9dffb8" : "#fff1d0");
    }
    // the torch you can see: a faint cone of light in the rain
    if (beam.current) {
      const show = !!lit && on && !dropped;
      beam.current.visible = show;
      if (show) {
        // the torch rides under the barrel: forward of the right shoulder, gun height
        const y = m.crouch ? 0.72 : 0.98;
        const rx = -Math.sin(fa) * 0.13;
        const rz = Math.cos(fa) * 0.13;
        beam.current.position.set(p.x + rx + Math.cos(fa) * 3.75, y - 0.2, p.z + rz + Math.sin(fa) * 3.75);
        beam.current.rotation.set(0, -fa, Math.PI / 2 + 0.06);
        (beam.current.material as THREE.ShaderMaterial).uniforms.uA.value = 0.55 * flick;
      }
    }
    if (!dropped) tgt.position.set(p.x + Math.cos(fa) * 6, 0.3, p.z + Math.sin(fa) * 6);
    // gunfire: tracer to the target (or near it), muzzle flash, sound once
    if (tracer.current && flash.current) {
      tracer.current.visible = shot >= 0 && on;
      flash.current.intensity = shot >= 0 && on ? 26 : 0;
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
        tracer.current.scale.set(len, 1, 1);
        flash.current.position.set(mx, 1.05, mz);
        if (!fired.current.has(shot)) {
          fired.current.add(shot);
          audio.shotAt(a.weapon, a.name === "DUSK" ? 1 : 6, 0);
        }
      }
    }
  });
  return (
    <>
      <group ref={g} visible={false}>
        <Avatar color={SEAT_COLORS[a.seat]} weapon={a.weapon} motion={motion} ring={false} />
      </group>
      <mesh ref={beam} visible={false} material={beamMat}>
        <coneGeometry args={[2.0, 6.0, 32, 1, true]} />
      </mesh>
      <spotLight ref={spot} angle={0.55} penumbra={0.35} distance={13} decay={1.05} intensity={0} castShadow={a.name === "DUSK" || a.name === "NYX"} shadow-bias={-0.0006} shadow-normalBias={0.04} />
      <pointLight ref={flash} color="#ffb347" distance={9} decay={1.3} intensity={0} />
      <mesh ref={tracer} visible={false}>
        <boxGeometry args={[1, 0.035, 0.035]} />
        <meshBasicMaterial color="#ffe6a8" toneMapped={false} />
      </mesh>
    </>
  );
}

/** The frag in flight, the blast, the smoke. */
function Blasts({ t }: { t: React.MutableRefObject<number> }) {
  const nade = useRef<THREE.Mesh>(null);
  const blast = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const smoke = useRef<(THREE.Mesh | null)[]>([]);
  const boomed = useRef(false);
  useFrame(() => {
    const now = t.current;
    const k = (now - NADE.from) / (NADE.to - NADE.from);
    if (nade.current) {
      nade.current.visible = k > 0 && k < 1;
      const [ax, ay, az] = NADE.a;
      const [bx, by, bz] = NADE.b;
      nade.current.position.set(ax + (bx - ax) * k, ay + (by - ay) * k + Math.sin(k * Math.PI) * 1.4, az + (bz - az) * k);
    }
    const B = BLASTS[0];
    const b = (now - B.t) / 0.45;
    if (blast.current) {
      blast.current.visible = b > 0 && b < 1;
      blast.current.position.set(B.x, 0.6, B.z);
      blast.current.scale.setScalar(0.3 + b * 2.0);
      (blast.current.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - b) * (1 - b);
    }
    if (light.current) {
      light.current.position.set(B.x, 1.3, B.z);
      light.current.intensity = b > 0 && b < 1 ? 45 * (1 - b) : 0;
    }
    smoke.current.forEach((m, i) => {
      if (!m) return;
      const s = (now - B.t - i * 0.07) / 2.4;
      m.visible = s > 0 && s < 1.4;
      m.position.set(B.x + Math.cos(i * 1.7) * s * 1.5, 0.6 + s * 1.9 + (i % 3) * 0.2, B.z + Math.sin(i * 1.7) * s * 1.5);
      m.scale.setScalar(0.5 + s * 1.7);
    });
    if (now >= B.t && !boomed.current) {
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

/** The zone wall sweeping in. */
function ZoneWall({ t }: { t: React.MutableRefObject<number> }) {
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

function Warden({ t }: { t: React.MutableRefObject<number> }) {
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
      g.current.visible = s > 0.01;
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
    <group ref={g} position={[24, 9.8, 24]} visible={false}>
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
  const cue = (key: string, at: number, f: () => void) => {
    if (t.current >= at && !cues.current.has(key)) {
      cues.current.add(key);
      f();
    }
  };
  useFrame(({ clock }) => {
    if (start.current === null) start.current = clock.elapsedTime;
    const frozen = (globalThis as any).__introT;
    t.current = typeof frozen === "number" ? frozen : clock.elapsedTime - start.current;
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
    const B = BLASTS[0];
    const shake = now > B.t && now < B.t + 0.55 ? (1 - (now - B.t) / 0.55) * 0.14 : 0;
    camera.position.set(pos[0] + (Math.random() - 0.5) * shake, pos[1] + (Math.random() - 0.5) * shake, pos[2]);
    camera.lookAt(...look);
    if (fill.current) {
      fill.current.position.set(pos[0], pos[1] + 0.6, pos[2]);
      fill.current.intensity = s.fill ?? 0;
    }
    // the city's lights die early; lightning when the Warden wakes; light floods in for the title
    // the city's lights die at 03:12 and only come back for the title
    (globalThis as any).__boLightsOut = now > 3.1 && now < TITLE_AT;
    const strikes = [2.9, 3.05, 29.6];
    let li = 0;
    for (const st of strikes) if (now >= st && now < st + 0.16) li = 5 * (1 - (now - st) / 0.16);
    if (lightning.current) lightning.current.intensity = li;
    const on = now > TITLE_AT ? Math.min(1, (now - TITLE_AT) / 0.6) : 0;
    if (amb.current) amb.current.intensity = 0.04 + on * 0.55;
    // NYX's boots on the far side of the container, passing left to right of DUSK's ear
    for (const [w0, w1, cx] of [[13.4, 20.6, 15], [40.4, 45.1, 31]]) {
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
    cue("wolves2", 40.6, () => audio.howl(0.7, 0.55));
    cue("click", 9.8, () => audio.reload());
    cue("heart", 13.2, () => audio.setHeartbeat(0.9));
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
    cue("zone", 33.9, () => audio.setZoneDanger(1));
    cue("toss", 37.25, () => audio.toss(1));
    cue("clink", 37.95, () => audio.clink(0.8, 0.3));
    cue("fall2", 38.6, () => audio.bodyFall(0.3, 0.7));
    cue("zoneoff", 40, () => audio.setZoneDanger(0));
    cue("heart2", 40.4, () => audio.setHeartbeat(1));
    cue("heart2off", 45.6, () => audio.setHeartbeat(0));
    cue("fall3", 46.35, () => audio.bodyFall(-0.2, 1));
    cue("click2", 47.0, () => audio.reload());
    cue("walksout", 47.4, () => audio.horror("high", 0.75));
    cue("hunt", 13.6, () => audio.horror("bass", 0.5, { wet: 0.7 }));
    cue("lights", TITLE_AT, () => {
      audio.lightsOn();
      audio.boom();
    });
    onTime(now);
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
        <Arena />
        {ACTORS.map((a) => (
          <ActorView key={a.name} a={a} t={t} />
        ))}
        <Blasts t={t} />
        <ZoneWall t={t} />
        <Warden t={t} />
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
