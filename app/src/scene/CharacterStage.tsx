// The Character page's 3D stage: your operator on a lit plinth, turn it by dragging.
import { memo, Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import * as THREE from "three";
import { Avatar } from "./Avatar";
import { stillMotion, type Motion } from "./Soldier";
import type { Look } from "../game/look";
import { TOUCH } from "../game/device";

function Studio() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    (scene as any).environmentIntensity = 0.35;
    return () => {
      scene.environment = null;
      env.dispose();
      pm.dispose();
    };
  }, [gl, scene]);
  return null;
}

function Turntable({ look, weapon, emoteAt, spin }: { look: Look; weapon: number; emoteAt: number; spin: React.MutableRefObject<number> }) {
  const g = useRef<THREE.Group>(null);
  const motion = useRef<Motion>({ ...stillMotion() });
  useEffect(() => {
    if (!emoteAt) return;
    motion.current.emote = look.emote;
    motion.current.emoteAt = emoteAt;
  }, [emoteAt, look.emote]);
  useFrame(() => {
    if (g.current) g.current.rotation.y += (spin.current - g.current.rotation.y) * 0.15;
  });
  return (
    <group ref={g} rotation-y={spin.current}>
      <Avatar color="#ffd166" me ring={false} weapon={weapon} motion={motion} look={look} />
    </group>
  );
}

function Plinth() {
  const glow = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const x = c.getContext("2d")!;
    const gr = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, "rgba(255,209,102,0.35)");
    gr.addColorStop(0.5, "rgba(255,180,90,0.08)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = gr;
    x.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }, []);
  return (
    <>
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <cylinderGeometry args={[0.85, 0.95, 0.12, 64]} />
        <meshStandardMaterial color="#181b23" metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, 0]}>
        <ringGeometry args={[0.8, 0.84, 96]} />
        <meshBasicMaterial color="#ffd166" toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.11, 0]}>
        <planeGeometry args={[5, 5]} />
        <meshBasicMaterial map={glow} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}

export const CharacterStage = memo(function CharacterStage({ look, weapon, emoteAt }: { look: Look; weapon: number; emoteAt: number }) {
  const spin = useRef(-Math.PI / 2 + 0.8);
  const drag = useRef<number | null>(null);
  return (
    <div
      className="cs-stage"
      onPointerDown={(e) => {
        drag.current = e.clientX;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current === null) return;
        spin.current += (e.clientX - drag.current) * 0.012;
        drag.current = e.clientX;
      }}
      onPointerUp={() => (drag.current = null)}
    >
      <Canvas shadows={!TOUCH} dpr={TOUCH ? 1 : [1, 1.75]} gl={{ antialias: true, alpha: true }} camera={{ fov: 28, position: [0, 1.05, 4.3] }} onCreated={({ gl, camera }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.15;
        gl.setClearColor(0x000000, 0);
        camera.lookAt(0, 0.78, 0);
      }}>
        <Studio />
        <hemisphereLight args={["#aab8d8", "#0b0c10", 0.45]} />
        <spotLight position={[1.4, 5, 3.4]} angle={0.42} penumbra={0.6} intensity={75} decay={1.4} distance={14} color="#fff0dc" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
        <spotLight position={[-2.4, 3.4, -3]} angle={0.6} penumbra={0.8} intensity={45} decay={1.3} distance={12} color="#9fb8ff" />
        <spotLight position={[2.6, 2.2, -2.6]} angle={0.6} penumbra={0.9} intensity={22} decay={1.3} distance={10} color="#ffd166" />
        <Suspense fallback={null}>
          <Turntable look={look} weapon={weapon} emoteAt={emoteAt} spin={spin} />
        </Suspense>
        <Plinth />
      </Canvas>
      <small className="cs-hint">drag to turn</small>
    </div>
  );
});
