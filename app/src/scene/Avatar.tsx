import { forwardRef } from "react";
import * as THREE from "three";

export const SEAT_COLORS = ["#ffd166", "#ef476f", "#06d6a0", "#4cc9f0", "#c77dff", "#ff8c42", "#90e0ef", "#f15bb5"];

/** Low-poly operative. Faces +x in its local frame; rotate around Y to aim. */
export const Avatar = forwardRef<THREE.Group, { color: string; weapon?: number; me?: boolean; ghost?: boolean }>(
  function Avatar({ color, weapon = 0, me = false, ghost = false }, ref) {
    const body = ghost ? "#1a1c22" : "#20232c";
    const op = ghost ? 0.35 : 1;
    const gunLen = weapon === 2 ? 0.55 : weapon === 1 ? 0.45 : 0.32;
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
        {/* gun */}
        <mesh position={[0.28 + gunLen / 2, 0.68, 0.12]} castShadow>
          <boxGeometry args={[gunLen, 0.08, 0.08]} />
          <meshStandardMaterial color="#0b0c10" roughness={0.4} metalness={0.8} transparent={ghost} opacity={op} />
        </mesh>
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
