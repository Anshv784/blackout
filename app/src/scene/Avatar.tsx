import { forwardRef } from "react";
import * as THREE from "three";

export const SEAT_COLORS = ["#ffd166", "#ef476f", "#06d6a0", "#4cc9f0", "#c77dff", "#ff8c42", "#90e0ef", "#f15bb5"];

/** Low-poly operative. Faces +x in its local frame; rotate around Y to aim. */
export const Avatar = forwardRef<THREE.Group, { color: string; weapon?: number; me?: boolean; ghost?: boolean }>(
  function Avatar({ color, weapon = 0, me = false, ghost = false }, ref) {
    const body = ghost ? "#1a1c22" : "#20232c";
    const op = ghost ? 0.35 : 1;
    return (
      <group ref={ref}>
        {/* feet ring */}
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.36, me ? 0.44 : 0.41, 32]} />
          <meshBasicMaterial color={color} transparent opacity={me ? 0.9 : 0.6 * op} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.52, 0]} castShadow>
          <capsuleGeometry args={[0.27, 0.42, 6, 12]} />
          <meshStandardMaterial color={body} roughness={0.6} metalness={0.3} transparent={ghost} opacity={op} />
        </mesh>
        {/* shoulder band */}
        <mesh position={[0, 0.72, 0]}>
          <torusGeometry args={[0.27, 0.03, 8, 24]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} toneMapped={false} transparent={ghost} opacity={op} />
        </mesh>
        <mesh position={[0, 1.02, 0]} castShadow>
          <sphereGeometry args={[0.2, 16, 12]} />
          <meshStandardMaterial color={body} roughness={0.5} metalness={0.4} transparent={ghost} opacity={op} />
        </mesh>
        {/* visor */}
        <mesh position={[0.15, 1.04, 0]}>
          <boxGeometry args={[0.1, 0.07, 0.28]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={3} toneMapped={false} transparent={ghost} opacity={op} />
        </mesh>
        <group position={[0, 0.68, 0.12]}>
          <Gun weapon={weapon} ghost={ghost} />
        </group>
      </group>
    );
  },
);

export const aimToRotY = (aim: number) => -(aim / 65536) * Math.PI * 2;
export const toWorld = (v: number) => v / 256;

export function setAvatar(g: THREE.Object3D | null, x: number, y: number, aim: number) {
  if (!g) return;
  g.position.set(x / 256, 0, y / 256);
  g.rotation.y = aimToRotY(aim);
}

type Part = { p: [number, number, number]; s: [number, number, number]; c?: string; r?: number; cyl?: boolean; glow?: string };

// Low-poly guns, built along +x from the hand. Index = weapon id (P92, UMP, S12K, M416, KAR98K).
const GUNS: Part[][] = [
  [
    { p: [0.4, 0, 0], s: [0.26, 0.08, 0.06] },
    { p: [0.33, -0.08, 0], s: [0.06, 0.14, 0.05], c: "#16181e" },
  ],
  [
    { p: [0.46, 0, 0], s: [0.36, 0.1, 0.07] },
    { p: [0.5, -0.11, 0], s: [0.05, 0.17, 0.045], c: "#16181e" },
    { p: [0.69, 0.01, 0], s: [0.12, 0.035, 0.035], c: "#2a2d35" },
    { p: [0.3, -0.03, 0], s: [0.12, 0.07, 0.05], c: "#16181e" },
  ],
  [
    { p: [0.5, 0, 0], s: [0.5, 0.1, 0.08] },
    { p: [0.85, 0.02, 0], s: [0.28, 0.045, 0.045], c: "#2a2d35" },
    { p: [0.66, -0.06, 0], s: [0.18, 0.06, 0.09], c: "#3a2a1c" },
    { p: [0.22, -0.02, 0], s: [0.16, 0.1, 0.06], c: "#3a2a1c" },
  ],
  [
    { p: [0.48, 0, 0], s: [0.42, 0.1, 0.07] },
    { p: [0.21, -0.01, 0], s: [0.17, 0.09, 0.06], c: "#16181e" },
    { p: [0.52, -0.13, 0], s: [0.05, 0.19, 0.045], c: "#16181e", r: 0.28 },
    { p: [0.8, 0.01, 0], s: [0.24, 0.035, 0.035], c: "#2a2d35" },
    { p: [0.47, 0.08, 0], s: [0.12, 0.04, 0.035], c: "#2a2d35" },
    { p: [0.42, 0.105, 0], s: [0.02, 0.02, 0.02], glow: "#ff3b3b" },
  ],
  [
    { p: [0.56, 0, 0], s: [0.6, 0.08, 0.07], c: "#3a2a1c" },
    { p: [0.18, -0.02, 0], s: [0.2, 0.11, 0.06], c: "#3a2a1c" },
    { p: [1.06, 0.015, 0], s: [0.44, 0.03, 0.03], c: "#2a2d35" },
    { p: [0.58, 0.1, 0], s: [0.3, 0.045, 0.045], c: "#101216", cyl: true },
    { p: [0.74, 0.1, 0], s: [0.012, 0.04, 0.04], glow: "#9fd8ff" },
  ],
];

export function Gun({ weapon, ghost = false }: { weapon: number; ghost?: boolean }) {
  const parts = GUNS[weapon] ?? GUNS[0];
  const op = ghost ? 0.35 : 1;
  return (
    <>
      {parts.map((pt, i) =>
        pt.glow ? (
          <mesh key={i} position={pt.p}>
            <boxGeometry args={pt.s} />
            <meshBasicMaterial color={pt.glow} toneMapped={false} transparent={ghost} opacity={op} />
          </mesh>
        ) : pt.cyl ? (
          <mesh key={i} position={pt.p} rotation-z={Math.PI / 2} castShadow>
            <cylinderGeometry args={[pt.s[1], pt.s[1], pt.s[0], 12]} />
            <meshStandardMaterial color={pt.c ?? "#0b0c10"} roughness={0.35} metalness={0.85} transparent={ghost} opacity={op} />
          </mesh>
        ) : (
          <mesh key={i} position={pt.p} rotation-z={pt.r ?? 0} castShadow>
            <boxGeometry args={pt.s} />
            <meshStandardMaterial color={pt.c ?? "#0b0c10"} roughness={0.4} metalness={0.8} transparent={ghost} opacity={op} />
          </mesh>
        ),
      )}
    </>
  );
}
