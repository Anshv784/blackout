import { memo, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, Noise, ChromaticAberration } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";
import { Arena, occlusion } from "./Arena";
import { Avatar, Gun, SEAT_COLORS, aimToRotY } from "./Avatar";
import type { Session } from "../game/session";
import { ST_COUNTDOWN, ST_LIVE, ST_ENDED } from "../chain/layout";
import { controls, wheelZoom } from "../game/controls";
import { prefs, usePrefs } from "../game/prefs";
import { feel } from "../game/feel";
import { useStore } from "../game/store";
import { Effects, sparks } from "./Effects";
import { radToAngle, angleToRad, isWall, lightsOut } from "../game/sim";
import { MAP_W } from "../game/gen";
import { audio } from "../game/audio";

const CONE_RAD = (7000 / 65536) * Math.PI * 2; // half-angle used on chain
const VISION_TILES = 10;
const LOOT_COLORS = ["#fff", "#06d6a0", "#4cc9f0", "#ff8c42", "#ef476f", "#f15bb5", "#ffd166", "#c77dff", "#ff3b3b"];
const LOOT_LABEL = ["", "MEDKIT", "ARMOR", "UMP", "S12K", "FLARE", "M416", "KAR98K", "SUPPLY DROP"];
const COOLDOWN_MS = [350, 100, 800, 150, 1500];
// crosshair kick per shot (vertical, horizontal jitter) — PUBG-style: you pull it back down
const RECOIL = [[0.02, 0.004], [0.009, 0.006], [0.045, 0.01], [0.013, 0.005], [0.07, 0.002]];

function beamMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color("#ffe9b0") }, uStrength: { value: 0.07 } },
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ vY = position.y; vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ float along = clamp(0.5 - vY/${VISION_TILES.toFixed(1)}, 0.0, 1.0); float rim = pow(abs(dot(vN, vV)), 1.5);
      gl_FragColor = vec4(uColor, uStrength * pow(along, 1.6) * rim); }`,
  });
}

function MyPlayer({ session }: { session: Session }) {
  const group = useRef<THREE.Group>(null);
  const aimGroup = useRef<THREE.Group>(null);
  const spot = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const flash = useRef<THREE.PointLight>(null);
  const beam = useMemo(beamMaterial, []);
  const lastShot = useRef(0);
  const lastPos = useRef({ x: 0, y: 0 });
  const myWeapon = useStore((s) => s.view?.me.weapon ?? 0);
  const gait = useRef(0);
  const { scene } = useThree();
  useEffect(() => {
    scene.add(target);
    return () => {
      scene.remove(target);
    };
  }, [scene, target]);
  useEffect(() => {
    if (spot.current) spot.current.target = target;
  }, [target]);

  useFrame(() => {
    const v = session.view;
    const pos = session.myPos();
    const g = group.current;
    if (!g || !pos || !v) {
      if (g) g.visible = false;
      return;
    }
    g.visible = true;
    const alive = v.me.alive === 1;
    // walk cycle: bob while moving (faster when sprinting), lean into the run
    const t = performance.now() / 1000;
    const step = Math.hypot(pos.x - lastPos.current.x, pos.y - lastPos.current.y);
    lastPos.current = { x: pos.x, y: pos.y };
    gait.current += ((step > 0.5 ? 1 : 0) - gait.current) * 0.15;
    const freq = session.sprinting ? 16 : 11;
    g.position.set(pos.x / 256, Math.abs(Math.sin(t * freq)) * 0.07 * gait.current, pos.y / 256);
    const aim = session.input.aim;
    if (aimGroup.current) {
      aimGroup.current.rotation.y = aimToRotY(aim);
      aimGroup.current.rotation.z = -gait.current * (session.sprinting ? 0.16 : 0.06);
    }
    const a = angleToRad(aim);
    target.position.set(pos.x / 256 + Math.cos(a) * 6, 0.2, pos.y / 256 + Math.sin(a) * 6);
    const flare = v.me.flare > 0;
    const r0 = session.room;
    const dark = !!r0 && r0.status === ST_LIVE && lightsOut(r0.matchLen, Math.max(0, r0.tick - 60));
    (globalThis as any).__boLightsOut = dark; // street lamps and the searchlight die too
    if (spot.current) {
      spot.current.intensity = alive && !dark ? (flare ? 0 : 55) : 0;
    }
    // the light shaft reads well from above but becomes a giant dome from behind
    beam.uniforms.uStrength.value = alive && !flare && controls.view === "top" ? 0.07 : 0;
    // local muzzle flash on fire (server is authoritative for the bullet)
    const now = performance.now();
    const firing = (session.input.buttons & 1) === 1 && alive && v.me.reload === 0 && v.me.mag > 0 && session.room?.status === ST_LIVE;
    if (firing && now - lastShot.current > (COOLDOWN_MS[v.me.weapon] ?? 350)) {
      lastShot.current = now;
      audio.shoot(v.me.weapon);
      if (flash.current) flash.current.intensity = 14;
      feel.recoil = Math.min(1.8, feel.recoil + [0.8, 0.45, 1.3, 0.55, 1.8][v.me.weapon]);
      const [ky, kx] = RECOIL[v.me.weapon] ?? RECOIL[0];
      const steady = 1 - controls.adsK * 0.4;
      controls.camPitch = Math.max(0.02, controls.camPitch - ky * 0.7 * steady);
      controls.camYaw += (Math.random() - 0.5) * 2 * kx * 0.8 * steady;
      sparks(pos.x / 256 + Math.cos(a) * 0.75, 0.7, pos.y / 256 + Math.sin(a) * 0.75, "#ffd27a", v.me.weapon === 2 ? 10 : 5, {
        speed: 5,
        dir: a,
        spread: 0.6,
        up: 0.3,
        life: 0.1,
        grav: 0,
      });
    }
    if (flash.current) flash.current.intensity *= 0.72;
  });

  return (
    <group ref={group}>
      <group ref={aimGroup}>
        <Avatar color={SEAT_COLORS[session.mySeat ?? 0]} me weapon={myWeapon} />
        {/* volumetric beam: a cone lying along +x */}
        <mesh position={[VISION_TILES / 2 + 0.3, 0.75, 0]} rotation-z={Math.PI / 2} material={beam}>
          <coneGeometry args={[Math.tan(CONE_RAD) * VISION_TILES, VISION_TILES, 48, 1, true]} />
        </mesh>
        <pointLight ref={flash} position={[0.9, 0.7, 0.12]} color="#ffcf7a" intensity={0} distance={5} decay={1.6} />
      </group>
      <spotLight
        ref={spot}
        position={[0, 1.75, 0]}
        angle={CONE_RAD}
        penumbra={0.35}
        distance={VISION_TILES + 1}
        decay={1.1}
        intensity={55}
        color="#fff1d0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-camera-near={0.2}
        shadow-camera-far={13}
      />
      {/* "feel" radius — the 2-tile circle you sense in any direction */}
      <pointLight position={[0, 1.3, 0]} intensity={2.2} distance={2.9} decay={1.4} color="#9fb4ff" />
    </group>
  );
}

function Others({ session }: { session: Session }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const ghosts = useRef<(THREE.Group | null)[]>([]);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  const hpBars = useRef<(HTMLElement | null)[]>([]);
  const room = session.room;
  const lastAt = useRef<({ x: number; y: number } | null)[]>(Array(8).fill(null));
  const gaits = useRef<number[]>(Array(8).fill(0));
  // re-render only when someone's gun changes
  const seen = useStore((st) => st.view?.players.map((p) => `${p.seat}:${p.weapon}`).join(",") ?? "");
  const lastWeapon = useRef<number[]>(Array(8).fill(0));
  for (const kv of seen.split(",")) {
    const [a, b] = kv.split(":").map(Number);
    if (kv && a >= 0 && a < 8) lastWeapon.current[a] = b;
  }
  const weapons = lastWeapon.current;
  const GRACE = 280; // ms an enemy stays solid after leaving your view (kills cone-edge flicker)
  const FADE = 2000; // ms the last-known silhouette lingers
  useFrame(() => {
    const now = performance.now();
    for (let s = 0; s < 8; s++) {
      const g = refs.current[s];
      const gh = ghosts.current[s];
      if (!g || !gh) continue;
      const tr = session.tracks.get(s);
      const lab = labels.current[s];
      if (!tr || s === session.mySeat || !session.view?.me.alive || !tr.samples.length) {
        g.visible = false;
        gh.visible = false;
        if (lab) lab.style.display = "none";
        continue;
      }
      const since = now - tr.lastSeen;
      const solid = tr.visible || since < GRACE;
      const last = tr.samples[tr.samples.length - 1];
      if (solid) {
        const smp = tr.visible ? session.sampleTrack(tr, now) ?? last : last;
        g.visible = true;
        gh.visible = false;
        const lp = lastAt.current[s];
        const moving = lp ? Math.hypot(smp.x - lp.x, smp.y - lp.y) > 0.5 : false;
        lastAt.current[s] = { x: smp.x, y: smp.y };
        gaits.current[s] += ((moving ? 1 : 0) - gaits.current[s]) * 0.15;
        g.position.set(smp.x / 256, Math.abs(Math.sin(now / 1000 * 11 + s)) * 0.07 * gaits.current[s], smp.y / 256);
        g.rotation.y = aimToRotY(smp.aim);
        const hp = hpBars.current[s];
        if (hp) hp.style.width = `${Math.max(0, smp.hp)}%`;
        if (lab) lab.style.display = "flex";
      } else {
        g.visible = false;
        if (lab) lab.style.display = "none";
        const k = (since - GRACE) / FADE;
        gh.visible = k < 1;
        if (k < 1) {
          gh.position.set(last.x / 256, 0, last.y / 256);
          gh.rotation.y = aimToRotY(last.aim);
          gh.traverse((o) => {
            const m = (o as THREE.Mesh).material as THREE.Material | undefined;
            if (m) {
              m.transparent = true;
              m.opacity = 0.32 * (1 - k);
              m.depthWrite = false;
            }
          });
        }
      }
    }
  });
  return (
    <>
      {Array.from({ length: 8 }, (_, s) => (
        <group key={s}>
          <group ref={(el) => (refs.current[s] = el)} visible={false}>
            <Avatar color={SEAT_COLORS[s]} weapon={weapons[s]} />
            <Html position={[0, 1.6, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
              <div className="tag" ref={(el) => (labels.current[s] = el)} style={{ ["--c" as any]: SEAT_COLORS[s] }}>
                <span>{room?.names[s] || `#${s}`}</span>
                <i>
                  <b ref={(el) => (hpBars.current[s] = el)} />
                </i>
              </div>
            </Html>
          </group>
          {/* last-known silhouette, fading into the dark */}
          <group ref={(el) => (ghosts.current[s] = el)} visible={false}>
            <Avatar color={SEAT_COLORS[s]} ghost />
          </group>
        </group>
      ))}
    </>
  );
}

function Bullets({ session }: { session: Session }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const k = Math.min(1.5, (performance.now() - session.bulletsAt) / 50);
    let n = 0;
    for (const b of session.bullets) {
      const x = (b.x + b.vx * k) / 256;
      const z = (b.y + b.vy * k) / 256;
      tmp.position.set(x, 0.7, z);
      tmp.rotation.set(0, -Math.atan2(b.vy, b.vx), 0);
      tmp.scale.set(0.55, 1, 1);
      tmp.updateMatrix();
      m.setMatrixAt(n++, tmp.matrix);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, 32]} frustumCulled={false}>
      <boxGeometry args={[1, 0.05, 0.05]} />
      <meshBasicMaterial color="#fff3c4" toneMapped={false} />
    </instancedMesh>
  );
}

const LOOT_GUN: Record<number, number> = { 3: 1, 4: 2, 6: 3, 7: 4 };

/** A real crate per loot kind: medkit case, vest box, flare canister, or a gun case with the gun on top. */
function Crate({ kind }: { kind: number }) {
  const c = LOOT_COLORS[kind] ?? "#fff";
  const gun = LOOT_GUN[kind];
  return (
    <group>
      {/* glow on the ground so it reads in the dark */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.025, 0]}>
        <ringGeometry args={[0.46, 0.56, 40]} />
        <meshBasicMaterial color={c} transparent opacity={0.85} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {kind === 1 && (
        <group position={[0, 0.17, 0]}>
          <mesh>
            <boxGeometry args={[0.52, 0.32, 0.38]} />
            <meshStandardMaterial color="#e9ecef" roughness={0.45} />
          </mesh>
          <mesh position={[0, 0.165, 0]}>
            <boxGeometry args={[0.24, 0.01, 0.07]} />
            <meshBasicMaterial color="#e5383b" toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.165, 0]}>
            <boxGeometry args={[0.07, 0.01, 0.24]} />
            <meshBasicMaterial color="#e5383b" toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.01, 0.192]}>
            <boxGeometry args={[0.16, 0.05, 0.005]} />
            <meshBasicMaterial color="#e5383b" toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.01, 0.192]}>
            <boxGeometry args={[0.05, 0.16, 0.005]} />
            <meshBasicMaterial color="#e5383b" toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <boxGeometry args={[0.2, 0.04, 0.04]} />
            <meshStandardMaterial color="#2b2d33" roughness={0.6} />
          </mesh>
        </group>
      )}
      {kind === 2 && (
        <group position={[0, 0.16, 0]}>
          <mesh>
            <boxGeometry args={[0.58, 0.3, 0.44]} />
            <meshStandardMaterial color="#33402f" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.04, 0]}>
            <boxGeometry args={[0.6, 0.05, 0.46]} />
            <meshStandardMaterial color="#4cc9f0" emissive="#4cc9f0" emissiveIntensity={1.4} toneMapped={false} />
          </mesh>
          {/* the vest folded on the lid */}
          <mesh position={[0, 0.2, 0]}>
            <boxGeometry args={[0.36, 0.09, 0.3]} />
            <meshStandardMaterial color="#20262f" roughness={0.7} />
          </mesh>
          <mesh position={[0.1, 0.25, 0]}>
            <boxGeometry args={[0.08, 0.02, 0.28]} />
            <meshStandardMaterial color="#2f3a4a" roughness={0.6} />
          </mesh>
        </group>
      )}
      {kind === 8 && (
        <group position={[0, 0.3, 0]}>
          <mesh>
            <boxGeometry args={[0.85, 0.6, 0.85]} />
            <meshStandardMaterial color="#c9ccd1" roughness={0.6} metalness={0.3} />
          </mesh>
          {[-0.3, 0, 0.3].map((y) => (
            <mesh key={y} position={[0, y * 0.6, 0]}>
              <boxGeometry args={[0.87, 0.07, 0.87]} />
              <meshStandardMaterial color="#d62828" emissive="#d62828" emissiveIntensity={0.6} />
            </mesh>
          ))}
          <mesh position={[0, 0.33, 0]}>
            <boxGeometry args={[0.5, 0.05, 0.5]} />
            <meshBasicMaterial color="#ff3b3b" toneMapped={false} />
          </mesh>
        </group>
      )}
      {kind === 5 && (
        <group>
          <mesh position={[0, 0.06, 0]}>
            <boxGeometry args={[0.34, 0.12, 0.34]} />
            <meshStandardMaterial color="#2b2d33" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.36, 0]}>
            <cylinderGeometry args={[0.08, 0.08, 0.46, 16]} />
            <meshStandardMaterial color="#ff7b2e" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.62, 0]}>
            <cylinderGeometry args={[0.085, 0.085, 0.06, 16]} />
            <meshBasicMaterial color="#ff3b8f" toneMapped={false} />
          </mesh>
        </group>
      )}
      {gun !== undefined && (
        <group>
          {/* weapon case */}
          <mesh position={[0, 0.1, 0]}>
            <boxGeometry args={[1.05, 0.2, 0.4]} />
            <meshStandardMaterial color="#3d4630" roughness={0.75} metalness={0.15} />
          </mesh>
          <mesh position={[0, 0.205, 0]}>
            <boxGeometry args={[1.07, 0.012, 0.42]} />
            <meshStandardMaterial color="#2a3022" roughness={0.8} />
          </mesh>
          {[-0.3, 0.3].map((x) => (
            <mesh key={x} position={[x, 0.12, 0.205]}>
              <boxGeometry args={[0.08, 0.06, 0.02]} />
              <meshStandardMaterial color="#9aa0a6" metalness={0.9} roughness={0.3} />
            </mesh>
          ))}
          <mesh position={[0, 0.215, 0]}>
            <boxGeometry args={[0.95, 0.005, 0.03]} />
            <meshBasicMaterial color={c} toneMapped={false} />
          </mesh>
          {/* the gun itself, laid on the lid */}
          <group position={[-0.62 * (gun === 4 ? 1.05 : 0.95), 0.27, -0.05]} scale={gun === 4 ? 0.8 : 1}>
            <Gun weapon={gun} display />
          </group>
        </group>
      )}
    </group>
  );
}

function LootCrates({ session }: { session: Session }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  // which kind sits in each slot (re-render only when that changes)
  const kinds = useStore((st) => st.view?.loot.map((l) => `${l.id}:${l.kind}`).join(",") ?? "");
  const kindOf = useRef<number[]>(Array(12).fill(0));
  for (const kv of kinds.split(",")) {
    const [a, b] = kv.split(":").map(Number);
    if (kv && a >= 0 && a < 12) kindOf.current[a] = b;
  }
  useFrame(({ clock }) => {
    const loot = session.view?.loot ?? [];
    for (let i = 0; i < 12; i++) {
      const g = refs.current[i];
      if (!g) continue;
      const l = loot.find((x) => x.id === i);
      g.visible = !!l;
      const lab = labels.current[i];
      if (lab) lab.style.display = l ? "block" : "none";
      if (!l) continue;
      g.position.set(l.x / 256, 0, l.y / 256);
      g.rotation.y = i * 1.7 + Math.sin(clock.elapsedTime * 0.4 + i) * 0.08;
      if (lab && lab.textContent !== LOOT_LABEL[l.kind]) {
        lab.textContent = LOOT_LABEL[l.kind];
        lab.style.color = LOOT_COLORS[l.kind];
      }
    }
  });
  return (
    <>
      {Array.from({ length: 12 }, (_, i) => (
        <group key={i} ref={(el) => (refs.current[i] = el)} visible={false}>
          {kindOf.current[i] > 0 && <Crate kind={kindOf.current[i]} />}
          <Html position={[0, 0.95, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
            <div className="loot-tag" ref={(el) => (labels.current[i] = el)} />
          </Html>
        </group>
      ))}
    </>
  );
}

function zoneMaterial(color: string) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        float lines = 0.5 + 0.5*sin(vUv.y*60.0 - uTime*4.0);
        float cols = 0.5 + 0.5*sin(vUv.x*420.0 + uTime*1.5);
        float fade = pow(1.0 - vUv.y, 1.6);
        float base = smoothstep(0.08, 0.0, vUv.y) * 1.2;
        float flick = 0.85 + 0.15 * h(vec2(floor(uTime*12.0), floor(vUv.x*80.0)));
        gl_FragColor = vec4(uColor * (1.0 + base), ((0.08 + 0.22*lines + 0.08*cols) * fade + base * 0.5) * flick); }`,
  });
}

function Zone({ session }: { session: Session }) {
  const wall = useRef<THREE.Mesh>(null);
  const next = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => zoneMaterial("#a64dff"), []);
  useFrame(({ clock }) => {
    const r = session.room;
    mat.uniforms.uTime.value = clock.elapsedTime;
    if (!r || !wall.current || !next.current) return;
    const show = r.status === ST_LIVE || r.status === ST_COUNTDOWN || r.status === ST_ENDED;
    wall.current.visible = show && r.zone.r > 0;
    wall.current.position.set(r.zone.x / 256, 2, r.zone.y / 256);
    wall.current.scale.set(r.zone.r / 256, 1, r.zone.r / 256);
    const nr = r.next.r;
    next.current.visible = show && nr > 0 && nr < r.zone.r - 10;
    next.current.position.set(r.next.x / 256, 0.04, r.next.y / 256);
    next.current.scale.set(nr / 256, nr / 256, 1);
    // danger hum when outside
    const p = session.myPos();
    if (p && session.view?.me.alive && r.status === ST_LIVE) {
      const d = Math.hypot(p.x - r.zone.x, p.y - r.zone.y);
      audio.setZoneDanger(d > r.zone.r ? 1 : 0);
    } else audio.setZoneDanger(0);
  });
  return (
    <>
      <mesh ref={wall} material={mat} visible={false}>
        <cylinderGeometry args={[1, 1, 4, 128, 1, true]} />
      </mesh>
      <mesh ref={next} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.992, 1, 160]} />
        <meshBasicMaterial color="#cfd8ff" transparent opacity={0.32} />
      </mesh>
    </>
  );
}

const PING_COLORS = ["#fff", "#9fb4ff", "#ff5d5d", "#ffd166", "#c9c9c9", "#ff3b3b", "#ffd166"];

function Fx({ session }: { session: Session }) {
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const flashes = useRef<(THREE.PointLight | null)[]>([]);
  useFrame(() => {
    const now = performance.now();
    const pings = session.fx.filter((f) => f.kind === "ping" && now - f.at < 1400).slice(-10);
    for (let i = 0; i < 10; i++) {
      const m = rings.current[i];
      if (!m) continue;
      const f = pings[i];
      m.visible = !!f;
      if (!f) continue;
      const age = (now - f.at) / 1400;
      const me = session.myPos() ?? { x: f.x, y: f.y };
      const a = angleToRad(f.angle ?? 0);
      // an arc around you, pointing where the sound came from; closer sounds hug you tighter
      const radius = 1.3 + Math.min(f.dist ?? 4, 12) * 0.12 + age * 0.6;
      m.position.set(me.x / 256, 0.06, me.y / 256);
      m.rotation.set(-Math.PI / 2, 0, -a);
      m.scale.set(radius, radius, 1);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.set(PING_COLORS[f.sub ?? 1]);
      mat.opacity = 0.85 * (1 - age);
    }
    const shots = session.fx.filter((f) => f.kind === "shot" && now - f.at < 120).slice(-3);
    for (let i = 0; i < 3; i++) {
      const l = flashes.current[i];
      if (!l) continue;
      const f = shots[i];
      if (!f) {
        l.intensity = 0;
        continue;
      }
      const a = angleToRad(f.angle ?? 0);
      l.position.set(f.x / 256 + Math.cos(a) * 0.7, 0.8, f.y / 256 + Math.sin(a) * 0.7);
      l.intensity = 10 * (1 - (now - f.at) / 120);
    }
  });
  return (
    <>
      {Array.from({ length: 10 }, (_, i) => (
        <mesh key={i} ref={(el) => (rings.current[i] = el)} rotation-x={-Math.PI / 2} visible={false}>
          <ringGeometry args={[0.86, 1, 24, 1, -0.32, 0.64]} />
          <meshBasicMaterial transparent opacity={0} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {Array.from({ length: 3 }, (_, i) => (
        <pointLight key={i} ref={(el) => (flashes.current[i] = el)} color="#ffb347" intensity={0} distance={4} decay={1.5} />
      ))}
    </>
  );
}

function CameraRig({ session }: { session: Session }) {
  const { camera } = useThree();
  useEffect(
    () => () => {
      occlusion.active = false;
    },
    [],
  );
  const look = useRef(new THREE.Vector3(16, 0, 16));
  const pos = useRef(new THREE.Vector3(16, 30, 30));
  useFrame((_, dt) => {
    const p = session.myPos();
    const r = session.room;
    const playing = p && r && (r.status === ST_LIVE || r.status === ST_COUNTDOWN) && session.view?.me.alive;
    let wantLook: THREE.Vector3;
    let wantPos: THREE.Vector3;
    if (playing && controls.view === "chase" && !controls.touchMove && controls.touchAim === null) {
      // PUBG-style third person: the mouse turns the camera (yaw) and tilts it (pitch);
      // you face where it looks and the crosshair sits dead centre.
      const a = controls.camYaw;
      const pitch = controls.camPitch;
      const ads = controls.adsK;
      const sniper = session.view?.me.weapon === 4;
      const fx = Math.cos(a);
      const fz = Math.sin(a);
      const shoulder = 0.68 + 0.25 * ads;
      // the point the camera orbits: just above and right of your shoulder
      const tx = p!.x / 256 - fz * shoulder;
      const tz = p!.y / 256 + fx * shoulder;
      const ty = 1.15 + controls.chaseHeight * 0.06;
      const dir = new THREE.Vector3(fx * Math.cos(pitch), -Math.sin(pitch), fz * Math.cos(pitch));
      let d = controls.chaseDist * 0.62 + ((sniper ? 1.8 : 2.3) - controls.chaseDist * 0.62) * ads;
      // pull in before a wall gets between the camera and you
      const steps = Math.ceil(d / 0.12);
      for (let i = 1; i <= steps; i++) {
        const t = (i / steps) * d;
        const sx = tx - dir.x * t;
        const sy = ty - dir.y * t;
        const sz = tz - dir.z * t;
        if (sy < 2.0 && isWall(Math.floor(sx), Math.floor(sz))) {
          d = Math.max(0.9, t - 0.3);
          break;
        }
      }
      wantPos = new THREE.Vector3(tx - dir.x * d, Math.max(0.45, ty - dir.y * d), tz - dir.z * d);
      wantLook = new THREE.Vector3(tx + dir.x * 12, ty + dir.y * 12, tz + dir.z * 12);
      // rigid: the camera is on your shoulder, it doesn't float behind
      pos.current.copy(wantPos);
      look.current.copy(wantLook);
    } else {
      const tx = p ? p.x / 256 : MAP_W / 2;
      const tz = p ? p.y / 256 : MAP_W / 2;
      const height = playing ? controls.topZoom : 30;
      const back = playing ? controls.topZoom * 0.38 : 14;
      wantLook = new THREE.Vector3(tx, 0, tz);
      wantPos = new THREE.Vector3(tx, height, tz + back);
      const k = 1 - Math.pow(0.00002, dt);
      pos.current.lerp(wantPos, k);
      look.current.lerp(wantLook, k);
    }
    camera.position.copy(pos.current);
    camera.lookAt(look.current);
    occlusion.active = !!playing && controls.view === "chase";
    if (p) {
      occlusion.cam.copy(camera.position);
      occlusion.target.set(p.x / 256, 0.9, p.y / 256);
    }
    // feel: sprint widens the view and bobs it, your shots kick it back, hits shake it
    const cam = camera as THREE.PerspectiveCamera;
    const t = performance.now() / 1000;
    const sprinting = !!playing && session.sprinting;
    controls.adsK += ((controls.ads && playing && controls.view === "chase" ? 1 : 0) - controls.adsK) * (1 - Math.pow(0.00005, dt));
    const zoom = 1 - controls.adsK * (session.view?.me.weapon === 4 ? 0.55 : 0.2);
    const fovWant = prefs.fov * zoom + (sprinting && controls.adsK < 0.2 ? 8 : 0);
    if (Math.abs(cam.fov - fovWant) > 0.05) {
      cam.fov += (fovWant - cam.fov) * (1 - Math.pow(0.0005, dt));
      cam.updateProjectionMatrix();
    }
    if (sprinting) camera.position.y += Math.sin(t * 15) * 0.045;
    const decay = Math.pow(0.0008, dt);
    if (feel.recoil > 0.001) {
      camera.translateZ(feel.recoil * 0.18);
      camera.rotateX(feel.recoil * 0.012);
      feel.recoil *= decay;
    }
    if (feel.shake > 0.001) {
      const s = prefs.shake ? feel.shake * 0.11 : 0;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
      camera.rotateZ((Math.random() - 0.5) * s * 0.15);
      feel.shake *= Math.pow(0.002, dt);
    }
    // shooter view: put the crosshair where your bullets actually go (6 tiles out, gun height)
    if (playing && controls.view === "chase") {
      controls.cursorX = window.innerWidth / 2;
      controls.cursorY = window.innerHeight / 2;
    }
  });
  return null;
}

/** Mouse/keyboard → session input. Touch joysticks write into `controls` directly. */
/** Laser from the muzzle along your aim to the first wall; red when an enemy is on it. */
function LaserSight({ session }: { session: Session }) {
  const line = useRef<THREE.Mesh>(null);
  const dot = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffd166", transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false }), []);
  const dotMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffd166", transparent: true, opacity: 0.9, toneMapped: false }), []);
  useFrame(() => {
    const p = session.myPos();
    const v = session.view;
    const live = p && v?.me.alive && (session.room?.status === ST_LIVE || session.room?.status === ST_COUNTDOWN);
    if (!line.current || !dot.current) return;
    line.current.visible = dot.current.visible = !!live && controls.laser;
    if (!live) {
      controls.onTarget = false;
      return;
    }
    const a = angleToRad(session.input.aim);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const x0 = p!.x / 256;
    const z0 = p!.y / 256;
    // march to the first wall (max 12 tiles)
    let len = 12;
    for (let t = 0.4; t < 12; t += 0.1) {
      if (isWall(Math.floor(x0 + dx * t), Math.floor(z0 + dz * t))) {
        len = t;
        break;
      }
    }
    // anyone visible on the line before the wall?
    let target = false;
    const now = performance.now();
    for (const tr of session.tracks.values()) {
      if (!tr.visible || tr.seat === session.mySeat) continue;
      const sm = session.sampleTrack(tr, now);
      if (!sm) continue;
      const ex = sm.x / 256 - x0;
      const ez = sm.y / 256 - z0;
      const along = ex * dx + ez * dz;
      if (along <= 0 || along > len) continue;
      const perp = Math.abs(ex * dz - ez * dx);
      if (perp < 0.42) target = true;
    }
    controls.onTarget = target;
    const color = target ? "#ff2e4d" : "#ffd166";
    mat.color.set(color);
    dotMat.color.set(color);
    mat.opacity = target ? 0.85 : 0.45;
    const start = 0.55;
    const L = Math.max(0.1, len - start);
    line.current.position.set(x0 + dx * (start + L / 2), 0.68, z0 + dz * (start + L / 2));
    line.current.rotation.set(0, -a, 0);
    line.current.scale.set(L, 1, 1);
    dot.current.position.set(x0 + dx * len, 0.68, z0 + dz * len);
  });
  return (
    <>
      <mesh ref={line} material={mat} visible={false}>
        <boxGeometry args={[1, 0.018, 0.018]} />
      </mesh>
      <mesh ref={dot} material={dotMat} visible={false}>
        <sphereGeometry args={[0.06, 12, 8]} />
      </mesh>
    </>
  );
}

function FpsMeter() {
  const acc = useRef({ n: 0, t: performance.now() });
  useFrame(() => {
    const a = acc.current;
    a.n++;
    const now = performance.now();
    if (now - a.t > 1000) {
      controls.fps = Math.round((a.n * 1000) / (now - a.t));
      a.n = 0;
      a.t = now;
    }
  });
  return null;
}

function InputController({ session }: { session: Session }) {
  const { camera, gl } = useThree();
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.7), []);
  const mouse = useRef(new THREE.Vector2(0, 0));
  const hit = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      // a second mouse button pressed while one is held arrives as pointermove, not pointerdown
      // (so "aim with RMB, then click to fire" needs this)
      if (e.pointerType === "mouse" && (controls.view !== "chase" || document.pointerLockElement === el)) {
        const left = (e.buttons & 1) !== 0;
        if (left && !controls.fire) {
          controls.fire = true;
          controls.fireUntil = performance.now() + 160;
        } else if (!left && controls.fire) controls.fire = false;
        controls.ads = (e.buttons & 2) !== 0;
      }

      const r = el.getBoundingClientRect();
      if (controls.view !== "chase") {
        controls.cursorX = e.clientX;
        controls.cursorY = e.clientY;
      }
      mouse.current.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      controls.mouseActive = true;
    };
    const down = (e: PointerEvent) => {
      audio.unlock();
      if (e.pointerType === "touch") return;

      // third person needs the mouse: the first click captures it (and doesn't shoot)
      if (controls.view === "chase" && document.pointerLockElement !== el) {
        el.requestPointerLock?.();
        return;
      }
      if (e.button === 0) {
        controls.fire = true;
        controls.fireUntil = performance.now() + 160;
      }
      if (e.button === 2) controls.ads = true;
    };
    const up = (e: PointerEvent) => {
      if (e.button === 0) controls.fire = false;
      if (e.button === 2) controls.ads = false;
    };
    const noMenu = (e: Event) => e.preventDefault();
    el.addEventListener("contextmenu", noMenu);
    const lockChange = () => (controls.locked = document.pointerLockElement === el);
    // shooter view: mouse X turns you. mousemove carries movementX in every browser, locked or not.
    const look = (e: MouseEvent) => {
      if (controls.view !== "chase") return;
      if (document.pointerLockElement === el) {
        // mouse X turns you, mouse Y tilts the view; aiming down sights slows it with the zoom
        const k = controls.sens * 0.00009 * (1 - controls.adsK * (session.view?.me.weapon === 4 ? 0.6 : 0.3));
        controls.camYaw += e.movementX * k;
        controls.camPitch += e.movementY * k * (prefs.invertY ? -1 : 1);
        controls.camPitch = Math.max(0.02, Math.min(1.15, controls.camPitch));
      }
      controls.mouseActive = true;
    };
    document.addEventListener("mousemove", look);

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      wheelZoom(e.deltaY);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("pointerlockchange", lockChange);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      document.removeEventListener("pointerlockchange", lockChange);
      document.removeEventListener("mousemove", look);

      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", noMenu);
    };
  }, [gl, session]);
  useFrame(() => {
    const p = session.myPos();
    let aim = session.input.aim;
    // Q/E swing the behind-view camera
    const camArrows = prefs.arrows === "camera";
    const turn =
      (controls.keys.has("e") || (camArrows && controls.keys.has("arrowright")) ? 1 : 0) -
      (controls.keys.has("q") || (camArrows && controls.keys.has("arrowleft")) ? 1 : 0);
    if (turn) controls.camYaw += turn * 0.045 * prefs.turnSpeed;
    if (camArrows) {
      // up/down tilt the crosshair (aim further out or closer in)
      const tilt = (controls.keys.has("arrowup") ? 1 : 0) - (controls.keys.has("arrowdown") ? 1 : 0);
      if (tilt) controls.camPitch = Math.max(0.02, Math.min(1.15, controls.camPitch - tilt * 0.02 * prefs.turnSpeed));
    }
    if (controls.touchAim !== null) aim = controls.touchAim;
    else if (controls.view === "chase" && p) {
      // the crosshair is the centre of the screen
      ray.setFromCamera(new THREE.Vector2(0, 0), camera);
      if (ray.ray.intersectPlane(plane, hit) && hit.distanceTo(ray.ray.origin) < 60) {
        const dx = hit.x - p.x / 256;
        const dz = hit.z - p.y / 256;
        // a crosshair below/behind your body would aim backwards, turn you round and swing the
        // camera to your face: only aim at points clearly in front, else use the view heading
        const ahead = dx * Math.cos(controls.camYaw) + dz * Math.sin(controls.camYaw);
        aim = ahead > 1.2 ? radToAngle(Math.atan2(dz, dx)) : radToAngle(Math.atan2(ray.ray.direction.z, ray.ray.direction.x));
      } else aim = radToAngle(Math.atan2(ray.ray.direction.z, ray.ray.direction.x));
      // never further than ~100° off the camera: the view can't flip to the front
      {
        let off = angleToRad(aim) - controls.camYaw;
        off = Math.atan2(Math.sin(off), Math.cos(off));
        if (Math.abs(off) > 1.75) aim = radToAngle(controls.camYaw + Math.sign(off) * 1.75);
      }
    }
    else if (p && controls.mouseActive) {
      ray.setFromCamera(mouse.current, camera);
      if (ray.ray.intersectPlane(plane, hit) && hit.distanceTo(ray.ray.origin) < 60) aim = radToAngle(Math.atan2(hit.z - p.y / 256, hit.x - p.x / 256));
      else aim = radToAngle(Math.atan2(ray.ray.direction.z, ray.ray.direction.x)); // pointing at the sky: aim that way
    }
    const k = controls.keys;
    // aim-relative: W walks toward the mouse, S backs off, A/D strafe around it
    const ar_ = !camArrows;
    const fwd = (k.has("w") || (ar_ && k.has("arrowup")) ? 1 : 0) - (k.has("s") || (ar_ && k.has("arrowdown")) ? 1 : 0);
    const side = (k.has("d") || (ar_ && k.has("arrowright")) ? 1 : 0) - (k.has("a") || (ar_ && k.has("arrowleft")) ? 1 : 0);
    // third person: W is where the camera looks; top-down: W walks toward the cursor
    const ar = controls.view === "chase" && controls.touchAim === null ? controls.camYaw : angleToRad(aim);
    const fx = Math.cos(ar);
    const fy = Math.sin(ar);
    let dx = fx * fwd - fy * side;
    let dy = fy * fwd + fx * side;
    if (controls.touchMove) {
      dx = controls.touchMove[0];
      dy = controls.touchMove[1];
    }
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    const now = performance.now();
    const sprint = controls.keys.has("shift") || controls.touchSprint;
    const buttons =
      (controls.fire || controls.touchFire || now < controls.fireUntil ? 1 : 0) | (controls.reload || now < controls.reloadUntil ? 2 : 0) | (sprint ? 4 : 0);
    session.setInput(dx * 127, dy * 127, aim, buttons);
    session.frame();
  });
  return null;
}

function Post({ session }: { session: Session }) {
  const ca = useRef<any>(null);
  const offset = useMemo(() => new THREE.Vector2(0, 0), []);
  useFrame(() => {
    const now = performance.now();
    let hit: (typeof session.fx)[number] | undefined;
    for (let i = session.fx.length - 1; i >= 0; i--) if (session.fx[i].kind === "hit") { hit = session.fx[i]; break; }
    const k = hit && prefs.hitFlash ? Math.max(0, 1 - (now - hit.at) / 350) : 0;
    offset.set(0.004 * k, 0.003 * k);
  });
  return (
    <EffectComposer multisampling={0}>
      <Bloom intensity={1.05} luminanceThreshold={0.22} luminanceSmoothing={0.2} mipmapBlur />
      <ChromaticAberration ref={ca} offset={offset} blendFunction={BlendFunction.NORMAL} radialModulation={false} modulationOffset={0} />
      <Noise opacity={0.06} premultiply blendFunction={BlendFunction.ADD} />
      <Vignette eskil={false} offset={0.18} darkness={0.85} />
    </EffectComposer>
  );
}

function FlareLight({ session }: { session: Session }) {
  const l = useRef<THREE.AmbientLight>(null);
  useFrame(() => {
    if (!l.current) return;
    const f = session.view?.me.flare ?? 0;
    l.current.intensity = f > 0 ? 0.35 + 0.2 * Math.sin(performance.now() / 60) : 0.025;
  });
  return <ambientLight ref={l} color="#ff9ed8" intensity={0.025} />;
}

/** Applies display settings that live on the renderer/camera. */
function DisplayPrefs() {
  const { gl, camera, scene } = useThree();
  const p = usePrefs();
  useEffect(() => {
    gl.toneMappingExposure = p.exposure;
    const shadows = p.quality === "high";
    if (gl.shadowMap.enabled !== shadows) {
      gl.shadowMap.enabled = shadows;
      scene.traverse((o: any) => {
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => (m.needsUpdate = true));
      });
    }
  }, [p.exposure, p.quality]);
  return null;
}

export const GameScene = memo(function GameScene({ session }: { session: Session }) {
  const p = usePrefs();
  return (
    <Canvas
      shadows
      dpr={p.quality === "high" ? [1, 1.5] : 1}
      camera={{ fov: 46, position: [16, 30, 30], near: 0.1, far: 120 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.1;
        gl.shadowMap.type = THREE.PCFShadowMap;
      }}
    >
      <color attach="background" args={["#020203"]} />
      <fog attach="fog" args={["#020203", 18, 46]} />
      <hemisphereLight args={["#20305a", "#000000", 0.06]} />
      <FlareLight session={session} />
      <Arena />
      <MyPlayer session={session} />
      <Others session={session} />
      <Effects session={session} />
      <LootCrates session={session} />
      <Zone session={session} />
      <Fx session={session} />
      <CameraRig session={session} />
      <InputController session={session} />
      <FpsMeter />
      <LaserSight session={session} />
      <DisplayPrefs />
      {p.quality === "high" && <Post session={session} />}
    </Canvas>
  );
});
