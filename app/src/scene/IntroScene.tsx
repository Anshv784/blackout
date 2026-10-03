// The prologue: a scripted real-time cinematic in the actual Yard.
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";
import * as THREE from "three";
import { Arena } from "./Arena";
import { Avatar, SEAT_COLORS } from "./Avatar";
import { SPAWNS } from "../game/gen";
import { audio } from "../game/audio";

export const INTRO_LENGTH = 38;

// camera keyframes: [time, pos, lookAt]
const KEYS: [number, [number, number, number], [number, number, number]][] = [
  [0, [16, 34, 46], [16, 0, 16]],
  [5, [16, 20, 32], [16, 0, 15]],
  [6, [3.5, 2.4, 27], [6, 0.8, 18]],
  [10, [9.6, 1.9, 15.8], [11.5, 1.0, 14.5]],
  [11, [10.2, 1.6, 15.4], [12.5, 0.9, 14.5]],
  [13.5, [9.4, 4.0, 15.6], [16.5, 0.6, 14.5]],
  [16, [16, 14, 30], [16, 2, 14]],
  [19, [16, 9, 27], [16, 7, 16]],
  [22, [22, 5, 22], [16, 1, 16]],
  [27, [20, 7, 24], [15, 0.5, 15]],
  [30, [16, 22, 34], [16, 0, 16]],
  [33, [16, 26, 38], [16, 0, 16]],
  [38, [16, 30, 42], [16, 0, 16]],
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

// you, at the west end of a long corridor — and a stranger at the far end, facing you
const SURVIVORS = [5, 6, 0, 3, 8, 11, 12, 14].map((i) => SPAWNS[i % SPAWNS.length]);
const BEAM_ON = [11, 12.4, 12.9, 13.3, 13.6, 14.0, 14.3, 14.6];
const BEAM_OFF = [33.2, 28.6, 29.2, 29.7, 30.3, 30.8, 31.4, 32.0];

function Survivor({ i, t }: { i: number; t: React.MutableRefObject<number> }) {
  const g = useRef<THREE.Group>(null);
  const spot = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const { scene } = useThree();
  const [tx, ty] = SURVIVORS[i];
  const face = useMemo(() => (i === 0 ? 0 : i === 1 ? Math.PI : Math.atan2(16 - ty, 16 - tx) + (i % 2 ? 0.6 : -0.4)), [i, tx, ty]);
  useEffect(() => {
    scene.add(target);
    if (spot.current) spot.current.target = target;
    return () => {
      scene.remove(target);
    };
  }, [scene, target]);
  useFrame(() => {
    const now = t.current;
    // the two in the corridor hold their beams on each other; the rest sweep the dark
    const sweep = face + (i < 2 ? Math.sin(now * 0.4 + i) * 0.06 : Math.sin(now * 0.6 + i) * 0.5);
    if (g.current) {
      g.current.position.set(tx + 0.5, 0, ty + 0.5);
      g.current.rotation.y = -sweep;
    }
    target.position.set(tx + 0.5 + Math.cos(sweep) * 6, 0.2, ty + 0.5 + Math.sin(sweep) * 6);
    const on = now >= BEAM_ON[i] && now < BEAM_OFF[i];
    // flicker as it turns on and off
    const flick = now < BEAM_ON[i] + 0.35 ? (Math.random() > 0.4 ? 1 : 0.1) : now > BEAM_OFF[i] - 0.3 && now < BEAM_OFF[i] ? (Math.random() > 0.5 ? 1 : 0.1) : 1;
    if (spot.current) spot.current.intensity = on ? (i === 0 ? 60 : 38) * flick : 0;
  });
  return (
    <>
      <group ref={g}>
        <Avatar color={SEAT_COLORS[i]} me={i === 0} />
      </group>
      <spotLight
        ref={spot}
        position={[tx + 0.5, 1.75, ty + 0.5]}
        angle={0.67}
        penumbra={0.35}
        distance={11}
        decay={1.1}
        color="#fff1d0"
        intensity={0}
        castShadow={i === 0}
        shadow-mapSize={[1024, 1024]}
      />
    </>
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
    const appear = Math.min(1, Math.max(0, (now - 16.3) / 1.6));
    const gone = now > 33 ? Math.max(0, 1 - (now - 33) / 1.2) : 1;
    const s = appear * gone;
    if (g.current) {
      g.current.visible = s > 0.01;
      g.current.scale.setScalar(0.2 + s * 0.8);
      g.current.rotation.y = now * 0.25;
      g.current.position.y = 9 + Math.sin(now * 0.8) * 0.3;
    }
    if (eye.current) (eye.current.material as THREE.MeshBasicMaterial).opacity = s;
    if (beam.current) {
      beam.current.rotation.z = Math.sin(now * 0.7) * 0.45;
      beam.current.rotation.x = Math.cos(now * 0.5) * 0.3;
    }
    beamMat.uniforms.uA.value = s;
  });
  return (
    <group ref={g} position={[16, 9, 16]} visible={false}>
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
  const shots = [22.6, 23.0, 23.15, 24.4, 24.55, 25.6];
  const where: [number, number][] = [
    [18.5, 15.5],
    [18.5, 15.5],
    [18.5, 15.5],
    [14.5, 17.5],
    [14.5, 17.5],
    [17, 19.5],
  ];
  const fired = useRef(new Set<number>());
  useFrame(() => {
    const now = t.current;
    let inten = 0;
    shots.forEach((st, k) => {
      if (now >= st && now < st + 0.12) {
        inten = 26;
        l.current?.position.set(where[k][0], 0.9, where[k][1]);
        if (!fired.current.has(k)) {
          fired.current.add(k);
          audio.shoot(k % 3 === 2 ? 2 : 0);
        }
      }
    });
    if (l.current) l.current.intensity = inten;
  });
  return <pointLight ref={l} color="#ffb347" distance={9} decay={1.3} intensity={0} castShadow />;
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
    cue("click", 11, () => audio.reload());
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
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ fov: 42, position: [16, 34, 46], near: 0.1, far: 160 }}
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
      {SURVIVORS.map((_, i) => (
        <Survivor key={i} i={i} t={t} />
      ))}
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
