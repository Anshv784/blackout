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
import { ANIMS_URL, CHARACTERS, OUTFITS, FINISHES, EMOTES, DEFAULT_LOOK, skinOf, type Look } from "../game/look";

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
  deadAt?: number; // performance.now() they were killed: a recorded death plays, the gun drops
  /** which recorded death to play (the story picks; in a match it follows from the moment of death) */
  deathClip?: string;
  reloadAt?: number; // performance.now() the reload started (your own soldier only)
  reloadDur?: number; // and how long it takes, ms
  pickAt?: number; // performance.now() of a pickup: bend down and grab it
  prone?: boolean; // lying flat, crawling
  /** which way the body is moving relative to where it faces (radians: 0 forward, PI back, +PI/2 right) */
  dir?: number;
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
/** the recorded deaths in the bundle; a standing kill picks one of the first five */
const DEATHS = ["death_back", "death_rifle", "death_headshot", "death_forward", "death_dying", "death_crouch"];
/** a long recording is played a little quicker so the body is down before it turns into a crate */
const DEATH_MAX = 2.3;
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
// (the built guns: palm on the grip part at x 0.36, palm under the handguard, which ends at y -0.01)
const GRIP_AT = new THREE.Vector3(0.35, -0.08, 0.045);
const FRONT_AT = new THREE.Vector3(0.72, -0.03, -0.015);
/** a pistol is held two-handed: the support hand cups the shooting hand under the grip */
const PISTOL_FRONT = new THREE.Vector3(0.36, -0.13, -0.06);

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();
const sockM = new THREE.Matrix4();
const chestA = new THREE.Vector3();
const chestB = new THREE.Vector3();
const chestC = new THREE.Vector3();
const chestD = new THREE.Vector3();
const chestE = new THREE.Vector3();
const chestF = new THREE.Vector3();
const chestQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const sockM2 = new THREE.Matrix4();
const sockM3 = new THREE.Matrix4();
const sockV = new THREE.Vector3();
const sockV2 = new THREE.Vector3();
const sockQ = new THREE.Quaternion();
const gripV = new THREE.Vector3();
const sockQ2 = new THREE.Quaternion();
const [sockV3, sockV4, sockV5, sockV6, sockV7, sockV8, sockV9, sockV10, sockV11, palmR, palmLw] = Array.from({ length: 11 }, () => new THREE.Vector3());
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
  const g = c.getContext("2d", { willReadFrequently: true })!; // read back below: keep it off the GPU
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
const LOCO = ["idle", "walk", "run", "crouch", "crouchwalk", "walk_back", "run_back", "strafe_left", "strafe_right", "crouch_back", "crouch_strafe_left", "crouch_strafe_right", "pistol_idle", "pistol_walk", "pistol_run", "prone_idle", "prone_crawl", "prone_back"] as const;
type Loco = (typeof LOCO)[number];
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
  void 0;
  const out: Record<string, THREE.AnimationClip> = {};
  const inPlace = new Set(["dive_roll", "idle", "walk", "run", "crouchwalk", "crouch", "aim", "walk_back", "run_back", "strafe_left", "strafe_right", "crouch_back", "crouch_strafe_left", "crouch_strafe_right", "pistol_idle", "pistol_walk", "pistol_run", "prone_idle", "prone_crawl", "prone_back", "reload_stand", "reload_walk", "reload_crouch", "reload_prone", "throw", "throw_crouch", "throw_prone", "jump"]);
  for (const c of src) {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const t0 of c.tracks) {
      const t = t0.clone();
      // the bundle holds one skeleton per clip and the loader renames duplicates (Hips_3...):
      // point every track back at the real bone name
      const [rawBone, prop] = t.name.split(".");
      const bone = rawBone.replace(/_\d+$/, "");
      t.name = `${bone}.${prop}`;
      // each recording came from its own skeleton (the bundle keeps one per clip): scale its hips by
      // that skeleton's height, not the first one's, or clips from a shorter body sink into the floor
      const srcHip = prop === "position" && /Hips$/.test(bone) ? (animRoot.getObjectByName(rawBone)?.position.y ?? animHip) : animHip;
      const kc = charHip / (srcHip || 1);
      if (prop === "position") {
        if (!/Hips$/.test(bone) || retarget) continue; // only the hips move, and only on a matching skeleton
        const v = t.values;
        const x0 = v[0];
        const z0 = v[2];
        for (let i = 0; i < v.length; i += 3) {
          v[i] = inPlace.has(c.name) ? x0 * kc : v[i] * kc;
          v[i + 1] *= kc;
          v[i + 2] = inPlace.has(c.name) ? z0 * kc : v[i + 2] * kc;
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
  // reloads while standing, walking or crouched: the arms, chest and head from the recording, the
  // legs from whatever the body is doing (prone reloads use the whole body)
  const upper = (t: THREE.KeyframeTrack) => /Spine|Neck|Head|Shoulder|Arm|Hand/.test(t.name);
  for (const n of ["reload_stand", "reload_walk", "reload_crouch", "throw", "throw_crouch", "aim"])
    if (out[n]) out[n + "_up"] = new THREE.AnimationClip(n + "_up", out[n].duration, out[n].tracks.filter(upper));
  // the pistol stance on the arms alone, for the clips recorded with a rifle (crouch, strafes, backing
  // off): the chest keeps its lean and the legs their step, the arms hold the pistol out in both hands
  if (out.pistol_idle) out.pistol_arms = new THREE.AnimationClip("pistol_arms", out.pistol_idle.duration, out.pistol_idle.tracks.filter((t) => /Shoulder|Arm|Hand/.test(t.name)));
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
    const pick = (n: string, fb: string) => mixer.clipAction(def.camo ? own(fb === "walk" ? "Walk" : fb === "run" ? "Run" : "Idle") : clips[n] ?? clips[fb]);
    const actions: Record<Loco, THREE.AnimationAction> = {
      idle: mixer.clipAction(def.camo ? own("Idle") : clips.idle),
      walk: mixer.clipAction(def.camo ? own("Walk") : clips.walk),
      run: mixer.clipAction(def.camo ? own("Run") : clips.run),
      // the Mixamo bodies crouch with the recorded crouch (the original bends its own legs in code)
      crouch: pick("crouch", "idle"),
      crouchwalk: pick("crouchwalk", "walk"),
      walk_back: pick("walk_back", "walk"),
      run_back: pick("run_back", "run"),
      strafe_left: pick("strafe_left", "walk"),
      strafe_right: pick("strafe_right", "walk"),
      crouch_back: pick("crouch_back", "walk"),
      crouch_strafe_left: pick("crouch_strafe_left", "walk"),
      crouch_strafe_right: pick("crouch_strafe_right", "walk"),
      pistol_idle: pick("pistol_idle", "idle"),
      pistol_walk: pick("pistol_walk", "walk"),
      pistol_run: pick("pistol_run", "run"),
      prone_idle: pick("prone_idle", "idle"),
      prone_crawl: pick("prone_crawl", "walk"),
      prone_back: pick("prone_back", "walk"),
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
    // scrubbed by hand (time set from the game's progress), so they always line up with the gun
    const scrub = (n: string) => {
      const c = clips[n];
      if (!c) return null;
      const a = mixer.clipAction(c);
      a.play();
      a.paused = true;
      a.setEffectiveWeight(0);
      return a;
    };
    const reloads = { stand: scrub("reload_stand_up"), walk: scrub("reload_walk_up"), crouch: scrub("reload_crouch_up"), prone: scrub("reload_prone") };
    const throws = { stand: scrub("throw_up"), crouch: scrub("throw_crouch_up"), prone: scrub("throw_prone") };
    const jump = scrub("jump");
    const dive = scrub("dive_roll");
    const reload = reloads.stand;
    // recorded deaths, scrubbed from the moment of death so every client and every replay agrees
    const deaths = Object.fromEntries(DEATHS.map((n) => [n, scrub(n)])) as Record<string, THREE.AnimationAction | null>;
    // shooting: the recorded rifle aim on the arms, chest and head (the legs keep walking or crouching)
    const aim = clips.aim_up ? mixer.clipAction(clips.aim_up) : null;
    if (aim) {
      aim.play();
      aim.setEffectiveWeight(0);
    }
    const pistolArms = clips.pistol_arms ? mixer.clipAction(clips.pistol_arms) : null;
    if (pistolArms) {
      pistolArms.play();
      pistolArms.setEffectiveWeight(0);
    }
    return { emotes, reload, reloads, throws, jump, dive, deaths, aim, pistolArms };
  }, [mixer, clips]);
  const emoteRef = useRef({ at: 0, idx: -1 });
  // the gun fitted to this body: moved with the shoulder, and in closer for shorter arms
  const gunBase = useMemo(() => GUN_POS.clone(), [def]);
  const fitted = useRef(false);
  const handAnchor = useRef<THREE.Matrix4 | null>(null);
  const diveAt = useRef(0);
  const raiseK = useRef(0);
  /** how far the gun is swung out (about the grip) to keep the stock out of the chest, radians */
  const clearYaw = useRef(0);
  const aimW = useRef(0);
  const pistolW = useRef(0);
  const holdDir = useRef(new THREE.Vector3());
  const prevCrouch = useRef(false);
  const prevSpeed = useRef(0);
  const reachFix = useRef(0);

  useEffect(() => () => void mixer.stopAllAction(), [mixer]);

  const w = useRef<Record<Loco, number>>(Object.fromEntries(LOCO.map((n) => [n, n === "idle" ? 1 : 0])) as Record<Loco, number>);
  const kick = useRef(0);
  const roll = useRef(0);
  const lastShot = useRef(0);
  const flashAt = useRef(-1e9);
  const flash = useRef<THREE.Group>(null);
  const crouchK = useRef(0);
  const proneK = useRef(0);
  const landed = useRef(false); // the fallen pose has been drawn at least once
  const death = useRef<{ at: number; a: THREE.AnimationAction | null; dur: number; rate: number }>({ at: 0, a: null, dur: 0, rate: 1 });
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
  const kp = useMemo(() => Array.from({ length: 11 }, () => new THREE.Vector3()), []);
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
    const want = Object.fromEntries(LOCO.map((n) => [n, 0])) as Record<Loco, number>;
    if (def.camo) {
      // the original: its own three clips (it bends for crouch and prone in code)
      if (m.downed) want[m.speed > 0 ? "walk" : "idle"] = 1;
      else want[m.speed === 2 ? "run" : m.speed === 1 ? "walk" : "idle"] = 1;
    } else {
      // which way the legs go, relative to where the body faces: forward, back, left, right
      const d = m.dir ?? 0;
      const fw = Math.max(0, Math.cos(d));
      const bw = Math.max(0, -Math.cos(d));
      const rt = Math.max(0, Math.sin(d));
      const lt = Math.max(0, -Math.sin(d));
      const sum = fw + bw + rt + lt || 1;
      const moving = m.speed > 0;
      const pistol = weapon === 0;
      if (m.downed) want[moving ? "prone_crawl" : "prone_idle"] = 1;
      else if (m.prone) {
        if (!moving) want.prone_idle = 1;
        else {
          want.prone_crawl = (fw + rt + lt) / sum;
          want.prone_back = bw / sum;
        }
      } else if (m.crouch) {
        if (!moving) want.crouch = 1;
        else {
          want.crouchwalk = fw / sum;
          want.crouch_back = bw / sum;
          want.crouch_strafe_right = rt / sum;
          want.crouch_strafe_left = lt / sum;
        }
      } else if (!moving) want[pistol ? "pistol_idle" : "idle"] = 1;
      else if (m.speed === 2) {
        want[pistol ? "pistol_run" : "run"] = fw / sum;
        want.run_back = bw / sum;
        want.strafe_right = rt / sum;
        want.strafe_left = lt / sum;
      } else {
        want[pistol ? "pistol_walk" : "walk"] = fw / sum;
        want.walk_back = bw / sum;
        want.strafe_right = rt / sum;
        want.strafe_left = lt / sum;
      }
    }
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
    if (emoting) for (const n of LOCO) want[n] = 0;
    for (const n of LOCO) {
      if (dying) break; // the pose under a body stays exactly as it was when it fell
      w.current[n] += (want[n] - w.current[n]) * k;
      actions[n].setEffectiveWeight(w.current[n]);
    }
    // firing (or just fired) with a long gun: the stock comes up into the shoulder the way the
    // recording aims, instead of the carry pose with the gun forced level in front of it
    {
      const tn = performance.now();
      const hotA = m.firing || (m.shotAt !== undefined && tn - m.shotAt < 700);
      const aimOn = !!extra.aim && !def.camo && hotA && !m.prone && !m.downed && weapon !== 0 && !m.reloading && !dying && !emoting && tn - m.throwAt > 450;
      aimW.current += ((aimOn ? 1 : 0) - aimW.current) * Math.min(1, dt * (aimOn ? 12 : 4));
      extra.aim?.setEffectiveWeight(aimW.current * 10);
      // a pistol in a clip recorded with a rifle: the pistol arms over it
      const native = w.current.pistol_idle + w.current.pistol_walk + w.current.pistol_run;
      const pOn = weapon === 0 && !def.camo && !m.prone && !m.downed && !m.reloading && !dying && !emoting && tn - m.throwAt > 450;
      const pTarget = pOn ? Math.max(0, 1 - native) : 0;
      pistolW.current += (pTarget - pistolW.current) * Math.min(1, dt * 10);
      extra.pistolArms?.setEffectiveWeight(pistolW.current * 10);
    }
    // running strafes are the walking ones, quicker
    actions.strafe_left.timeScale = actions.strafe_right.timeScale = m.speed === 2 ? 1.45 : 1;
    actions.walk.timeScale = m.downed ? 0.45 : 1.25;
    actions.run.timeScale = 1.15;
    // the dead stop breathing once they're down
    const deadT = m.deadAt ? (performance.now() - m.deadAt) / 1000 : -1;
    if (m.deadAt && death.current.at !== m.deadAt) {
      // which recording: the story names one; crouched kills fold down; prone and downed keep the
      // procedural fall (no recording starts lying down); otherwise one picked from the moment of death
      const name = def.camo || m.prone || m.downed ? null : m.deathClip ?? (m.crouch ? "death_crouch" : DEATHS[Math.floor(Math.abs(m.deadAt * 7.31)) % 5]);
      const a = name ? extra.deaths[name] ?? null : null;
      for (const d of Object.values(extra.deaths)) d?.setEffectiveWeight(0);
      const dur = a ? a.getClip().duration : 0;
      death.current = { at: m.deadAt, a, dur, rate: Math.max(1, Math.min(1.4, dur / DEATH_MAX)) };
    }
    if (!m.deadAt && death.current.a) {
      death.current.a.setEffectiveWeight(0);
      death.current = { at: 0, a: null, dur: 0, rate: 1 };
    }
    const rec = death.current.a;
    const recEnd = rec ? death.current.dur / death.current.rate : 0;
    const boxAt = rec ? Math.max(BOX_AT, recEnd + 0.5) : BOX_AT;
    // landed: the body is frozen exactly as it fell. Nothing touches the skeleton any more.
    if (landed.current && deadT > (rec ? recEnd + 0.05 : 1.3)) {
      if (pool.current) pool.current.scale.setScalar(0.15 + 0.85 * Math.sqrt(Math.min(1, (deadT - 0.6) / 4)));
      // then the body becomes a death box: it sinks into the ground as a crate pops up in its place
      const bt = (deadT - boxAt) / BOX_DUR;
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
    mixer.update(deadT > 0.9 && !rec ? 0 : dt);
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
    if (deadT >= 0 && rec) {
      // the recording takes the whole body over a fifth of a second, then plays out and holds its last frame
      const f = Math.min(1, deadT / 0.2);
      for (const n of LOCO) actions[n].setEffectiveWeight(w.current[n] * (1 - f));
      extra.emotes.forEach((a) => a?.setEffectiveWeight(0));
      for (const a of [...Object.values(extra.reloads), ...Object.values(extra.throws), extra.jump, extra.dive]) a?.setEffectiveWeight(0);
      rec.setEffectiveWeight(Math.max(0.001, f) * 20);
      rec.time = Math.min(death.current.dur - 1e-3, deadT * death.current.rate);
      mixer.update(0);
      model.rotation.x = 0;
      model.rotation.z = 0;
      model.position.y = 0;
      if (deadT > recEnd) landed.current = true;
      if (gunRef.current) {
        // the gun leaves the hands and clatters down beside the body
        const gt = Math.min(1, deadT / 0.6);
        gunRef.current.visible = true;
        gunRef.current.position.set(gunBase.x + 0.35 * gt, Math.max(0.04, gunBase.y * (1 - gt * gt)), gunBase.z + 0.25 * gt);
        gunRef.current.rotation.set((Math.PI / 2) * gt, 0, 0);
      }
      if (pool.current) {
        const k2 = THREE.MathUtils.clamp((deadT - recEnd * 0.7) / 4, 0, 1);
        pool.current.visible = !ghost && deadT > recEnd * 0.6;
        pool.current.scale.setScalar(0.15 + 0.85 * Math.sqrt(k2));
        bones.spine.updateWorldMatrix(true, false);
        g.worldToLocal(tmpA.setFromMatrixPosition(bones.spine.matrixWorld));
        pool.current.position.set(tmpA.x, 0.015, tmpA.z);
      }
      return;
    }
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
    model.rotation.x += ((!def.camo ? 0 : m.downed ? -1.35 : m.prone ? -1.5 : 0) - model.rotation.x) * k;
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
    model.position.y = !def.camo ? 0 : m.downed ? 0.18 / scale : pk2 > 0.01 ? (0.06 * pk2) / scale : lift / scale;
    if (pk2 > 0.01 && false) {
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
    const thrA = !def.camo ? (m.prone ? extra.throws.prone : m.crouch ? extra.throws.crouch : extra.throws.stand) : null;
    const thrDur = thrA ? thrA.getClip().duration / 1.4 : 0.45; // played a little quicker than recorded
    const throwT = (now - m.throwAt) / 1000;
    const throwing = throwT >= 0 && throwT < (thrA ? thrDur : 0.45);
    for (const a of [extra.throws.stand, extra.throws.crouch, extra.throws.prone]) {
      if (!a) continue;
      const on = a === thrA && throwing;
      a.setEffectiveWeight(on ? 20 * Math.min(1, throwT / 0.12, (thrDur - throwT) / 0.15) : 0);
      if (on) a.time = Math.min(a.getClip().duration - 1e-3, throwT * 1.4);
    }
    // sprint, then drop to a crouch: a dive roll into cover (the recording, start to finish)
    if (extra.dive && !def.camo) {
      if (m.crouch && !prevCrouch.current && prevSpeed.current === 2 && !m.prone) diveAt.current = now;
      prevCrouch.current = !!m.crouch;
      if (!m.crouch) prevSpeed.current = m.speed;
      const dd = extra.dive.getClip().duration / 1.3;
      const dt2 = (now - diveAt.current) / 1000;
      const on = diveAt.current > 0 && dt2 >= 0 && dt2 < dd;
      extra.dive.setEffectiveWeight(on ? 20 * Math.min(1, dt2 / 0.08, (dd - dt2) / 0.25) : 0);
      if (on) extra.dive.time = dt2 * 1.3;
    }
    // jumps: the recording, scrubbed over the game's half-second hop
    if (extra.jump && !def.camo) {
      const jt = m.jumpAt ? (now - m.jumpAt) / 500 : 1;
      const on = jt >= 0 && jt < 1 && !m.prone && !m.downed;
      extra.jump.setEffectiveWeight(on ? 20 * Math.min(1, jt / 0.1, (1 - jt) / 0.15) : 0);
      if (on) extra.jump.time = (0.15 + jt * 0.7) * extra.jump.getClip().duration;
    }
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
    // Holding the gun the way the recording does. Every rifle clip carries an invisible rifle in both
    // hands, so each frame the gun is laid along the line from the right palm to the left palm, with
    // this gun's pistol grip in the right palm. Walk, run, crouch, prone and reload all carry it right,
    // and nothing passes through the chest, because the recording never did. The pistol keeps its own
    // two-handed stance (both hands on the grip, so the line between them means nothing there).
    // while an emote is still on the body (fading in or out) the arms aren't holding anything
    const emoteW = extra.emotes.reduce((mx, a) => Math.max(mx, a ? a.getEffectiveWeight() : 0), 0);
    const socket = !def.camo && !!gr && !!inner && !throwing && !m.downed && !!grips.r && !!grips.l && emoteW < 0.04;
    let socketed = false;
    let supportPart: THREE.Vector3 | null = null;
    if (socket && gr && inner && grips.r && grips.l) {
      g.updateMatrixWorld(true);
      const ws = g.getWorldScale(sockV5).x;
      const palmOf = (gp: Grip, out: THREE.Vector3) => {
        gp.hand.updateWorldMatrix(true, false);
        const q = gp.hand.getWorldQuaternion(sockQ2);
        out.setFromMatrixPosition(gp.hand.matrixWorld)
          .addScaledVector(sockV3.copy(gp.finger).applyQuaternion(q), 0.045 * ws)
          .addScaledVector(sockV4.copy(gp.palm).applyQuaternion(q), 0.022 * ws);
        return out;
      };
      const rW = palmOf(grips.r, palmR);
      const lW = palmOf(grips.l, palmLw);
      const rL = g.worldToLocal(sockV6.copy(rW));
      const lL = g.worldToLocal(sockV7.copy(lW));
      const gripLocal = gripV.copy(gm?.grip ? sockV2.fromArray(gm.grip) : sockV2.copy(GRIP_AT)).multiplyScalar(GUN_SCALE).add(GUN_INNER);
      const dir = sockV8.copy(lL).sub(rL);
      const pistolHold = weapon === 0 || dir.length() < 0.09;
      if (pistolHold) {
        // straight out of the shooting hand, both hands round the grip
        dir.set(1, 0, 0);
      } else dir.normalize();
      // never pointing back or across the body: when the recording's hands cross (crouch walk, mid-step)
      // fall back towards straight ahead, keeping some of the tilt
      if (dir.x < 0.6) {
        const k = THREE.MathUtils.clamp((0.6 - dir.x) / 0.8, 0, 1);
        dir.lerp(sockV9.set(1, dir.y * 0.4, dir.z * 0.3).normalize(), k).normalize();
        if (dir.x < 0.5) dir.set(1, Math.max(-0.4, Math.min(0.3, dir.y)), Math.max(-0.4, Math.min(0.4, dir.z))).normalize();
      }
      // smooth out frame-to-frame wobble in the recording
      if (holdDir.current.lengthSq() < 0.5) holdDir.current.copy(dir);
      holdDir.current.lerp(dir, Math.min(1, dt * 18)).normalize();
      const along = holdDir.current;
      const upV = sockV9.set(0, 1, 0).addScaledVector(along, -along.y).normalize();
      const side = sockV10.crossVectors(along, upV);
      const frame = sockM2.makeBasis(along, upV, side).setPosition(rL);
      // the line between the palms runs from the grip to the handguard, not along the barrel: on a
      // real rifle the grip hangs lower than the handguard, so the barrel sits a few degrees off it
      if (!pistolHold) {
        const fp = gm?.front ?? [FRONT_AT.x, FRONT_AT.y, FRONT_AT.z];
        const gpx = gm?.grip ?? [GRIP_AT.x, GRIP_AT.y, GRIP_AT.z];
        frame.multiply(sockM.makeRotationZ(-Math.atan2(fp[1] - gpx[1], fp[0] - gpx[0])));
      }
      frame.multiply(sockM3.makeTranslation(-gripLocal.x, -gripLocal.y, -gripLocal.z));
      frame.decompose(gr.position, gr.quaternion, tmpB);
      gr.scale.set(1, 1, 1);
      // firing (or just fired): the gun comes up level to point straight ahead, about the grip
      const hot = m.firing || (m.shotAt !== undefined && now - m.shotAt < 700);
      raiseK.current += ((hot ? 1 : 0) - raiseK.current) * Math.min(1, dt * (hot ? 14 : 3));
      if (raiseK.current > 0.01) {
        const gp = sockV2.copy(gripLocal).applyQuaternion(gr.quaternion).add(gr.position);
        gr.quaternion.slerp(sockQ.identity(), raiseK.current);
        gr.position.copy(gp).sub(sockV.copy(gripLocal).applyQuaternion(gr.quaternion));
      }
      // never through the chest: when the operator turns or shifts weight, the recording's hands can
      // bring the back of the gun into the body. The torso is an oval sized from this operator's
      // shoulders (TITAN's armour is far wider than VIPER); if the stock lands inside it, swing the
      // gun about its grip (the right hand stays put) until the stock rests against the body.
      if (!pistolHold && bones.spine && bones.lArm && bones.rArm) {
        const sp = g.worldToLocal(chestA.setFromMatrixPosition(bones.spine.matrixWorld));
        const la = g.worldToLocal(chestB.setFromMatrixPosition(bones.lArm.matrixWorld));
        const ra = g.worldToLocal(chestC.setFromMatrixPosition(bones.rArm.matrixWorld));
        // the arm bones sit at the shoulder joints, inside the body: the surface (muscle, or TITAN's
        // plate) is a few centimetres further out
        const halfW = Math.max(0.16, la.distanceTo(ra) * 0.5 + 0.065);
        const halfD = halfW * 0.72;
        const top = Math.max(la.y, ra.y) + 0.08;
        const low = sp.y - 0.38;
        // the back of the gun relative to the grip, in the gun's own frame
        const rel = chestD.set(gm ? gm.rear + 0.03 : 0.12, gm ? gm.y : 0, 0).multiplyScalar(GUN_SCALE).add(GUN_INNER).sub(gripLocal);
        const gp = chestE.copy(gripLocal).applyQuaternion(gr.quaternion).add(gr.position);
        const depth = (yaw: number) => {
          chestQ.setFromAxisAngle(UP, yaw).multiply(gr.quaternion);
          const st = chestF.copy(rel).applyQuaternion(chestQ).add(gp);
          if (st.y > top || st.y < low) return 2;
          return ((st.x - sp.x) / halfD) ** 2 + ((st.z - sp.z) / halfW) ** 2;
        };
        let want = 0;
        if (depth(0) < 1) {
          // swing whichever way clears sooner, at most ~80°
          for (let k = 1; k <= 28 && want === 0; k++) {
            const a = k * 0.05;
            const out = depth(a), inn = depth(-a);
            if (out >= 1 || inn >= 1) want = out >= inn ? a : -a;
          }
          if (want === 0) want = depth(1.4) > depth(-1.4) ? 1.4 : -1.4;
        }
        // swing out fast (never let it sink in), ease back slowly
        clearYaw.current += (want - clearYaw.current) * Math.min(1, dt * (Math.abs(want) > Math.abs(clearYaw.current) ? 30 : 8));
        if (Math.abs(clearYaw.current) > 1e-3) {
          chestQ.setFromAxisAngle(UP, clearYaw.current);
          gr.quaternion.premultiply(chestQ);
          gr.position.copy(gp).sub(chestF.copy(gripLocal).applyQuaternion(gr.quaternion));
        }
      }
      // the shot kicks: back along the barrel, muzzle up
      const K2 = RECOIL[weapon] ?? RECOIL[0];
      gr.translateX(-kick.current * K2[0]);
      gr.rotateZ(kick.current * K2[1]);
      gr.updateMatrixWorld(true);
      // the support hand closes on this gun's handguard, as near as it can to where the recording
      // has it: projected onto the gun, kept between the mag well and the muzzle end
      if (!pistolHold) {
        const pl = inner.worldToLocal(sockV11.copy(lW));
        const f = gm?.front ?? [FRONT_AT.x, FRONT_AT.y, FRONT_AT.z];
        // slides along the handguard: from the measured hold to a little ahead of it (never back onto the mag well),
        // never past the muzzle (the compact SMG's whole handguard is a few centimetres long)
        const endX = gm ? gm.rear + gm.len * 0.9 : 0.85;
        pl.set(THREE.MathUtils.clamp(pl.x, f[0] - 0.02, Math.max(f[0] - 0.02, Math.min(f[0] + 0.12, endX))), f[1], f[2]);
        supportPart = pl;
      }
      socketed = true;
    }
    const grip = gr && inner ? inner.localToWorld(gm?.grip ? target.fromArray(gm.grip) : target.copy(GRIP_AT)) : target.set(0, 0, 0);
    let rightT: THREE.Vector3 = grip;
    if (throwing) {
      // overhand throw with the right arm
      const p = (now - m.throwAt) / 450;
      rightT = g.localToWorld(kp[7].set(0.1 + p * 0.5, 1.45 - p * 0.35, 0.18));
    }
    const front = gr && inner ? inner.localToWorld(supportPart ? ikF.copy(supportPart) : gm?.front ? ikF.fromArray(gm.front) : ikF.copy(weapon === 0 ? PISTOL_FRONT : FRONT_AT)) : grip;
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
    // every gun reloads with a recording: lying down, crouched, on the move or standing
    const rlA = !def.camo ? (m.prone ? extra.reloads.prone : m.crouch ? extra.reloads.crouch : m.speed > 0 ? extra.reloads.walk : extra.reloads.stand) : null;
    const mocap = !!rlA && rp >= 0 && !throwing && !m.downed;
    const mb = mocap ? win(0, 0.06, 0.92, 1, rp) : 0;
    for (const a of [extra.reloads.stand, extra.reloads.walk, extra.reloads.crouch, extra.reloads.prone]) {
      if (!a) continue;
      const on = mocap && a === rlA;
      a.setEffectiveWeight(on ? 20 * mb : 0);
      if (on) a.time = rp * a.getClip().duration;
    }
    void magFed;
    // the right hand always holds the grip; the left arm is the recording's through a mag reload
    if (!socketed && !(throwing && !def.camo)) {
      g.localToWorld(pole.set(-0.2, 0.7, 0.75));
      reach(bones.rArm, bones.rFore, bones.rHand, rightT, pole);
    }
    // throwing: both hands are the recording's; the gun is slung out of sight until it's over
    if (gr && !def.camo) gr.visible = !throwing && !m.downed && emoteW < 0.04;
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
    const leftFree = !def.camo && (mb > 0.4 || throwing);
    // `front` is where the centre of the left PALM goes; the arm reaches with the wrist, so aim the
    // wrist a palm's length back from it (in the turn the hand is about to be given below), or the
    // fingers end up past the handguard (on the short SMG, right off the gun)
    const leftPalmT = kp[10].copy(leftT); // where the palm goes (leftT becomes the wrist's target)
    if (!leftFree && gr && !throwing && grips.l) {
      // away from the handguard only while a reload carries the hand off (a short arm sliding back
      // along the gun is still holding it)
      const hold = rp >= 0 ? 1 - Math.min(1, leftT.distanceTo(front) / 0.22) : 1;
      if (hold > 0) {
        const ws = g.getWorldScale(sockV5).x;
        gr.getWorldQuaternion(qGun);
        const fA = hd[2].set(0.3, 0.2, 1).applyQuaternion(qGun).normalize();
        const pA = hd[3].set(0, 1, 0.75).applyQuaternion(qGun);
        pA.addScaledVector(fA, -pA.dot(fA)).normalize();
        leftT = kp[9].copy(leftT).addScaledVector(fA, -0.045 * ws * hold).addScaledVector(pA, -0.022 * ws * hold);
      }
    }
    if (!leftFree) {
      g.localToWorld(pole.set(0.35, 0.35, -0.32));
      reach(bones.lArm, bones.lFore, bones.lHand, leftT, pole);
    }
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
      const away = rp >= 0 ? Math.min(1, leftPalmT.distanceTo(front) / 0.22) : 0;
      const handling = (1 - away) * (carry ? 0.6 : 1);
      if (!leftFree) orientHand(grips.l, across, up, picking ? 1 - bendK : handling);
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
          <Gun key={`${shown}-${skinOf(look, shown)}-${look.finish}`} weapon={shown} ghost={ghost} torch={torchOn} finish={FINISHES[look.finish]?.tint} skin={skinOf(look, shown)} />
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
