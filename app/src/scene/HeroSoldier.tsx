// The home screen's operator: your soldier, standing lit at the edge of the Yard with the
// torch on. A transparent canvas over the backdrop, so the Yard stays visible behind him.
import { memo, Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import * as THREE from "three";
import { Avatar } from "./Avatar";
import { stillMotion, type Motion } from "./Soldier";
import { TOUCH } from "../game/device";
import { useLook } from "../game/look";

function Studio() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    (scene as any).environmentIntensity = 0.2;
    return () => {
      scene.environment = null;
      env.dispose();
      pm.dispose();
    };
  }, [gl, scene]);
  return null;
}

/** Turns slowly to face you and away, and follows the mouse a little. */
function Operator({ color }: { color: string }) {
  const g = useRef<THREE.Group>(null);
  const motion = useRef<Motion>({ ...stillMotion(), torch: true });
  const myLook = useLook((s) => s.look);
  // say hello: your signature emote once, a moment after the menu opens (and when you change it)
  useEffect(() => {
    const t = setTimeout(() => {
      motion.current.emote = myLook.emote;
      motion.current.emoteAt = performance.now();
    }, 1600);
    return () => clearTimeout(t);
  }, [myLook.emote, myLook.char]);
  const look = useRef(0);
  useEffect(() => {
    const f = (e: PointerEvent) => (look.current = (e.clientX / window.innerWidth - 0.5) * 0.9);
    window.addEventListener("pointermove", f);
    return () => window.removeEventListener("pointermove", f);
  }, []);
  useFrame(({ clock }) => {
    if (!g.current) return;
    const t = clock.elapsedTime;
    // soldiers face +x in their own frame; the camera is out on +z: face it, a touch to the left
    const want = -Math.PI / 2 + 0.85 + Math.sin(t * 0.25) * 0.12 + look.current * 0.5;
    g.current.rotation.y += (want - g.current.rotation.y) * 0.05;
  });
  return (
    <group ref={g} scale={1.55}>
      <Avatar color={color} me ring={false} weapon={3} motion={motion} look={myLook} />
    </group>
  );
}

/** Frame the whole soldier (feet to helmet, plus a margin) in whatever box the column gives. */
function Fit() {
  const { camera, size, gl } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const aspect = size.width / Math.max(1, size.height);
    const H = 2.75; // the soldier is ~2.15 tall at this scale; room for the plate below and air above
    const W = 1.9;
    const dist = Math.max(H / 2 / tanV, W / 2 / (tanV * aspect));
    cam.position.set(0.15, 1.25, dist);
    cam.lookAt(0, 1.0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // tell the page where the boots are, so the name plate sits right under them
    const feet = new THREE.Vector3(0, 0, 0).project(cam);
    const y = ((1 - feet.y) / 2) * size.height;
    (gl.domElement.closest(".hero-stage") as HTMLElement | null)?.style.setProperty("--feet", `${Math.round(y)}px`);
  }, [camera, size, gl]);
  return null;
}

function Ground() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const x = c.getContext("2d")!;
    const gr = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, "rgba(255,214,140,0.30)");
    gr.addColorStop(0.45, "rgba(255,180,90,0.08)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = gr;
    x.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }, []);
  return (
    <>
      {/* a pool of warm light on the concrete */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]}>
        <planeGeometry args={[4.2, 4.2]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {/* contact shadow catcher */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <shadowMaterial opacity={0.55} />
      </mesh>
    </>
  );
}

export const HeroSoldier = memo(function HeroSoldier({ color = "#ffd166" }: { color?: string }) {
  return (
    <Canvas
      shadows={!TOUCH}
      dpr={TOUCH ? 1 : [1, 1.75]}
      gl={{ alpha: true, antialias: true, premultipliedAlpha: false }}
      camera={{ fov: 30, position: [0.2, 1.7, 6.4] }}
      onCreated={({ gl, camera }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.15;
        gl.setClearColor(0x000000, 0);
        camera.lookAt(0, 1.15, 0);
      }}
    >
      <Studio />
      <Fit />
      <hemisphereLight args={["#9fb0d0", "#0b0c10", 0.28]} />
      {/* key: an overhead work lamp, warm and hard */}
      <spotLight position={[1.6, 5.5, 3.2]} angle={0.45} penumbra={0.6} intensity={70} decay={1.4} distance={14} color="#ffe2b8" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
      {/* rim: cold moonlight from behind, so the silhouette separates from the dark */}
      <spotLight position={[-2.4, 3.6, -3.2]} angle={0.6} penumbra={0.8} intensity={55} decay={1.3} distance={12} color="#c4d2ee" />
      <spotLight position={[2.8, 2.2, -2.6]} angle={0.6} penumbra={0.9} intensity={22} decay={1.3} distance={10} color={color} />
      <Suspense fallback={null}>
        <Operator color={color} />
      </Suspense>
      <Ground />
    </Canvas>
  );
});
