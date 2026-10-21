// Small things that make a firefight feel physical: brass that flies out of every gun and
// rattles on the concrete, and bullet holes that stay in the walls for the rest of the night.
// Pure decoration, drawn only from shots you already see. Each is one instanced draw call.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Session } from "../game/session";
import { audio } from "../game/audio";
import { gfx } from "../game/prefs";
import { TOUCH } from "../game/device";
import { MAP_W, MAP_H } from "../game/gen";
import { wallBoxes } from "./Arena";

// ------------------------------------------------------------------ shell casings

const MAX_CASINGS = TOUCH ? 24 : 48;
/** brass for rifles and pistols, red plastic for the shotgun, a long round for the Kar98k */
const CASE_COLOR = ["#c9a14a", "#c9a14a", "#b8322a", "#c9a14a", "#d8b45a"];
const CASE_LEN = [0.75, 0.9, 1.35, 0.95, 1.25];
const REST_FOR = 9; // seconds a casing lies on the ground before it goes
const cs = {
  pos: new Float32Array(MAX_CASINGS * 3),
  vel: new Float32Array(MAX_CASINGS * 3),
  rot: new Float32Array(MAX_CASINGS * 3),
  spin: new Float32Array(MAX_CASINGS * 3),
  age: new Float32Array(MAX_CASINGS).fill(-1),
  bounces: new Uint8Array(MAX_CASINGS),
  weapon: new Uint8Array(MAX_CASINGS),
  loud: new Float32Array(MAX_CASINGS),
  next: 0,
  dirty: true,
};

/**
 * Throw a casing out of the gun's ejection port: to the shooter's right, up, a little back.
 * `x`, `z` are the shooter (world units), `aim` the facing (radians), `loud` 0..1 for the clink.
 */
export function ejectCasing(x: number, z: number, aim: number, weapon: number, h = 1.0, loud = 1) {
  if (gfx() === "low" && Math.random() < 0.5) return;
  const i = cs.next;
  cs.next = (cs.next + 1) % MAX_CASINGS;
  const fx = Math.cos(aim);
  const fz = Math.sin(aim);
  // right of facing (x right, z down the map, y up) = (-sin, cos)
  const rx = -fz;
  const rz = fx;
  const side = 1.3 + Math.random() * 0.9;
  const back = -0.2 - Math.random() * 0.4;
  cs.pos.set([x + fx * 0.3 + rx * 0.12, h + 0.12, z + fz * 0.3 + rz * 0.12], i * 3);
  cs.vel.set([rx * side + fx * back, 1.7 + Math.random() * 1.1, rz * side + fz * back], i * 3);
  cs.rot.set([Math.random() * 6, aim, Math.random() * 6], i * 3);
  cs.spin.set([(Math.random() - 0.5) * 40, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 40], i * 3);
  cs.age[i] = 0;
  cs.bounces[i] = 0;
  cs.weapon[i] = weapon;
  cs.loud[i] = loud;
  cs.dirty = true;
}

function Casings({ session }: { session: Session }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const lastClink = useRef(0);
  const match = useRef(-1);
  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    // a new night sweeps the ground clean
    const no = session.room?.matchNo ?? -1;
    if (no !== match.current) {
      match.current = no;
      cs.age.fill(-1);
      cs.dirty = true;
    }
    dt = Math.min(dt, 0.05);
    let n = 0;
    let moving = false;
    for (let i = 0; i < MAX_CASINGS; i++) {
      if (cs.age[i] < 0) continue;
      cs.age[i] += dt;
      const j = i * 3;
      const resting = cs.bounces[i] >= 3;
      if (!resting) {
        moving = true;
        cs.vel[j + 1] -= 9.8 * dt;
        cs.pos[j] += cs.vel[j] * dt;
        cs.pos[j + 1] += cs.vel[j + 1] * dt;
        cs.pos[j + 2] += cs.vel[j + 2] * dt;
        cs.rot[j] += cs.spin[j] * dt;
        cs.rot[j + 1] += cs.spin[j + 1] * dt;
        cs.rot[j + 2] += cs.spin[j + 2] * dt;
        if (cs.pos[j + 1] < 0.012) {
          // hit the ground: lose most of the speed, tinkle the first time
          cs.pos[j + 1] = 0.012;
          cs.vel[j + 1] = -cs.vel[j + 1] * 0.32;
          cs.vel[j] *= 0.45;
          cs.vel[j + 2] *= 0.45;
          cs.spin[j] *= 0.4;
          cs.spin[j + 2] *= 0.4;
          cs.bounces[i]++;
          const now = performance.now();
          if (cs.bounces[i] === 1 && cs.loud[i] > 0.05 && now - lastClink.current > 70) {
            lastClink.current = now;
            audio.clink(0.35 * cs.loud[i] * (0.6 + Math.random() * 0.4));
          }
          if (cs.bounces[i] >= 3) {
            // lie on its side
            cs.rot[j] = Math.PI / 2;
            cs.rot[j + 2] = 0;
          }
        }
      }
      const life = cs.age[i];
      if (life > REST_FOR) {
        cs.age[i] = -1;
        continue;
      }
      const fade = life > REST_FOR - 1 ? REST_FOR - life : 1;
      if (fade < 1) moving = true;
      const len = CASE_LEN[cs.weapon[i]] ?? 1;
      tmp.position.set(cs.pos[j], cs.pos[j + 1], cs.pos[j + 2]);
      tmp.rotation.set(cs.rot[j], cs.rot[j + 1], cs.rot[j + 2]);
      tmp.scale.set(fade * (cs.weapon[i] === 2 ? 1.5 : 1), fade * len, fade * (cs.weapon[i] === 2 ? 1.5 : 1));
      tmp.updateMatrix();
      m.setMatrixAt(n, tmp.matrix);
      m.setColorAt(n, color.set(CASE_COLOR[cs.weapon[i]] ?? CASE_COLOR[0]));
      n++;
    }
    if (!moving && !cs.dirty && m.count === n) return;
    cs.dirty = false;
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX_CASINGS]} frustumCulled={false}>
      <cylinderGeometry args={[0.011, 0.011, 0.045, 6]} />
      {/* a faint glint, so brass in the dark still catches the eye */}
      <meshStandardMaterial metalness={0.85} roughness={0.3} emissive="#3a2a08" emissiveIntensity={0.6} />
    </instancedMesh>
  );
}

// ------------------------------------------------------------------ bullet holes

const MAX_HOLES = TOUCH ? 48 : 120;

/** how tall the wall on each tile is drawn (holes never float above a low crate) */
let tileH: Float32Array | null = null;
let tileFence: Uint8Array | null = null;
function wallInfo() {
  if (!tileH) {
    tileH = new Float32Array(MAP_W * MAP_H);
    tileFence = new Uint8Array(MAP_W * MAP_H);
    for (const b of wallBoxes())
      for (let y = b.y; y < b.y + b.h; y++)
        for (let x = b.x; x < b.x + b.w; x++) {
          tileH[y * MAP_W + x] = b.height;
          tileFence![y * MAP_W + x] = b.kind === "fence" ? 1 : 0;
        }
  }
  return { tileH, tileFence: tileFence! };
}

const isWallTile = (x: number, y: number) => x < 0 || y < 0 || x >= MAP_W || y >= MAP_H || wallInfo().tileH[y * MAP_W + x] > 0;

const holes = { m: new Float32Array(MAX_HOLES * 16), n: 0, next: 0, dirty: false };
const holeObj = new THREE.Object3D();

/**
 * A round from (fromX, fromY) stopped inside the wall at (hitX, hitY) (map units, 256 per tile):
 * put a hole on the face it went through, at height `h`.
 */
export function bulletHole(fromX: number, fromY: number, hitX: number, hitY: number, h: number) {
  const tx = Math.floor(hitX / 256);
  const ty = Math.floor(hitY / 256);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return;
  const { tileH, tileFence } = wallInfo();
  if (!(tileH[ty * MAP_W + tx] > 0)) return; // not inside a wall
  if (tileFence[ty * MAP_W + tx]) return; // chain-link: the round goes through the gap
  const top = tileH[ty * MAP_W + tx] || 1.2;
  const y = Math.min(h + (Math.random() - 0.5) * 0.12, top - 0.07);
  if (y < 0.06) return;
  const dx = hitX - fromX;
  const dy = hitY - fromY;
  // which face did it come through? the side of the hit tile the path entered last (slab test),
  // and only a face that is open to the air (not pressed against the next wall tile)
  const enterX = Math.abs(dx) < 1e-3 ? -Infinity : ((dx > 0 ? tx : tx + 1) * 256 - fromX) / dx;
  const enterY = Math.abs(dy) < 1e-3 ? -Infinity : ((dy > 0 ? ty : ty + 1) * 256 - fromY) / dy;
  const openX = !isWallTile(tx + (dx > 0 ? -1 : 1), ty);
  const openY = !isWallTile(tx, ty + (dy > 0 ? -1 : 1));
  let useX = enterX >= enterY;
  if (useX && !openX) useX = false;
  else if (!useX && !openY) useX = true;
  if ((useX && (!openX || enterX === -Infinity)) || (!useX && (!openY || enterY === -Infinity))) return;
  let px: number, pz: number, rotY: number;
  if (useX) {
    const bx = dx > 0 ? tx * 256 : (tx + 1) * 256;
    pz = (fromY + dy * enterX) / 256;
    if (Math.floor(pz) !== ty) pz = Math.min(ty + 0.95, Math.max(ty + 0.05, pz));
    px = bx / 256 + (dx > 0 ? -0.004 : 0.004);
    rotY = dx > 0 ? -Math.PI / 2 : Math.PI / 2;
  } else {
    const by = dy > 0 ? ty * 256 : (ty + 1) * 256;
    px = (fromX + dx * enterY) / 256;
    if (Math.floor(px) !== tx) px = Math.min(tx + 0.95, Math.max(tx + 0.05, px));
    pz = by / 256 + (dy > 0 ? -0.004 : 0.004);
    rotY = dy > 0 ? Math.PI : 0;
  }
  holeObj.position.set(px, y, pz);
  holeObj.rotation.set(0, rotY, Math.random() * Math.PI * 2);
  const s = 0.75 + Math.random() * 0.5;
  holeObj.scale.set(s, s, 1);
  holeObj.updateMatrix();
  holeObj.matrix.toArray(holes.m, holes.next * 16);
  holes.next = (holes.next + 1) % MAX_HOLES;
  holes.n = Math.min(MAX_HOLES, holes.n + 1);
  holes.dirty = true;
}

function holeTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  // soot and chipped paint around the hole
  const halo = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  halo.addColorStop(0, "rgba(20,18,16,0.9)");
  halo.addColorStop(0.35, "rgba(40,36,32,0.55)");
  halo.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = halo;
  g.fillRect(0, 0, 64, 64);
  // cracks
  g.strokeStyle = "rgba(10,10,10,0.7)";
  g.lineWidth = 1;
  for (let k = 0; k < 6; k++) {
    let x = 32;
    let y = 32;
    const a = (k / 6) * Math.PI * 2 + Math.random() * 0.6;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 3; s++) {
      x += Math.cos(a + (Math.random() - 0.5) * 0.8) * (4 + Math.random() * 5);
      y += Math.sin(a + (Math.random() - 0.5) * 0.8) * (4 + Math.random() * 5);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // the hole: dark core with a bright chipped rim
  g.fillStyle = "rgba(170,160,145,0.55)";
  g.beginPath();
  g.arc(32, 32, 5.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#050505";
  g.beginPath();
  g.arc(32, 32, 3.6, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Holes({ session }: { session: Session }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const tex = useMemo(holeTexture, []);
  const match = useRef(-1);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const no = session.room?.matchNo ?? -1;
    if (no !== match.current) {
      match.current = no;
      holes.n = 0;
      holes.next = 0;
      holes.dirty = true;
    }
    if (!holes.dirty) return;
    holes.dirty = false;
    (m.instanceMatrix.array as Float32Array).set(holes.m.subarray(0, holes.n * 16));
    m.count = holes.n;
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX_HOLES]} frustumCulled={false}>
      <planeGeometry args={[0.2, 0.2]} />
      <meshStandardMaterial map={tex} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} roughness={1} />
    </instancedMesh>
  );
}

export function Details({ session }: { session: Session }) {
  return (
    <>
      <Casings session={session} />
      <Holes session={session} />
    </>
  );
}
