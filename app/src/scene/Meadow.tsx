// The Meadow: fields at night. Same rules as the Yard, different ground: grass you can see sway,
// tall grass you can crouch in, hedgerows, rocks, tree groves, a farmhouse and barn, and a creek
// with two plank crossings. Every blade is an instance; the wind runs on the GPU.
import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MAP_W, MAP_H } from "../game/gen";
import { MAPS } from "../game/maps";
import { wallBoxes, type WallBox } from "./Arena";
import { TOUCH } from "../game/device";

const MAP = MAPS[1];
const ROWS = MAP.rows;
const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H ? ROWS[y][x] : "#");
const rnd = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

// ------------------------------------------------------------------ ground
/** Soil and grass painted per tile, blended across tile edges so no grid shows. */
function groundTexture() {
  const px = 40;
  const c = document.createElement("canvas");
  c.width = MAP_W * px;
  c.height = MAP_H * px;
  const g = c.getContext("2d")!;
  const r = rnd(9);
  // base: dark loam
  g.fillStyle = "#1d2414";
  g.fillRect(0, 0, c.width, c.height);
  const tone: Record<string, string> = { ".": "#2c3a1c", ",": "#25331a", "=": "#5a4630", _: "#4a3a28", S: "#2c3a1c", L: "#2c3a1c", l: "#2c3a1c", W: "#14201a", H: "#1f2a16", R: "#2a2f22", T: "#1d2716", B: "#3a2f22", "#": "#141a10" };
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      const ch = at(x, y);
      g.fillStyle = tone[ch] ?? "#2c3a1c";
      // soft-edged tiles: a slightly larger blurred square, so neighbours bleed into each other
      g.globalAlpha = 0.85;
      g.fillRect(x * px - 6, y * px - 6, px + 12, px + 12);
    }
  g.globalAlpha = 1;
  g.filter = "blur(10px)";
  g.drawImage(c, 0, 0);
  g.filter = "none";
  // mottling: patches of lighter and darker growth, bare earth, clover
  for (let i = 0; i < 2600; i++) {
    const x = r() * c.width;
    const y = r() * c.height;
    const ch = at(Math.floor(x / px), Math.floor(y / px));
    if (ch === "W") continue;
    const rad = 4 + r() * 22;
    const k = r();
    g.fillStyle = k < 0.45 ? `rgba(70,92,40,${0.06 + r() * 0.1})` : k < 0.75 ? `rgba(10,14,6,${0.08 + r() * 0.12})` : `rgba(92,74,48,${0.05 + r() * 0.08})`;
    g.beginPath();
    g.ellipse(x, y, rad, rad * (0.5 + r() * 0.6), r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // planks on the farm floors and the crossings
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      const ch = at(x, y);
      if (ch !== "_" && ch !== "=") continue;
      for (let k = 0; k < 4; k++) {
        g.fillStyle = k % 2 ? "rgba(0,0,0,0.18)" : "rgba(255,220,170,0.05)";
        g.fillRect(x * px, y * px + k * (px / 4), px, 1.5);
      }
    }
  // muddy banks along the creek
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (at(x, y) !== "W") continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (at(x + dx, y + dy) === "W") continue;
        g.fillStyle = "rgba(48,38,24,0.55)";
        g.beginPath();
        g.ellipse((x + 0.5 + dx * 0.55) * px, (y + 0.5 + dy * 0.55) * px, px * 0.55, px * 0.45, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------ grass
/** One blade: a tapered strip, 5 segments tall, slightly curved. Height 1 (scaled per instance). */
function bladeGeometry() {
  const segs = 5;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const v = i / segs;
    const w = 0.035 * (1 - v * 0.92);
    const bend = v * v * 0.18;
    pos.push(-w, v, bend, w, v, bend);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Lit like everything else (torches, lanterns), with the wind added in the vertex shader. */
function grassMaterial(time: { value: number }) {
  const m = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying float vH;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vH = position.y;
        // wind: a slow swell rolling across the field, plus a quick flutter; the tip moves, the root stays
        vec3 root = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float swell = sin(uTime * 1.3 + root.x * 0.35 + root.z * 0.22) * 0.5 + 0.5;
        float flutter = sin(uTime * 4.1 + root.x * 3.1 + root.z * 2.3) * 0.25;
        float bend = (swell * 0.9 + flutter) * position.y * position.y * 0.32;
        // push in world x/z: undo the blade's own spin so the whole field leans one way
        mat3 inv = transpose(mat3(instanceMatrix));
        transformed += inv * vec3(bend, -abs(bend) * 0.35, bend * 0.45);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vH;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        // dark at the root, sunlit-green to straw at the tip
        diffuseColor.rgb *= mix(0.28, 1.15, smoothstep(0.0, 1.0, vH));`,
      );
  };
  return m;
}

function Grass({ time }: { time: { value: number } }) {
  const mesh = useMemo(() => {
    const per: Record<string, number> = TOUCH ? { ".": 9, ",": 16, S: 6, L: 4, l: 4 } : { ".": 34, ",": 60, S: 22, L: 14, l: 14 };
    const spots: [number, number, boolean][] = [];
    for (let y = 1; y < MAP_H - 1; y++)
      for (let x = 1; x < MAP_W - 1; x++) {
        const ch = at(x, y);
        const n = per[ch];
        if (!n) continue;
        for (let k = 0; k < n; k++) spots.push([x, y, ch === ","]);
      }
    const geo = bladeGeometry();
    const mat = grassMaterial(time);
    const im = new THREE.InstancedMesh(geo, mat, spots.length);
    const r = rnd(42);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const e = new THREE.Euler();
    const col = new THREE.Color();
    const greens = ["#4f6b2a", "#5c7a31", "#456326", "#6a7f35", "#7d8a3c", "#3d5a22"];
    spots.forEach(([x, y, tall], i) => {
      p.set(x + r(), 0, y + r());
      e.set((r() - 0.5) * 0.35, r() * Math.PI * 2, (r() - 0.5) * 0.35);
      q.setFromEuler(e);
      const h = tall ? 0.55 + r() * 0.45 : 0.18 + r() * 0.22;
      const w = tall ? 1.2 + r() * 0.5 : 0.9 + r() * 0.5;
      s.set(w, h, w);
      m4.compose(p, q, s);
      im.setMatrixAt(i, m4);
      col.set(greens[Math.floor(r() * greens.length)]);
      if (tall) col.lerp(new THREE.Color("#8a8a44"), r() * 0.35); // tall grass going to seed
      col.multiplyScalar(0.8 + r() * 0.35);
      im.setColorAt(i, col);
    });
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    im.receiveShadow = true;
    return im;
  }, [time]);
  useEffect(() => () => {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }, [mesh]);
  return <primitive object={mesh} />;
}

// ------------------------------------------------------------------ cover: hedges, rocks, trees
function lumpy(radius: number, detail: number, amount: number, seed: number) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const r = rnd(seed);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  // displace each unique vertex position the same way (shared positions stay joined)
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) {
      k = 1 + (r() - 0.5) * amount;
      seen.set(key, k);
    }
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function leafTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3d5a2a";
  g.fillRect(0, 0, 256, 256);
  const r = rnd(5);
  for (let i = 0; i < 1400; i++) {
    const k = r();
    g.fillStyle = k < 0.4 ? "#4f7234" : k < 0.7 ? "#2a4019" : k < 0.9 ? "#628a3e" : "#7a9c4a";
    g.beginPath();
    g.ellipse(r() * 256, r() * 256, 2 + r() * 5, 1.5 + r() * 3, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function woodTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#4a3624";
  g.fillRect(0, 0, 256, 256);
  const r = rnd(11);
  for (let x = 0; x < 256; x += 32) {
    g.fillStyle = `rgba(0,0,0,${0.25 + r() * 0.2})`;
    g.fillRect(x, 0, 2, 256);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? "255,220,170" : "0,0,0"},${0.03 + r() * 0.05})`;
      g.fillRect(x + 3 + r() * 26, r() * 256, 1, 20 + r() * 80);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Instanced lumps: hedge clumps, rocks and tree canopies, each kind one draw call. */
function Lumps({ items, geo, mat, cast = true }: { items: { p: [number, number, number]; s: [number, number, number]; r: number }[]; geo: THREE.BufferGeometry; mat: THREE.Material; cast?: boolean }) {
  const mesh = useMemo(() => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    const m4 = new THREE.Matrix4();
    items.forEach((it, i) => {
      m4.compose(new THREE.Vector3(...it.p), new THREE.Quaternion().setFromEuler(new THREE.Euler(it.r * 0.3, it.r * 6.28, it.r * 0.2)), new THREE.Vector3(...it.s));
      im.setMatrixAt(i, m4);
    });
    im.count = items.length;
    im.castShadow = cast;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    return im;
  }, [items, geo, mat, cast]);
  return <primitive object={mesh} />;
}

function Cover({ boxes }: { boxes: WallBox[] }) {
  const parts = useMemo(() => {
    const r = rnd(77);
    const hedge: { p: [number, number, number]; s: [number, number, number]; r: number }[] = [];
    const rock: typeof hedge = [];
    const canopy: typeof hedge = [];
    const trunk: typeof hedge = [];
    for (const b of boxes) {
      if (b.kind === "hedge") {
        // a row of overlapping clumps over the hedge's footprint
        for (let yy = 0; yy < b.h; yy++)
          for (let xx = 0; xx < b.w; xx++)
            for (let k = 0; k < 3; k++) {
              const s = 0.45 + r() * 0.2;
              hedge.push({ p: [b.x + xx + 0.2 + r() * 0.6, 0.45 + r() * 0.75, b.y + yy + 0.2 + r() * 0.6], s: [s, s * (0.9 + r() * 0.3), s], r: r() });
            }
      } else if (b.kind === "rock") {
        for (let yy = 0; yy < b.h; yy++)
          for (let xx = 0; xx < b.w; xx++) {
            const s = 0.5 + r() * 0.25;
            rock.push({ p: [b.x + xx + 0.5 + (r() - 0.5) * 0.2, s * 0.55, b.y + yy + 0.5 + (r() - 0.5) * 0.2], s: [s * (1 + r() * 0.3), s * (0.8 + r() * 0.5), s], r: r() });
            if (r() < 0.6) rock.push({ p: [b.x + xx + r(), 0.12, b.y + yy + r()], s: [0.22, 0.16, 0.2], r: r() });
          }
      } else if (b.kind === "tree" || b.kind === "border") {
        // groves, and a tree line round the edge of the map
        const step = b.kind === "border" ? 1.6 : 1;
        for (let yy = 0; yy < b.h; yy += step)
          for (let xx = 0; xx < b.w; xx += step) {
            const x = b.x + xx + 0.5 + (r() - 0.5) * 0.4;
            const z = b.y + yy + 0.5 + (r() - 0.5) * 0.4;
            const h = 2.2 + r() * 1.4;
            trunk.push({ p: [x, h * 0.35, z], s: [0.13 + r() * 0.05, h * 0.7, 0.13], r: 0 });
            // dense undergrowth round the trunk fills the tile, so what blocks you is what you see
            if (b.kind === "tree")
              for (let k = 0; k < 4; k++) {
                const a = (k / 4) * Math.PI * 2 + r();
                const sz = 0.34 + r() * 0.1;
                hedge.push({ p: [b.x + xx + 0.5 + Math.cos(a) * 0.24, 0.28 + r() * 0.12, b.y + yy + 0.5 + Math.sin(a) * 0.24], s: [sz, sz * 0.8, sz], r: r() });
              }
            for (let k = 0; k < 3; k++) {
              const s = 0.8 + r() * 0.5 - k * 0.15;
              canopy.push({ p: [x + (r() - 0.5) * 0.5, h * 0.65 + k * 0.55, z + (r() - 0.5) * 0.5], s: [s, s * 0.85, s], r: r() });
            }
          }
      }
    }
    return { hedge, rock, canopy, trunk };
  }, [boxes]);
  const mats = useMemo(() => {
    const leaf = leafTexture();
    return {
      hedge: new THREE.MeshStandardMaterial({ map: leaf, color: "#c8d6b4", roughness: 0.85 }),
      canopy: new THREE.MeshStandardMaterial({ map: leaf, color: "#a9bf98", roughness: 0.85 }),
      rock: new THREE.MeshStandardMaterial({ color: "#8a8c88", roughness: 0.92, flatShading: true }),
      trunk: new THREE.MeshStandardMaterial({ color: "#3b2c1f", roughness: 0.95 }),
    };
  }, []);
  const geos = useMemo(
    () => ({ clump: lumpy(1, 2, 0.35, 3), rock: lumpy(1, 1, 0.45, 8), trunk: new THREE.CylinderGeometry(0.6, 1, 1, 7) }),
    [],
  );
  return (
    <>
      <Lumps items={parts.hedge} geo={geos.clump} mat={mats.hedge} />
      <Lumps items={parts.rock} geo={geos.rock} mat={mats.rock} />
      <Lumps items={parts.trunk} geo={geos.trunk} mat={mats.trunk} />
      <Lumps items={parts.canopy} geo={geos.clump} mat={mats.canopy} />
    </>
  );
}

// ------------------------------------------------------------------ farm buildings, creek, crossings
function Farm({ boxes }: { boxes: WallBox[] }) {
  const wood = useMemo(woodTexture, []);
  const walls = boxes.filter((b) => b.kind === "building");
  return (
    <>
      {walls.map((b, i) => {
        const tex = wood.clone();
        tex.repeat.set(Math.max(b.w, b.h), b.height);
        tex.needsUpdate = true;
        return (
          <mesh key={i} position={[b.x + b.w / 2, b.height / 2, b.y + b.h / 2]} castShadow receiveShadow>
            <boxGeometry args={[b.w, b.height, b.h]} />
            <meshStandardMaterial map={tex} roughness={0.85} />
          </mesh>
        );
      })}
    </>
  );
}

function Creek({ time }: { time: { value: number } }) {
  const geo = useMemo(() => {
    // one quad per water tile, merged; sits a little below the ground
    const pos: number[] = [];
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        if (at(x, y) !== "W") continue;
        pos.push(x, 0, y, x + 1, 0, y, x, 0, y + 1, x + 1, 0, y, x + 1, 0, y + 1, x, 0, y + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.scale(1, 1, 1);
    return g;
  }, []);
  const mat = useMemo(() => {
    // shallow enough to wade: a clear, slightly murky surface over a stony bed
    const m = new THREE.MeshStandardMaterial({ color: "#13303a", roughness: 0.1, metalness: 0.55, transparent: true, opacity: 0.82, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vW;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying vec3 vW;")
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
          // ripples drifting downstream
          float r1 = sin(vW.x * 7.0 + vW.z * 3.0 - uTime * 1.6);
          float r2 = sin(vW.z * 9.0 - vW.x * 2.0 - uTime * 2.3);
          normal = normalize(normal + vec3(r1 * 0.06, 0.0, r2 * 0.06));`,
        );
    };
    return m;
  }, [time]);
  const bed = useMemo(() => {
    const out: { p: [number, number, number]; s: [number, number, number]; r: number }[] = [];
    const r = rnd(19);
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        if (at(x, y) !== "W") continue;
        for (let k = 0; k < 3; k++) {
          const sz = 0.06 + r() * 0.08;
          out.push({ p: [x + r(), -0.1, y + r()], s: [sz, sz * 0.5, sz * 0.8], r: r() });
        }
      }
    return out;
  }, []);
  const stone = useMemo(() => ({ g: lumpy(1, 0, 0.3, 4), m: new THREE.MeshStandardMaterial({ color: "#4a4c48", roughness: 0.9, flatShading: true }) }), []);
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[MAP_W / 2, -0.14, MAP_H / 2]}>
        <planeGeometry args={[MAP_W, MAP_H]} />
        <meshStandardMaterial color="#1c2018" roughness={1} />
      </mesh>
      <Lumps items={bed} geo={stone.g} mat={stone.m} cast={false} />
      <mesh geometry={geo} material={mat} position={[0, -0.04, 0]} receiveShadow />
    </>
  );
}

function Crossings() {
  const planks = useMemo(() => {
    const out: [number, number][] = [];
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (at(x, y) === "=") out.push([x, y]);
    return out;
  }, []);
  return (
    <>
      {planks.map(([x, y], i) =>
        [0, 1, 2, 3].map((k) => (
          <mesh key={`${i}-${k}`} position={[x + 0.5, 0.04, y + 0.125 + k * 0.25]} castShadow receiveShadow>
            <boxGeometry args={[1, 0.06, 0.22]} />
            <meshStandardMaterial color={k % 2 ? "#5a4430" : "#4d3a28"} roughness={0.9} />
          </mesh>
        )),
      )}
    </>
  );
}

// ------------------------------------------------------------------ lanterns and fireflies
const NEAR_LIGHTS = TOUCH ? 2 : 4;
function Lanterns({ lit }: { lit: boolean }) {
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const glow = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,190,110,0.55)");
    gr.addColorStop(0.4, "rgba(255,160,80,0.16)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  const { camera } = useThree();
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    // the few real lights follow the lanterns nearest the view
    const cam = camera.position;
    const order = MAP.lamps
      .map(([x, y], i) => ({ i, d: (x + 0.5 - cam.x) ** 2 + (y + 0.5 - cam.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, NEAR_LIGHTS);
    order.forEach(({ i }, k) => {
      const l = lights.current[k];
      if (!l) return;
      const [x, y] = MAP.lamps[i];
      l.position.copy(tmp.set(x + 0.5, 1.35, y + 0.5));
      l.intensity = (lit ? 2 : 5.5) * (0.92 + Math.sin(clock.elapsedTime * 9 + i * 3) * 0.05 + Math.sin(clock.elapsedTime * 23 + i) * 0.03);
    });
  });
  return (
    <>
      {MAP.lamps.map(([x, y], i) => (
        <group key={i} position={[x + 0.5, 0, y + 0.5]}>
          <mesh position={[0, 0.65, 0]} castShadow>
            <cylinderGeometry args={[0.035, 0.045, 1.3, 6]} />
            <meshStandardMaterial color="#2e2318" roughness={0.9} />
          </mesh>
          <mesh position={[0.12, 1.28, 0]}>
            <boxGeometry args={[0.28, 0.035, 0.035]} />
            <meshStandardMaterial color="#2e2318" roughness={0.9} />
          </mesh>
          <mesh position={[0.24, 1.17, 0]}>
            <boxGeometry args={[0.12, 0.16, 0.12]} />
            <meshStandardMaterial color="#ffcf8a" emissive="#ffb35a" emissiveIntensity={2.4} toneMapped={false} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[0.1, 0.03, 0]}>
            <planeGeometry args={[4.5, 4.5]} />
            <meshBasicMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {Array.from({ length: NEAR_LIGHTS }, (_, k) => (
        <pointLight key={k} ref={(l) => (lights.current[k] = l)} color="#ffb366" distance={6.5} decay={1.6} intensity={4} />
      ))}
    </>
  );
}

function Fireflies({ time }: { time: { value: number } }) {
  const { geo, mat } = useMemo(() => {
    const n = TOUCH ? 60 : 180;
    const r = rnd(3);
    const pos = new Float32Array(n * 3);
    const ph = new Float32Array(n);
    let k = 0;
    while (k < n) {
      const x = 1 + r() * (MAP_W - 2);
      const z = 1 + r() * (MAP_H - 2);
      const ch = at(Math.floor(x), Math.floor(z));
      if (ch !== "," && ch !== "." && ch !== "W") continue;
      pos.set([x, 0.3 + r() * 1.2, z], k * 3);
      ph[k] = r() * 100;
      k++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("ph", new THREE.BufferAttribute(ph, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: time },
      vertexShader: `attribute float ph; uniform float uTime; varying float vA;
        void main(){
          vec3 p = position + vec3(sin(uTime*0.4+ph)*0.6, sin(uTime*0.9+ph*1.7)*0.25, cos(uTime*0.35+ph)*0.6);
          vA = pow(max(0.0, sin(uTime*1.3+ph*2.1)), 6.0);
          vec4 mv = modelViewMatrix * vec4(p,1.0);
          gl_PointSize = 26.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA;
        void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d)*vA; gl_FragColor = vec4(vec3(0.85,1.0,0.45)*a, a); }`,
    });
    return { geo: g, mat: m };
  }, [time]);
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

// ------------------------------------------------------------------ the map
export const Meadow = memo(function Meadow({ lit = false }: { lit?: boolean }) {
  const time = useMemo(() => ({ value: 0 }), []);
  const boxes = useMemo(() => wallBoxes(ROWS), []);
  const ground = useMemo(groundTexture, []);
  const { scene } = useThree();
  useEffect(() => {
    // a cool moonlit haze over the fields (the Yard sets its own)
    const before = scene.fog;
    // haze that thickens with distance from the camera, so the far field fades but the map view stays clear
    scene.fog = new THREE.Fog(lit ? "#0e1522" : "#0a101b", lit ? 40 : 18, lit ? 120 : 80);
    return () => {
      scene.fog = before;
    };
  }, [scene, lit]);
  useFrame((_, dt) => {
    time.value += Math.min(dt, 0.1);
  });
  return (
    <group>
      {/* moonlight: low, cold, from one side, enough to read the fields without a torch */}
      <directionalLight position={[-20, 30, -10]} intensity={lit ? 1.6 : 0.95} color="#a9bfe8" />
      <hemisphereLight args={["#3a5078", "#141a0e", lit ? 1.1 : 0.7]} />
      <mesh rotation-x={-Math.PI / 2} position={[MAP_W / 2, 0, MAP_H / 2]} receiveShadow>
        <planeGeometry args={[MAP_W, MAP_H]} />
        <meshStandardMaterial map={ground} roughness={0.95} metalness={0} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[MAP_W / 2, -0.02, MAP_H / 2]}>
        <planeGeometry args={[220, 220]} />
        <meshBasicMaterial color="#05080a" />
      </mesh>
      <Grass time={time} />
      <Creek time={time} />
      <Crossings />
      <Cover boxes={boxes} />
      <Farm boxes={boxes} />
      <Lanterns lit={lit} />
      <Fireflies time={time} />
    </group>
  );
});
