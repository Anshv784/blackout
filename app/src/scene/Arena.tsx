import { useMemo, useRef } from "react";
import { TOUCH } from "../game/device";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MAP_ROWS, LOOT_SPOTS, LAMPS, MAP_W, MAP_H, WALL_CHARS } from "../game/gen";
import { Dressing } from "./Dressing";
import { usePrefs, gfx } from "../game/prefs";

/** Collision height on chain is just "wall"; visual heights vary for silhouette. */
export const WALL_H = 1.25;

export interface WallBox {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "border" | "container" | "concrete" | "pillar" | "building" | "tower" | "fence" | "crates";
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

/** Greedy-merge wall tiles of the same type into boxes, then give each a look. */
export function wallBoxes(): WallBox[] {
  const H = MAP_ROWS.length;
  const W = MAP_ROWS[0].length;
  const used = Array.from({ length: H }, () => new Array(W).fill(false));
  const out: WallBox[] = [];
  const isW = (x: number, y: number) => WALL_CHARS.includes(MAP_ROWS[y][x]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isW(x, y) || used[y][x]) continue;
      const ch = MAP_ROWS[y][x];
      let w = 1;
      while (x + w < W && MAP_ROWS[y][x + w] === ch && !used[y][x + w]) w++;
      let h = 1;
      outer: while (y + h < H) {
        for (let k = 0; k < w; k++) if (MAP_ROWS[y + h][x + k] !== ch || used[y + h][x + k]) break outer;
        h++;
      }
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) used[yy][xx] = true;
      const r = rnd(x * 73 + y * 151 + w * 7 + h);
      const kind: WallBox["kind"] =
        ch === "#" ? "border" : ch === "C" ? "container" : ch === "B" ? "building" : ch === "T" ? "tower" : ch === "F" ? "fence" : "crates";
      const height =
        kind === "border" ? 2.2 : kind === "container" ? 1.35 + (r() < 0.3 ? 0.25 : 0) : kind === "building" ? 2.4 : kind === "tower" ? (w === 1 && h === 1 ? 2.4 : 1.0) : kind === "fence" ? 1.4 : 0.8 + r() * 0.25;
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

function buildingTex(tone: number) {
  return canvasTex(256, 256, (g) => {
    const base = 70 + tone * 5;
    g.fillStyle = `rgb(${base},${base - 2},${base - 6})`;
    g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 5000, 0.15);
    // brick courses
    g.strokeStyle = "rgba(0,0,0,0.25)";
    g.lineWidth = 1;
    for (let y = 0; y < 256; y += 16) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(256, y);
      g.stroke();
      for (let x = (y / 16) % 2 ? 0 : 16; x < 256; x += 32) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 16);
        g.stroke();
      }
    }
    // a window, some lit
    g.fillStyle = Math.random() < 0.35 ? "rgba(255,200,110,0.85)" : "rgba(10,12,18,0.9)";
    g.fillRect(96, 70, 64, 52);
    g.strokeStyle = "rgba(30,30,30,0.9)";
    g.lineWidth = 6;
    g.strokeRect(96, 70, 64, 52);
    g.beginPath();
    g.moveTo(128, 70);
    g.lineTo(128, 122);
    g.stroke();
    // grime at the foot
    const grad = g.createLinearGradient(0, 180, 0, 256);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.5)");
    g.fillStyle = grad;
    g.fillRect(0, 180, 256, 76);
  });
}

function fenceTex() {
  const t = canvasTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = "rgba(180,190,200,0.9)";
    g.lineWidth = 2;
    for (let k = -128; k < 256; k += 16) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + 128, 128);
      g.stroke();
      g.beginPath();
      g.moveTo(k + 128, 0);
      g.lineTo(k, 128);
      g.stroke();
    }
    g.fillStyle = "rgba(90,95,105,1)";
    g.fillRect(0, 0, 128, 6);
    g.fillRect(0, 0, 6, 128);
  });
  return t;
}

function crateTex() {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = "#6b4f2e";
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 21) {
      g.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.15})`;
      g.fillRect(0, y, 128, 2);
    }
    g.strokeStyle = "#3d2c18";
    g.lineWidth = 8;
    g.strokeRect(4, 4, 120, 120);
    g.beginPath();
    g.moveTo(4, 4);
    g.lineTo(124, 124);
    g.stroke();
    speckle(g, 128, 128, 800, 0.2);
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
  const cell = 64;
  const size = MAP_W * cell;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H ? MAP_ROWS[y][x] : "#");
  return canvasTex(size, size, (g) => {
    // ground per tile: concrete yard, asphalt road, dirt field, indoor floor
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        const c = at(x, y);
        g.fillStyle =
          c === "=" ? "#1b1d22" : c === "," ? `rgb(${52 + ((x * 7 + y * 3) % 9)},${46 + ((x + y * 5) % 7)},${34})` : c === "_" ? "#3a3d44" : c === "#" ? "#111" : "#2a2d34";
        g.fillRect(x * cell, y * cell, cell, cell);
      }
    speckle(g, size, size, 160000, 0.12);
    // indoor floor tiles
    g.strokeStyle = "rgba(0,0,0,0.35)";
    g.lineWidth = 2;
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++)
        if (at(x, y) === "_") {
          g.strokeRect(x * cell + 1, y * cell + 1, cell / 2 - 2, cell / 2 - 2);
          g.strokeRect(x * cell + cell / 2 + 1, y * cell + cell / 2 + 1, cell / 2 - 2, cell / 2 - 2);
        }
    // grass tufts and stones in the field
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      if (at(Math.floor(x / cell), Math.floor(y / cell)) !== ",") continue;
      g.fillStyle = Math.random() < 0.7 ? `rgba(${70 + Math.random() * 30},${90 + Math.random() * 40},50,0.55)` : "rgba(120,115,105,0.5)";
      g.fillRect(x, y, 2 + Math.random() * 3, 2 + Math.random() * 5);
    }
    // road edges + dashed centre lines
    g.strokeStyle = "rgba(230,200,90,0.55)";
    g.lineWidth = 5;
    g.setLineDash([40, 30]);
    g.beginPath();
    g.moveTo(cell, 24 * cell);
    g.lineTo(size - cell, 24 * cell);
    g.moveTo(24 * cell, cell);
    g.lineTo(24 * cell, size - cell);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = "rgba(220,220,220,0.3)";
    g.lineWidth = 3;
    for (const [x0, y0, x1, y1] of [[1, 22, 47, 22], [1, 26, 47, 26], [22, 1, 22, 47], [26, 1, 26, 47]]) {
      g.beginPath();
      g.moveTo(x0 * cell, y0 * cell);
      g.lineTo(x1 * cell, y1 * cell);
      g.stroke();
    }
    // concrete expansion joints in the yards
    g.strokeStyle = "rgba(0,0,0,0.4)";
    g.lineWidth = 2;
    for (let y = 0; y < MAP_H; y += 2)
      for (let x = 0; x < MAP_W; x += 2)
        if (at(x, y) === "." || at(x, y) === "L" || at(x, y) === "S") g.strokeRect(x * cell, y * cell, cell * 2, cell * 2);
    // cracks, oil and puddles
    for (let i = 0; i < 120; i++) {
      let x = Math.random() * size;
      let y = Math.random() * size;
      g.strokeStyle = "rgba(0,0,0,0.5)";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (Math.random() - 0.5) * 50;
        y += (Math.random() - 0.5) * 50;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 14 + Math.random() * 46;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const wet = Math.random() < 0.4;
      grad.addColorStop(0, wet ? "rgba(120,140,170,0.22)" : "rgba(0,0,0,0.45)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    // road furniture: manholes, storm drains at the kerb, lane arrows, skid marks
    const road = (x: number, y: number) => at(Math.floor(x / cell), Math.floor(y / cell)) === "=";
    const manhole = (x: number, y: number) => {
      g.fillStyle = "#16181c";
      g.beginPath();
      g.arc(x, y, 22, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(120,125,135,0.5)";
      g.lineWidth = 2;
      g.stroke();
      g.strokeStyle = "rgba(90,95,105,0.45)";
      g.lineWidth = 1.5;
      for (let k = -16; k <= 16; k += 6) {
        g.beginPath();
        g.moveTo(x + k, y - Math.sqrt(22 * 22 - k * k) + 3);
        g.lineTo(x + k, y + Math.sqrt(22 * 22 - k * k) - 3);
        g.stroke();
      }
    };
    for (const [mx, my] of [[8, 23.5], [38, 24.6], [23.4, 8], [24.6, 37], [16, 24.5], [23.5, 43]]) manhole(mx * cell, my * cell);
    const drain = (x: number, y: number, vertical: boolean) => {
      const w = vertical ? 12 : 40;
      const h = vertical ? 40 : 12;
      g.fillStyle = "#0d0e11";
      g.fillRect(x - w / 2, y - h / 2, w, h);
      g.fillStyle = "rgba(110,115,125,0.55)";
      for (let k = 0; k < 6; k++) vertical ? g.fillRect(x - w / 2, y - h / 2 + 4 + k * 6, w, 2) : g.fillRect(x - w / 2 + 4 + k * 6, y - h / 2, 2, h);
    };
    for (let i = 3; i < MAP_W - 3; i += 7) {
      if (road(i * cell, 22.1 * cell)) drain(i * cell, 22 * cell + 8, false);
      if (road(i * cell, 25.9 * cell)) drain(i * cell + 30, 26 * cell - 8, false);
      if (road(22.1 * cell, i * cell)) drain(22 * cell + 8, i * cell + 20, true);
      if (road(25.9 * cell, i * cell)) drain(26 * cell - 8, i * cell, true);
    }
    const arrow = (x: number, y: number, a: number) => {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.fillStyle = "rgba(230,230,225,0.32)";
      g.fillRect(-46, -5, 60, 10);
      g.beginPath();
      g.moveTo(14, -20);
      g.lineTo(46, 0);
      g.lineTo(14, 20);
      g.fill();
      g.restore();
    };
    for (const k of [6, 16, 33, 42]) {
      arrow(k * cell, 23 * cell, Math.PI); // westbound lane
      arrow(k * cell, 25 * cell, 0);
      arrow(23 * cell, k * cell, -Math.PI / 2);
      arrow(25 * cell, k * cell, Math.PI / 2);
    }
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.lineWidth = 7;
    for (let i = 0; i < 7; i++) {
      // a car that braked hard: two parallel black curves
      const x0 = (4 + Math.random() * 40) * cell;
      const y0 = (22.6 + Math.random() * 2.6) * cell;
      if (!road(x0, y0)) continue;
      const len = 120 + Math.random() * 180;
      const bend = (Math.random() - 0.5) * 60;
      for (const off of [0, 22]) {
        g.beginPath();
        g.moveTo(x0, y0 + off);
        g.quadraticCurveTo(x0 + len / 2, y0 + off + bend, x0 + len, y0 + off + bend * 0.4);
        g.stroke();
      }
    }
    // tyre tracks rutted into the dirt field
    g.strokeStyle = "rgba(25,20,12,0.4)";
    g.lineWidth = 9;
    for (const off of [0, 30]) {
      g.beginPath();
      g.moveTo(26 * cell, 27 * cell + off);
      g.bezierCurveTo(32 * cell, 30 * cell + off, 30 * cell, 38 * cell + off, 38 * cell, 46 * cell + off);
      g.stroke();
    }
    // litter: paper scraps on concrete, dead leaves in the field
    for (let i = 0; i < 700; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const c = at(Math.floor(x / cell), Math.floor(y / cell));
      if (WALL_CHARS.includes(c) || c === "=") continue;
      g.save();
      g.translate(x, y);
      g.rotate(Math.random() * Math.PI);
      if (c === ",") {
        g.fillStyle = `rgba(${90 + Math.random() * 40},${55 + Math.random() * 25},25,0.6)`;
        g.beginPath();
        g.ellipse(0, 0, 4 + Math.random() * 3, 2, 0, 0, Math.PI * 2);
        g.fill();
      } else if (Math.random() < 0.25) {
        g.fillStyle = `rgba(${200 + Math.random() * 40},${195 + Math.random() * 40},${180 + Math.random() * 30},0.32)`;
        g.fillRect(-6, -4, 10 + Math.random() * 6, 7 + Math.random() * 5);
      }
      g.restore();
    }
    // loot pads: hazard squares
    for (const [lx, ly] of LOOT_SPOTS) {
      const x0 = lx * cell + 6;
      const y0 = ly * cell + 6;
      const s = cell - 12;
      g.strokeStyle = "rgba(255,190,40,0.55)";
      g.lineWidth = 3;
      g.strokeRect(x0, y0, s, s);
    }
    // district stencils
    g.font = "bold 150px monospace";
    g.fillStyle = "rgba(255,255,255,0.06)";
    for (const [sx, sy, label] of [[6, 21, "YARD"], [31, 3, "WAREHOUSE"], [4, 28, "OFFICES"], [29, 32, "FIELD"]] as const) g.fillText(label, sx * cell, sy * cell);
  });
}

/** Street lamps: a post, a warm glow on the ground, dark during the blackout. Two of them are
 *  failing and flicker; every head has a faint cone of light and a few moths. */
const FLICKER = new Set([2, 7]);
/** 1 = fully on. A failing lamp buzzes, dips, and now and then cuts out for a moment. */
function lampLevel(i: number, t: number) {
  if (!FLICKER.has(i)) return 1;
  const s = Math.sin(t * 2.1 + i * 4.7) * Math.sin(t * 0.73 + i);
  if (s > 0.55) return Math.sin(t * 60 + i) > 0 ? 0.15 : 0.9; // the stutter
  if (s > 0.45) return 0.05; // out
  return 0.85 + Math.sin(t * 31 + i) * 0.08;
}

/** Light falling through damp air under every lamp, in one draw call: brightest at the bulb, gone
 *  at the ground, and soft at the silhouette (faces seen edge-on fade), so it reads as a glow. */
function lampCones() {
  const one = new THREE.ConeGeometry(1.25, 3.1, 18, 1, true);
  const n = one.attributes.position.count;
  const pos = new Float32Array(n * 3 * LAMPS.length);
  const nor = new Float32Array(n * 3 * LAMPS.length);
  const hgt = new Float32Array(n * LAMPS.length);
  const lamp = new Float32Array(n * LAMPS.length);
  const idx: number[] = [];
  const src = one.index!.array;
  LAMPS.forEach(([x, y], k) => {
    for (let v = 0; v < n; v++) {
      const o = (k * n + v) * 3;
      pos[o] = one.attributes.position.getX(v) + x + 0.5;
      pos[o + 1] = one.attributes.position.getY(v) + 1.58;
      pos[o + 2] = one.attributes.position.getZ(v) + y + 0.5;
      nor[o] = one.attributes.normal.getX(v);
      nor[o + 1] = one.attributes.normal.getY(v);
      nor[o + 2] = one.attributes.normal.getZ(v);
      hgt[k * n + v] = one.attributes.position.getY(v) / 3.1 + 0.5;
      lamp[k * n + v] = k;
    }
    for (let t = 0; t < src.length; t++) idx.push(src[t] + k * n);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("h", new THREE.BufferAttribute(hgt, 1));
  g.setAttribute("lamp", new THREE.BufferAttribute(lamp, 1));
  g.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { levels: { value: new Array(LAMPS.length).fill(1) }, color: { value: new THREE.Color("#ffc777") } },
    vertexShader: `attribute float h; attribute float lamp; uniform float levels[${LAMPS.length}];
      varying float vH; varying float vFace; varying float vLevel;
      void main(){
        vH = h;
        vLevel = levels[int(lamp + 0.5)];
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 color; varying float vH; varying float vFace; varying float vLevel;
      void main(){
        float a = pow(vH, 1.8) * pow(vFace, 2.5) * 0.11 * vLevel;
        gl_FragColor = vec4(color * a, 1.0);
      }`,
  });
  return { g, m };
}

const MOTHS_PER = 3;
function Lamps() {
  // every lamp head glows, but only the nearest ones cast real light: a fixed number of lights
  // (no shader recompiles); every light costs on every pixel, so phones light only 2
  const N = TOUCH ? 2 : 6;
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const heads = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const cones = useMemo(lampCones, []);
  // the low graphics tier (weak phones) skips the glow and the moths: extra pixels to fill
  const low = gfx(usePrefs()) === "low";
  const moths = useRef<THREE.Points>(null);
  const mothPos = useMemo(() => new Float32Array(LAMPS.length * MOTHS_PER * 3), []);
  const head = useMemo(() => new THREE.Color("#ffd89a"), []);
  const dark = useMemo(() => new THREE.Color("#222"), []);
  const { camera } = useThree();
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const out = (globalThis as any).__boLightsOut === true;
    const near = LAMPS.map(([x, y], i) => [(x + 0.5 - camera.position.x) ** 2 + (y + 0.5 - camera.position.z) ** 2, i] as const)
      .sort((a, b) => a[0] - b[0])
      .slice(0, N);
    near.forEach(([, li], k) => {
      const l = lights.current[k];
      if (!l) return;
      l.position.set(LAMPS[li][0] + 0.5, 3, LAMPS[li][1] + 0.5);
      l.intensity = out ? 0 : 7 * lampLevel(li, t);
    });
    LAMPS.forEach(([x, y], i) => {
      const lv = out ? 0 : lampLevel(i, t);
      heads.current[i]?.color.copy(dark).lerp(head, lv);
      cones.m.uniforms.levels.value[i] = lv;
      // moths: lazy loops around the bulb, gone when it's dark
      for (let m = 0; m < MOTHS_PER; m++) {
        const j = (i * MOTHS_PER + m) * 3;
        const a = t * (1.6 + m * 0.7) + i * 2 + m * 2.1;
        const r = lv > 0.3 ? 0.22 + 0.12 * Math.sin(t * 3.1 + m) : 0;
        mothPos[j] = x + 0.5 + Math.cos(a) * r;
        mothPos[j + 1] = lv > 0.3 ? 3.05 + Math.sin(a * 1.7) * 0.12 : -10;
        mothPos[j + 2] = y + 0.5 + Math.sin(a * 1.3) * r;
      }
    });
    if (moths.current) moths.current.geometry.attributes.position.needsUpdate = true;
  });
  const mothGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mothPos, 3));
    return g;
  }, [mothPos]);
  return (
    <>
      {LAMPS.map(([x, y], i) => (
        <group key={i} position={[x + 0.5, 0, y + 0.5]}>
          <mesh position={[0, 1.6, 0]}>
            <cylinderGeometry args={[0.05, 0.07, 3.2, 8]} />
            <meshStandardMaterial color="#2a2d33" metalness={0.7} roughness={0.4} />
          </mesh>
          <mesh position={[0, 3.2, 0]}>
            <boxGeometry args={[0.36, 0.1, 0.22]} />
            <meshBasicMaterial ref={(m) => (heads.current[i] = m)} color="#ffd89a" toneMapped={false} />
          </mesh>
        </group>
      ))}
      {!low && <mesh geometry={cones.g} material={cones.m} frustumCulled={false} />}
      {!low && (
        <points ref={moths} geometry={mothGeo} frustumCulled={false}>
          <pointsMaterial size={0.035} color="#fff1cf" sizeAttenuation transparent opacity={0.8} />
        </points>
      )}
      {Array.from({ length: N }, (_, k) => (
        <pointLight key={k} ref={(l) => (lights.current[k] = l)} color="#ffc777" intensity={7} distance={6.5} decay={1.4} />
      ))}
    </>
  );
}

/** The two 2x2 towers: a water tower over the plaza, a watchtower with a sweeping searchlight. */
function Towers({ boxes }: { boxes: WallBox[] }) {
  const towers = boxes.filter((b) => b.kind === "tower" && b.w === 2 && b.h === 2);
  const beam = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const wt = towers.find((t) => t.x > 30);
    if (!wt || !beam.current) return;
    const a = clock.elapsedTime * 0.5;
    target.position.set(wt.x + 1 + Math.cos(a) * 8, 0, wt.y + 1 + Math.sin(a) * 8);
    target.updateMatrixWorld();
    beam.current.target = target;
    beam.current.intensity = (globalThis as any).__boLightsOut === true ? 0 : 40;
  });
  return (
    <>
      {towers.map((t, i) => {
        const cx = t.x + 1;
        const cz = t.y + 1;
        const water = t.x < 30;
        return (
          <group key={i} position={[cx, 0, cz]}>
            {[-0.8, 0.8].flatMap((dx) =>
              [-0.8, 0.8].map((dz) => (
                <mesh key={`${dx}${dz}`} position={[dx, water ? 2.6 : 2.2, dz]}>
                  <boxGeometry args={[0.14, water ? 5.2 : 4.4, 0.14]} />
                  <meshStandardMaterial color="#3a3d44" metalness={0.6} roughness={0.5} />
                </mesh>
              )),
            )}
            {water ? (
              <mesh position={[0, 6.1, 0]} castShadow>
                <cylinderGeometry args={[1.4, 1.4, 1.8, 24]} />
                <meshStandardMaterial color="#5a6270" metalness={0.5} roughness={0.5} />
              </mesh>
            ) : (
              <>
                <mesh position={[0, 4.7, 0]} castShadow>
                  <boxGeometry args={[2.2, 1.2, 2.2]} />
                  <meshStandardMaterial color="#3d4630" roughness={0.8} />
                </mesh>
                <mesh position={[0, 5.45, 0]}>
                  <coneGeometry args={[1.8, 0.6, 4]} />
                  <meshStandardMaterial color="#2a3022" roughness={0.8} />
                </mesh>
                {!TOUCH && <spotLight ref={beam} position={[0, 5, 0]} angle={0.22} penumbra={0.3} distance={16} decay={1} intensity={40} color="#eaf2ff" />}
              </>
            )}
          </group>
        );
      })}
      <primitive object={target} />
    </>
  );
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
  // a unit box drawn in two calls instead of six: the four walls, then the roof (no floor face,
  // nobody sees under a wall). Six face groups cost ~400 extra draw calls across the Yard.
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const idx = g.index!.array;
    const face = (f: number) => Array.from(idx.slice(f * 6, f * 6 + 6)); // faces: +x -x +y -y +z -z
    const walls = [...face(0), ...face(1), ...face(4), ...face(5)];
    g.setIndex([...walls, ...face(2)]);
    g.clearGroups();
    g.addGroup(0, walls.length, 0);
    g.addGroup(walls.length, 6, 1);
    return g;
  }, []);
  const materials = useMemo(() => {
    const cont = CONTAINER_COLORS.map(containerTex);
    const conc = [0, 1, 2, 3].map(concreteTex);
    const border = borderTex();
    const bld = [0, 1, 2, 3].map(buildingTex);
    const fence = fenceTex();
    const crate = crateTex();
    return boxes.map((b) => {
      let base: THREE.Texture;
      let rough = 0.85;
      let metal = 0.1;
      if (b.kind === "container") {
        base = cont[b.tone];
        rough = 0.55;
        metal = 0.45;
      } else if (b.kind === "border") base = border;
      else if (b.kind === "building") base = bld[b.tone];
      else if (b.kind === "fence") base = fence;
      else if (b.kind === "crates") base = crate;
      else base = conc[b.tone];
      const map = base.clone();
      map.needsUpdate = true;
      // repeat along the long side so ribs/panels keep their scale
      const per = b.kind === "fence" ? 1 : b.kind === "crates" ? 0.8 : 2;
      map.repeat.set(Math.max(1, Math.max(b.w, b.h) / per), b.kind === "fence" ? 1.4 : 1);
      const see = b.kind === "fence";
      const side = new THREE.MeshStandardMaterial({
        map,
        roughness: rough,
        metalness: see ? 0.6 : metal,
        color: lit ? "#bfc6d6" : "#ffffff",
        transparent: see,
        alphaTest: see ? 0.3 : 0,
        side: see ? THREE.DoubleSide : THREE.FrontSide,
      });
      const top = see
        ? new THREE.MeshBasicMaterial({ visible: false })
        : new THREE.MeshStandardMaterial({ map: b.kind === "crates" ? map : null, color: b.kind === "container" ? "#3a3f4a" : b.kind === "building" ? "#2b2e35" : "#4a4f5a", roughness: 0.9 });
      return [side, top]; // walls, roof (see the geometry above)
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
      <mesh rotation-x={-Math.PI / 2} position={[MAP_W / 2, 0, MAP_H / 2]} receiveShadow>
        <planeGeometry args={[MAP_W, MAP_H]} />
        <meshStandardMaterial map={floor} roughness={0.88} metalness={0.05} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[MAP_W / 2, -0.01, MAP_H / 2]}>
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
      <Dressing boxes={boxes} />
      <Lamps />
      <Towers boxes={boxes} />
    </group>
  );
}
