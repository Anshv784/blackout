// Set dressing for the Yard: power cables sagging between the lamp posts, coiled razor wire on the
// border wall, rain puddles under the lamps, and graffiti and posters on the walls (found with your
// torch). All static and decorative: nothing here blocks a bullet or a player. One draw call each.
import { useMemo } from "react";
import * as THREE from "three";
import { LAMPS, MAP_ROWS, MAP_W, MAP_H, WALL_CHARS } from "../game/gen";
import type { WallBox } from "./Arena";

const rnd = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};
const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H ? MAP_ROWS[y][x] : "#");
const wall = (x: number, y: number) => WALL_CHARS.includes(at(x, y));

/** lamp head height (see Lamps in Arena) */
const HEAD_Y = 3.15;

// ------------------------------------------------------------------ cables

function Cables() {
  const geo = useMemo(() => {
    const pts: number[] = [];
    const seen = new Set<string>();
    // each lamp to its nearest neighbour or two, if they're close enough to string a line
    LAMPS.forEach(([x, y], i) => {
      const near = LAMPS.map(([u, v], j) => [Math.hypot(u - x, v - y), j] as const)
        .filter(([d, j]) => j !== i && d < 13)
        .sort((a, b) => a[0] - b[0])
        .slice(0, 2);
      for (const [d, j] of near) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const [u, v] = LAMPS[j];
        const sag = 0.25 + d * 0.035;
        const N = 18;
        let px = x + 0.5;
        let py = HEAD_Y;
        let pz = y + 0.5;
        for (let k = 1; k <= N; k++) {
          const t = k / N;
          const nx = x + 0.5 + (u - x) * t;
          const nz = y + 0.5 + (v - y) * t;
          const ny = HEAD_Y - sag * (1 - (2 * t - 1) ** 2);
          pts.push(px, py, pz, nx, ny, nz);
          px = nx;
          py = ny;
          pz = nz;
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#0c0d10" transparent opacity={0.9} />
    </lineSegments>
  );
}

// ------------------------------------------------------------------ razor wire on the border

function RazorWire({ boxes }: { boxes: WallBox[] }) {
  const geo = useMemo(() => {
    const pts: number[] = [];
    for (const b of boxes) {
      if (b.kind !== "border") continue;
      const along = b.w >= b.h; // the wall runs along x or along z
      const len = along ? b.w : b.h;
      const top = b.height + 0.16;
      const R = 0.15;
      // a coil: a helix wound along the top of the wall
      const turns = len * 3.2;
      const N = Math.ceil(turns * 10);
      let prev: [number, number, number] | null = null;
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const a = t * turns * Math.PI * 2;
        const s = t * len;
        const off = Math.cos(a) * R;
        const p: [number, number, number] = along
          ? [b.x + s, top + Math.sin(a) * R, b.y + b.h / 2 + off]
          : [b.x + b.w / 2 + off, top + Math.sin(a) * R, b.y + s];
        if (prev) pts.push(...prev, ...p);
        prev = p;
      }
      // posts holding it up, every 3 tiles
      for (let s = 0.5; s < len; s += 3) {
        const [px, pz] = along ? [b.x + s, b.y + b.h / 2] : [b.x + b.w / 2, b.y + s];
        pts.push(px, b.height, pz, px, top + R + 0.05, pz);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [boxes]);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#5d6470" transparent opacity={0.75} />
    </lineSegments>
  );
}

// ------------------------------------------------------------------ puddles

function puddleTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const r = rnd(7);
  // an uneven blob: overlapping soft circles (white = water, read as alpha)
  for (let i = 0; i < 9; i++) {
    const x = 64 + (r() - 0.5) * 52;
    const y = 64 + (r() - 0.5) * 30;
    const rad = 18 + r() * 22;
    const grad = g.createRadialGradient(x, y, rad * 0.4, x, y, rad);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

function Puddles() {
  const { geo, mat } = useMemo(() => {
    const r = rnd(4242);
    const spots: [number, number, number, number][] = [];
    for (const [lx, ly] of LAMPS) {
      for (let k = 0; k < 2; k++) {
        const x = lx + 0.5 + (r() - 0.5) * 3.2;
        const z = ly + 0.5 + (r() - 0.5) * 3.2;
        if (wall(Math.floor(x), Math.floor(z)) || at(Math.floor(x), Math.floor(z)) === ",") continue;
        spots.push([x, z, 0.8 + r() * 0.9, r() * Math.PI]);
      }
    }
    // one merged mesh: a flat quad per puddle
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    spots.forEach(([x, z, s, a], i) => {
      const c = Math.cos(a) * s;
      const sn = Math.sin(a) * s;
      const corners: [number, number, number, number][] = [
        [-1, -0.6, 0, 0],
        [1, -0.6, 1, 0],
        [1, 0.6, 1, 1],
        [-1, 0.6, 0, 1],
      ];
      for (const [u, v, tu, tv] of corners) {
        pos.push(x + u * c - v * sn, 0.006, z + u * sn + v * c);
        uv.push(tu, tv);
      }
      const o = i * 4;
      idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // a wet sheen, smoother than the concrete around it: catches lamps and torches as highlights
    const m = new THREE.MeshStandardMaterial({
      color: "#2b3646",
      roughness: 0.08,
      metalness: 0.15,
      opacity: 0.5,
      alphaMap: puddleTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      side: THREE.DoubleSide,
    });
    return { geo: g, mat: m };
  }, []);
  return <mesh geometry={geo} material={mat} />;
}

// ------------------------------------------------------------------ graffiti and posters

const ATLAS_COLS = 4;
const ATLAS_ROWS = 2;
/** cells 0-5 spray paint, 6-7 paper posters */
function wallArtAtlas() {
  const W = 1024;
  const H = 512;
  const cw = W / ATLAS_COLS;
  const ch = H / ATLAS_ROWS;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const r = rnd(99);
  const spray = (cx: number, cy: number, text: string, color: string, size: number, tilt: number) => {
    g.save();
    g.translate(cx, cy);
    g.rotate(tilt);
    g.font = `900 ${size}px Impact, "Arial Black", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    // overspray halo, then the letters, then drips
    g.shadowColor = color;
    g.shadowBlur = 14;
    g.fillStyle = color;
    g.globalAlpha = 0.85;
    g.fillText(text, 0, 0);
    g.shadowBlur = 0;
    g.globalAlpha = 0.9;
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.lineWidth = 2;
    g.strokeText(text, 0, 0);
    const w = g.measureText(text).width;
    g.fillStyle = color;
    g.globalAlpha = 0.7;
    for (let i = 0; i < 6; i++) {
      const x = -w / 2 + r() * w;
      g.fillRect(x, size * 0.3, 2, 8 + r() * 26);
    }
    g.restore();
    g.globalAlpha = 1;
  };
  const cell = (i: number) => [(i % ATLAS_COLS) * cw, Math.floor(i / ATLAS_COLS) * ch] as const;
  const tags: [string, string, number][] = [
    ["LIGHTS OUT", "#ff3b5c", 46],
    ["RUN", "#ffd166", 92],
    ["THEY HEAR YOU", "#7cf0ff", 32],
    ["NYX WAS HERE", "#c77dff", 34],
    ["DON'T LOOK", "#9ae64a", 44],
    ["13", "#ff8c42", 110],
  ];
  tags.forEach(([t, col, size], i) => {
    const [x, y] = cell(i);
    spray(x + cw / 2, y + ch / 2, t, col, size, (r() - 0.5) * 0.25);
  });
  // an eye stencil next to "THEY HEAR YOU"
  {
    const [x, y] = cell(2);
    g.strokeStyle = "rgba(124,240,255,0.8)";
    g.lineWidth = 5;
    g.beginPath();
    g.ellipse(x + cw / 2, y + ch / 2 + 62, 34, 15, 0, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "rgba(124,240,255,0.85)";
    g.beginPath();
    g.arc(x + cw / 2, y + ch / 2 + 62, 9, 0, Math.PI * 2);
    g.fill();
  }
  // posters: worn paper, a headline, a silhouette or a notice
  const poster = (i: number, title: string, body: string[], face: boolean) => {
    const [x, y] = cell(i);
    const px = x + 38;
    const py = y + 14;
    const pw = cw - 76;
    const pph = ch - 28;
    g.fillStyle = "#d9d2bf";
    g.fillRect(px, py, pw, pph);
    // grime and a torn corner
    for (let k = 0; k < 900; k++) {
      g.fillStyle = `rgba(60,50,30,${r() * 0.12})`;
      g.fillRect(px + r() * pw, py + r() * pph, 2, 2);
    }
    g.fillStyle = "rgba(0,0,0,0)";
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.moveTo(px + pw, py + pph);
    g.lineTo(px + pw - 46, py + pph);
    g.lineTo(px + pw, py + pph - 38);
    g.fill();
    g.restore();
    g.fillStyle = "#1a1a1a";
    g.font = '900 30px Impact, "Arial Black", sans-serif';
    g.textAlign = "center";
    g.fillText(title, px + pw / 2, py + 40);
    if (face) {
      // a missing person: head and shoulders in black
      g.beginPath();
      g.arc(px + pw / 2, py + 100, 30, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(px + pw / 2, py + 170, 56, 34, 0, Math.PI, 0);
      g.fill();
    }
    g.font = "bold 15px monospace";
    body.forEach((line, k) => g.fillText(line, px + pw / 2, py + (face ? 196 : 82) + k * 22));
    // tape
    g.fillStyle = "rgba(230,220,170,0.7)";
    g.fillRect(px + pw / 2 - 24, py - 6, 48, 14);
  };
  poster(6, "MISSING", ["LAST SEEN AT THE YARD", "AFTER DARK"], true);
  poster(7, "CURFEW", ["NO ONE OUTSIDE", "AFTER 21:00", "", "LIGHTS ARE CUT", "AT MIDNIGHT", "", "— YARD AUTHORITY"], false);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function WallArt({ boxes }: { boxes: WallBox[] }) {
  const { geo, mat } = useMemo(() => {
    const r = rnd(1337);
    const pos: number[] = [];
    const uv: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    let q = 0;
    /** a quad on a wall face: centre (x, y, z), facing normal (nx, nz), width w, height h, atlas cell */
    const quad = (x: number, y: number, z: number, nx: number, nz: number, w: number, h: number, cellI: number) => {
      // the face's "right" as you stand in front of it, looking at it along -normal
      const rx = nz;
      const rz = -nx;
      const u0 = (cellI % ATLAS_COLS) / ATLAS_COLS;
      const v0 = 1 - (Math.floor(cellI / ATLAS_COLS) + 1) / ATLAS_ROWS;
      const u1 = u0 + 1 / ATLAS_COLS;
      const v1 = v0 + 1 / ATLAS_ROWS;
      const off = 0.012;
      for (const [sx, sy, u, v] of [
        [-1, -1, u0, v0],
        [1, -1, u1, v0],
        [1, 1, u1, v1],
        [-1, 1, u0, v1],
      ] as const) {
        pos.push(x + nx * off + rx * sx * (w / 2), y + sy * (h / 2), z + nz * off + rz * sx * (w / 2));
        uv.push(u, v);
        nor.push(nx, 0, nz);
      }
      idx.push(q, q + 1, q + 2, q, q + 2, q + 3);
      q += 4;
    };
    // candidate faces: every exposed tile side of the border and the buildings
    const faces: { x: number; z: number; nx: number; nz: number; top: number; kind: WallBox["kind"] }[] = [];
    for (const b of boxes) {
      if (b.kind !== "border" && b.kind !== "building" && b.kind !== "container") continue;
      for (let ty = b.y; ty < b.y + b.h; ty++)
        for (let tx = b.x; tx < b.x + b.w; tx++)
          for (const [nx, nz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            if (wall(tx + nx, ty + nz) || at(tx + nx, ty + nz) === "#") continue;
            if (tx + nx < 0 || ty + nz < 0 || tx + nx >= MAP_W || ty + nz >= MAP_H) continue;
            faces.push({ x: tx + 0.5 + nx * 0.5, z: ty + 0.5 + nz * 0.5, nx, nz, top: b.height, kind: b.kind });
          }
    }
    // shuffle, then take a spread: tags on walls and containers, posters on buildings
    for (let i = faces.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [faces[i], faces[j]] = [faces[j], faces[i]];
    }
    const used: [number, number][] = [];
    let tagsN = 0;
    let postersN = 0;
    for (const f of faces) {
      if (used.some(([x, z]) => Math.hypot(x - f.x, z - f.z) < 4)) continue;
      if (f.kind === "building" && postersN < 14) {
        quad(f.x, Math.min(1.2, f.top - 0.45), f.z, f.nx, f.nz, 0.55, 0.55, 6 + (postersN % 2));
        postersN++;
      } else if (f.kind !== "building" && tagsN < 26) {
        const w = 1.2 + r() * 0.8;
        const h = Math.min(w / 2, f.top - 0.2);
        quad(f.x, Math.min(0.75 + r() * 0.3, f.top - h / 2 - 0.05), f.z, f.nx, f.nz, w, h, Math.floor(r() * 6));
        tagsN++;
      } else continue;
      used.push([f.x, f.z]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    const m = new THREE.MeshStandardMaterial({
      map: wallArtAtlas(),
      transparent: true,
      depthWrite: false,
      roughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    return { geo: g, mat: m };
  }, [boxes]);
  return <mesh geometry={geo} material={mat} />;
}

export function Dressing({ boxes }: { boxes: WallBox[] }) {
  return (
    <>
      <Cables />
      <RazorWire boxes={boxes} />
      <Puddles />
      <WallArt boxes={boxes} />
    </>
  );
}
