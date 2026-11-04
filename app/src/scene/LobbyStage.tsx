// The holding cell: eight pedestals under spotlights. Taken seats show the survivor,
// open seats are a faint hologram you can click to take.
import { TOUCH } from "../game/device";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Html, MeshReflectorMaterial } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";
import * as THREE from "three";
import { Avatar, SEAT_COLORS } from "./Avatar";
import type { Look } from "../game/look";
import { stillMotion, type Motion } from "./Soldier";

export interface SeatInfo {
  name: string;
  look?: Look;
  /** performance.now() you pressed an emote (your seat only) */
  emoteAt?: number;
  taken: boolean;
  bot: boolean;
  me: boolean;
  host: boolean;
  away: boolean;
  canMakeHost?: boolean;
  canKick?: boolean;
  /** duos: which team this seat is on */
  team?: number;
  /** hint under OPEN SEAT */
  openHint?: string;
}

/** Seats sit on a shallow arc; tighter on a phone held upright. */
const seatPos = (i: number, n: number, gap: number, rows: number): [number, number, number] => {
  if (rows === 2) {
    // phone held upright: two rows, the back one offset so nobody hides behind anyone
    const cols = Math.ceil(n / 2);
    const back = i >= cols ? 1 : 0;
    const col = back ? i - cols : i;
    const inRow = back ? n - cols : cols;
    const x = (col - (inRow - 1) / 2) * gap * (back ? 1.55 : 1);
    return [x, 0, back ? -2.4 : 0];
  }
  // one straight line: every pedestal, soldier and tag sits at the same height
  return [(i - (n - 1) / 2) * gap, 0, 0];
};
const WHITE = new THREE.Color("#ffffff");

function Pedestal({ i, n, gap, rows, seat, onTake, onMakeHost, onKick, onSelf }: { onSelf?: (x: number, y: number) => void; i: number; n: number; gap: number; rows: number; seat: SeatInfo; onTake: (i: number) => void; onMakeHost?: (i: number) => void; onKick?: (i: number) => void }) {
  const ring = useRef<THREE.Mesh>(null);
  const motion = useRef<Motion>(stillMotion());
  if (seat.emoteAt && motion.current.emoteAt !== seat.emoteAt) {
    motion.current.emote = seat.look?.emote ?? 0;
    motion.current.emoteAt = seat.emoteAt;
  }
  const g = useRef<THREE.Group>(null);
  const key = useRef<THREE.SpotLight>(null);
  const rim = useRef<THREE.SpotLight>(null);
  const aimAt = useRef<THREE.Object3D>(null);
  useEffect(() => {
    if (key.current && aimAt.current) key.current.target = aimAt.current;
    if (rim.current && aimAt.current) rim.current.target = aimAt.current;
  }, []);
  const [x, , z] = seatPos(i, n, gap, rows);
  const color = SEAT_COLORS[i];
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ring.current) (ring.current.material as THREE.MeshBasicMaterial).opacity = seat.taken ? 0.95 : 0.2 + 0.15 * Math.sin(t * 2 + i);
    // face the camera (out on +z), turned a touch towards the middle, with a slow idle sway; soldiers face +x in their own frame
    if (g.current) g.current.rotation.y = -Math.PI / 2 + 0.8 + Math.sin(t * 0.5 + i) * 0.06;
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.11, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[0.62, 0.68, 0.22, 48]} />
        <meshStandardMaterial color="#1a1d26" metalness={0.75} roughness={0.32} />
      </mesh>
      <mesh position={[0, 0.225, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[0.6, 48]} />
        <meshStandardMaterial color="#2a2e38" metalness={0.4} roughness={0.55} />
      </mesh>
      <mesh ref={ring} position={[0, 0.23, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.57, 0.61, 64]} />
        <meshBasicMaterial color={color} transparent toneMapped={false} />
      </mesh>
      {seat.taken ? (
        <group
          ref={g}
          position={[0, 0.23, 0]}
          scale={1.3}
          onClick={(e) => {
            if (!seat.me || !onSelf) return;
            e.stopPropagation();
            onSelf(e.nativeEvent.clientX, e.nativeEvent.clientY);
          }}
          onPointerOver={() => seat.me && (document.body.style.cursor = "pointer")}
          onPointerOut={() => (document.body.style.cursor = "")}
        >
          <Avatar color={color} me={seat.me} ring={false} weapon={3} look={seat.look} motion={motion} />
        </group>
      ) : (
        <group ref={g} position={[0, 0.23, 0]} scale={1.3}>
          <Avatar color={color} ghost ring={false} weapon={3} />
        </group>
      )}
            <object3D ref={aimAt} position={[0, 1.1, 0]} />
      {/* key: a neutral, slightly warm work light from the front, so the kit reads as real cloth and metal */}
      <spotLight ref={key} position={[0.8, 4.6, 3.2]} angle={0.36} penumbra={0.7} distance={11} decay={1.2} intensity={seat.taken ? 60 : 0} color="#fff1e2" castShadow={seat.taken} shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
      {/* rim: the seat colour from behind, outlining the silhouette */}
      <spotLight ref={rim} position={[-0.4, 3.4, -2.6]} angle={0.5} penumbra={0.8} distance={8} decay={1.3} intensity={seat.taken ? 38 : 3.5} color={new THREE.Color(color).lerp(WHITE, seat.taken ? 0.15 : 0)} />
      <Html position={[0, rows === 2 && z < -1 ? 1.15 : 2.5, rows === 2 && z < -1 ? 0.9 : 0]} center zIndexRange={[4, 0]}>
        {seat.taken ? (
          <div className={`stage-tag ${seat.me ? "me" : ""}`} style={{ ["--c" as any]: color }}>
            <b>{seat.name || "SURVIVOR"}</b>
            <span>
              {seat.me && "YOU · CLICK TO EMOTE"}
              {seat.host && (seat.me ? " · HOST" : "HOST")}
              {seat.bot && "BOT"}
              {seat.away && " · AWAY"}
              {seat.team && ` · TEAM ${seat.team}`}
            </span>
            {(seat.canMakeHost || seat.canKick) && (
              <div className="seat-actions">
                {seat.canMakeHost && onMakeHost && (
                  <button className="make-host" onClick={() => onMakeHost(i)}>
                    MAKE HOST
                  </button>
                )}
                {seat.canKick && onKick && (
                  <button className="make-host kick" onClick={() => onKick(i)}>
                    KICK
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <button className="stage-open" style={{ ["--c" as any]: color }} onClick={() => onTake(i)}>
            OPEN SEAT
            <small>{seat.openHint ?? "bot if empty"}</small>
          </button>
        )}
      </Html>
    </group>
  );
}

/** Frames the seats in the free band between the page title and the controls at the bottom,
 *  measured from the page itself, so tags never run into the title on any screen. */
function Rig({ n, gap, depth }: { n: number; gap: number; depth: number }) {
  const { camera, size } = useThree();
  const band = useRef({ top: 170, bot: size.height - 170, left: 0, at: -1 });
  useEffect(() => () => (camera as THREE.PerspectiveCamera).clearViewOffset(), [camera]);
  useFrame(({ clock }) => {
    const cam = camera as THREE.PerspectiveCamera;
    const t = clock.elapsedTime;
    if (t - band.current.at > 0.5) {
      band.current.at = t;
      const head = document.querySelector(".lobby2-head")?.getBoundingClientRect();
      const dock = document.querySelector(".dock")?.getBoundingClientRect();
      band.current.top = (head?.bottom ?? 170) + 8;
      band.current.bot = (dock?.top ?? size.height - 170) - 26;
      // the map picker sits on the left: keep the seats in the free space to its right
      const picker = document.querySelector(".map-picker")?.getBoundingClientRect();
      band.current.left = picker && getComputedStyle(document.querySelector(".map-picker")!).position === "absolute" ? picker.right + 12 : 0;
    }
    const { top, bot, left } = band.current;
    const freeW = Math.max(200, size.width - left * 2 > 300 ? size.width - left - 24 : size.width);
    const h = Math.max(120, bot - top);
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const aspect = size.width / Math.max(1, size.height);
    // fit the row across the screen, and the stage (floor to name tags, ~3.4 tall) into the band
    const half = ((n - 1) * gap) / 2 + 1.0;
    const fitW = (half / (tanV * aspect)) * (size.width / freeW);
    const fitH = (3.4 * size.height) / (h * 2 * tanV);
    const dist = Math.max(6.5, fitW, fitH) + depth;
    cam.position.set(Math.sin(t * 0.1) * 0.5, 2.9 + Math.sin(t * 0.25) * 0.05, dist);
    cam.lookAt(0, 1.6, -depth);
    // move the picture's centre into the middle of the band
    const offY = size.height / 2 - (top + bot) / 2;
    const offX = left ? size.width / 2 - (left + (left + freeW)) / 2 : 0;
    const v = cam.view;
    if (!v || !v.enabled || Math.abs(v.offsetY - offY) > 0.5 || Math.abs(v.offsetX - offX) > 0.5 || v.fullWidth !== size.width || v.fullHeight !== size.height) cam.setViewOffset(size.width, size.height, offX, offY, size.width, size.height);
  });
  return null;
}

/** Soft studio reflections so metal and fabric have some life, without lighting up the room. */
function Studio() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    (scene as any).environmentIntensity = 0.22;
    return () => {
      scene.environment = null;
      env.dispose();
      pm.dispose();
    };
  }, [gl, scene]);
  return null;
}

export const LobbyStage = memo(function LobbyStage({ seats, onTake, onMakeHost, onKick, onSelf }: { seats: SeatInfo[]; onTake: (i: number) => void; onMakeHost?: (i: number) => void; onKick?: (i: number) => void; onSelf?: (x: number, y: number) => void }) {
  const floor = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    g.fillStyle = "#07080c";
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = "rgba(120,140,220,0.08)";
    for (let i = 0; i <= 512; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 512);
      g.stroke();
      g.beginPath();
      g.moveTo(0, i);
      g.lineTo(512, i);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(6, 6);
    return t;
  }, []);
  const [portrait, setPortrait] = useState(() => window.innerWidth < window.innerHeight * 0.9);
  useEffect(() => {
    const f = () => setPortrait(window.innerWidth < window.innerHeight * 0.9);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const rows = portrait && seats.length > 2 ? 2 : 1;
  const gap = portrait ? 1.7 : 2.1;
  return (
    <div className="backdrop">
      <Canvas shadows={!TOUCH} dpr={TOUCH ? 1 : [1, 1.5]} gl={{ antialias: !TOUCH }} camera={{ fov: 34, position: [0, 2.3, 9] }} onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.1;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
        }}>
        <color attach="background" args={["#020203"]} />
        <fog attach="fog" args={["#020203", 10, 24]} />
        <hemisphereLight args={["#8ea2c8", "#0b0c10", 0.32]} />
        <Studio />
        <Rig n={rows === 2 ? Math.ceil(seats.length / 2) : seats.length} gap={gap} depth={rows === 2 ? 1.2 : 0.4} />
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[60, 60]} />
          {TOUCH ? (
            <meshStandardMaterial map={floor} roughness={0.6} metalness={0.3} />
          ) : (
            <MeshReflectorMaterial map={floor} mirror={0} blur={[400, 120]} resolution={512} mixBlur={1} mixStrength={2.2} depthScale={0.6} minDepthThreshold={0.6} color="#0a0b10" metalness={0.5} roughness={0.75} />
          )}
        </mesh>
        {seats.map((s, i) => (
          <Pedestal key={i} i={i} n={seats.length} gap={gap} rows={rows} onSelf={onSelf} seat={s} onTake={onTake} onMakeHost={onMakeHost} onKick={onKick} />
        ))}
        {!TOUCH && <EffectComposer multisampling={0}>
          <Bloom intensity={0.7} luminanceThreshold={0.55} mipmapBlur />
          <Noise opacity={0.035} premultiply />
          <Vignette offset={0.2} darkness={0.85} />
        </EffectComposer>}
      </Canvas>
    </div>
  );
});
