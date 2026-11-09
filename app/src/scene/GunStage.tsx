// The gunsmith's bench: one gun, large, on a slow turntable (drag to turn), lit like a product shot.
import { memo, Suspense, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import * as THREE from "three";
import { Gun } from "./Gun";
import { TOUCH } from "../game/device";

function Studio() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    (scene as any).environmentIntensity = 0.55;
    return () => {
      scene.environment = null;
      env.dispose();
      pm.dispose();
    };
  }, [gl, scene]);
  return null;
}

/** centres the gun (its part space runs ~0..1.3 along +x) and fits it to the view */
const CENTRE: Record<number, [number, number]> = { 0: [0.39, 0.32], 1: [0.33, 0.62], 2: [0.6, 1.0], 3: [0.45, 0.95], 4: [0.72, 1.2], 5: [0.6, 1.1], 6: [0.5, 1.08], 7: [0.53, 0.86] };

function Bench({ weapon, finish, skin, spin }: { weapon: number; finish?: string; skin: number; spin: React.MutableRefObject<{ y: number; drag: boolean }> }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!g.current) return;
    // thumbnail capture (dev): hold a clean side profile
    if ((globalThis as any).__gunThumb) spin.current.y = g.current.rotation.y = 0.22;
    else if (!spin.current.drag) spin.current.y += dt * 0.35;
    g.current.rotation.y += (spin.current.y - g.current.rotation.y) * 0.12;
  });
  const [cx, len] = CENTRE[weapon] ?? [0.5, 1];
  const k = 1.35 / len;
  return (
    <group ref={g}>
      <group scale={k} position={[-cx * k, 0, 0]}>
        <Gun key={`${weapon}-${finish}-${skin}`} weapon={weapon} finish={finish} skin={skin} display />
      </group>
    </group>
  );
}

export const GunStage = memo(function GunStage({ weapon, finish, skin }: { weapon: number; finish?: string; skin: number }) {
  const spin = useRef({ y: 0.5, drag: false });
  const last = useRef<number | null>(null);
  return (
    <div
      className="cs-stage gs-stage"
      onPointerDown={(e) => {
        last.current = e.clientX;
        spin.current.drag = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        spin.current.y += (e.clientX - last.current) * 0.012;
        last.current = e.clientX;
      }}
      onPointerUp={() => {
        last.current = null;
        spin.current.drag = false;
      }}
    >
      <Canvas dpr={TOUCH ? 1 : [1, 2]} gl={{ antialias: true, alpha: true }} camera={{ fov: 26, position: [0, 0.55, 3.2] }} onCreated={({ gl, camera }) => {
        gl.debug.checkShaderErrors = import.meta.env.DEV; // in production the check forces a synchronous compile (a hitch)
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.2;
        gl.setClearColor(0x000000, 0);
        camera.lookAt(0, 0, 0);
      }}>
        <Studio />
        <hemisphereLight args={["#c8d2ea", "#14161c", 0.6]} />
        <directionalLight position={[2, 3, 3]} intensity={2.2} color="#fff2e0" />
        <directionalLight position={[-3, 1.5, -2]} intensity={1.4} color="#9fb8ff" />
        <spotLight position={[0, 3, 0.5]} angle={0.6} penumbra={0.8} intensity={30} color="#ffd166" />
        <Suspense fallback={null}>
          <Bench weapon={weapon} finish={finish} skin={skin} spin={spin} />
        </Suspense>
        <mesh rotation-x={-Math.PI / 2} position={[0, -0.3, 0]} visible={!(globalThis as any).__gunThumb}>
          <ringGeometry args={[0.62, 0.64, 96]} />
          <meshBasicMaterial color="#ffd166" toneMapped={false} transparent opacity={0.7} />
        </mesh>
      </Canvas>
      <small className="cs-hint">drag to turn</small>
    </div>
  );
});
