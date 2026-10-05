// Living background for the gate and lobby: the Yard at night, survivors sweeping
// their flashlights, the Warden hovering, the odd lightning strike.
import { memo, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";
import * as THREE from "three";
import { MAP_W } from "../game/gen";
const C = MAP_W / 2;
import { Arena } from "./Arena";
import { Avatar, SEAT_COLORS } from "./Avatar";

// wandering survivors walk loops through open lanes
const PATHS: [number, number][][] = [
  [[10.5, 2.5], [17.5, 2.5], [17.5, 10.5], [10.5, 10.5]],
  [[11.5, 10.5], [15.5, 10.5], [15.5, 21.5], [11.5, 21.5]],
  [[21.5, 19.5], [25.5, 19.5], [25.5, 30.5], [21.5, 30.5]],
  [[21.5, 1.5], [30.5, 1.5], [30.5, 6.5], [21.5, 6.5]],
  [[2.5, 8.5], [7.5, 8.5], [7.5, 17.5], [2.5, 17.5]],
];

function along(path: [number, number][], u: number) {
  const segs = path.length;
  const f = ((u % segs) + segs) % segs;
  const i = Math.floor(f);
  const k = f - i;
  const a = path[i];
  const b = path[(i + 1) % segs];
  return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, dir: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

function Walker({ idx }: { idx: number }) {
  const g = useRef<THREE.Group>(null);
  const spot = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const { scene } = useThree();
  useMemo(() => scene.add(target), [scene, target]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const p = along(PATHS[idx], t * 0.09 + idx * 0.7);
    const look = p.dir + Math.sin(t * 0.8 + idx) * 0.6;
    g.current?.position.set(p.x, 0, p.z);
    if (g.current) g.current.rotation.y = -look;
    spot.current?.position.set(p.x, 1.75, p.z);
    target.position.set(p.x + Math.cos(look) * 6, 0.2, p.z + Math.sin(look) * 6);
    if (spot.current) {
      spot.current.target = target;
      // the occasional dying-battery flicker
      spot.current.intensity = Math.sin(t * 13 + idx * 7) > 0.97 ? 6 : 40;
    }
  });
  return (
    <>
      <group ref={g}>
        <Avatar color={SEAT_COLORS[(idx * 3) % 8]} />
      </group>
      <spotLight ref={spot} angle={0.67} penumbra={0.4} distance={11} decay={1.1} color="#fff1d0" intensity={40} castShadow={idx === 1} shadow-mapSize={[1024, 1024]} />
    </>
  );
}

function Warden() {
  const g = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Group>(null);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: `varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying float vY; void main(){ float k = clamp(0.5 + vY/9.0, 0.0, 1.0); gl_FragColor = vec4(0.65,0.3,1.0, k * 0.22); }`,
      }),
    [],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (g.current) {
      g.current.rotation.y = t * 0.2;
      g.current.position.y = 10 + Math.sin(t * 0.7) * 0.35;
    }
    if (beam.current) {
      beam.current.rotation.z = Math.sin(t * 0.33) * 0.55;
      beam.current.rotation.x = Math.cos(t * 0.27) * 0.4;
    }
  });
  return (
    <group ref={g} position={[C, 10, C]}>
      <mesh>
        <icosahedronGeometry args={[1.5, 1]} />
        <meshBasicMaterial color="#a64dff" wireframe transparent opacity={0.55} toneMapped={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.5, 24, 16]} />
        <meshBasicMaterial color="#e6c8ff" toneMapped={false} />
      </mesh>
      <pointLight color="#a64dff" intensity={5} distance={22} decay={1.2} />
      <group ref={beam}>
        <mesh material={mat} position={[0, -5, 0]}>
          <coneGeometry args={[3.4, 10, 32, 1, true]} />
        </mesh>
      </group>
    </group>
  );
}

function Rig({ focus }: { focus: "gate" | "lobby" }) {
  const { camera } = useThree();
  const flash = useRef<THREE.DirectionalLight>(null);
  const nextStrike = useRef(4);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const r = focus === "gate" ? 36 : 28;
    const h = focus === "gate" ? 22 : 16;
    const a = t * 0.035 + 0.6;
    camera.position.set(C + Math.cos(a) * r, h, C + Math.sin(a) * r);
    camera.lookAt(C, focus === "gate" ? 3 : 2, C);
    if (t > nextStrike.current) nextStrike.current = t + 9 + Math.random() * 10;
    const dt = t - (nextStrike.current - 9);
    const strike = (Math.abs(dt) < 0.12 ? 1 : 0) + (Math.abs(dt - 0.25) < 0.08 ? 0.6 : 0);
    if (flash.current) flash.current.intensity = strike * 4;
  });
  return <directionalLight ref={flash} position={[4, 30, 6]} color="#cfd8ff" intensity={0} />;
}

export const Backdrop = memo(function Backdrop({ focus = "gate" }: { focus?: "gate" | "lobby" }) {
  return (
    <div className="backdrop">
      <Canvas shadows dpr={[1, 1.25]} camera={{ fov: 42, near: 0.1, far: 160 }} gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.1;
        }}
      >
        <color attach="background" args={["#020203"]} />
        <fog attach="fog" args={["#020203", 24, 62]} />
        <ambientLight intensity={0.035} color="#b8c6ff" />
        <hemisphereLight args={["#1a2550", "#000000", 0.06]} />
        <Rig focus={focus} />
        <Arena />
        {PATHS.map((_, i) => (
          <Walker key={i} idx={i} />
        ))}
        <Warden />
        <EffectComposer multisampling={0}>
          <Bloom intensity={1.1} luminanceThreshold={0.22} mipmapBlur />
          <Noise opacity={0.07} premultiply />
          <Vignette offset={0.2} darkness={0.85} />
        </EffectComposer>
      </Canvas>
    </div>
  );
});
