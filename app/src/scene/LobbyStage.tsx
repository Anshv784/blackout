// The holding cell: eight pedestals under spotlights. Taken seats show the survivor,
// open seats are a faint hologram you can click to take.
import { memo, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";
import * as THREE from "three";
import { Avatar, SEAT_COLORS } from "./Avatar";

export interface SeatInfo {
  name: string;
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

const seatPos = (i: number, n: number): [number, number, number] => {
  const x = (i - (n - 1) / 2) * 2.05;
  return [x, 0, -(x * x) / 16];
};

function Pedestal({ i, n, seat, onTake, onMakeHost, onKick }: { i: number; n: number; seat: SeatInfo; onTake: (i: number) => void; onMakeHost?: (i: number) => void; onKick?: (i: number) => void }) {
  const ring = useRef<THREE.Mesh>(null);
  const g = useRef<THREE.Group>(null);
  const spot = useRef<THREE.SpotLight>(null);
  const aimAt = useRef<THREE.Object3D>(null);
  useEffect(() => {
    if (spot.current && aimAt.current) spot.current.target = aimAt.current;
  }, []);
  const [x, , z] = seatPos(i, n);
  const color = SEAT_COLORS[i];
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ring.current) (ring.current.material as THREE.MeshBasicMaterial).opacity = seat.taken ? 0.9 : 0.25 + 0.2 * Math.sin(t * 2 + i);
    if (g.current) g.current.rotation.y = Math.PI / 2 - Math.atan2(-z - 9, -x) + Math.sin(t * 0.7 + i) * 0.15;
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.15, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[0.72, 0.82, 0.3, 40]} />
        <meshStandardMaterial color="#14161d" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh ref={ring} position={[0, 0.31, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.6, 0.68, 48]} />
        <meshBasicMaterial color={color} transparent toneMapped={false} />
      </mesh>
      {seat.taken ? (
        <group ref={g} position={[0, 0.3, 0]} scale={1.15}>
          <Avatar color={color} me={seat.me} />
        </group>
      ) : (
        <mesh position={[0, 1.0, 0]}>
          <capsuleGeometry args={[0.3, 0.6, 6, 12]} />
          <meshBasicMaterial color={color} transparent opacity={0.07} toneMapped={false} wireframe />
        </mesh>
      )}
      <object3D ref={aimAt} position={[0, 0.3, 0]} />
      <spotLight
        ref={spot}
        position={[0, 5.2, 1.2]}
        angle={0.42}
        penumbra={0.6}
        distance={9}
        decay={1.3}
        intensity={seat.taken ? 46 : 6}
        color={seat.taken ? new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.6) : color}
        castShadow={seat.taken}
      />
      <Html position={[0, seat.taken ? 2.25 : 1.9, 0]} center zIndexRange={[4, 0]}>
        {seat.taken ? (
          <div className={`stage-tag ${seat.me ? "me" : ""}`} style={{ ["--c" as any]: color }}>
            <b>{seat.name || "SURVIVOR"}</b>
            <span>
              {seat.me && "YOU"}
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

function Breath() {
  useFrame(({ camera, clock }) => {
    const t = clock.elapsedTime;
    camera.position.set(Math.sin(t * 0.12) * 0.8, 3.4 + Math.sin(t * 0.3) * 0.08, 10.5);
    camera.lookAt(0, 1.1, -1.2);
  });
  return null;
}

export const LobbyStage = memo(function LobbyStage({ seats, onTake, onMakeHost, onKick }: { seats: SeatInfo[]; onTake: (i: number) => void; onMakeHost?: (i: number) => void; onKick?: (i: number) => void }) {
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
  return (
    <div className="backdrop">
      <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 40, position: [0, 3.4, 10.5] }} onCreated={({ gl }) => (gl.toneMapping = THREE.ACESFilmicToneMapping)}>
        <color attach="background" args={["#020203"]} />
        <fog attach="fog" args={["#020203", 12, 26]} />
        <ambientLight intensity={0.05} color="#9fb4ff" />
        <Breath />
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[60, 60]} />
          <meshStandardMaterial map={floor} roughness={0.6} metalness={0.3} />
        </mesh>
        {seats.map((s, i) => (
          <Pedestal key={i} i={i} n={seats.length} seat={s} onTake={onTake} onMakeHost={onMakeHost} onKick={onKick} />
        ))}
        <EffectComposer multisampling={0}>
          <Bloom intensity={1.0} luminanceThreshold={0.25} mipmapBlur />
          <Noise opacity={0.06} premultiply />
          <Vignette offset={0.2} darkness={0.85} />
        </EffectComposer>
      </Canvas>
    </div>
  );
});
