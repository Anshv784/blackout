// A real soldier (rigged, animated) instead of a capsule. One shared GLB, cloned per player.
// Idle / walk / run come from the file; holding the gun, recoil, reload, the throw swing and
// crawling when downed are driven on the skeleton every frame (two-bone IK for the arms).
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Gun } from "./Gun";

export const SOLDIER_URL = "/models/soldier.glb";
useGLTF.preload(SOLDIER_URL);

/** What the body should be doing this frame. Parents write it, the soldier reads it. */
export interface Motion {
  speed: number; // 0 still, 1 walking, 2 running
  firing: boolean;
  reloading: boolean;
  downed: boolean;
  throwAt: number; // performance.now() of the last throw
  crouch?: boolean;
  jumpAt?: number; // performance.now() a jump started
  deadAt?: number; // performance.now() they were killed: knees go, then they fall back and the gun drops
}
export const stillMotion = (): Motion => ({ speed: 0, firing: false, reloading: false, downed: false, throwAt: 0 });

const HEIGHT = 1.38; // world units (a tile is 1)
const GUN_POS = new THREE.Vector3(0.1, 1.0, 0.13); // the stock, at the right shoulder (+x forward, +z right)

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();

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
  const parentQ = new THREE.Quaternion();
  bone.parent?.getWorldQuaternion(parentQ);
  bone.quaternion.copy(parentQ.invert().multiply(newWorld));
  bone.updateWorldMatrix(false, true);
}

/** Two-bone IK: shoulder→elbow→hand reaches `target`, elbow bent toward `pole`. */
function reach(upper: THREE.Object3D, lower: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3) {
  upper.updateWorldMatrix(true, true);
  const s = new THREE.Vector3().setFromMatrixPosition(upper.matrixWorld);
  const e = new THREE.Vector3().setFromMatrixPosition(lower.matrixWorld);
  const h = new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld);
  const a = s.distanceTo(e);
  const b = e.distanceTo(h);
  const toT = target.clone().sub(s);
  const d = Math.min(toT.length(), a + b - 1e-3);
  const dir = toT.normalize();
  // distance along dir to the elbow's projection, and the elbow's offset from that line
  const x = (a * a - b * b + d * d) / (2 * d);
  const y = Math.sqrt(Math.max(0, a * a - x * x));
  const bend = pole.clone().sub(s);
  bend.sub(dir.clone().multiplyScalar(bend.dot(dir))).normalize();
  const elbow = s.clone().add(dir.clone().multiplyScalar(x)).add(bend.multiplyScalar(y));
  aimBone(upper, lower, elbow);
  aimBone(lower, hand, target);
}

export function Soldier({ color: _color, weapon = 0, ghost = false, motion }: { color: string; weapon?: number; ghost?: boolean; motion?: React.MutableRefObject<Motion> }) {
  const gltf = useGLTF(SOLDIER_URL) as any;
  const root = useRef<THREE.Group>(null);
  const gunRef = useRef<THREE.Group>(null);
  const { model, mixer, actions, bones, scale } = useMemo(() => {
    const model = cloneSkinned(gltf.scene) as THREE.Group;
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const scale = HEIGHT / Math.max(0.01, box.max.y - box.min.y);
    model.traverse((o: any) => {
      if (o.isMesh) {
        o.castShadow = !ghost;
        o.receiveShadow = false;
        o.frustumCulled = false;
        if (ghost) {
          o.material = o.material.clone();
          o.material.transparent = true;
          o.material.opacity = 0.35;
          o.material.depthWrite = false;
        }
      }
    });
    const mixer = new THREE.AnimationMixer(model);
    const clip = (n: string) => gltf.animations.find((a: THREE.AnimationClip) => a.name === n);
    const actions = {
      idle: mixer.clipAction(clip("Idle")),
      walk: mixer.clipAction(clip("Walk")),
      run: mixer.clipAction(clip("Run")),
    };
    Object.values(actions).forEach((a) => {
      a.play();
      a.setEffectiveWeight(0);
    });
    actions.idle.setEffectiveWeight(1);
    const b = (n: string) => model.getObjectByName(`mixamorig${n}`)!;
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
    return { model, mixer, actions, bones, scale };
  }, [gltf, ghost]);

  useEffect(() => () => void mixer.stopAllAction(), [mixer]);

  const w = useRef({ idle: 1, walk: 0, run: 0 });
  const kick = useRef(0);
  const crouchK = useRef(0);
  const pool = useRef<THREE.Mesh>(null);
  const lastFire = useRef(false);
  const target = useMemo(() => new THREE.Vector3(), []);
  const pole = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    dt = Math.min(dt, 0.05);
    const m = motion?.current ?? stillMotion();
    const g = root.current;
    if (!g) return;
    // locomotion blend
    const want = m.downed ? { idle: 0, walk: m.speed > 0 ? 1 : 0, run: 0 } : { idle: m.speed === 0 ? 1 : 0, walk: m.speed === 1 ? 1 : 0, run: m.speed === 2 ? 1 : 0 };
    const k = 1 - Math.pow(0.0005, dt);
    const dying = m.deadAt !== undefined;
    (["idle", "walk", "run"] as const).forEach((n) => {
      if (dying) return; // the pose under a body stays exactly as it was when it fell
      w.current[n] += (want[n] - w.current[n]) * k;
      actions[n].setEffectiveWeight(w.current[n]);
    });
    actions.walk.timeScale = m.downed ? 0.45 : 1.25;
    actions.run.timeScale = 1.15;
    // the dead stop breathing once they're down
    const deadT = m.deadAt ? (performance.now() - m.deadAt) / 1000 : -1;
    mixer.update(deadT > 0.9 ? 0 : dt);
    if (deadT >= 0) {
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
        gunRef.current.position.set(GUN_POS.x + 0.35 * gt, Math.max(0.04, GUN_POS.y * (1 - gt * gt)), GUN_POS.z + 0.25 * gt);
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

    // lying on the floor when downed
    model.rotation.x += ((m.downed ? -1.35 : 0) - model.rotation.x) * k;
    model.rotation.z = 0;
    // crouch: sink the hips, bend hips and knees, lean in
    crouchK.current += ((m.crouch && !m.downed ? 1 : 0) - crouchK.current) * (1 - Math.pow(0.0001, dt));
    const ck = crouchK.current;
    // jump: a half-second arc with the legs tucked
    const jp = m.jumpAt ? (performance.now() - m.jumpAt) / 500 : 1;
    const jk = jp >= 0 && jp < 1 ? Math.sin(jp * Math.PI) : 0;
    const lift = -0.26 * ck + 0.55 * jk; // how far the whole body (and the gun with it) moves
    model.position.y = m.downed ? 0.18 / scale : lift / scale;
    if (ck > 0.01 || jk > 0.01) {
      const bend = Math.max(ck, jk * 0.7);
      bones.lUp.rotation.x -= 0.95 * bend;
      bones.rUp.rotation.x -= 0.95 * bend;
      bones.lLeg.rotation.x += 1.45 * bend;
      bones.rLeg.rotation.x += 1.45 * bend;
      bones.spine.rotation.x += 0.18 * ck;
    }

    // shots kick the gun back
    if (m.firing && !lastFire.current) kick.current = 1;
    lastFire.current = m.firing;
    kick.current *= Math.pow(0.0002, dt);
    if (gunRef.current) {
      gunRef.current.position.set(GUN_POS.x - kick.current * 0.07, GUN_POS.y + kick.current * 0.02 + (m.downed ? 0 : lift), GUN_POS.z);
      gunRef.current.rotation.set(0, 0, kick.current * 0.12);
      gunRef.current.visible = !m.downed;
    }
    if (m.downed) return;

    // shoulder into the stock, head up behind the sights
    bones.spine.rotation.y += 0.12;
    bones.spine.rotation.z -= kick.current * 0.05;
    bones.neck.rotation.x -= 0.1;

    // hands on the gun: right on the grip, left on the handguard (or the mag while reloading)
    g.updateWorldMatrix(true, true);
    const now = performance.now();
    const throwing = now - m.throwAt < 450;
    const grip = gunRef.current ? gunRef.current.localToWorld(target.set(0.14, -0.05, 0)) : target.set(0, 0, 0);
    if (throwing) {
      // overhand throw with the right arm
      const p = (now - m.throwAt) / 450;
      g.localToWorld(target.set(0.1 + p * 0.5, 1.45 - p * 0.35, 0.18));
    }
    g.localToWorld(pole.set(-0.2, 0.7, 0.75));
    reach(bones.rArm, bones.rFore, bones.rHand, throwing ? target : grip, pole);
    const front = gunRef.current ? gunRef.current.localToWorld(new THREE.Vector3(m.reloading ? 0.22 : 0.42, m.reloading ? -0.14 : -0.03, 0)) : grip;
    if (m.reloading) front.y += Math.sin(now / 90) * 0.02;
    g.localToWorld(pole.set(0.25, 0.55, -0.55));
    reach(bones.lArm, bones.lFore, bones.lHand, front, pole);
  });

  return (
    <group ref={root}>
      {/* the mesh faces +z; our players face +x */}
      <group rotation-y={-Math.PI / 2} scale={scale}>
        <primitive object={model} />
      </group>
      {/* blood spreading under a body */}
      <mesh ref={pool} rotation-x={-Math.PI / 2} visible={false}>
        <circleGeometry args={[0.55, 24]} />
        <meshStandardMaterial color="#3a0408" roughness={0.15} metalness={0.2} transparent opacity={0.85} depthWrite={false} polygonOffset polygonOffsetFactor={-4} />
      </mesh>
      <group ref={gunRef} position={GUN_POS.toArray()}>
        <group position={[-0.17, 0, -0.12]} scale={0.85}>
          <Gun weapon={weapon} ghost={ghost} />
        </group>
      </group>
    </group>
  );
}
