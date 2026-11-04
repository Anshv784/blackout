// A real soldier (rigged, animated) instead of a capsule. One shared GLB, cloned per player.
// Idle / walk / run come from the file; holding the gun, recoil, reload, the throw swing and
// crawling when downed are driven on the skeleton every frame (two-bone IK for the arms).
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Gun, MUZZLE_FWD, GUN_MODELS } from "./Gun";
import { dropMag } from "./Details";
import { ANIMS_URL, CHARACTERS, OUTFITS, FINISHES, EMOTES, DEFAULT_LOOK, type Look } from "../game/look";

export const SOLDIER_URL = "/models/soldier-v2.glb";
useGLTF.preload(SOLDIER_URL);
useGLTF.preload(ANIMS_URL);

/** What the body should be doing this frame. Parents write it, the soldier reads it. */
export interface Motion {
  speed: number; // 0 still, 1 walking, 2 running
  firing: boolean;
  reloading: boolean;
  downed: boolean;
  throwAt: number; // performance.now() of the last throw
  crouch?: boolean;
  jumpAt?: number; // performance.now() a jump started
  shotAt?: number; // performance.now() of the latest shot (each one kicks)
  torch?: boolean; // the under-barrel torch is on
  deadAt?: number; // performance.now() they were killed: knees go, then they fall back and the gun drops
  reloadAt?: number; // performance.now() the reload started (your own soldier only)
  reloadDur?: number; // and how long it takes, ms
  pickAt?: number; // performance.now() of a pickup: bend down and grab it
  prone?: boolean; // lying flat, crawling
  emote?: number; // index into EMOTES while emoting
  emoteAt?: number; // performance.now() the emote started (moving or firing cancels it)
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 0 → 1 between a and b, eased */
const ss = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** rises a → b, holds, falls c → d */
const win = (a: number, b: number, c: number, d: number, x: number) => ss(a, b, x) * (1 - ss(c, d, x));
/** where the hand is at time x along keyframes [time, point] (eased between them) */
function along(keys: [number, THREE.Vector3][], x: number, out: THREE.Vector3) {
  if (x <= keys[0][0]) return out.copy(keys[0][1]);
  for (let i = 1; i < keys.length; i++) {
    const [t1, p1] = keys[i];
    if (x <= t1) {
      const [t0, p0] = keys[i - 1];
      return out.copy(p0).lerp(p1, ss(t0, t1, x));
    }
  }
  return out.copy(keys[keys.length - 1][1]);
}
export const stillMotion = (): Motion => ({ speed: 0, firing: false, reloading: false, downed: false, throwAt: 0 });

/** seconds after death the body becomes a crate, and how long the change takes */
const BOX_AT = 1.6;
const BOX_DUR = 0.45;
/** per gun: [push back, muzzle climb (rad), flash size, settle (lower = faster)] */
const RECOIL: [number, number, number, number][] = [
  [0.06, 0.16, 0.8, 0.0004], // VESPER: snappy flip
  [0.035, 0.07, 0.7, 0.00002], // HORNET: light, fast
  [0.12, 0.3, 1.5, 0.002], // MAUL: big shove
  [0.05, 0.09, 1.0, 0.00005], // KESTREL: tight climb
  [0.14, 0.34, 1.4, 0.004], // TALON: heavy, slow to settle
  [0.09, 0.22, 1.2, 0.0012], // marksman: firm, settles fast
  [0.04, 0.08, 0.9, 0.00003], // LMG: steady chatter
  [0.03, 0.05, 0, 0.0005], // crossbow: a nudge, no flash
];
const HEIGHT = 1.38; // world units (a tile is 1)
// the stock at the right shoulder (+x forward, +z right), pulled in so the left hand really reaches
// the handguard (this rig's arms are short: at the old 0.85 scale the support hand stopped in mid-air)
const GUN_POS = new THREE.Vector3(0.05, 1.0, 0.09);
/** the original's right shoulder and arm reach (its own frame) that GUN_POS was tuned for */
const REF_SHOULDER = new THREE.Vector3(-0.022, 1.04, 0.137);
const REF_REACH = 0.356;
const GUN_INNER = new THREE.Vector3(-0.17, 0, -0.12);
/** real proportions: a rifle is about half a person's height */
export const GUN_SCALE = 0.72;
/** where the hands go, in the gun's own part space (see Gun.tsx): the right wrist just behind and
 *  outside the pistol grip, the left wrist under and left of the handguard */
const GRIP_AT = new THREE.Vector3(0.3, -0.075, 0.045);
const FRONT_AT = new THREE.Vector3(0.62, -0.065, -0.045);
/** a pistol is held two-handed: the support hand cups the shooting hand under the grip */
const PISTOL_FRONT = new THREE.Vector3(0.36, -0.13, -0.06);

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();
const sockM = new THREE.Matrix4();
const sockM2 = new THREE.Matrix4();
const sockM3 = new THREE.Matrix4();
const sockV = new THREE.Vector3();
const sockV2 = new THREE.Vector3();
const tmpM2 = new THREE.Matrix4();
const ikQ = new THREE.Quaternion();
const [ikS, ikE, ikH, ikT, ikB, ikD, ikEl, ikF] = Array.from({ length: 8 }, () => new THREE.Vector3());

/** Rotate `bone` so the direction to `child` points at world `target`. */
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3) {
  bone.updateWorldMatrix(true, false);
  child.updateWorldMatrix(false, false);
  const from = tmpA.setFromMatrixPosition(bone.matrixWorld);
  const cur = tmpB.setFromMatrixPosition(child.matrixWorld).sub(from).normalize();
  const want = tmpC.copy(target).sub(from).normalize();
  if (cur.lengthSq() < 1e-8 || want.lengthSq() < 1e-8) return;
  const delta = tmpQ.setFromUnitVectors(cur, want);
  const worldQ = bone.getWorldQuaternion(tmpQ2);
  const newWorld = delta.multiply(worldQ);
  const parentQ = ikQ.identity();
  bone.parent?.getWorldQuaternion(parentQ);
  bone.quaternion.copy(parentQ.invert().multiply(newWorld));
  bone.updateWorldMatrix(false, true);
}

/** Two-bone IK: shoulder→elbow→hand reaches `target`, elbow bent toward `pole`. */
function reach(upper: THREE.Object3D, lower: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3) {
  upper.updateWorldMatrix(true, true);
  // scratch vectors, reused: this runs for every soldier every frame (no garbage, no GC stutter)
  const s = ikS.setFromMatrixPosition(upper.matrixWorld);
  const e = ikE.setFromMatrixPosition(lower.matrixWorld);
  const h = ikH.setFromMatrixPosition(hand.matrixWorld);
  const a = s.distanceTo(e);
  const b = e.distanceTo(h);
  const toT = ikT.copy(target).sub(s);
  const d = Math.min(toT.length(), a + b - 1e-3);
  const dir = toT.normalize();
  // distance along dir to the elbow's projection, and the elbow's offset from that line
  const x = (a * a - b * b + d * d) / (2 * d);
  const y = Math.sqrt(Math.max(0, a * a - x * x));
  const bend = ikB.copy(pole).sub(s);
  bend.sub(ikD.copy(dir).multiplyScalar(bend.dot(dir))).normalize();
  const elbow = ikEl.copy(s).add(ikD.copy(dir).multiplyScalar(x)).add(bend.multiplyScalar(y));
  aimBone(upper, lower, elbow);
  aimBone(lower, hand, target);
}

/** Repaints the model's beige sci-fi armour as woodland field kit: the original shading (folds,
 *  straps, panel lines) is kept as light and dark, and an original 4-tone camo is printed over it. */
let camoMap: THREE.Texture | null = null;
function camo(src: THREE.Texture): THREE.Texture {
  if (camoMap) return camoMap;
  const img = src.image as HTMLImageElement | ImageBitmap;
  const w = img.width;
  const h = img.height;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.drawImage(img as CanvasImageSource, 0, 0);
  const d = g.getImageData(0, 0, w, h);
  // smooth value noise, a few octaves, for blotchy patches
  const R = 64;
  const grid = Array.from({ length: (R + 1) * (R + 1) }, (_, i) => {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  });
  const at = (x: number, y: number) => grid[(y % R) * (R + 1) + (x % R)];
  const noise = (u: number, v: number) => {
    const x = u * R;
    const y = v * R;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  // olive base, brown, dark green, near-black
  const tones = [
    [92, 98, 66],
    [104, 84, 58],
    [52, 64, 44],
    [34, 34, 30],
  ];
  const px = d.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = px[i];
      const gg = px[i + 1];
      const b = px[i + 2];
      const lum = (0.3 * r + 0.59 * gg + 0.11 * b) / 255;
      const sat = Math.max(r, gg, b) - Math.min(r, gg, b);
      // saturated details (the red trim) and very dark parts (straps, pouches) stay gear-coloured
      const u = x / w;
      const v = y / h;
      const n = noise(u * 0.25, v * 0.25) * 0.6 + noise(u * 0.5 + 0.3, v * 0.5) * 0.3 + noise(u + 0.7, v + 0.1) * 0.1;
      const tone = n < 0.36 ? 0 : n < 0.5 ? 1 : n < 0.62 ? 2 : n < 0.7 ? 0 : 3;
      let [tr, tg, tb] = tones[tone];
      if (sat > 60) [tr, tg, tb] = [58, 56, 50]; // trim becomes webbing grey
      if (lum < 0.18) [tr, tg, tb] = [30, 30, 28]; // straps and pouches: black nylon
      const k = 0.35 + lum * 1.25;
      px[i] = Math.min(255, tr * k);
      px[i + 1] = Math.min(255, tg * k);
      px[i + 2] = Math.min(255, tb * k);
    }
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = src.flipY;
  t.colorSpace = src.colorSpace;
  t.wrapS = src.wrapS;
  t.wrapT = src.wrapT;
  t.anisotropy = 4;
  camoMap = t;
  return t;
}

type Chain = THREE.Object3D[];
interface Grip {
  chains: Chain[]; // index, middle, ring, pinky: segments 1..3
  axis: THREE.Vector3; // local axis that closes the fingers towards the palm
  hand: THREE.Object3D;
  rest: THREE.Quaternion[][]; // each finger segment's rest rotation (curl starts from here)
  axes: THREE.Vector3[][]; // each segment's own axis that closes it towards the palm
  finger: THREE.Vector3; // hand-local: wrist -> knuckles
  palm: THREE.Vector3; // hand-local: out of the palm
}
const curlQ = new THREE.Quaternion();
const qGun = new THREE.Quaternion();
const hd = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
/** Finds, once, which way this rig's fingers bend shut: tries each axis and keeps the one that
 *  brings the fingertip closest to the wrist. (Rigs differ; guessing gives claws.) */
function gripFor(model: THREE.Object3D, side: "Left" | "Right"): Grip | null {
  const b = (n: string) => model.getObjectByName(`mixamorig${side}Hand${n}`);
  const chains = ["Index", "Middle", "Ring", "Pinky"].map((f) => [1, 2, 3].map((k) => b(`${f}${k}`)).filter(Boolean) as THREE.Object3D[]);
  const wrist = model.getObjectByName(`mixamorig${side}Hand`);
  const thumbTip = b("Thumb3") ?? b("Thumb2");
  if (!wrist || !thumbTip || chains.some((c) => c.length !== 3)) return null;
  model.updateMatrixWorld(true);
  const W = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
  // the hand's geometry: fingers run wrist -> middle knuckle; the knuckle line runs index -> pinky;
  // the palm faces the side the thumb sits on
  const wristP = W(wrist);
  const knuckle = W(chains[1][0]);
  const fingerW = knuckle.clone().sub(wristP).normalize();
  const across = W(chains[0][0]).sub(W(chains[3][0])).normalize();
  const palmW = new THREE.Vector3().crossVectors(fingerW, across).normalize();
  // Mixamo builds its characters in a T-pose with the palms facing the floor
  if (palmW.y > 0) palmW.negate();
  void thumbTip;
  // curling turns each segment about the knuckle line, the way that moves the tip towards the palm
  // (measured: this direction moves the fingertip into the palm; the other bent it backwards)
  const axisW = new THREE.Vector3().crossVectors(fingerW, palmW).normalize();
  const axes = chains.map((c) =>
    c.map((o) => {
      const q = o.getWorldQuaternion(new THREE.Quaternion()).invert();
      return axisW.clone().applyQuaternion(q).normalize();
    }),
  );
  const inv = wrist.getWorldQuaternion(new THREE.Quaternion()).invert();
  return {
    chains,
    rest: chains.map((c) => c.map((o) => o.quaternion.clone())),
    axis: axes[1][0],
    axes,
    hand: wrist,
    finger: fingerW.applyQuaternion(inv),
    palm: palmW.applyQuaternion(inv),
  };
}

const basisM = new THREE.Matrix4();
const basisL = new THREE.Matrix4();
const qWant = new THREE.Quaternion();
const qLocal = new THREE.Quaternion();
const qParent = new THREE.Quaternion();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
/** Turn the hand so its fingers point along `finger` and its palm faces `palm` (world space),
 *  blended by `w`. This is what keeps fingers on the grip instead of through the receiver. */
function orientHand(g: Grip | null, finger: THREE.Vector3, palm: THREE.Vector3, w: number) {
  if (!g || w <= 0) return;
  const f = vA.copy(finger).normalize();
  const p = vB.copy(palm).addScaledVector(f, -palm.dot(f)).normalize();
  basisM.makeBasis(f, p, vC.crossVectors(f, p));
  const lf = g.finger;
  const lp = g.palm;
  basisL.makeBasis(lf, lp, vC.crossVectors(lf, lp));
  qWant.setFromRotationMatrix(basisM).multiply(qLocal.setFromRotationMatrix(basisL).invert());
  g.hand.parent!.getWorldQuaternion(qParent);
  qLocal.copy(qParent).invert().multiply(qWant);
  g.hand.quaternion.slerp(qLocal, w);
}
/** Close the fingers round whatever the hand holds: `amount` 0 open .. 1 a full fist.
 *  The trigger finger stays a little straighter on the gun hand. */
function curl(g: Grip | null, amount: number, trigger = false) {
  if (!g || amount <= 0) return;
  g.chains.forEach((chain, f) => {
    const k = trigger && f === 0 ? 0.55 : 1;
    chain.forEach((o, seg) => o.quaternion.copy(g.rest[f][seg]).multiply(curlQ.setFromAxisAngle(g.axes[f][seg], amount * k * [0.95, 1.05, 0.7][seg])));
  });
}

/** A ghillie suit: thousands of frayed jute strands in layered tufts, in dry-grass, moss, olive
 *  and dead-leaf tones, with see-through fibre tips (alpha-tested texture). Two pieces: the hood,
 *  shoulders and back ride the chest bone; a skirt rides the hips so it moves with the legs. */
let ghillieGeos: { upper: THREE.BufferGeometry; lower: THREE.BufferGeometry } | null = null;
function strandsGeometry(anchors: [number, number, number, number, number][], seed0: number) {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  let seed = seed0;
  const r = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  // jute, dead grass, moss, olive, dry leaf, near-black shadow strands
  const tones = [[0.42, 0.36, 0.22], [0.5, 0.44, 0.27], [0.27, 0.32, 0.15], [0.34, 0.37, 0.19], [0.4, 0.3, 0.17], [0.16, 0.17, 0.11]];
  for (const [x, y, z, len, spread] of anchors) {
    // a tuft: 3-5 strands from one knot, fanned
    const n = 3 + Math.floor(r() * 3);
    const t = tones[Math.floor(r() * r() * tones.length * 1.2) % tones.length];
    for (let k = 0; k < n; k++) {
      const w = 0.018 + r() * 0.03;
      const tw = r() * Math.PI;
      const dx = Math.cos(tw) * w;
      const dz = Math.sin(tw) * w;
      const l = len * (0.7 + r() * 0.5);
      const fx = (r() - 0.5) * spread - 0.01;
      const fz = (r() - 0.5) * spread;
      const segs = 3;
      for (let sgi = 0; sgi < segs; sgi++) {
        const a = sgi / segs;
        const b = (sgi + 1) / segs;
        // hangs down, droops outward a little more towards the tip
        const P = (u: number) => [x + fx * u * 1.6, y - l * u, z + fz * u * 1.6];
        const p0 = P(a);
        const p1 = P(b);
        pos.push(p0[0] - dx, p0[1], p0[2] - dz, p0[0] + dx, p0[1], p0[2] + dz, p1[0] - dx, p1[1], p1[2] - dz);
        pos.push(p0[0] + dx, p0[1], p0[2] + dz, p1[0] + dx, p1[1], p1[2] + dz, p1[0] - dx, p1[1], p1[2] - dz);
        const u0 = (k % 4) / 4;
        const u1 = u0 + 0.25;
        uv.push(u0, 1 - a, u1, 1 - a, u0, 1 - b, u1, 1 - a, u1, 1 - b, u0, 1 - b);
        const kk = 0.5 + r() * 0.35; // dusk-dark, so it melts into the grass at night
        for (let v = 0; v < 6; v++) col.push(t[0] * kk, t[1] * kk, t[2] * kk);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
function ghillieGeometry() {
  if (ghillieGeos) return ghillieGeos;
  let seed = 11;
  const r = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const up: [number, number, number, number, number][] = [];
  // hood: a dome over the head, longer at the back and sides, a fringe over the brow
  for (let i = 0; i < 160; i++) {
    const a = r() * Math.PI * 2;
    const e = r() * 0.9;
    const back = Math.cos(a) < 0 ? 1 : 0.55;
    up.push([Math.cos(a) * 0.13 * Math.cos(e), 0.38 + Math.sin(e) * 0.14, Math.sin(a) * 0.13 * Math.cos(e), (0.1 + r() * 0.16) * back, 0.12]);
  }
  // shoulders and upper arms: a thick mantle
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2;
    up.push([Math.cos(a) * (0.15 + r() * 0.05) - 0.02, 0.2 + r() * 0.12, Math.sin(a) * (0.24 + r() * 0.05), 0.22 + r() * 0.3, 0.16]);
  }
  // back and chest: layered rows
  for (let i = 0; i < 300; i++) {
    const front = r() < 0.35;
    up.push([front ? 0.13 + r() * 0.03 : -0.15 - r() * 0.04, -0.25 + r() * 0.48, (r() - 0.5) * 0.42, 0.18 + r() * 0.3, 0.12]);
  }
  const low: [number, number, number, number, number][] = [];
  // skirt round the hips and the backs of the thighs
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2;
    const backish = Math.cos(a) < 0.2;
    low.push([Math.cos(a) * 0.16, 0.08 + r() * 0.08, Math.sin(a) * 0.19, (backish ? 0.38 : 0.24) + r() * 0.2, 0.14]);
  }
  ghillieGeos = { upper: strandsGeometry(up, 3), lower: strandsGeometry(low, 9) };
  return ghillieGeos;
}
/** a jute fibre strip: twisted threads, gaps between them, frayed thin at the tip */
function juteTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 64, 128);
  let seed = 5;
  const r = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let q = 0; q < 4; q++) {
    // four strand variants side by side (uv picks one)
    for (let f = 0; f < 9; f++) {
      const x0 = q * 16 + 1 + r() * 14;
      const end = 70 + r() * 58; // how far down this fibre reaches before it frays out
      g.strokeStyle = `rgba(255,255,255,${0.75 + r() * 0.25})`;
      g.lineWidth = 0.8 + r() * 1.4;
      g.beginPath();
      g.moveTo(x0, 0);
      let x = x0;
      for (let y = 0; y < end; y += 8) {
        x += (r() - 0.5) * 2.2;
        g.lineTo(Math.max(q * 16, Math.min(q * 16 + 16, x)), y);
      }
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const ghillieMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.35, transparent: false });
ghillieMat.alphaMap = typeof document !== "undefined" ? juteTexture() : null;
ghillieMat.map = ghillieMat.alphaMap;

const animCache = new Map<string, Record<string, THREE.AnimationClip>>();
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
/** The shared Mixamo clips fitted to one character. Same skeleton (the Mixamo characters): hip
 *  height scaled to its legs. A skeleton with other rest orientations (the Blender-exported
 *  original): every rotation is applied as a change from the recording's rest pose onto this
 *  character's rest pose, and the hips stay put. Locomotion is pinned in place (the game moves
 *  the body); the reload is trimmed to the upper body. */
function clipsFor(key: string, src: THREE.AnimationClip[], animRoot: THREE.Object3D, model: THREE.Object3D, retarget: boolean) {
  const hit = animCache.get(key);
  if (hit) return hit;
  const animHip = animRoot.getObjectByName("mixamorigHips")?.position.y ?? 1;
  const charHip = model.getObjectByName("mixamorigHips")?.position.y ?? animHip;
  const k = charHip / (animHip || 1);
  const out: Record<string, THREE.AnimationClip> = {};
  const inPlace = new Set(["idle", "walk", "run", "crouchwalk", "crouch", "aim"]);
  for (const c of src) {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const t0 of c.tracks) {
      const t = t0.clone();
      // the bundle holds one skeleton per clip and the loader renames duplicates (Hips_3...):
      // point every track back at the real bone name
      const [rawBone, prop] = t.name.split(".");
      const bone = rawBone.replace(/_\d+$/, "");
      t.name = `${bone}.${prop}`;
      if (prop === "position") {
        if (!/Hips$/.test(bone) || retarget) continue; // only the hips move, and only on a matching skeleton
        const v = t.values;
        const x0 = v[0];
        const z0 = v[2];
        for (let i = 0; i < v.length; i += 3) {
          v[i] = inPlace.has(c.name) ? x0 * k : v[i] * k;
          v[i + 1] *= k;
          v[i + 2] = inPlace.has(c.name) ? z0 * k : v[i + 2] * k;
        }
      } else if (prop === "quaternion" && retarget) {
        const ab = animRoot.getObjectByName(bone);
        const cb = model.getObjectByName(bone);
        if (!ab || !cb) continue;
        const restA = ab.quaternion.clone().invert();
        const restC = cb.quaternion;
        const v = t.values;
        for (let i = 0; i < v.length; i += 4) {
          qa.fromArray(v, i);
          qb.copy(restC).multiply(restA.clone().multiply(qa)); // this rig's rest, plus the recorded change
          qb.toArray(v, i);
        }
      } else if (prop === "scale") continue;
      tracks.push(t);
    }
    out[c.name] = new THREE.AnimationClip(c.name, c.duration, tracks);
  }
  if (out.reload) out.reloadUpper = new THREE.AnimationClip("reloadUpper", out.reload.duration, out.reload.tracks.filter((t) => /Spine|Neck|Head/.test(t.name)));
  animCache.set(key, out);
  return out;
}
const matCache = new Map<string, THREE.Material>();

export function Soldier({ color, weapon = 0, ghost = false, ghillie = false, look = DEFAULT_LOOK, motion }: { color: string; weapon?: number; ghost?: boolean; ghillie?: boolean; look?: Look; motion?: React.MutableRefObject<Motion> }) {
  const def = CHARACTERS[look.char] ?? CHARACTERS[0];
  const gltf = useGLTF(def.url) as any;
  const animsGltf = useGLTF(ANIMS_URL) as any;
  const root = useRef<THREE.Group>(null);
  const gunRef = useRef<THREE.Group>(null);
  const cloak = useMemo(() => {
    const mk = (geo: THREE.BufferGeometry) => {
      const m = new THREE.Mesh(geo, ghillieMat);
      m.castShadow = true;
      m.frustumCulled = false;
      m.visible = false;
      return m;
    };
    return { upper: mk(ghillieGeometry().upper), lower: mk(ghillieGeometry().lower) };
  }, []);
  const innerRef = useRef<THREE.Group>(null);
  const { model, mixer, actions, bones, scale, grips, clips } = useMemo(() => {
    const model = cloneSkinned(gltf.scene) as THREE.Group;
    const tint = new THREE.Color(OUTFITS[look.outfit]?.tint ?? "#ffffff");
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const scale = HEIGHT / Math.max(0.01, box.max.y - box.min.y);
    model.traverse((o: any) => {
      if (o.isMesh) {
        o.castShadow = !ghost;
        o.receiveShadow = false;
        o.frustumCulled = false;
        if (ghost) {
          // an empty seat: a faint hologram in the seat colour
          o.material = o.material.clone();
          // an empty seat: a dark silhouette, the seat colour only as a faint glow at the edges
          o.material.color = new THREE.Color("#07080b");
          o.material.emissive = new THREE.Color(color).multiplyScalar(0.07);
          o.material.roughness = 0.9;
          o.material.metalness = 0;
          o.material.transparent = true;
          o.material.opacity = 0.42;
          o.material.depthWrite = false;
        } else if (!def.camo) {
          // the Mixamo characters: their own textures, the chosen outfit tone over them
          const ck = `${def.key}:${look.outfit}:${o.material.uuid}`;
          let mat = matCache.get(ck);
          if (!mat) {
            const m2 = o.material.clone();
            m2.color = (m2.color ?? new THREE.Color(1, 1, 1)).clone().multiply(tint);
            m2.roughness = Math.max(0.55, m2.roughness ?? 0.8);
            m2.metalness = Math.min(0.3, m2.metalness ?? 0);
            m2.envMapIntensity = 0.7;
            mat = m2;
            matCache.set(ck, mat!);
          }
          o.material = mat;
        } else if (!o.material.userData.real || look.outfit) {
          // the file ships fully matte (roughness 1), which flattens the kit into plastic;
          // a little sheen on the fabric and a glassy visor read as real gear under the lights
          const ck = `vanguard:${look.outfit}:${o.material.name}`;
          const cached = matCache.get(ck);
          if (cached) {
            o.material = cached;
            return;
          }
          o.material = o.material.clone();
          matCache.set(ck, o.material);
          const visor = /visor/i.test(o.material.name);
          if (!visor && o.material.map) o.material.map = camo(o.material.map);
          if (visor) o.material.color = new THREE.Color("#3a4048"); // smoked goggles
          o.material.roughness = visor ? 0.2 : 0.8;
          o.material.metalness = visor ? 0.7 : 0.05;
          o.material.envMapIntensity = visor ? 1.6 : 0.7;
          o.material.needsUpdate = true;
          if (!visor) o.material.color = new THREE.Color(1, 1, 1).multiply(tint);
          o.material.userData.real = true;
        }
      }
    });
    const mixer = new THREE.AnimationMixer(model);
    const b = (n: string) => model.getObjectByName(`mixamorig${n}`)!;
    // motion-captured clips, shared by every character (same Mixamo skeleton)
    const clips = clipsFor(def.key, animsGltf.animations, animsGltf.scene, gltf.scene, !!def.camo);
    // the original keeps its own walk cycle (made for its rig); everyone else uses the recordings
    const own = (n: string) => gltf.animations.find((a: THREE.AnimationClip) => a.name === n);
    const actions: Record<"idle" | "walk" | "run" | "crouch" | "crouchwalk", THREE.AnimationAction> = {
      idle: mixer.clipAction(def.camo ? own("Idle") : clips.idle),
      walk: mixer.clipAction(def.camo ? own("Walk") : clips.walk),
      run: mixer.clipAction(def.camo ? own("Run") : clips.run),
      // the Mixamo bodies crouch with the recorded crouch (the original bends its own legs in code)
      crouch: mixer.clipAction(def.camo ? own("Idle") : clips.crouch),
      crouchwalk: mixer.clipAction(def.camo ? own("Walk") : clips.crouchwalk),
    };
    Object.values(actions).forEach((a) => {
      a.play();
      a.setEffectiveWeight(0);
    });
    actions.idle.setEffectiveWeight(1);
    model.updateMatrixWorld(true);
    const grips = { r: gripFor(model, "Right"), l: gripFor(model, "Left") };
    const bones = {
      spine: b("Spine2"),
      neck: b("Neck"),
      rArm: b("RightArm"),
      rFore: b("RightForeArm"),
      rHand: b("RightHand"),
      lArm: b("LeftArm"),
      lFore: b("LeftForeArm"),
      lHand: b("LeftHand"),
      hips: b("Hips"),
      lUp: b("LeftUpLeg"),
      lLeg: b("LeftLeg"),
      rUp: b("RightUpLeg"),
      rLeg: b("RightLeg"),
    };
    return { model, mixer, actions, bones, scale, grips, clips };
  }, [gltf, animsGltf, ghost, color, def, look.outfit]);
  // emotes and the recorded reload: built once per soldier
  const extra = useMemo(() => {
    const emotes = EMOTES.map((e) => {
      const a = clips[e.clip] ? mixer.clipAction(clips[e.clip]) : null;
      if (a) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
        a.setEffectiveWeight(0);
      }
      return a;
    });
    const reload = clips.reloadUpper ? mixer.clipAction(clips.reloadUpper) : null;
    if (reload) {
      reload.play();
      reload.paused = true;
      reload.setEffectiveWeight(0);
    }
    return { emotes, reload };
  }, [mixer, clips]);
  const emoteRef = useRef({ at: 0, idx: -1 });
  // the gun fitted to this body: moved with the shoulder, and in closer for shorter arms
  const gunBase = useMemo(() => GUN_POS.clone(), [def]);
  const fitted = useRef(false);
  const handAnchor = useRef<THREE.Matrix4 | null>(null);
  const reachFix = useRef(0);

  useEffect(() => () => void mixer.stopAllAction(), [mixer]);

  const w = useRef({ idle: 1, walk: 0, run: 0, crouch: 0, crouchwalk: 0 });
  const kick = useRef(0);
  const roll = useRef(0);
  const lastShot = useRef(0);
  const flashAt = useRef(-1e9);
  const flash = useRef<THREE.Group>(null);
  const crouchK = useRef(0);
  const proneK = useRef(0);
  const landed = useRef(false); // the fallen pose has been drawn at least once
  const [torchOn, setTorchOn] = useState(false);
  // swapping guns: the old one drops away, the new one comes up (shown gun lags the real one)
  const [shown, setShown] = useState(weapon);
  const swapAt = useRef(-1);
  useEffect(() => {
    if (weapon === shown) return;
    swapAt.current = performance.now();
    const t = setTimeout(() => setShown(weapon), 220);
    return () => clearTimeout(t);
  }, [weapon]);
  const pool = useRef<THREE.Mesh>(null);
  const box = useRef<THREE.Group>(null);
  const landedY = useRef<number | null>(null);
  const lastFire = useRef(false);
  const target = useMemo(() => new THREE.Vector3(), []);
  const pole = useMemo(() => new THREE.Vector3(), []);
  // reload: scratch points for the hand's path, the gun's moving parts, what the left hand carries
  const kp = useMemo(() => Array.from({ length: 9 }, () => new THREE.Vector3()), []);
  const held = useRef<THREE.Group>(null);
  const heldMag = useRef<THREE.Mesh>(null);
  const heldShell = useRef<THREE.Mesh>(null);
  const heldRound = useRef<THREE.Mesh>(null);
  const magDropped = useRef(0);
  const wq = useMemo(() => new THREE.Quaternion(), []);

  useFrame((_, dt) => {
    dt = Math.min(dt, 0.05);
    const m = motion?.current ?? stillMotion();
    const wantTorch = !!m.torch && m.deadAt === undefined;
    if (wantTorch !== torchOn) setTorchOn(wantTorch);
    const g = root.current;
    if (!g) return;
    // hidden (enemy out of sight, unused ghost, etc.): don't animate it at all, it's the biggest
    // per-frame cost on phones with up to 17 soldiers in the scene
    for (let o: THREE.Object3D | null = g; o; o = o.parent) if (!o.visible) return;
    // locomotion blend
    const crouchClip = !def.camo && !!m.crouch && !m.downed && !m.prone;
    const want = m.downed
      ? { idle: m.speed > 0 ? 0 : 1, walk: m.speed > 0 ? 1 : 0, run: 0, crouch: 0, crouchwalk: 0 } // never an empty pose (T-pose) while down
      : crouchClip
        ? { idle: 0, walk: 0, run: 0, crouch: m.speed === 0 ? 1 : 0, crouchwalk: m.speed > 0 ? 1 : 0 }
        : { idle: m.speed === 0 ? 1 : 0, walk: m.speed === 1 ? 1 : 0, run: m.speed === 2 ? 1 : 0, crouch: 0, crouchwalk: 0 };
    const k = 1 - Math.pow(0.0005, dt);
    const dying = m.deadAt !== undefined;
    // emotes: only standing still with the gun quiet; moving or firing ends one
    const ed = m.emote !== undefined && m.emoteAt ? extra.emotes[m.emote] : null;
    const edDur = ed ? ed.getClip().duration * 1000 : 0;
    const emoting = !!ed && !dying && !m.downed && m.speed === 0 && !m.firing && performance.now() - (m.emoteAt ?? 0) < edDur;
    if (emoting && (emoteRef.current.at !== m.emoteAt || emoteRef.current.idx !== m.emote)) {
      extra.emotes.forEach((a) => a && a !== ed && a.stop());
      ed!.reset().play();
      emoteRef.current = { at: m.emoteAt!, idx: m.emote! };
    }
    extra.emotes.forEach((a) => {
      if (!a) return;
      const target = emoting && a === ed ? 1 : 0;
      a.setEffectiveWeight(a.getEffectiveWeight() + (target - a.getEffectiveWeight()) * Math.min(1, dt * 10));
      if (!emoting && a.getEffectiveWeight() < 0.01 && a.isRunning()) a.stop();
    });
    if (emoting) {
      want.idle = 0;
      want.walk = 0;
      want.run = 0;
      want.crouch = 0;
      want.crouchwalk = 0;
    }
    (["idle", "walk", "run", "crouch", "crouchwalk"] as const).forEach((n) => {
      if (dying) return; // the pose under a body stays exactly as it was when it fell
      w.current[n] += (want[n] - w.current[n]) * k;
      actions[n].setEffectiveWeight(w.current[n]);
    });
    actions.walk.timeScale = m.downed ? 0.45 : 1.25;
    actions.run.timeScale = 1.15;
    // the dead stop breathing once they're down
    const deadT = m.deadAt ? (performance.now() - m.deadAt) / 1000 : -1;
    // landed: the body is frozen exactly as it fell. Nothing touches the skeleton any more.
    if (deadT > 1.3 && landed.current) {
      if (pool.current) pool.current.scale.setScalar(0.15 + 0.85 * Math.sqrt(Math.min(1, (deadT - 0.6) / 4)));
      // then the body becomes a death box: it sinks into the ground as a crate pops up in its place
      const bt = (deadT - BOX_AT) / BOX_DUR;
      if (landedY.current === null) landedY.current = model.position.y;
      const sink = Math.min(1, Math.max(0, bt));
      model.position.y = landedY.current - (sink * 0.9) / scale;
      model.visible = sink < 1;
      if (gunRef.current) gunRef.current.visible = bt < 0.3;
      if (pool.current && sink >= 1) pool.current.visible = false;
      if (box.current) {
        box.current.visible = bt > 0 && !ghost;
        if (bt > 0) {
          // pops up with a little overshoot, then sits still
          const k = Math.min(1, bt / 0.8);
          const s = k < 1 ? 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2) : 1;
          box.current.scale.setScalar(Math.max(0.01, s));
          if (pool.current) box.current.position.set(pool.current.position.x, 0, pool.current.position.z);
        }
      }
      return;
    }
    if (box.current) box.current.visible = false;
    if (deadT < 0) {
      landedY.current = null;
      model.visible = true;
    }
    mixer.update(deadT > 0.9 ? 0 : dt);
    if (deadT < 0) {
      // the gun rides the shoulder: every frame it follows where the walk / run / crouch put the
      // right shoulder (so it bobs, leans and dips with the body instead of floating level)
      g.updateMatrixWorld(true);
      const sh = g.worldToLocal(tmpA.setFromMatrixPosition(bones.rArm.matrixWorld));
      if (!fitted.current) {
        fitted.current = true;
        const el = g.worldToLocal(tmpB.setFromMatrixPosition(bones.rFore.matrixWorld));
        const wr = g.worldToLocal(tmpC.setFromMatrixPosition(bones.rHand.matrixWorld));
        reachFix.current = THREE.MathUtils.clamp((sh.distanceTo(el) + el.distanceTo(wr) - REF_REACH) * 0.9, -0.08, 0.06);
      }
      tmpB.copy(GUN_POS).add(sh.sub(REF_SHOULDER));
      tmpB.x += reachFix.current;
      gunBase.lerp(tmpB, Math.min(1, dt * 18));
    }
    if (deadT < 0) landed.current = false;
    if (deadT >= 0) {
      if (deadT > 1.1) landed.current = true;
      // 0-0.25 s the knees buckle, 0.2-0.75 s the body goes over backwards with a small bounce
      const buckle = Math.min(1, deadT / 0.25);
      const fall = THREE.MathUtils.clamp((deadT - 0.2) / 0.55, 0, 1);
      const ease = fall * fall * (3 - 2 * fall);
      // one small settle as it lands, then perfectly still
      const bt = deadT - 0.75;
      const bounce = fall >= 1 && bt < 0.35 ? Math.sin((bt / 0.35) * Math.PI) * 0.035 : 0;
      model.rotation.x = -1.42 * ease - bounce; // negative: over backwards
      model.rotation.z = 0.2 * ease;
      model.position.y = (-0.32 * buckle * (1 - ease) + 0.12 * ease) / scale;
      const bend = buckle * (1 - ease * 0.85);
      bones.lUp.rotation.x -= 1.1 * bend;
      bones.rUp.rotation.x -= 0.8 * bend;
      bones.lLeg.rotation.x += 1.6 * bend;
      bones.rLeg.rotation.x += 1.2 * bend;
      // arms fly out and go limp
      bones.lArm.rotation.z += 0.9 * ease;
      bones.rArm.rotation.z -= 0.7 * ease;
      bones.neck.rotation.x += 0.4 * ease;
      if (gunRef.current) {
        // the gun leaves the hands and clatters down beside the body
        const gt = Math.min(1, deadT / 0.6);
        gunRef.current.visible = true;
        gunRef.current.position.set(gunBase.x + 0.35 * gt, Math.max(0.04, gunBase.y * (1 - gt * gt)), gunBase.z + 0.25 * gt);
        gunRef.current.rotation.set(Math.PI / 2 * gt, 0, 0);
      }
      if (pool.current) {
        const k = THREE.MathUtils.clamp((deadT - 0.6) / 4, 0, 1);
        pool.current.visible = !ghost;
        pool.current.scale.setScalar(0.15 + 0.85 * Math.sqrt(k));
        // spreads from under the chest, wherever the fall left it
        bones.spine.updateWorldMatrix(true, false);
        g.worldToLocal(tmpA.setFromMatrixPosition(bones.spine.matrixWorld));
        pool.current.position.set(tmpA.x, 0.015, tmpA.z);
      }
      return;
    }
    if (pool.current) pool.current.visible = false;
    if (emoting) {
      // the whole body is the recording's: stand tall, put the gun away
      model.rotation.x = 0;
      model.rotation.z = 0;
      model.position.y = 0;
      if (gunRef.current) gunRef.current.visible = false;
      return;
    }

    // lying on the floor when downed (on your back), or prone (on your front, gun forward)
    // (the original rig faces the other way, so its forward tip is the opposite sign)
    model.rotation.x += ((m.downed ? -1.35 : m.prone ? (def.camo ? -1.5 : 1.5) : 0) - model.rotation.x) * k;
    model.rotation.z = 0;
    // crouch: sink the hips, bend hips and knees, lean in
    crouchK.current += ((m.crouch && !m.downed ? 1 : 0) - crouchK.current) * (1 - Math.pow(0.0001, dt));
    const ck = crouchK.current;
    // jump: a half-second arc with the legs tucked
    const jp = m.jumpAt ? (performance.now() - m.jumpAt) / 500 : 1;
    const jk = jp >= 0 && jp < 1 ? Math.sin(jp * Math.PI) : 0;
    proneK.current += ((m.prone && !m.downed ? 1 : 0) - proneK.current) * (1 - Math.pow(0.002, dt));
    const pk2 = proneK.current;
    // how far the whole body (and the gun with it) moves; prone brings the gun down to the grass
    const lift = (-0.26 * ck + 0.55 * jk) * (1 - pk2) - 0.74 * pk2;
    model.position.y = m.downed ? 0.18 / scale : pk2 > 0.01 ? (0.06 * pk2) / scale : (def.camo ? lift : 0.55 * jk) / scale;
    if (pk2 > 0.01 && !def.camo) {
      // flat on the belly: legs straight back, head up to look along the gun
      bones.neck.rotation.x -= 0.6 * pk2;
      bones.spine.rotation.x -= 0.12 * pk2;
    }
    if (def.camo && (ck > 0.01 || jk > 0.01) && pk2 < 0.5) {
      const bend = Math.max(ck, jk * 0.7);
      bones.lUp.rotation.x -= 0.95 * bend;
      bones.rUp.rotation.x -= 0.95 * bend;
      bones.lLeg.rotation.x += 1.45 * bend;
      bones.rLeg.rotation.x += 1.45 * bend;
      bones.spine.rotation.x += 0.18 * ck;
    }

    // every shot kicks: the gun slams back into the shoulder and the muzzle climbs, then settles
    const shot = m.shotAt ?? 0;
    if (shot && shot !== lastShot.current) {
      lastShot.current = shot;
      kick.current = Math.min(1.6, kick.current + 1);
      roll.current = (Math.random() - 0.5) * 2;
      flashAt.current = performance.now();
    } else if (!m.shotAt && m.firing && !lastFire.current) {
      kick.current = 1;
      flashAt.current = performance.now();
    }
    lastFire.current = m.firing;
    const K = RECOIL[weapon] ?? RECOIL[0];
    kick.current *= Math.pow(K[3], dt);
    const kk = kick.current;
    if (gunRef.current) {
      // prone: the gun goes out in front with the arms, just off the ground
      gunRef.current.position.set(gunBase.x - kk * K[0], Math.max(0.1, gunBase.y + kk * K[0] * 0.3 + 0.07 * pk2), gunBase.z + kk * 0.012 * roll.current);
      gunRef.current.rotation.set(kk * 0.04 * roll.current, 0, kk * K[1]);
      if (flash.current) {
        const fa = (performance.now() - flashAt.current) / 55;
        flash.current.visible = fa >= 0 && fa < 1 && !ghost;
        if (flash.current.visible) {
          flash.current.scale.setScalar((1 - fa * 0.5) * K[2]);
          flash.current.rotation.x = flashAt.current * 7.3;
        }
      }
      // the swap: 0.45 s, gun dips muzzle-down and out to the side, then back up into the shoulder
      const sp = swapAt.current < 0 ? 1 : (performance.now() - swapAt.current) / 450;
      if (sp < 1) {
        const s = Math.sin(sp * Math.PI);
        gunRef.current.position.y -= 0.38 * s;
        gunRef.current.position.x -= 0.12 * s;
        gunRef.current.position.z += 0.1 * s;
        gunRef.current.rotation.z -= 1.1 * s;
        gunRef.current.rotation.x += 0.5 * s;
      }
      // ---- reloading: the gun tips toward the left hand, and its parts actually move
      const gr = gunRef.current;
      const rp = m.reloading && m.reloadAt ? clamp01((performance.now() - m.reloadAt) / Math.max(300, m.reloadDur ?? 2000)) : -1;
      const mag = gr.getObjectByName("mag");
      const pump = gr.getObjectByName("pump");
      const bolt = gr.getObjectByName("bolt");
      const magGun = weapon === 0 || weapon === 1 || weapon === 3 || weapon === 5 || weapon === 6;
      if (rp >= 0) {
        const tilt = win(0, 0.12, 0.86, 1, rp);
        // the gun swings across, muzzle down and out to the right, mag well turned toward the
        // left hand (and toward the shoulder camera, which otherwise only sees your back)
        gr.rotation.y -= 0.5 * tilt;
        gr.position.z += 0.08 * tilt;
        // held, not mounted: a slow hand-held drift while the hands work
        gr.rotation.z += 0.025 * Math.sin(rp * 19) * tilt;
        gr.rotation.x += 0.02 * Math.sin(rp * 13 + 1) * tilt;
        if (weapon === 6) {
          // a belt-fed gun is reloaded level: rolled a little to the left so the cover opens
          // toward you, the stock still at the shoulder
          gr.rotation.x -= 0.22 * tilt;
          gr.position.y -= 0.03 * tilt;
          const slam = rp > 0.7 ? Math.exp(-(rp - 0.7) * 60) : 0; // the cover slammed shut
          gr.position.y += 0.02 * slam;
          gr.position.x -= 0.03 * win(0.8, 0.83, 0.85, 0.9, rp); // charged
        } else if (magGun) {
          gr.rotation.x -= 0.6 * tilt;
          gr.rotation.z -= 0.22 * tilt;
          gr.position.y -= 0.06 * tilt;
          // the pull on the old mag tugs the gun down; the slap of the new one knocks it up
          gr.position.y -= 0.025 * win(0.09, 0.13, 0.14, 0.18, rp);
          const slap = rp > 0.52 ? Math.exp(-(rp - 0.52) * 60) : 0;
          gr.position.y += 0.035 * slap;
          gr.rotation.z += 0.12 * slap;
          // the charging handle: pulled, released, and the bolt slams home with a kick
          gr.position.x -= 0.03 * win(0.68, 0.71, 0.74, 0.8, rp);
          const slam = rp > 0.76 ? Math.exp(-(rp - 0.76) * 55) : 0;
          gr.position.x += 0.025 * slam;
          gr.rotation.z += 0.08 * slam;
        } else if (weapon === 2) {
          gr.rotation.x += 0.85 * tilt; // loading port up
          gr.rotation.z -= 0.1 * tilt;
          gr.position.y -= 0.03 * tilt;
        } else {
          gr.rotation.x += 0.3 * tilt;
          gr.rotation.z -= 0.08 * tilt;
        }
      }
      if (mag) {
        // the left hand grips the empty mag and draws it out of the well (8-16%), lets it fall, and
        // from 45% the fresh one rides up into the well and seats with a click at 52%
        const out = rp >= 0.16 && rp < 0.45;
        const rest = mag.userData.rest ?? (mag.userData.rest = mag.position.y);
        mag.visible = !out;
        const draw = rp >= 0 && rp < 0.16 ? 0.16 * ss(0.09, 0.16, rp) : 0;
        mag.position.y = rp >= 0.45 && rp < 0.53 ? rest - 0.2 * (1 - ss(0.45, 0.52, rp)) : rest - draw;
        if (rp >= 0.16 && magDropped.current !== m.reloadAt && !ghost) {
          magDropped.current = m.reloadAt ?? 0;
          mag.updateWorldMatrix(true, false);
          dropMag(mag.getWorldPosition(tmpA), mag.getWorldQuaternion(wq), weapon, 1);
        }
      }
      const lid = gr.getObjectByName("lid");
      if (lid) {
        // the feed cover hinges up at its back edge, stays up while the belt goes in, then slams
        const restX = lid.userData.rx ?? (lid.userData.rx = lid.position.x);
        const restY = lid.userData.ry ?? (lid.userData.ry = lid.position.y);
        const open = rp >= 0 ? win(0.08, 0.15, 0.62, 0.7, rp) : 0;
        const a = 1.25 * open;
        lid.rotation.z = a;
        lid.position.x = restX - 0.12 * (1 - Math.cos(a));
        lid.position.y = restY + 0.12 * Math.sin(a);
      }
      const arrow = gr.getObjectByName("arrow");
      if (arrow) arrow.visible = !(m.reloading && rp >= 0 && rp < 0.5) && !(m.shotAt && performance.now() - m.shotAt < 400 && !m.reloading);
      if (pump) {
        const rest = pump.userData.rest ?? (pump.userData.rest = pump.position.x);
        pump.position.x = rest - 0.09 * (rp >= 0 ? win(0.82, 0.86, 0.88, 0.92, rp) : 0);
      }
      if (bolt) {
        const restX = bolt.userData.rest ?? (bolt.userData.rest = bolt.position.x);
        const open = rp >= 0 ? win(0.04, 0.14, 0.8, 0.9, rp) : 0;
        bolt.rotation.x = -1.1 * open; // up
        bolt.position.x = restX - 0.08 * open; // and back
      }
      gunRef.current.visible = !m.downed;
    }
    if (m.downed) return;

    // shoulder into the stock, head up behind the sights
    bones.spine.rotation.y += def.camo ? 0.12 : 0.04;
    bones.spine.rotation.z -= kick.current * 0.08; // the shoulder takes the hit
    bones.spine.rotation.y -= kick.current * 0.03;
    bones.neck.rotation.x -= 0.1;
    const now = performance.now();
    const throwing = now - m.throwAt < 450;
    const gr = gunRef.current;
    const rp = m.reloading && m.reloadAt ? clamp01((now - m.reloadAt) / Math.max(300, m.reloadDur ?? 2000)) : -1;
    // a pickup: bend at the waist and reach down for it (not while your hands are busy)
    const pk = m.pickAt ? (now - m.pickAt) / 600 : 1;
    const picking = pk >= 0 && pk < 1 && rp < 0 && !throwing;
    const bendK = picking ? Math.sin(pk * Math.PI) : 0;
    if (picking) bones.spine.rotation.x += 0.5 * bendK;

    // hands on the gun: right on the grip, left on the handguard (and through the reload)
    g.updateWorldMatrix(true, true);
    const inner = innerRef.current;
    const gm = GUN_MODELS[weapon];
    // The way shooters are animated: the recording drives the right arm, and the gun sits in that
    // hand (a socket), so walk, run and crouch move it exactly as a real hand would. The socket is
    // measured once, in the standing idle pose: the palm, with the gun level and pointing forward.
    const socket = !def.camo && !!gr && !!inner && !throwing && !m.downed && pk2 < 0.5 && !!grips.r;
    if (socket && gr && inner && grips.r) {
      bones.rHand.updateWorldMatrix(true, false);
      const handL = sockM.copy(g.matrixWorld).invert().multiply(bones.rHand.matrixWorld); // hand in the soldier's frame
      if (!handAnchor.current && m.speed === 0 && !m.crouch && rp < 0 && w.current.idle > 0.95) {
        handL.decompose(tmpA, tmpQ, tmpB);
        const fingerL = tmpC.copy(grips.r.finger).applyQuaternion(tmpQ).normalize();
        const palmL = sockV.copy(grips.r.palm).applyQuaternion(tmpQ).normalize();
        // the grip sits in the closed hand: a little along the fingers, a little off the palm
        const palmPt = tmpA.clone().addScaledVector(fingerL, 0.045).addScaledVector(palmL, 0.022);
        const anchor = new THREE.Matrix4().makeTranslation(palmPt.x, palmPt.y, palmPt.z);
        handAnchor.current = new THREE.Matrix4().copy(handL).invert().multiply(anchor);
      }
      if (handAnchor.current) {
        // the grip frame this frame, then the gun placed so its grip point is in it
        const gripLocal = sockV.copy(gm?.grip ? sockV2.fromArray(gm.grip) : sockV2.copy(GRIP_AT)).multiplyScalar(GUN_SCALE).add(GUN_INNER);
        const gunM = sockM2.copy(handL).multiply(handAnchor.current).multiply(sockM3.makeTranslation(-gripLocal.x, -gripLocal.y, -gripLocal.z));
        gunM.decompose(gr.position, gr.quaternion, tmpB);
        gr.scale.set(1, 1, 1);
        // the shot still kicks: back along the barrel, muzzle up
        const kk2 = kick.current;
        const K2 = RECOIL[weapon] ?? RECOIL[0];
        gr.translateX(-kk2 * K2[0]);
        gr.rotateZ(kk2 * K2[1]);
        gr.updateMatrixWorld(true);
      }
    }
    const socketed = socket && !!handAnchor.current;
    const grip = gr && inner ? inner.localToWorld(gm?.grip ? target.fromArray(gm.grip) : target.copy(GRIP_AT)) : target.set(0, 0, 0);
    let rightT: THREE.Vector3 = grip;
    if (throwing) {
      // overhand throw with the right arm
      const p = (now - m.throwAt) / 450;
      rightT = g.localToWorld(kp[7].set(0.1 + p * 0.5, 1.45 - p * 0.35, 0.18));
    }
    const front = gr && inner ? inner.localToWorld(gm?.front ? ikF.fromArray(gm.front) : ikF.copy(weapon === 0 ? PISTOL_FRONT : FRONT_AT)) : grip;
    let leftT: THREE.Vector3 = front;
    let carry = 0; // what the left hand holds: 1 a magazine, 2 a shell, 3 a rifle round
    if (rp >= 0 && gr && !throwing) {
      const pouch = g.localToWorld(kp[0].set(0.12, 0.7, -0.15)); // the mag pouches on the belt, front left
      const handguard = kp[1].copy(front);
      if (weapon === 6) {
        const box = gr.getObjectByName("mag");
        const boxP = box ? box.getWorldPosition(kp[2]) : kp[2].copy(front);
        const coverP = gr.localToWorld(kp[3].set(0.2, 0.09, 0));
        const beltP = gr.localToWorld(kp[4].set(0.17, 0.07, 0.02));
        const handle = gr.localToWorld(kp[5].set(0.12, 0.06, 0.04));
        leftT = along(
          [
            [0, handguard],
            [0.08, coverP], // flip the cover up
            [0.14, coverP],
            [0.2, boxP], // unhook the empty box
            [0.3, pouch], // a full one from the pouch
            [0.38, pouch],
            [0.47, boxP], // hook it on
            [0.55, beltP], // lay the belt across the tray
            [0.62, beltP],
            [0.68, coverP], // slam the cover
            [0.76, handle], // and charge it
            [0.84, handle],
            [0.94, handguard],
          ],
          rp,
          kp[6],
        );
        carry = rp > 0.32 && rp < 0.47 ? 1 : 0;
        // the empty box: off with the hand, then the new one appears as it's hooked on
        if (box) box.visible = !(rp > 0.2 && rp < 0.46);
      } else if (weapon === 0 || weapon === 1 || weapon === 3 || weapon === 5) {
        const mag = gr.getObjectByName("mag");
        const well = mag ? mag.getWorldPosition(kp[2]) : kp[2].copy(front);
        const below = kp[3].copy(well);
        below.y -= 0.12;
        const handle = gr.localToWorld(kp[4].set(weapon === 0 ? 0.26 : 0.12, 0.08, 0));
        const pulled = gr.localToWorld(kp[5].set(weapon === 0 ? 0.14 : 0.02, 0.08, 0));
        leftT = along(
          [
            [0, handguard],
            [0.08, well], // thumb on the release, fingers round the mag
            [0.16, below], // draw it out of the well, then let it go
            [0.27, pouch], // the empty one is falling; reach for a fresh one
            [0.35, pouch],
            [0.45, below], // line it up under the well
            [0.52, well], // and slap it home
            [0.6, handle],
            [0.68, handle],
            [0.75, pulled], // rack
            [0.92, handguard],
          ],
          rp,
          kp[6],
        );
        carry = rp > 0.29 && rp < 0.5 ? 1 : 0;
      } else if (weapon === 2) {
        const port = gr.localToWorld(kp[2].set(0.4, -0.07, 0));
        const pumpObj = gr.getObjectByName("pump");
        const pumpP = pumpObj ? pumpObj.getWorldPosition(kp[3]) : kp[3].copy(front);
        const keys: [number, THREE.Vector3][] = [[0, handguard]];
        for (let i = 0; i < 3; i++) {
          const s0 = 0.12 + i * 0.22;
          keys.push([s0 + 0.08, pouch], [s0 + 0.18, port]);
        }
        keys.push([0.8, pumpP], [1, pumpP]);
        leftT = along(keys, rp, kp[6]);
        // a shell travels from the pouch to the port in each cycle
        const ph = (rp - 0.12) / 0.22 - Math.floor((rp - 0.12) / 0.22);
        carry = rp > 0.12 && rp < 0.78 && ph > 0.38 && ph < 0.82 ? 2 : 0;
      } else if (weapon === 4 || weapon === 7) {
        // rifle: the open breech, three rounds; crossbow: one bolt from the quiver laid on the rail
        const top = weapon === 7 ? gr.localToWorld(kp[2].set(0.2, 0.08, 0)) : gr.localToWorld(kp[2].set(0.24, 0.09, 0));
        const keys: [number, THREE.Vector3][] = [[0, handguard]];
        const rounds = weapon === 7 ? 1 : 3;
        for (let i = 0; i < rounds; i++) {
          const s0 = weapon === 7 ? 0.25 : 0.22 + i * 0.13;
          const len = weapon === 7 ? 0.25 : 0.13;
          keys.push([s0 + len * 0.46, pouch], [s0 + len, top]);
        }
        keys.push([0.8, handguard]);
        leftT = along(keys, rp, kp[6]);
        const ph = (rp - 0.22) / 0.13 - Math.floor((rp - 0.22) / 0.13);
        carry = weapon === 7 ? (rp > 0.37 && rp < 0.5 ? 3 : 0) : rp > 0.22 && rp < 0.61 && ph > 0.45 ? 3 : 0;
        // the right hand leaves the grip to work the bolt, open and then closed
        const boltObj = gr.getObjectByName("bolt");
        if (boltObj) {
          const bp = boltObj.getWorldPosition(kp[4]);
          const b = Math.max(win(0.0, 0.05, 0.16, 0.22, rp), win(0.74, 0.79, 0.9, 0.96, rp));
          rightT = kp[7].copy(grip).lerp(bp, b);
        }
      }
    }
    if (picking) leftT = kp[8].copy(leftT).lerp(g.localToWorld(kp[5].set(0.5, 0.26, -0.12)), bendK);
    // magazine guns reload with the motion-captured clip: the arms are the recording's and the
    // gun rides in the right hand (held where it was when the reload began)
    const magFed = weapon === 0 || weapon === 1 || weapon === 3 || weapon === 5 || weapon === 6;
    const mocap = !!extra.reload && magFed && rp >= 0 && !throwing && !m.downed;
    const mb = mocap ? win(0, 0.08, 0.9, 1, rp) : 0;
    if (extra.reload) {
      extra.reload.setEffectiveWeight(mb * 3); // the body's weight shift and head, under our hands
      if (mocap) extra.reload.time = rp * extra.reload.getClip().duration;
    }
    // the right hand always holds the grip; the left arm is the recording's through a mag reload
    if (!socketed) {
      g.localToWorld(pole.set(-0.2, 0.7, 0.75));
      reach(bones.rArm, bones.rFore, bones.rHand, rightT, pole);
    }
    // a short arm holds the gun further back: slide the support hand along the gun (towards the
    // grip) until it's within a comfortable bend, instead of locking the arm straight in mid-air
    if (socketed && rp < 0 && !picking) {
      bones.lArm.updateWorldMatrix(true, true);
      const sh = sockV.setFromMatrixPosition(bones.lArm.matrixWorld);
      const el = sockV2.setFromMatrixPosition(bones.lFore.matrixWorld);
      const hn = tmpC.setFromMatrixPosition(bones.lHand.matrixWorld);
      const comfy = (sh.distanceTo(el) + el.distanceTo(hn)) * 0.93;
      if (sh.distanceTo(leftT) > comfy) {
        const back = kp[8].copy(grip);
        // the grip end of the slide: a hand's width ahead of the right hand (the mag well)
        back.lerp(leftT, 0.28);
        let lo = 0;
        let hi = 1;
        for (let it = 0; it < 10; it++) {
          const mid = (lo + hi) / 2;
          if (tmpA.copy(back).lerp(leftT, mid).distanceTo(sh) > comfy) hi = mid;
          else lo = mid;
        }
        leftT = kp[7].copy(back).lerp(leftT, lo);
      }
    }
    g.localToWorld(pole.set(0.35, 0.35, -0.32));
    reach(bones.lArm, bones.lFore, bones.lHand, leftT, pole);
    // hands set on the gun the way people hold one: right palm against the pistol grip with the
    // fingers wrapping its front, left palm up under the handguard. Measured in the gun's frame, so
    // they follow every tilt of the reload.
    if (gr && !throwing) {
      gr.getWorldQuaternion(qGun);
      const fwd = hd[0].set(1, -0.28, 0).applyQuaternion(qGun);
      const inward = hd[1].set(0, 0, -1).applyQuaternion(qGun);
      if (!socketed) orientHand(grips.r, fwd, inward, rightT === grip ? 1 : 0.35);
      // left: across under the handguard; while carrying, the palm turns to hold what it brings
      const across = hd[2].set(0.3, 0.2, 1).applyQuaternion(qGun);
      const up = hd[3].set(0, 1, 0.75).applyQuaternion(qGun); // palm up and in, against the handguard
      // full grip on the gun; relaxing as the hand travels away (to the belt and back)
      const away = Math.min(1, leftT.distanceTo(front) / 0.22);
      const handling = (1 - away) * (carry ? 0.6 : 1);
      orientHand(grips.l, across, up, picking ? 1 - bendK : handling);
    }
    // hands close round the grip and the handguard (looser while the left hand fetches a mag)
    curl(grips.r, 0.95, true);
    curl(grips.l, carry ? 0.55 : 0.85);
    // eyes on the work: the head tips down to the mag well through the reload
    if (rp >= 0) {
      const busy = win(0.05, 0.15, 0.85, 0.97, rp);
      bones.neck.rotation.x += 0.35 * busy;
      // shoulders come forward over the work, and turn a little toward the mag well
      bones.spine.rotation.x += 0.1 * busy;
      bones.spine.rotation.y -= 0.08 * busy;
    }
    // what the left hand is carrying, in the hand, lined up with the gun
    const h = held.current;
    if (h) {
      h.visible = carry > 0 && !ghost;
      if (carry) {
        bones.lHand.updateWorldMatrix(true, false);
        g.worldToLocal(h.position.setFromMatrixPosition(bones.lHand.matrixWorld));
        if (gr) h.quaternion.copy(gr.quaternion);
        if (heldMag.current) heldMag.current.visible = carry === 1;
        if (heldShell.current) heldShell.current.visible = carry === 2;
        if (heldRound.current) heldRound.current.visible = carry === 3;
      }
    }
  });

  // the suit rides the chest (hood, mantle, back) and the hips (skirt), oriented in the soldier's frame
  useEffect(() => {
    if (!root.current) return;
    root.current.updateMatrixWorld(true);
    const rq = root.current.getWorldQuaternion(new THREE.Quaternion());
    const rs = root.current.getWorldScale(new THREE.Vector3());
    const pairs: [THREE.Object3D | undefined, THREE.Mesh][] = [[bones.spine, cloak.upper], [bones.hips, cloak.lower]];
    for (const [bone, mesh] of pairs) {
      if (!bone) continue;
      const bq = bone.getWorldQuaternion(new THREE.Quaternion());
      const bs = bone.getWorldScale(new THREE.Vector3());
      mesh.quaternion.copy(bq.invert().multiply(rq));
      mesh.scale.set(rs.x / bs.x, rs.y / bs.y, rs.z / bs.z);
      bone.add(mesh);
    }
    return () => {
      for (const [bone, mesh] of pairs) bone?.remove(mesh);
    };
  }, [bones, cloak]);
  cloak.upper.visible = cloak.lower.visible = ghillie && !ghost;

  return (
    <group ref={root}>
      {/* the original mesh faces -z, the Mixamo exports face +z; our players face +x */}
      <group rotation-y={def.camo ? -Math.PI / 2 : Math.PI / 2} scale={scale}>
        <primitive object={model} />
      </group>
      {/* the death box a body turns into: a compact olive supply case (its footprint matches the
          solid BOX_R in the program), steel latches, and the player's colour as a thin glowing strap */}
      <group ref={box} visible={false} scale={1}>
        {/* body */}
        <mesh position={[0, 0.14, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.44, 0.26, 0.32]} />
          <meshStandardMaterial color="#3f4632" roughness={0.78} metalness={0.05} />
        </mesh>
        {/* lid, slightly proud of the body */}
        <mesh position={[0, 0.3, 0]} castShadow>
          <boxGeometry args={[0.46, 0.06, 0.34]} />
          <meshStandardMaterial color="#353b2a" roughness={0.7} metalness={0.08} />
        </mesh>
        {/* carry handle */}
        <mesh position={[0, 0.345, 0]}>
          <boxGeometry args={[0.16, 0.025, 0.04]} />
          <meshStandardMaterial color="#1b1d20" roughness={0.5} metalness={0.4} />
        </mesh>
        {/* the colour strap (glows; no light, so no shader recompiles mid-fight) */}
        <mesh position={[0, 0.17, 0]}>
          <boxGeometry args={[0.452, 0.035, 0.332]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        {/* latches and corner guards */}
        {[-0.15, 0.15].map((x) => (
          <mesh key={x} position={[x, 0.26, 0.165]}>
            <boxGeometry args={[0.05, 0.07, 0.02]} />
            <meshStandardMaterial color="#9aa0aa" roughness={0.35} metalness={0.8} />
          </mesh>
        ))}
        {[-0.215, 0.215].map((x) =>
          [-0.155, 0.155].map((z) => (
            <mesh key={`${x}${z}`} position={[x, 0.14, z]}>
              <boxGeometry args={[0.03, 0.27, 0.03]} />
              <meshStandardMaterial color="#2a2d31" roughness={0.45} metalness={0.6} />
            </mesh>
          )),
        )}
      </group>
      {/* blood spreading under a body */}
      <mesh ref={pool} rotation-x={-Math.PI / 2} visible={false}>
        <circleGeometry args={[0.55, 24]} />
        <meshStandardMaterial color="#3a0408" roughness={0.15} metalness={0.2} transparent opacity={0.85} depthWrite={false} polygonOffset polygonOffsetFactor={-4} />
      </mesh>
      {/* what the left hand brings from the vest during a reload */}
      <group ref={held} visible={false}>
        <mesh ref={heldMag} position={[0, -0.04, 0]} scale={0.85}>
          <boxGeometry args={[0.042, 0.15, 0.038]} />
          <meshStandardMaterial color="#5a606c" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh ref={heldShell} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.012, 0.012, 0.055, 8]} />
          <meshStandardMaterial color="#b8322a" roughness={0.5} />
        </mesh>
        <mesh ref={heldRound} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.0055, 0.0055, 0.07, 6]} />
          <meshStandardMaterial color="#d8b45a" metalness={0.85} roughness={0.3} emissive="#3a2a08" />
        </mesh>
      </group>
      <group ref={gunRef} position={gunBase.toArray()}>
        <group ref={innerRef} position={GUN_INNER.toArray()} scale={GUN_SCALE}>
          <Gun key={`${shown}-${look.skin ?? 0}-${look.finish}`} weapon={shown} ghost={ghost} torch={torchOn} finish={FINISHES[look.finish]?.tint} skin={look.skin ?? 0} />
        </group>
        {/* muzzle flash: two crossed bright cards at the barrel tip, for ~55 ms per shot */}
        <group ref={flash} position={[(MUZZLE_FWD[shown] ?? 0.6) - 0.1, 0, -0.11]} visible={false}>
          {[0, Math.PI / 2].map((r) => (
            <mesh key={r} rotation-x={r}>
              <planeGeometry args={[0.32, 0.16]} />
              <meshBasicMaterial color="#ffd27a" transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
          ))}
          <mesh position={[-0.03, 0, 0]}>
            <sphereGeometry args={[0.05, 8, 6]} />
            <meshBasicMaterial color="#fff6dc" toneMapped={false} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
