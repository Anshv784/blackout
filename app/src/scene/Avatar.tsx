import { forwardRef, Suspense } from "react";
import { Soldier, type Motion } from "./Soldier";
export { Gun } from "./Gun";
import * as THREE from "three";

import { SEAT_COLORS } from "../game/colors";
export { SEAT_COLORS };

/** A player: a rigged soldier holding their gun, with their seat colour as a ring at the feet. */
export const Avatar = forwardRef<THREE.Group, { color: string; weapon?: number; me?: boolean; ghost?: boolean; ring?: boolean; motion?: React.MutableRefObject<Motion> }>(
  function Avatar({ color, weapon = 0, me = false, ghost = false, ring = true, motion }, ref) {
    return (
      <group ref={ref}>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} visible={ring}>
          <ringGeometry args={[0.36, me ? 0.44 : 0.41, 32]} />
          <meshBasicMaterial color={color} transparent opacity={me ? 0.9 : ghost ? 0.25 : 0.6} toneMapped={false} />
        </mesh>
        <Suspense fallback={null}>
          <Soldier color={color} weapon={weapon} ghost={ghost} motion={motion} />
        </Suspense>
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

