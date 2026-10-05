// The prologue: a scripted real-time cinematic in the actual Yard.
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";
import * as THREE from "three";
import { Arena } from "./Arena";
import { Avatar, SEAT_COLORS } from "./Avatar";
import { stillMotion, type Motion } from "./Soldier";
import { CAST } from "../game/colors";
import { audio } from "../game/audio";

import { INTRO_LENGTH } from "../game/colors";
export { INTRO_LENGTH };

// camera keyframes: [time, pos, lookAt] — the 48x48 Yard, plaza and water tower at (24, 24)
const KEYS: [number, [number, number, number], [number, number, number]][] = [
  [0, [24, 46, 62], [24, 0, 24]],
  [5, [24, 20, 40], [24, 0, 24]],
  [6.2, [27.2, 1.7, 27.8], [29.5, 1.05, 23.5]],
  [15.8, [43.6, 1.7, 27.8], [45.5, 1.05, 23.5]],
  [16.6, [32, 6, 34], [24, 8, 24]],
  [19.2, [28.5, 9.5, 30], [24, 9.8, 24]],
  [21.8, [15.5, 3.2, 28.5], [16, 1, 23.5]],
  [22.6, [11.6, 1.75, 24.5], [19.5, 1.1, 23.5]],
  [27.2, [11.3, 1.9, 25.1], [19.5, 0.5, 23.5]],
  [28.4, [35.5, 7.5, 32.5], [35.5, 0.6, 23.5]],
  [33, [35.5, 11, 36.5], [35.5, 0.2, 23.5]],
  [38, [24, 30, 50], [24, 0, 24]],
];

function interp(t: number) {
  let i = 0;
  while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++;
  const [t0, p0, l0] = KEYS[i];
  const [t1, p1, l1] = KEYS[i + 1];
  let k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  k = k * k * (3 - 2 * k); // smoothstep
  const lerp = (a: number[], b: number[]) => a.map((v, j) => v + (b[j] - v) * k) as [number, number, number];
  return { pos: lerp(p0, p1), look: lerp(l0, l1) };
}

/** The line-up: the eight on the east road, each lit in turn as the camera passes (cards in Intro.tsx). */
function CastMember({ i, t }: { i: number; t: React.MutableRefObject<number> }) {
  const spot = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const motion = useRef<Motion>(stillMotion());
  const { scene } = useThree();
  const x = 29.5 + i * 2;
  const z = 23.5;
  useEffect(() => {
    target.position.set(x, 0.6, z);
    scene.add(target);
    if (spot.current) spot.current.target = target;
    return () => {
      scene.remove(target);
    };
  }, [scene, target, x]);
  useFrame(() => {
    const now = t.current;
    const on = CAST[i].at;
    const lit = now >= on && now < 16.3;
    const flick = now < on + 0.3 ? (Math.random() > 0.4 ? 1 : 0.15) : 1;
    // the ending: all but the last one fall, one by one
    const falls = 28.8 + i * 0.5;
    motion.current.downed = i !== 7 && now > falls && now < 37;
    motion.current.firing = i === 7 && now > 30 && now < 31.6 && Math.floor(now * 8) % 2 === 0;
    if (spot.current) spot.current.intensity = lit ? 34 * flick : now > 28.4 && now < 33.4 ? (i === 7 ? 22 : 0) : 0;
  });
  return (
    <>
      <group position={[x, 0, z]} rotation-y={-Math.PI / 2}>
        <Avatar color={SEAT_COLORS[i]} weapon={CAST[i].weapon} motion={motion} />
      </group>
      <spotLight ref={spot} position={[x, 4.6, z + 3]} angle={0.42} penumbra={0.5} distance={10} decay={1.1} color="#fff1d0" intensity={0} />
    </>
  );
}

/** The duel on the west road: NYX's light finds WRAITH, NYX fires first. */
function Duel({ t }: { t: React.MutableRefObject<number> }) {
  const a = useRef<Motion>(stillMotion());
  const b = useRef<Motion>(stillMotion());
  const sa = useRef<THREE.SpotLight>(null);
  const sb = useRef<THREE.SpotLight>(null);
  const ta = useMemo(() => new THREE.Object3D(), []);
  const tb = useMemo(() => new THREE.Object3D(), []);
  const { scene } = useThree();
  useEffect(() => {
    ta.position.set(19.5, 0.4, 23.5);
    tb.position.set(12.5, 0.4, 23.5);
    scene.add(ta, tb);
    if (sa.current) sa.current.target = ta;
    if (sb.current) sb.current.target = tb;
    return () => {
      scene.remove(ta, tb);
    };
  }, [scene, ta, tb]);
  useFrame(() => {
    const now = t.current;
    const on = now > 21.6 && now < 28.4;
    a.current.speed = now > 21.6 && now < 22.6 ? 1 : 0;
    a.current.firing = SHOTS.some((st) => now >= st && now < st + 0.12);
    b.current.downed = now > 25.7 && now < 28.4;
    if (sa.current) sa.current.intensity = on ? 45 : 0;
    if (sb.current) sb.current.intensity = on && now < 25.7 ? 40 : 0;
  });
  return (
    <>
      <group position={[12.5, 0, 23.5]}>
        <Avatar color={SEAT_COLORS[1]} weapon={4} motion={a} />
      </group>
      <group position={[19.5, 0, 23.5]} rotation-y={Math.PI}>
        <Avatar color={SEAT_COLORS[2]} weapon={1} motion={b} />
      </group>
      <spotLight ref={sa} position={[12.9, 1.75, 23.5]} angle={0.62} penumbra={0.35} distance={12} decay={1.1} color="#fff1d0" intensity={0} castShadow />
      <spotLight ref={sb} position={[19.1, 1.75, 23.5]} angle={0.62} penumbra={0.35} distance={12} decay={1.1} color="#fff1d0" intensity={0} />
    </>
  );
}
const SHOTS = [23.4, 24.3, 25.5];

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
    const appear = Math.min(1, Math.max(0, (now - 16.3) / 1.6));
    const gone = now > 33 ? Math.max(0, 1 - (now - 33) / 1.2) : 1;
    const s = appear * gone;
    if (g.current) {
      g.current.visible = s > 0.01;
      g.current.scale.setScalar(0.2 + s * 0.8);
      g.current.rotation.y = now * 0.25;
      g.current.position.y = 9.8 + Math.sin(now * 0.8) * 0.3;
    }
    if (eye.current) (eye.current.material as THREE.MeshBasicMaterial).opacity = s;
    if (beam.current) {
      beam.current.rotation.z = Math.sin(now * 0.7) * 0.45;
      beam.current.rotation.x = Math.cos(now * 0.5) * 0.3;
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

function MuzzleFlashes({ t }: { t: React.MutableRefObject<number> }) {
  const l = useRef<THREE.PointLight>(null);
  const fired = useRef(new Set<number>());
  useFrame(() => {
    const now = t.current;
    let inten = 0;
    SHOTS.forEach((st, k) => {
      if (now >= st && now < st + 0.12) {
        inten = 30;
        l.current?.position.set(13.6, 1.0, 23.6);
        if (!fired.current.has(k)) {
          fired.current.add(k);
          audio.shoot(4);
        }
      }
    });
    if (now > 30 && now < 31.6 && Math.floor(now * 8) % 2 === 0) {
      inten = 22;
      l.current?.position.set(44.6, 1.0, 24.4);
      if (!fired.current.has(99 + Math.floor(now * 4))) {
        fired.current.add(99 + Math.floor(now * 4));
        audio.shoot(3);
      }
    }
    if (l.current) l.current.intensity = inten;
  });
  return <pointLight ref={l} color="#ffb347" distance={9} decay={1.3} intensity={0} />;
}

function Director({ t, onTime }: { t: React.MutableRefObject<number>; onTime: (s: number) => void }) {
  const { camera } = useThree();
  const lightning = useRef<THREE.DirectionalLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
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
    t.current = clock.elapsedTime - start.current;
    const now = t.current;
    const { pos, look } = interp(now);
    camera.position.set(...pos);
    camera.lookAt(...look);
    // lightning: two strikes at the start, one when the Warden wakes
    const strikes = [1.1, 1.35, 3.1, 16.4];
    let li = 0;
    for (const st of strikes) if (now >= st && now < st + 0.18) li = 5 * (1 - (now - st) / 0.18);
    if (lightning.current) lightning.current.intensity = li;
    // lights on at the end
    const on = now > 33.4 ? Math.min(1, (now - 33.4) / 0.8) : 0;
    if (amb.current) amb.current.intensity = 0.02 + on * 0.7;
    cue("boom0", 0.4, () => audio.boom());
    cue("thunder", 1.1, () => audio.creak(0));
    cue("howl", 5.6, () => audio.howl(-0.6, 0.8));
    CAST.forEach((c, k) => cue(`cast${k}`, c.at, () => audio.reload()));
    cue("whisper", 17, () => {
      audio.whisper(-0.7);
      setTimeout(() => audio.whisper(0.7), 700);
    });
    cue("heart", 21.5, () => audio.setHeartbeat(0.7));
    cue("heartoff", 28, () => audio.setHeartbeat(0.3));
    cue("lights", 33.4, () => {
      audio.setHeartbeat(0);
      audio.lightsOn();
      audio.boom();
    });
    cue("howl2", 35.5, () => audio.howl(0.5, 0.6));
    onTime(now);
  });
  return (
    <>
      <ambientLight ref={amb} intensity={0.02} color="#b8c6ff" />
      <hemisphereLight args={["#1a2550", "#000000", 0.05]} />
      <directionalLight ref={lightning} position={[6, 30, 4]} intensity={0} color="#cfd8ff" />
    </>
  );
}

export function IntroScene({ onTime }: { onTime: (s: number) => void }) {
  const t = useRef(0);
  (globalThis as any).__boLightsOut = false; // street lamps on for the prologue
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ fov: 42, position: [24, 46, 62], near: 0.1, far: 200 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.1;
      }}
    >
      <color attach="background" args={["#010102"]} />
      <fog attach="fog" args={["#010102", 20, 60]} />
      <Director t={t} onTime={onTime} />
      <Arena />
      {CAST.map((_, i) => (
        <CastMember key={i} i={i} t={t} />
      ))}
      <Duel t={t} />
      <Warden t={t} />
      <MuzzleFlashes t={t} />
      <EffectComposer multisampling={0}>
        <Bloom intensity={1.2} luminanceThreshold={0.2} mipmapBlur />
        <Noise opacity={0.08} premultiply />
        <Vignette offset={0.15} darkness={0.9} />
      </EffectComposer>
    </Canvas>
  );
}
