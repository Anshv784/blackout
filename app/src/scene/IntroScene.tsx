// The trailer: a ~34 s scripted cinematic in the real Yard. Everything is data:
// actors (paths, facing, shots, falls), camera shots (hard cuts), blasts and the zone.
// `globalThis.__introT = <seconds>` freezes it at a moment (used to review frames).
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";
import * as THREE from "three";
import { Arena } from "./Arena";
import { Avatar, SEAT_COLORS } from "./Avatar";
import { stillMotion, type Motion } from "./Soldier";
import { audio } from "../game/audio";
import { INTRO_LENGTH } from "../game/colors";
export { INTRO_LENGTH };

// ------------------------------------------------------------------ script

type V3 = [number, number, number];
type Key = { t: number; x: number; z: number; face: number }; // face: degrees, 0 = +x (east), 90 = +z (south)
interface Actor {
  name: string;
  seat: number; // colour
  weapon: number;
  show: [number, number][];
  keys: Key[];
  fire?: { t: number; at: string | V3; miss?: number }[];
  down?: number; // falls at
  throwAt?: number;
  light?: [number, number]; // flashlight on window
  nvg?: boolean;
}

export const ACTORS: Actor[] = [
  // DUSK wakes at the yard's edge, later runs from the zone and wins the final duel
  {
    name: "DUSK", seat: 7, weapon: 3, show: [[3.4, 7], [24.4, 34]], light: [4.6, 34],
    keys: [
      { t: 3.4, x: 12.5, z: 20.6, face: 10 }, { t: 6.9, x: 12.5, z: 20.6, face: -15 }, { t: 24.3, x: 12.5, z: 20.6, face: 0 },
      { t: 24.4, x: 9.5, z: 23.4, face: 0 }, { t: 27.8, x: 19.4, z: 23.4, face: 0 },
      { t: 28.0, x: 25.4, z: 26.6, face: 184 }, { t: 30.6, x: 25.4, z: 26.6, face: 184 }, { t: 34, x: 25.4, z: 26.6, face: 160 },
    ],
    fire: [{ t: 29.6, at: "NYX" }, { t: 30.0, at: "NYX" }, { t: 30.35, at: "NYX" }],
  },
  {
    name: "NYX", seat: 1, weapon: 4, show: [[7, 8], [11, 16.4], [28, 31.6]], light: [7, 31.6],
    keys: [
      { t: 7, x: 21.3, z: 26.4, face: 50 }, { t: 8, x: 21.3, z: 26.4, face: 45 }, { t: 10.9, x: 21.3, z: 26.4, face: 180 },
      { t: 11, x: 21.2, z: 23.4, face: 180 }, { t: 16.4, x: 21.2, z: 23.4, face: 180 },
      { t: 28.0, x: 19.4, z: 26.2, face: 5 }, { t: 31.6, x: 19.4, z: 26.2, face: 5 },
    ],
    fire: [{ t: 11.7, at: "WRAITH", miss: 0.7 }, { t: 12.5, at: "WRAITH", miss: 0.5 }, { t: 13.2, at: "WRAITH", miss: 0.6 }, { t: 29.9, at: "DUSK", miss: 0.4 }],
    down: 30.45,
  },
  {
    name: "WRAITH", seat: 2, weapon: 1, show: [[11, 16.6]], light: [11, 16.6],
    keys: [
      { t: 11, x: 5.5, z: 23.0, face: 0 }, { t: 13.4, x: 13.5, z: 23.2, face: 0 }, { t: 13.7, x: 13.6, z: 23.2, face: 0 }, { t: 16.6, x: 13.6, z: 23.2, face: 0 },
    ],
    fire: [{ t: 14.0, at: "NYX", miss: 0.3 }, { t: 14.35, at: "NYX", miss: 0.4 }, { t: 14.7, at: "NYX", miss: 0.2 }, { t: 15.05, at: "NYX", miss: 0.5 }],
  },
  {
    name: "UMBRA", seat: 3, weapon: 2, show: [[8, 9], [16.4, 20.6]], light: [8, 20.6],
    keys: [
      { t: 8, x: 36.5, z: 15.2, face: 60 }, { t: 9, x: 36.5, z: 15.2, face: 55 }, { t: 16.3, x: 36.5, z: 15.2, face: 180 },
      { t: 16.4, x: 36.4, z: 23.8, face: 180 }, { t: 20.6, x: 36.4, z: 23.8, face: 180 },
    ],
    fire: [{ t: 16.9, at: "GLOOM", miss: 0.8 }, { t: 17.6, at: "GLOOM", miss: 0.7 }],
    down: 18.35,
  },
  {
    name: "GLOOM", seat: 5, weapon: 3, show: [[9, 10], [16.4, 20.6]], light: [9, 20.6],
    keys: [
      { t: 9, x: 30.6, z: 28.6, face: 135 }, { t: 10, x: 30.6, z: 28.6, face: 130 }, { t: 16.3, x: 30.6, z: 28.6, face: 5 },
      { t: 16.4, x: 30.0, z: 23.1, face: 5 }, { t: 20.6, x: 30.0, z: 23.1, face: 5 },
    ],
    throwAt: 17.45,
  },
  {
    name: "VESPER", seat: 4, weapon: 1, show: [[10, 11], [24.4, 28]], light: [10, 28], nvg: true,
    keys: [
      { t: 10, x: 10.6, z: 35.8, face: -40 }, { t: 11, x: 10.6, z: 35.8, face: -35 }, { t: 24.3, x: 10.6, z: 35.8, face: -90 },
      { t: 24.4, x: 22.6, z: 33.5, face: -90 }, { t: 28, x: 23.0, z: 27.6, face: -90 },
    ],
  },
];

type Cam = { from: number; to: number; p0: V3; p1: V3; l0: V3; l1: V3; follow?: string; fill?: number };
export const CAMS: Cam[] = [
  { from: 0, to: 3.4, p0: [24, 42, 60], p1: [24, 30, 47], l0: [24, 0, 24], l1: [24, 0, 22] },
  // DUSK wakes: low behind his right shoulder, light clicks on
  { from: 3.4, to: 7, p0: [14.6, 1.35, 22.2], p1: [14.2, 1.4, 21.9], l0: [12.5, 1.25, 20.6], l1: [12.5, 1.3, 20.6], fill: 3 },
  // the squad, one second each, faces lit
  { from: 7, to: 8, p0: [22.5, 1.5, 28.1], p1: [22.3, 1.45, 27.8], l0: [21.3, 1.15, 26.4], l1: [21.3, 1.2, 26.4], fill: 5 },
  { from: 8, to: 9, p0: [37.3, 1.5, 16.9], p1: [37.1, 1.45, 16.6], l0: [36.5, 1.15, 15.2], l1: [36.5, 1.2, 15.2], fill: 5 },
  { from: 9, to: 10, p0: [29.5, 1.5, 30.1], p1: [29.7, 1.45, 29.8], l0: [30.6, 1.15, 28.6], l1: [30.6, 1.2, 28.6], fill: 5 },
  { from: 10, to: 11, p0: [12.0, 1.5, 34.4], p1: [11.8, 1.45, 34.7], l0: [10.6, 1.15, 35.8], l1: [10.6, 1.2, 35.8], fill: 5 },
  // the firefight: track WRAITH's sprint side-on, then over NYX's shoulder as he fires back
  { from: 11, to: 13.6, p0: [-0.2, 1.25, 25.2], p1: [0, 1.25, 25.1], l0: [1.4, 1.05, 23.1], l1: [1.4, 1.05, 23.1], follow: "WRAITH", fill: 9 },
  { from: 13.6, to: 16.4, p0: [22.5, 1.6, 24.2], p1: [22.3, 1.58, 24.1], l0: [13.6, 1.1, 23.2], l1: [13.6, 1.05, 23.2], fill: 2 },
  // the frag: behind GLOOM, then wide as it lands
  { from: 16.4, to: 17.9, p0: [28.4, 1.55, 22.3], p1: [28.7, 1.6, 22.4], l0: [36.4, 1.0, 23.8], l1: [36.4, 1.0, 23.8] },
  { from: 17.9, to: 20.6, p0: [33.2, 3.2, 28.4], p1: [33.6, 3.6, 29.2], l0: [35.8, 0.6, 23.7], l1: [35.8, 0.5, 23.7] },
  // the Warden
  { from: 20.6, to: 24.4, p0: [30, 4.5, 32], p1: [27.6, 9, 28.8], l0: [24, 9, 24], l1: [24, 10, 24] },
  // the zone closes: high and wide, everyone running inward
  { from: 24.4, to: 28, p0: [8, 16, 40], p1: [12, 13, 37], l0: [18, 1, 26], l1: [20, 1, 25] },
  // the final duel under the plaza lamp: two-shot, then close on the winner
  { from: 28, to: 30.6, p0: [27.1, 1.7, 27.5], p1: [26.9, 1.68, 27.4], l0: [19.4, 1.0, 26.0], l1: [19.4, 0.9, 26.0], fill: 2 },
  { from: 30.6, to: 34, p0: [24.2, 1.5, 28.6], p1: [24.6, 2.4, 29.8], l0: [25.4, 1.3, 26.6], l1: [25.4, 1.25, 26.6], fill: 4 },
];

const BLASTS: { t: number; x: number; z: number }[] = [{ t: 18.3, x: 36.2, z: 23.7 }];
const NADE = { from: 17.45, to: 18.3, a: [30.6, 1.5, 23.2] as V3, b: [36.2, 0.2, 23.7] as V3 };
const ZONE = { from: 24.2, to: 28.4, r0: 30, r1: 12, x: 24, z: 24 };

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
  useEffect(() => {
    scene.add(tgt);
    if (spot.current) spot.current.target = tgt;
    return () => {
      scene.remove(tgt);
    };
  }, [scene, tgt]);
  useFrame(() => {
    const now = t.current;
    const p = poseAt(a, now);
    const on = a.show.some(([s0, s1]) => now >= s0 && now < s1);
    const fa = deg(p.face);
    if (g.current) {
      g.current.visible = on;
      g.current.position.set(p.x, 0, p.z);
      g.current.rotation.y = -fa;
    }
    const m = motion.current;
    m.speed = p.v > 4.6 ? 2 : p.v > 0.6 ? 1 : 0;
    m.downed = a.down !== undefined && now >= a.down;
    m.throwAt = a.throwAt !== undefined && now >= a.throwAt && now < a.throwAt + 0.45 ? performance.now() - (now - a.throwAt) * 1000 : 0;
    const shot = a.fire?.findIndex((f) => now >= f.t && now < f.t + 0.09) ?? -1;
    m.firing = shot >= 0;
    // flashlight
    const lit = a.light && now >= a.light[0] && now < a.light[1] && !m.downed;
    const flick = a.light && now < a.light[0] + 0.25 ? (Math.random() > 0.45 ? 1 : 0.1) : 1;
    if (spot.current) {
      spot.current.position.set(p.x + Math.cos(fa) * 0.2, 1.7, p.z + Math.sin(fa) * 0.2);
      spot.current.intensity = lit ? 48 * flick : 0;
      spot.current.color.set(a.nvg ? "#9dffb8" : "#fff1d0");
    }
    tgt.position.set(p.x + Math.cos(fa) * 6, 0.3, p.z + Math.sin(fa) * 6);
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
        tracer.current.position.set((mx + tx) / 2, 1.0, (mz + tz) / 2);
        tracer.current.rotation.set(0, -Math.atan2(tz - mz, tx - mx), 0);
        tracer.current.scale.set(len, 1, 1);
        flash.current.position.set(mx, 1.05, mz);
        if (!fired.current.has(shot)) {
          fired.current.add(shot);
          audio.shoot(a.weapon);
        }
      }
    }
  });
  return (
    <>
      <group ref={g} visible={false}>
        <Avatar color={SEAT_COLORS[a.seat]} weapon={a.weapon} motion={motion} />
      </group>
      <spotLight ref={spot} angle={0.55} penumbra={0.35} distance={13} decay={1.05} intensity={0} castShadow={a.name === "DUSK"} />
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
    const appear = Math.min(1, Math.max(0, (now - 20.8) / 1.0));
    const gone = now > 24.2 ? Math.max(0, 1 - (now - 24.2) / 0.5) : 1;
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
      pos = [p.x + pos[0], pos[1], pos[2]];
      look = [p.x + look[0], look[1], look[2]];
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
    (globalThis as any).__boLightsOut = now > 2.4 && now < 28;
    const strikes = [0.6, 0.85, 20.9];
    let li = 0;
    for (const st of strikes) if (now >= st && now < st + 0.16) li = 5 * (1 - (now - st) / 0.16);
    if (lightning.current) lightning.current.intensity = li;
    const on = now > 31 ? Math.min(1, (now - 31) / 0.5) : 0;
    if (amb.current) amb.current.intensity = 0.04 + on * 0.55;
    cue("boom0", 0.3, () => audio.boom());
    cue("dark", 2.4, () => audio.powerDown(true));
    cue("click", 4.6, () => audio.reload());
    cue("heart", 11, () => audio.setHeartbeat(0.8));
    cue("warden", 20.9, () => {
      audio.setHeartbeat(0);
      audio.boom();
      audio.whisper(-0.6);
    });
    cue("zone", 24.4, () => audio.setZoneDanger(1));
    cue("zoneoff", 28, () => audio.setZoneDanger(0));
    cue("lights", 31, () => {
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

export function IntroScene({ onTime }: { onTime: (s: number) => void }) {
  const t = useRef(0);
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ fov: 42, position: [24, 42, 60], near: 0.1, far: 200 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.2;
      }}
    >
      <color attach="background" args={["#010102"]} />
      <fog attach="fog" args={["#010102", 24, 72]} />
      <Director t={t} onTime={onTime} />
      <Arena />
      {ACTORS.map((a) => (
        <ActorView key={a.name} a={a} t={t} />
      ))}
      <Blasts t={t} />
      <ZoneWall t={t} />
      <Warden t={t} />
      <EffectComposer multisampling={0}>
        <Bloom intensity={1.25} luminanceThreshold={0.2} mipmapBlur />
        <Noise opacity={0.07} premultiply />
        <Vignette offset={0.15} darkness={0.85} />
      </EffectComposer>
    </Canvas>
  );
}
