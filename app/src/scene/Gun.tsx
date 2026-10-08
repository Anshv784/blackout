// Low-poly guns, built along +x from the hand.
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

// where the under-barrel torch sits on each gun (x along the barrel, from the hand)
export const TORCH_X = [0.48, 0.66, 0.86, 0.8, 0.9];

export function Gun({ weapon, ghost = false, display = false, torch = false }: { weapon: number; ghost?: boolean; display?: boolean; torch?: boolean }) {
  // on a loot crate the gun is shown off: lighter steel so you can tell what it is in the dark
  // in hand: gunmetal and polymer that still read in the dark (pure black metal renders as a hole)
  const tint = (c?: string) =>
    display ? (c === "#3a2a1c" ? "#8a6a48" : !c || c === "#16181e" ? "#6c727e" : "#9aa1ad") : c === "#3a2a1c" ? "#5a4029" : c === "#2a2d35" ? "#4a4f5a" : c === "#16181e" ? "#2a2d34" : c ?? "#33373f";
  const tx = TORCH_X[weapon] ?? 0.5;
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
          <mesh key={i} position={pt.p} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[pt.s[1], pt.s[1], pt.s[0], 12]} />
            <meshStandardMaterial color={tint(pt.c)} roughness={0.35} metalness={display ? 0.6 : 0.35} transparent={ghost} opacity={op} />
          </mesh>
        ) : (
          <mesh key={i} position={pt.p} rotation-z={pt.r ?? 0}>
            <boxGeometry args={pt.s} />
            <meshStandardMaterial color={tint(pt.c)} roughness={0.4} metalness={display ? 0.55 : 0.3} transparent={ghost} opacity={op} />
          </mesh>
        ),
      )}
      {!display && (
        // the torch under the barrel: body, and a lens that glows when it's on
        <group position={[tx, -0.075, 0]}>
          <mesh rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.024, 0.024, 0.14, 10]} />
            <meshStandardMaterial color="#1c1f25" roughness={0.5} metalness={0.3} transparent={ghost} opacity={op} />
          </mesh>
          <mesh position={[0.072, 0, 0]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.022, 0.022, 0.006, 12]} />
            <meshBasicMaterial color={torch ? "#fff6dc" : "#3a3d44"} toneMapped={false} transparent={ghost} opacity={op} />
          </mesh>
        </group>
      )}
    </>
  );
}
