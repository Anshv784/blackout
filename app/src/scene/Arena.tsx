import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MAP_ROWS, LOOT_SPOTS } from "../game/gen";

/** Collision height on chain is just "wall"; visual heights vary for silhouette. */
export const WALL_H = 1.25;

export interface WallBox {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "border" | "container" | "concrete" | "pillar";
  tone: number;
  height: number;
}

const rnd = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

/** Greedy-merge wall tiles into boxes, then give each a look. */
export function wallBoxes(): WallBox[] {
  const H = MAP_ROWS.length;
  const W = MAP_ROWS[0].length;
  const used = Array.from({ length: H }, () => new Array(W).fill(false));
  const out: WallBox[] = [];
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
      const r = rnd(x * 73 + y * 151 + w * 7 + h);
      const border = x === 0 || y === 0 || x + w === W || y + h === H;
      const long = Math.max(w, h);
      const kind: WallBox["kind"] = border ? "border" : w * h === 1 ? "pillar" : long >= 3 && Math.min(w, h) === 1 && r() < 0.55 ? "container" : "concrete";
      const height = border ? 1.9 : kind === "container" ? 1.35 + (r() < 0.3 ? 0.15 : 0) : kind === "pillar" ? 1.6 : 1.15 + r() * 0.2;
      out.push({ x, y, w, h, kind, tone: Math.floor(r() * 4), height });
    }
  }
  return out;
}

// ------------------------------------------------------------- textures

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, a: number) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * a})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

const CONTAINER_COLORS = ["#7a2e22", "#1f4e5a", "#2b3a67", "#6b5a24"];

function containerTex(color: string) {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, 256, 256);
    // corrugation ribs
    for (let x = 0; x < 256; x += 16) {
      const grad = g.createLinearGradient(x, 0, x + 16, 0);
      grad.addColorStop(0, "rgba(0,0,0,0.35)");
      grad.addColorStop(0.5, "rgba(255,255,255,0.10)");
      grad.addColorStop(1, "rgba(0,0,0,0.35)");
      g.fillStyle = grad;
      g.fillRect(x, 0, 16, 256);
    }
    // rust + grime
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${90 + Math.random() * 60},${40 + Math.random() * 20},20,${Math.random() * 0.25})`;
      g.beginPath();
      g.ellipse(Math.random() * 256, 200 + Math.random() * 56, 4 + Math.random() * 18, 2 + Math.random() * 8, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(0, 0, 256, 8);
    g.fillRect(0, 248, 256, 8);
    speckle(g, 256, 256, 1500, 0.12);
    g.font = "bold 22px monospace";
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.fillText(`BLK-${10 + Math.floor(Math.random() * 89)}`, 22, 52);
  });
}

function concreteTex(tone: number) {
  return canvasTex(256, 256, (g) => {
    const base = 62 + tone * 6;
    g.fillStyle = `rgb(${base},${base + 2},${base + 6})`;
    g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 6000, 0.18);
    // panel seams + bolts
    g.strokeStyle = "rgba(0,0,0,0.45)";
    g.lineWidth = 2;
    for (let x = 0; x <= 256; x += 128) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 256);
      g.stroke();
    }
    g.fillStyle = "rgba(0,0,0,0.5)";
    for (const [bx, by] of [[10, 12], [118, 12], [138, 12], [246, 12]]) g.fillRect(bx, by, 4, 4);
    // water streaks
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * 256;
      const grad = g.createLinearGradient(0, 30, 0, 256);
      grad.addColorStop(0, "rgba(0,0,0,0.25)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(x, 20, 2 + Math.random() * 4, 236);
    }
    // hazard band near the floor
    if (tone % 2 === 0) {
      for (let x = -40; x < 256; x += 28) {
        g.fillStyle = "rgba(255,190,40,0.55)";
        g.beginPath();
        g.moveTo(x, 256);
        g.lineTo(x + 14, 256);
        g.lineTo(x + 34, 226);
        g.lineTo(x + 20, 226);
        g.fill();
      }
    }
  });
}

function borderTex() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = "#2a2d35";
    g.fillRect(0, 0, 256, 256);
    // chain-link-ish fence lattice over a dark wall
    g.strokeStyle = "rgba(160,170,190,0.18)";
    g.lineWidth = 1.5;
    for (let i = -256; i < 512; i += 14) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 256, 256);
      g.stroke();
      g.beginPath();
      g.moveTo(i, 256);
      g.lineTo(i + 256, 0);
      g.stroke();
    }
    g.fillStyle = "rgba(0,0,0,0.5)";
    for (let x = 0; x < 256; x += 64) g.fillRect(x, 0, 6, 256);
    speckle(g, 256, 256, 2000, 0.1);
  });
}

function floorTexture() {
  const size = 2048;
  const cell = size / 32;
  return canvasTex(size, size, (g) => {
    // asphalt/concrete base
    g.fillStyle = "#24272f";
    g.fillRect(0, 0, size, size);
    speckle(g, size, size, 90000, 0.12);
    // slab variation
    for (let y = 0; y < 32; y += 2)
      for (let x = 0; x < 32; x += 2) {
        g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`;
        g.fillRect(x * cell, y * cell, cell * 2, cell * 2);
      }
    // expansion joints every 2 tiles
    g.strokeStyle = "rgba(0,0,0,0.55)";
    g.lineWidth = 3;
    for (let i = 0; i <= 32; i += 2) {
      g.beginPath();
      g.moveTo(i * cell, 0);
      g.lineTo(i * cell, size);
      g.stroke();
      g.beginPath();
      g.moveTo(0, i * cell);
      g.lineTo(size, i * cell);
      g.stroke();
    }
    // cracks
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.lineWidth = 1.5;
    for (let i = 0; i < 70; i++) {
      let x = Math.random() * size;
      let y = Math.random() * size;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (Math.random() - 0.5) * 50;
        y += (Math.random() - 0.5) * 50;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // oil stains
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 12 + Math.random() * 40;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, "rgba(0,0,0,0.45)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    // painted lane lines along open corridors
    g.strokeStyle = "rgba(230,230,210,0.22)";
    g.lineWidth = 5;
    g.setLineDash([36, 28]);
    for (let y = 0; y < 32; y++) {
      let run = 0;
      for (let x = 0; x <= 32; x++) {
        const open = x < 32 && MAP_ROWS[y][x] !== "#" && y > 0 && y < 31 && MAP_ROWS[y - 1][x] !== "#" && MAP_ROWS[y + 1][x] !== "#";
        if (open) run++;
        else {
          if (run >= 5) {
            g.beginPath();
            g.moveTo((x - run) * cell + 8, y * cell + cell / 2);
            g.lineTo(x * cell - 8, y * cell + cell / 2);
            g.stroke();
          }
          run = 0;
        }
      }
    }
    g.setLineDash([]);
    // loot pads: hazard squares
    for (const [lx, ly] of LOOT_SPOTS) {
      const x0 = lx * cell + 6;
      const y0 = ly * cell + 6;
      const s = cell - 12;
      g.save();
      g.beginPath();
      g.rect(x0, y0, s, s);
      g.clip();
      for (let k = -s; k < s * 2; k += 14) {
        g.fillStyle = "rgba(255,190,40,0.35)";
        g.beginPath();
        g.moveTo(x0 + k, y0);
        g.lineTo(x0 + k + 7, y0);
        g.lineTo(x0 + k + 7 - s, y0 + s);
        g.lineTo(x0 + k - s, y0 + s);
        g.fill();
      }
      g.restore();
      g.strokeStyle = "rgba(255,190,40,0.6)";
      g.lineWidth = 3;
      g.strokeRect(x0, y0, s, s);
    }
    // a few big stencilled sector numbers
    g.font = "bold 120px monospace";
    g.fillStyle = "rgba(255,255,255,0.05)";
    const sectors = [[4, 6, "A1"], [20, 4, "B2"], [12, 17, "C3"], [24, 21, "D4"], [5, 27, "E5"]] as const;
    for (const [sx, sy, label] of sectors) g.fillText(label, sx * cell, sy * cell);
  });
}

// ------------------------------------------------------------- scene

function Beacons({ boxes }: { boxes: WallBox[] }) {
  const mats = useRef<THREE.MeshBasicMaterial[]>([]);
  const spots = useMemo(() => boxes.filter((b, i) => b.kind === "container" && i % 3 === 0), [boxes]);
  useFrame(({ clock }) => {
    mats.current.forEach((m, i) => {
      if (m) m.opacity = 0.25 + 0.75 * Math.max(0, Math.sin(clock.elapsedTime * 2.2 + i * 1.7));
    });
  });
  return (
    <>
      {spots.map((b, i) => (
        <mesh key={i} position={[b.x + 0.35, b.height + 0.06, b.y + 0.35]}>
          <boxGeometry args={[0.1, 0.1, 0.1]} />
          <meshBasicMaterial ref={(m) => m && (mats.current[i] = m)} color="#ff3b3b" transparent toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

/** Set by the match camera: walls between it and you fade so you never lose your own body. */
export const occlusion = { active: false, cam: new THREE.Vector3(), target: new THREE.Vector3() };

/** Does the segment a→b pass through the box? (slab test) */
function segHitsBox(a: THREE.Vector3, b: THREE.Vector3, min: [number, number, number], max: [number, number, number]) {
  let t0 = 0;
  let t1 = 1;
  const d = [b.x - a.x, b.y - a.y, b.z - a.z];
  const o = [a.x, a.y, a.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-6) {
      if (o[i] < min[i] || o[i] > max[i]) return false;
      continue;
    }
    let ta = (min[i] - o[i]) / d[i];
    let tb = (max[i] - o[i]) / d[i];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

export function Arena({ lit = false }: { lit?: boolean }) {
  const boxes = useMemo(wallBoxes, []);
  const floor = useMemo(floorTexture, []);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const materials = useMemo(() => {
    const cont = CONTAINER_COLORS.map(containerTex);
    const conc = [0, 1, 2, 3].map(concreteTex);
    const border = borderTex();
    return boxes.map((b) => {
      let base: THREE.Texture;
      let rough = 0.85;
      let metal = 0.1;
      if (b.kind === "container") {
        base = cont[b.tone];
        rough = 0.55;
        metal = 0.45;
      } else if (b.kind === "border") base = border;
      else base = conc[b.tone];
      const map = base.clone();
      map.needsUpdate = true;
      // repeat along the long side so ribs/panels keep their scale
      map.repeat.set(Math.max(1, Math.max(b.w, b.h) / 2), 1);
      const side = new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: metal, color: lit ? "#bfc6d6" : "#ffffff" });
      const top = new THREE.MeshStandardMaterial({ color: b.kind === "container" ? "#3a3f4a" : "#4a4f5a", roughness: 0.9 });
      // box faces: +x -x +y -y +z -z
      return [side, side, top, top, side, side];
    });
  }, [boxes, lit]);
  const edges = useMemo(() => {
    const pts: number[] = [];
    for (const b of boxes) {
      const [x0, x1, z0, z1, y] = [b.x, b.x + b.w, b.y, b.y + b.h, b.height + 0.002];
      pts.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [boxes]);

  const fade = useRef<number[]>(boxes.map(() => 1));
  useFrame((_, dt) => {
    if (!occlusion.active && fade.current.every((f) => f === 1)) return;
    const k = 1 - Math.pow(0.0001, dt);
    boxes.forEach((b, i) => {
      if (b.kind === "border") return;
      const blocked =
        occlusion.active && segHitsBox(occlusion.cam, occlusion.target, [b.x + 0.05, 0, b.y + 0.05], [b.x + b.w - 0.05, b.height, b.y + b.h - 0.05]);
      const want = blocked ? 0.18 : 1;
      const cur = fade.current[i];
      if (Math.abs(cur - want) < 0.01) {
        if (cur !== want) fade.current[i] = want;
        else return;
      } else fade.current[i] = cur + (want - cur) * k;
      const f = fade.current[i];
      for (const m of new Set(materials[i])) {
        const see = f < 0.999;
        if (m.transparent !== see) {
          m.transparent = see;
          m.depthWrite = !see;
          m.needsUpdate = true;
        }
        m.opacity = f;
      }
    });
  });

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[16, 0, 16]} receiveShadow>
        <planeGeometry args={[32, 32]} />
        <meshStandardMaterial map={floor} roughness={0.88} metalness={0.05} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[16, -0.01, 16]}>
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial color="#020203" />
      </mesh>
      {boxes.map((b, i) => (
        <mesh key={i} geometry={geo} material={materials[i]} position={[b.x + b.w / 2, b.height / 2, b.y + b.h / 2]} scale={[b.w, b.height, b.h]} castShadow receiveShadow />
      ))}
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={lit ? "#8fb4ff" : "#31406b"} transparent opacity={lit ? 0.45 : 0.5} />
      </lineSegments>
      <Beacons boxes={boxes} />
    </group>
  );
}
