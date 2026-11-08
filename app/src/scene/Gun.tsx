import * as THREE from "three";
import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { applySkin, bakeSkinSpace, tickSkins } from "./skins";
import { LegendFx, isLegend } from "./LegendFx";
/** `n` names a moving part the reload animates: the magazine, the shotgun's pump, the Talon's bolt */
type Part = { p: [number, number, number]; s: [number, number, number]; c?: string; r?: number; ry?: number; cyl?: boolean; glow?: string; n?: string };


// Built in "part space": +x along the barrel. The right hand closes on the pistol grip at x≈0.36,
// the left on the handguard at x≈0.69 (see Soldier: grip / front). Original designs, simple shapes.
const M = "#2a2d35"; // steel
const P = "#16181e"; // polymer
const W = "#3a2a1c"; // wood
const R = "#111214"; // rubber
const GUNS: Part[][] = [
  // 0 · pistol: slide, frame, grip, mag, sights
  [
    { p: [0.42, 0.02, 0], s: [0.24, 0.06, 0.055] },
    { p: [0.41, -0.025, 0], s: [0.21, 0.035, 0.05], c: P },
    { p: [0.36, -0.09, 0], s: [0.055, 0.12, 0.05], c: P, r: 0.22 },
    { p: [0.355, -0.16, 0], s: [0.045, 0.035, 0.042], c: R, n: "mag" },
    { p: [0.4, -0.06, 0], s: [0.06, 0.008, 0.02], c: M },
    { p: [0.53, 0.058, 0], s: [0.012, 0.016, 0.012], c: M },
    { p: [0.32, 0.058, 0], s: [0.016, 0.016, 0.03], c: M },
    { p: [0.545, 0.02, 0], s: [0.012, 0.03, 0.03], c: R, cyl: true },
  ],
  // 1 · SMG: compact receiver, short handguard, straight mag, folding stock
  [
    { p: [0.45, 0.02, 0], s: [0.3, 0.075, 0.06] },
    { p: [0.47, 0.068, 0], s: [0.26, 0.014, 0.028], c: M },
    { p: [0.36, -0.07, 0], s: [0.045, 0.1, 0.045], c: P, r: 0.3 },
    { p: [0.5, -0.11, 0], s: [0.045, 0.16, 0.042], c: P, n: "mag" },
    { p: [0.66, 0.015, 0], s: [0.1, 0.065, 0.06], c: P },
    { p: [0.75, 0.02, 0], s: [0.1, 0.016, 0.016], c: M, cyl: true },
    { p: [0.8, 0.02, 0], s: [0.04, 0.022, 0.022], c: R, cyl: true },
    { p: [0.25, 0.0, 0], s: [0.14, 0.018, 0.04], c: M },
    { p: [0.18, -0.02, 0], s: [0.02, 0.08, 0.045], c: R },
    { p: [0.46, 0.098, 0], s: [0.06, 0.04, 0.04], c: P },
    { p: [0.43, 0.098, 0], s: [0.008, 0.026, 0.026], glow: "#ff3b3b" },
  ],
  // 2 · shotgun: long receiver, tube under the barrel, wooden pump and stock
  [
    { p: [0.46, 0.015, 0], s: [0.28, 0.085, 0.065] },
    { p: [0.85, 0.035, 0], s: [0.5, 0.02, 0.02], c: M, cyl: true },
    { p: [0.8, -0.015, 0], s: [0.4, 0.017, 0.017], c: M, cyl: true },
    { p: [0.69, -0.03, 0], s: [0.17, 0.055, 0.075], c: W, n: "pump" },
    { p: [0.37, -0.08, 0], s: [0.045, 0.1, 0.045], c: W, r: 0.35 },
    { p: [0.22, -0.02, 0], s: [0.2, 0.08, 0.055], c: W, r: -0.08 },
    { p: [0.115, -0.03, 0], s: [0.016, 0.11, 0.06], c: R },
    { p: [1.09, 0.06, 0], s: [0.012, 0.016, 0.012], c: M },
    { p: [0.42, -0.055, 0], s: [0.07, 0.01, 0.02], c: M },
  ],
  // 3 · assault rifle: rail, red dot, vented handguard, curved mag, tube stock, muzzle brake
  [
    { p: [0.47, 0.025, 0], s: [0.32, 0.07, 0.058] },
    { p: [0.43, -0.03, 0], s: [0.2, 0.05, 0.054], c: P },
    { p: [0.5, 0.07, 0], s: [0.4, 0.014, 0.03], c: M },
    { p: [0.36, -0.1, 0], s: [0.044, 0.11, 0.045], c: P, r: 0.35 },
    { p: [0.52, -0.13, 0], s: [0.048, 0.17, 0.044], c: M, r: 0.28, n: "mag" },
    { p: [0.42, -0.065, 0], s: [0.07, 0.01, 0.02], c: M },
    { p: [0.72, 0.02, 0], s: [0.22, 0.072, 0.066], c: P },
    ...[0.65, 0.72, 0.79].map((x): Part => ({ p: [x, 0.02, 0.034], s: [0.035, 0.022, 0.004], c: R })),
    { p: [0.9, 0.022, 0], s: [0.16, 0.013, 0.013], c: M, cyl: true },
    { p: [0.99, 0.022, 0], s: [0.05, 0.021, 0.021], c: R, cyl: true },
    { p: [0.23, 0.01, 0], s: [0.14, 0.02, 0.02], c: M, cyl: true },
    { p: [0.15, -0.0, 0], s: [0.12, 0.075, 0.05], c: P },
    { p: [0.087, -0.005, 0], s: [0.014, 0.1, 0.055], c: R },
    { p: [0.31, 0.05, 0.028], s: [0.03, 0.014, 0.03], c: M },
    { p: [0.47, 0.105, 0], s: [0.07, 0.05, 0.045], c: P },
    { p: [0.435, 0.105, 0], s: [0.008, 0.032, 0.032], glow: "#ff3b3b" },
  ],
  // 4 · bolt-action rifle: one-piece wooden stock, long barrel, scope with rings, bolt handle
  [
    { p: [0.58, -0.005, 0], s: [0.56, 0.065, 0.062], c: W },
    { p: [0.25, -0.03, 0], s: [0.22, 0.1, 0.055], c: W, r: -0.1 },
    { p: [0.135, -0.04, 0], s: [0.016, 0.12, 0.06], c: R },
    { p: [0.37, -0.075, 0], s: [0.05, 0.09, 0.05], c: W, r: 0.4 },
    { p: [0.5, 0.04, 0], s: [0.22, 0.045, 0.05] },
    { p: [1.06, 0.03, 0], s: [0.44, 0.014, 0.014], c: M, cyl: true },
    { p: [1.28, 0.03, 0], s: [0.035, 0.018, 0.018], c: R, cyl: true },
    { p: [0.55, 0.115, 0], s: [0.3, 0.032, 0.032], c: P, cyl: true },
    { p: [0.42, 0.115, 0], s: [0.06, 0.04, 0.04], c: P, cyl: true },
    { p: [0.7, 0.115, 0], s: [0.06, 0.045, 0.045], c: P, cyl: true },
    { p: [0.735, 0.115, 0], s: [0.006, 0.04, 0.04], glow: "#9fd8ff" },
    ...[0.48, 0.62].map((x): Part => ({ p: [x, 0.08, 0], s: [0.02, 0.035, 0.04], c: M })),
    { p: [0.3, 0.035, 0.055], s: [0.025, 0.025, 0.06], c: M, n: "bolt" },
    { p: [0.42, -0.055, 0], s: [0.07, 0.01, 0.02], c: M },
  ],
  // 5 · marksman rifle: skeleton stock, short box mag, long fluted barrel, scope on a rail
  [
    { p: [0.48, 0.025, 0], s: [0.3, 0.068, 0.056] },
    { p: [0.43, -0.028, 0], s: [0.18, 0.045, 0.052], c: P },
    { p: [0.5, 0.068, 0], s: [0.36, 0.013, 0.03], c: M },
    { p: [0.36, -0.1, 0], s: [0.044, 0.11, 0.045], c: P, r: 0.35 },
    { p: [0.52, -0.1, 0], s: [0.05, 0.11, 0.042], c: M, r: 0.08, n: "mag" },
    { p: [0.42, -0.065, 0], s: [0.07, 0.01, 0.02], c: M },
    { p: [0.74, 0.02, 0], s: [0.22, 0.06, 0.06], c: P },
    { p: [0.98, 0.022, 0], s: [0.3, 0.014, 0.014], c: M, cyl: true },
    { p: [1.14, 0.022, 0], s: [0.04, 0.02, 0.02], c: R, cyl: true },
    // skeleton stock: top bar, bottom bar, butt
    { p: [0.21, 0.02, 0], s: [0.2, 0.02, 0.03], c: P },
    { p: [0.2, -0.04, 0], s: [0.18, 0.018, 0.03], c: P, r: 0.12 },
    { p: [0.105, -0.01, 0], s: [0.016, 0.1, 0.05], c: R },
    { p: [0.52, 0.11, 0], s: [0.26, 0.03, 0.03], c: P, cyl: true },
    { p: [0.4, 0.11, 0], s: [0.04, 0.038, 0.038], c: P, cyl: true },
    { p: [0.65, 0.11, 0], s: [0.05, 0.042, 0.042], c: P, cyl: true },
    { p: [0.675, 0.11, 0], s: [0.006, 0.036, 0.036], glow: "#9fd8ff" },
  ],
  // 6 · LMG: bulky receiver, box mag below, carry handle, heavy barrel with a folded bipod
  [
    { p: [0.47, 0.025, 0], s: [0.34, 0.09, 0.07] },
    { p: [0.43, -0.035, 0], s: [0.22, 0.05, 0.064], c: P },
    { p: [0.5, 0.075, 0], s: [0.24, 0.016, 0.07], c: M, n: "lid" },
    { p: [0.36, -0.1, 0], s: [0.046, 0.11, 0.046], c: P, r: 0.35 },
    { p: [0.5, -0.11, 0], s: [0.12, 0.1, 0.1], c: P, n: "mag" },
    { p: [0.42, -0.07, 0], s: [0.07, 0.01, 0.02], c: M },
    { p: [0.74, 0.02, 0], s: [0.24, 0.08, 0.075], c: M },
    ...[0.66, 0.74, 0.82].map((x): Part => ({ p: [x, 0.02, 0.039], s: [0.04, 0.03, 0.004], c: R })),
    { p: [1.0, 0.025, 0], s: [0.28, 0.02, 0.02], c: M, cyl: true },
    { p: [1.15, 0.025, 0], s: [0.05, 0.026, 0.026], c: R, cyl: true },
    { p: [0.5, 0.12, 0], s: [0.14, 0.014, 0.022], c: M },
    { p: [0.44, 0.1, 0], s: [0.014, 0.04, 0.02], c: M },
    { p: [0.56, 0.1, 0], s: [0.014, 0.04, 0.02], c: M },
    { p: [0.94, -0.01, 0.018], s: [0.18, 0.012, 0.012], c: M, cyl: true },
    { p: [0.94, -0.01, -0.018], s: [0.18, 0.012, 0.012], c: M, cyl: true },
    { p: [0.21, 0.0, 0], s: [0.18, 0.08, 0.055], c: P },
    { p: [0.115, -0.005, 0], s: [0.016, 0.11, 0.06], c: R },
  ],
  // 7 · crossbow: stock and rail, swept limbs, string, a bolt laid on the rail
  [
    { p: [0.55, 0.02, 0], s: [0.56, 0.045, 0.05], c: P },
    { p: [0.58, 0.05, 0], s: [0.5, 0.012, 0.022], c: M },
    { p: [0.36, -0.08, 0], s: [0.044, 0.1, 0.045], c: P, r: 0.3 },
    { p: [0.42, -0.04, 0], s: [0.07, 0.01, 0.02], c: M },
    { p: [0.21, -0.01, 0], s: [0.22, 0.08, 0.05], c: P, r: -0.06 },
    { p: [0.105, -0.02, 0], s: [0.016, 0.1, 0.055], c: R },
    // limbs, swept forward from the riser, and the riser block
    { p: [0.82, 0.03, 0], s: [0.05, 0.06, 0.08], c: M },
    { p: [0.8, 0.03, 0.15], s: [0.03, 0.03, 0.24], c: P, ry: -0.35 },
    { p: [0.8, 0.03, -0.15], s: [0.03, 0.03, 0.24], c: P, ry: 0.35 },
    // the string, drawn back to the latch
    { p: [0.64, 0.055, 0.12], s: [0.006, 0.006, 0.32], c: "#d8d2c0", ry: -0.78 },
    { p: [0.64, 0.055, -0.12], s: [0.006, 0.006, 0.32], c: "#d8d2c0", ry: 0.78 },
    // the bolt (vanes at the back)
    { p: [0.7, 0.066, 0], s: [0.4, 0.007, 0.007], c: "#8a8f98", cyl: true, n: "arrow" },
    { p: [0.52, 0.066, 0], s: [0.04, 0.02, 0.003], c: "#c4473b" },
    { p: [0.43, 0.08, 0], s: [0.06, 0.03, 0.03], c: P },
  ],
];

// where the under-barrel torch sits on each gun (x along the barrel, from the hand)
/** where the barrel ends, relative to the player (forward, height): shots and flashes start here */
export const MUZZLE_FWD = [0.254, 0.312, 0.679, 0.542, 0.83, 0.71, 0.629, 0.571]; // = 0.05 - 0.17 + 0.72 x each barrel's end
export const MUZZLE_Y = 1.0;
export function muzzleAt(x: number, y: number, aimRad: number, weapon: number, crouch = false) {
  const f = MUZZLE_FWD[weapon] ?? 0.6;
  return { x: x + Math.cos(aimRad) * f, z: y + Math.sin(aimRad) * f, y: MUZZLE_Y - (crouch ? 0.26 : 0) };
}
export const TORCH_X = [0.48, 0.66, 0.86, 0.8, 0.9, 0.82, 0.86, 0.55];
/** the moving part's rest position, so a reload can offset it and put it back */
export function partRest(weapon: number, name: string) {
  return (GUNS[weapon] ?? GUNS[0]).find((pt) => pt.n === name)?.p;
}

/** Real gun models (CC-BY, credits in CREDITS.md). Each is turned so its barrel runs along +x,
 *  scaled to `len` in part space and placed with its rear end at `rear`; `flip` fixes models
 *  that point the other way or sit upside down; `y` lifts it so the grip meets the right hand. */
export interface GunModel {
  url: string;
  len: number;
  rear: number;
  y: number;
  flip?: [boolean, boolean];
  /** extra turn about the barrel (radians), for models lying on their side */
  roll?: number;
  /** where this model's pistol grip and handguard are, in part space (hands go here) */
  grip?: [number, number, number];
  front?: [number, number, number];
}
// grip / front measured on each model in part space (side view on a 5 cm grid): `grip` is the
// centre of the right palm on the pistol grip (a little outside it, +z), `front` the centre of the
// left palm cupped under the handguard (just below it, barely left of centre)
export const GUN_MODELS: Partial<Record<number, GunModel>> = {
  0: { url: "/models/guns/pistol.glb", len: 0.27, rear: 0.25, y: -0.02, flip: [true, false], grip: [0.29, 0.0, 0.045], front: [0.31, -0.03, -0.04] },
  1: { url: "/models/guns/smg.glb", len: 0.55, rear: 0.05, y: -0.01, grip: [0.42, -0.07, 0.045], front: [0.55, -0.065, -0.015] },
  2: { url: "/models/guns/shotgun.glb", len: 1.0, rear: 0.11, y: -0.01, grip: [0.245, -0.01, 0.045], front: [0.78, -0.045, -0.015] },
  3: { url: "/models/guns/rifle.glb", len: 0.95, rear: -0.03, y: -0.01, flip: [true, false], grip: [0.295, -0.035, 0.045], front: [0.66, 0.035, -0.015] },
  4: { url: "/models/guns/sniper.glb", len: 1.2, rear: 0.12, y: 0.0, grip: [0.39, -0.055, 0.045], front: [0.72, -0.035, -0.015] },
  6: { url: "/models/guns/lmg.glb", len: 1.08, rear: -0.04, y: -0.01, grip: [0.3, -0.05, 0.045], front: [0.64, -0.045, -0.015] },
  7: { url: "/models/guns/crossbow.glb", len: 0.86, rear: 0.1, y: 0.0, roll: Math.PI / 2, grip: [0.37, -0.045, 0.045], front: [0.63, -0.065, -0.015] },
};
for (const m of Object.values(GUN_MODELS)) if (m) useGLTF.preload(m.url);

/** the transform that lays a model along +x at its slot's size (cached per url) */
const fitCache = new Map<string, THREE.Matrix4>();
function fitFor(scene: THREE.Object3D, m: GunModel) {
  const hit = fitCache.get(m.url + JSON.stringify(m.flip ?? []) + (m.roll ?? 0) + m.len + m.rear + m.y);
  if (hit) return hit;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  // longest axis -> x (the barrel), next longest -> y (the height)
  const ax = [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a));
  const basis = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const X = basis[ax[0]].clone().multiplyScalar(m.flip?.[0] ? -1 : 1);
  const Y = basis[ax[1]].clone().multiplyScalar(m.flip?.[1] ? -1 : 1);
  const Z = new THREE.Vector3().crossVectors(X, Y);
  // rows of the rotation = the model axes that become x, y, z
  const rot = new THREE.Matrix4().set(X.x, X.y, X.z, 0, Y.x, Y.y, Y.z, 0, Z.x, Z.y, Z.z, 0, 0, 0, 0, 1);
  const k = m.len / size.getComponent(ax[0]);
  const mat = new THREE.Matrix4()
    .makeTranslation(m.rear + m.len / 2, m.y, 0)
    .multiply(new THREE.Matrix4().makeRotationX(m.roll ?? 0))
    .multiply(new THREE.Matrix4().makeScale(k, k, k))
    .multiply(rot)
    .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
  fitCache.set(m.url + JSON.stringify(m.flip ?? []) + (m.roll ?? 0) + m.len + m.rear + m.y, mat);
  return mat;
}

const modelMats = new Map<string, THREE.Material>();
function ModelGun({ m, finish, skin, ghost, glow }: { m: GunModel; finish?: string; skin: number; ghost: boolean; glow: number }) {
  const gltf = useGLTF(m.url) as any;
  const obj = useMemo(() => {
    const src = gltf.scene as THREE.Object3D;
    const fit = fitFor(src, m);
    // each source mesh's place in the gun, so the skin can be laid out in gun space
    const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
    const toGun: THREE.Matrix4[] = [];
    src.traverse((o: any) => {
      if (o.isMesh) toGun.push(fit.clone().multiply(inv.clone().multiply(o.matrixWorld)));
    });
    const root = src.clone(true);
    const holder = new THREE.Group();
    holder.add(root);
    root.matrixAutoUpdate = false;
    root.matrix.copy(fit);
    const tint = finish && finish !== "#ffffff" ? new THREE.Color(finish) : null;
    let mi = 0;
    root.traverse((o: any) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      if (skin) bakeSkinSpace(o.geometry, toGun[mi]);
      mi++;
      const key = `${m.url}:${o.material.uuid}:${finish}:${skin}:${ghost}:${glow}`;
      let mat = modelMats.get(key) as THREE.MeshStandardMaterial | undefined;
      if (!mat) {
        mat = (o.material as THREE.MeshStandardMaterial).clone();
        if (skin) {
          // the shader paints over the model's colour; its normal and roughness maps keep the detail
          mat.color = new THREE.Color(1, 1, 1);
          applySkin(mat, skin, tint, glow);
        } else {
          if (!mat.map) {
            mat.color = new THREE.Color("#3b3f46");
            mat.metalness = 0.6;
            mat.roughness = 0.45;
          }
          if (tint) mat.color = (mat.color ?? new THREE.Color(1, 1, 1)).clone().lerp(tint, 0.55);
        }
        if (ghost) {
          mat.transparent = true;
          mat.opacity = 0.35;
        }
        mat.needsUpdate = true;
        modelMats.set(key, mat);
      }
      o.material = mat;
    });
    return holder;
  }, [gltf, m, finish, skin, ghost, glow]);
  return <primitive object={obj} />;
}

/** the built guns' parts as geometry, with the skin's gun-space coordinates baked in (cached) */
const partGeo = new Map<string, THREE.BufferGeometry>();
function geoFor(weapon: number, i: number, pt: Part) {
  const k = `${weapon}:${i}`;
  let g = partGeo.get(k);
  if (!g) {
    g = pt.cyl ? new THREE.CylinderGeometry(pt.s[1], pt.s[1], pt.s[0], 12) : new THREE.BoxGeometry(...pt.s);
    const rot = pt.cyl ? new THREE.Euler(0, pt.ry ?? 0, Math.PI / 2) : new THREE.Euler(0, pt.ry ?? 0, pt.r ?? 0);
    bakeSkinSpace(g, new THREE.Matrix4().compose(new THREE.Vector3(...pt.p), new THREE.Quaternion().setFromEuler(rot), new THREE.Vector3(1, 1, 1)));
    partGeo.set(k, g);
  }
  return g;
}
const partMats = new Map<string, THREE.Material>();
function partMat(key: string, make: () => THREE.MeshStandardMaterial) {
  let m = partMats.get(key);
  if (!m) partMats.set(key, (m = make()));
  return m;
}

/** keeps the animated skins moving (any gun on screen drives the shared clock) */
function SkinClock() {
  useFrame(tickSkins);
  return null;
}

export function Gun({ weapon, ghost = false, display = false, torch = false, finish, skin = 0 }: { weapon: number; ghost?: boolean; display?: boolean; torch?: boolean; finish?: string; skin?: number }) {
  // on a loot crate the gun is shown off: lighter steel so you can tell what it is in the dark
  // in hand: gunmetal and polymer that still read in the dark (pure black metal renders as a hole)
  const fin = finish && finish !== "#ffffff" ? new THREE.Color(finish) : null;
  const tint = (c?: string) => (fin && c !== W && c !== R ? "#" + new THREE.Color(tint0(c)).lerp(fin, 0.55).getHexString() : tint0(c));
  const tint0 = (c?: string) =>
    display ? (c === "#3a2a1c" ? "#8a6a48" : !c || c === "#16181e" ? "#6c727e" : "#9aa1ad") : c === "#3a2a1c" ? "#5a4029" : c === "#2a2d35" ? "#4a4f5a" : c === "#16181e" ? "#2a2d34" : c === R ? "#1c1d20" : c ?? "#33373f";
  const tx = TORCH_X[weapon] ?? 0.5;
  const parts = GUNS[weapon] ?? GUNS[0];
  const op = ghost ? 0.35 : 1;
  const model = GUN_MODELS[weapon];
  // self-lit skins glow less in a match: the night is dark and bloom picks them up
  const glow = display ? 1 : 0.6;
  return (
    <>
      {skin > 0 && <SkinClock />}
      {isLegend(skin) && !ghost && <LegendFx skin={skin} display={display} />}
      {model && <ModelGun m={model} finish={finish} skin={skin} ghost={ghost} glow={glow} />}
      {(model ? [] : parts).map((pt, i) => {
        if (pt.glow)
          return (
            <mesh key={i} position={pt.p}>
              <boxGeometry args={pt.s} />
              <meshBasicMaterial color={pt.glow} toneMapped={false} transparent={ghost} opacity={op} />
            </mesh>
          );
        const skinned = skin > 0 && pt.c !== R && !pt.c?.startsWith("#d8") && !pt.c?.startsWith("#8a") && !pt.c?.startsWith("#c4");
        const rough = pt.cyl ? 0.35 : pt.c === W ? 0.6 : pt.c === P || pt.c === R ? 0.75 : 0.38;
        const metal = pt.cyl ? (display ? 0.6 : 0.35) : pt.c === W || pt.c === P || pt.c === R ? 0.05 : display ? 0.6 : 0.55;
        const col = tint(pt.c);
        const mat = partMat(`${col}:${rough}:${metal}:${skinned ? skin : 0}:${finish}:${ghost}:${glow}`, () => {
          const mm = new THREE.MeshStandardMaterial({ color: skinned ? "#ffffff" : col, roughness: rough, metalness: metal, transparent: ghost, opacity: op });
          return skinned ? applySkin(mm, skin, fin, glow) : mm;
        });
        return <mesh key={i} name={pt.n} position={pt.p} rotation={pt.cyl ? [0, pt.ry ?? 0, Math.PI / 2] : [0, pt.ry ?? 0, pt.r ?? 0]} geometry={geoFor(weapon, i, pt)} material={mat} />;
      })}
      {!display && !model && (
        // the torch under the barrel: body, and a lens that glows when it's on
        // tucked under the handguard (it ends at y -0.01 on the built guns), not hanging below it
        <group position={[tx, -0.036, 0]}>
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
