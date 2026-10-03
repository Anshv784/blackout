import { useMemo } from "react";
import * as THREE from "three";
import { MAP_ROWS, LOOT_SPOTS } from "../game/gen";

export const WALL_H = 1.25;

/** Greedy-merge wall tiles into boxes (rows first, then stack identical runs). */
export function wallBoxes() {
  const H = MAP_ROWS.length;
  const W = MAP_ROWS[0].length;
  const used = Array.from({ length: H }, () => new Array(W).fill(false));
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (MAP_ROWS[y][x] !== "#" || used[y][x]) continue;
      let w = 1;
      while (x + w < W && MAP_ROWS[y][x + w] === "#" && !used[y][x + w]) w++;
      let h = 1;
      outer: while (y + h < H) {
        for (let k = 0; k < w; k++) if (MAP_ROWS[y + h][x + k] !== "#" || used[y + h][x + k]) break outer;
        h++;
      }
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) used[yy][xx] = true;
      boxes.push({ x, y, w, h });
    }
  }
  return boxes;
}

function floorTexture() {
  const size = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1c1f27";
  g.fillRect(0, 0, size, size);
  const cell = size / 32;
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const v = 46 + Math.floor(Math.random() * 14);
      g.fillStyle = `rgb(${v},${v + 2},${v + 8})`;
      g.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
      // grime
      for (let i = 0; i < 6; i++) {
        g.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
        g.fillRect(x * cell + Math.random() * cell, y * cell + Math.random() * cell, 2 + Math.random() * 6, 1);
      }
    }
  g.strokeStyle = "rgba(10,12,18,0.9)";
  g.lineWidth = 2;
  g.lineWidth = 1;
  for (let i = 0; i <= 32; i++) {
    g.beginPath();
    g.moveTo(i * cell, 0);
    g.lineTo(i * cell, size);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * cell);
    g.lineTo(size, i * cell);
    g.stroke();
  }
  // hazard paint near loot spots
  g.strokeStyle = "rgba(255,209,102,0.12)";
  g.lineWidth = 3;
  for (const [lx, ly] of LOOT_SPOTS) {
    g.strokeRect(lx * cell + 4, ly * cell + 4, cell - 8, cell - 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function Arena({ lit = false }: { lit?: boolean }) {
  const boxes = useMemo(wallBoxes, []);
  const floor = useMemo(floorTexture, []);
  const wallGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const edges = useMemo(() => {
    const pts: number[] = [];
    for (const b of boxes) {
      const x0 = b.x;
      const x1 = b.x + b.w;
      const z0 = b.y;
      const z1 = b.y + b.h;
      const y = WALL_H + 0.002;
      pts.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [boxes]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[16, 0, 16]} receiveShadow>
        <planeGeometry args={[32, 32]} />
        <meshStandardMaterial map={floor} roughness={0.92} metalness={0.05} />
      </mesh>
      {/* outer void */}
      <mesh rotation-x={-Math.PI / 2} position={[16, -0.01, 16]}>
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial color="#020203" />
      </mesh>
      {boxes.map((b, i) => (
        <mesh
          key={i}
          geometry={wallGeo}
          position={[b.x + b.w / 2, WALL_H / 2, b.y + b.h / 2]}
          scale={[b.w, WALL_H, b.h]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={lit ? "#3a3f4c" : "#4a5162"} roughness={0.8} metalness={0.1} />
        </mesh>
      ))}
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={lit ? "#8fb4ff" : "#2c3c66"} transparent opacity={lit ? 0.5 : 0.55} />
      </lineSegments>
    </group>
  );
}
