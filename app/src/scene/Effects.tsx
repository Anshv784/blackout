// Atmosphere and impact effects for the match: rain + lightning, sparks, tracers,
// dust in your flashlight, footstep dust, and the poisoned ground outside the zone.
// Everything here is drawn from data you're already allowed to see: lightning lights
// the walls, never the players (others only exist in your scene while in your view).
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Session } from "../game/session";
import { ST_LIVE, ST_COUNTDOWN } from "../chain/layout";
import { isWall, angleToRad, sinFx, PLAYER_R } from "../game/sim";
import { controls } from "../game/controls";
import { audio } from "../game/audio";
import { feel } from "../game/feel";
import { MAP_W } from "../game/gen";
import { prefs, usePrefs, gfx } from "../game/prefs";

// ------------------------------------------------------------------ sparks

const MAX_SPARKS = 420;
const sp = {
  pos: new Float32Array(MAX_SPARKS * 3),
  vel: new Float32Array(MAX_SPARKS * 3),
  col: new Float32Array(MAX_SPARKS * 3),
  base: new Float32Array(MAX_SPARKS * 3),
  life: new Float32Array(MAX_SPARKS),
  max: new Float32Array(MAX_SPARKS),
  grav: new Float32Array(MAX_SPARKS),
  next: 0,
};
const tmpColor = new THREE.Color();

/** Fire `n` particles from (x, y, z) in world units. `dir` (radians) biases them, `spread` widens the fan. */
export function sparks(x: number, y: number, z: number, color: string, n: number, opts: { speed?: number; dir?: number; spread?: number; up?: number; life?: number; grav?: number } = {}) {
  const { speed = 3, dir, spread = Math.PI, up = 1.2, life = 0.45, grav = 9 } = opts;
  if (gfx() === "low") n = Math.ceil(n / 2);
  tmpColor.set(color);
  for (let k = 0; k < n; k++) {
    const i = sp.next;
    sp.next = (sp.next + 1) % MAX_SPARKS;
    const a = dir === undefined ? Math.random() * Math.PI * 2 : dir + (Math.random() - 0.5) * spread;
    const s = speed * (0.4 + Math.random() * 0.8);
    sp.pos.set([x, y, z], i * 3);
    sp.vel.set([Math.cos(a) * s, up * (0.3 + Math.random()), Math.sin(a) * s], i * 3);
    sp.base.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
    sp.max[i] = sp.life[i] = life * (0.6 + Math.random() * 0.8);
    sp.grav[i] = grav;
  }
}

function Sparks() {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(sp.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(sp.col, 3));
    return g;
  }, []);
  useFrame((_, dt) => {
    dt = Math.min(dt, 0.05);
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (sp.life[i] <= 0) {
        sp.col[i * 3] = sp.col[i * 3 + 1] = sp.col[i * 3 + 2] = 0;
        continue;
      }
      sp.life[i] -= dt;
      const j = i * 3;
      sp.vel[j + 1] -= sp.grav[i] * dt;
      sp.pos[j] += sp.vel[j] * dt;
      sp.pos[j + 1] = Math.max(0.02, sp.pos[j + 1] + sp.vel[j + 1] * dt);
      sp.pos[j + 2] += sp.vel[j + 2] * dt;
      const k = Math.max(0, sp.life[i] / sp.max[i]);
      sp.col[j] = sp.base[j] * k;
      sp.col[j + 1] = sp.base[j + 1] * k;
      sp.col[j + 2] = sp.base[j + 2] * k;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  });
  return (
    <points geometry={geo} frustumCulled={false}>
      <pointsMaterial size={0.09} vertexColors transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} sizeAttenuation />
    </points>
  );
}

// ------------------------------------------------------------------ tracers + impacts

const WEAPON_TRACER = ["#ffe6a8", "#ffd27a", "#ffb36b"];

function Tracers({ session }: { session: Session }) {
  const core = useRef<THREE.InstancedMesh>(null);
  const glow = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const prev = useRef<{ list: Session["bullets"]; at: number }>({ list: [], at: 0 });

  useFrame(() => {
    const now = performance.now();
    // impacts: a bullet from the last update that has no continuation in this one died.
    if (session.bulletsAt !== prev.current.at) {
      const p = prev.current;
      if (p.at) {
        const ticks = Math.max(1, Math.round((session.bulletsAt - p.at) / 50));
        for (const b of p.list) {
          const ex = b.x + b.vx * ticks;
          const ey = b.y + b.vy * ticks;
          const continued = session.bullets.some((n) => Math.abs(n.x - ex) < 90 && Math.abs(n.y - ey) < 90);
          if (continued) continue;
          // walk its path: wall → sparks, body → blood
          const steps = ticks * 4;
          let hit: "wall" | "body" | null = null;
          let hx = b.x;
          let hy = b.y;
          for (let s = 1; s <= steps && !hit; s++) {
            hx = b.x + (b.vx * ticks * s) / steps;
            hy = b.y + (b.vy * ticks * s) / steps;
            if (isWall(Math.floor(hx / 256), Math.floor(hy / 256))) hit = "wall";
            else
              for (const tr of session.tracks.values()) {
                const sm = tr.samples[tr.samples.length - 1];
                if (tr.visible && sm && Math.hypot(sm.x - hx, sm.y - hy) < 110) {
                  hit = "body";
                  break;
                }
              }
            const me = session.myPos();
            if (!hit && me && Math.hypot(me.x - hx, me.y - hy) < 100) hit = "body";
          }
          if (!hit) continue;
          const back = Math.atan2(-b.vy, -b.vx);
          if (hit === "wall") {
            sparks(hx / 256, 0.7, hy / 256, "#ffc56b", 9, { speed: 3.2, dir: back, spread: 2.2, up: 2.2, life: 0.35 });
            const me = session.myPos();
            if (me && Math.hypot(hx - me.x, hy - me.y) < 6 * 256) audio.ricochet(Math.sin(Math.atan2(hy - me.y, hx - me.x) - angleToRad(session.input.aim)));
          }
          else sparks(hx / 256, 0.75, hy / 256, "#ff2e4d", 12, { speed: 2.2, dir: back + Math.PI, spread: 1.6, up: 1.6, life: 0.5, grav: 7 });
        }
      }
      // a round that came from further out and is now right next to you: it cracked past your head
      const me = session.myPos();
      if (me) {
        for (const nb of session.bullets) {
          const dn = Math.hypot(nb.x - me.x, nb.y - me.y);
          const db = Math.hypot(nb.x - nb.vx - me.x, nb.y - nb.vy - me.y);
          if (dn < 1.3 * 256 && db > 2.2 * 256) audio.whiz(Math.sin(Math.atan2(nb.y - me.y, nb.x - me.x) - angleToRad(session.input.aim)));
        }
      }
      prev.current = { list: session.bullets, at: session.bulletsAt };
    }

    const c = core.current;
    const g = glow.current;
    if (!c || !g) return;
    const k = Math.min(1.5, (now - session.bulletsAt) / 50);
    let n = 0;
    for (const b of session.bullets) {
      const x = (b.x + b.vx * k) / 256;
      const z = (b.y + b.vy * k) / 256;
      const len = Math.min(1.6, Math.hypot(b.vx, b.vy) / 256 * 1.6);
      tmp.position.set(x - (Math.cos(Math.atan2(b.vy, b.vx)) * len) / 2, 0.7, z - (Math.sin(Math.atan2(b.vy, b.vx)) * len) / 2);
      tmp.rotation.set(0, -Math.atan2(b.vy, b.vx), 0);
      tmp.scale.set(len, 1, 1);
      tmp.updateMatrix();
      c.setMatrixAt(n, tmp.matrix);
      g.setMatrixAt(n, tmp.matrix);
      n++;
    }
    // your own shots: flown locally at the real speed, stopped by walls
    for (const s of session.localShots) {
      if (s.dead || n >= 31) continue;
      const age = (now - s.born) / 50; // in ticks
      if (age > s.ttl) {
        s.dead = true;
        continue;
      }
      let px = s.x + s.vx * age;
      let py = s.y + s.vy * age;
      // walk the path to the first wall
      const steps = Math.ceil(age * 4);
      for (let k = 1; k <= steps; k++) {
        const qx = s.x + (s.vx * age * k) / steps;
        const qy = s.y + (s.vy * age * k) / steps;
        if (isWall(Math.floor(qx / 256), Math.floor(qy / 256))) {
          s.dead = true;
          sparks(qx / 256, 0.7, qy / 256, "#ffc56b", 9, { speed: 3.2, dir: Math.atan2(-s.vy, -s.vx), spread: 2.2, up: 2.2, life: 0.35 });
          px = qx;
          py = qy;
          break;
        }
      }
      if (s.dead) continue;
      const len = Math.min(1.6, (Math.hypot(s.vx, s.vy) / 256) * 1.6);
      const dir = Math.atan2(s.vy, s.vx);
      tmp.position.set(px / 256 - (Math.cos(dir) * len) / 2, 0.7, py / 256 - (Math.sin(dir) * len) / 2);
      tmp.rotation.set(0, -dir, 0);
      tmp.scale.set(len, 1, 1);
      tmp.updateMatrix();
      c.setMatrixAt(n, tmp.matrix);
      g.setMatrixAt(n, tmp.matrix);
      n++;
    }
    c.count = g.count = n;
    c.instanceMatrix.needsUpdate = g.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={core} args={[undefined, undefined, 32]} frustumCulled={false}>
        <boxGeometry args={[1, 0.035, 0.035]} />
        <meshBasicMaterial color={WEAPON_TRACER[0]} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={glow} args={[undefined, undefined, 32]} frustumCulled={false}>
        <boxGeometry args={[1.05, 0.14, 0.14]} />
        <meshBasicMaterial color="#ff9a3c" transparent opacity={0.22} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </>
  );
}

// ------------------------------------------------------------------ thrown gadgets

const NADE_TTL = 18; // ticks of flight (the program's throw)
const NADE_COLOR = ["#000", "#4a5233", "#7d8a8f", "#3c4450", "#6b5a2e", "#2d4a5a"];
const NADE_LIGHT = ["#000", "#ff3030", "#000", "#ffffff", "#ffb347", "#3cf0ff"];
const BLAST_R = [0, 3, 2.5, 7, 1, 1]; // tiles: frag, smoke, flash, decoy, sensor

/** Height above the ground `t` ticks after the throw: a lob, one short hop, then rolling. */
function nadeY(t: number) {
  if (t < 11) {
    const u = t / 11;
    return 1.25 * (1 - u) + 0.07 * u + 3.0 * u * (1 - u);
  }
  if (t < 15) return 0.07 + 0.3 * Math.sin((Math.PI * (t - 11)) / 4);
  return 0.07;
}

/** The program's flight, tick by tick (same integer maths, so the arc is where it really lands). */
function flightPath(x0: number, y0: number, aim: number) {
  const c = sinFx(aim + 16384);
  const sn = sinFx(aim);
  let x = x0 + Math.trunc((c * (PLAYER_R + 40)) / 1024);
  let y = y0 + Math.trunc((sn * (PLAYER_R + 40)) / 1024);
  if (isWall(x >> 8, y >> 8)) return null;
  let vx = Math.trunc((c * 120) / 1024);
  let vy = Math.trunc((sn * 120) / 1024);
  const pts: [number, number][] = [[x, y]];
  for (let i = 0; i < NADE_TTL; i++) {
    const nx = x + vx;
    if (isWall(nx >> 8, y >> 8)) vx = Math.trunc(-vx / 2);
    else x = nx;
    const ny = y + vy;
    if (isWall(x >> 8, ny >> 8)) vy = Math.trunc(-vy / 2);
    else y = ny;
    vx = Math.trunc((vx * 7) / 8);
    vy = Math.trunc((vy * 7) / 8);
    pts.push([x, y]);
  }
  return pts;
}

function Nades({ session }: { session: Session }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const prev = useRef<{ list: Session["nades"]; at: number }>({ list: [], at: 0 });
  useFrame(() => {
    const now = performance.now();
    const me = session.myPos();
    const aimR = angleToRad(session.input.aim);
    if (session.bulletsAt !== prev.current.at) {
      // bounces off walls and the first touch-down get a clink; matched to last update's can
      for (const n of session.nades) {
        const o = prev.current.list.find((q) => q.kind === n.kind && q.ttl > n.ttl && Math.hypot(q.x - n.x, q.y - n.y) < 500);
        if (!o) continue;
        const d = me ? Math.hypot(n.x - me.x, n.y - me.y) / 256 : 10;
        const vol = Math.max(0.15, 1 - d / 16);
        const pan = me ? Math.sin(Math.atan2(n.y - me.y, n.x - me.x) - aimR) : 0;
        const landed = NADE_TTL - o.ttl < 11 && NADE_TTL - n.ttl >= 11;
        const hopped = NADE_TTL - o.ttl < 15 && NADE_TTL - n.ttl >= 15;
        const wall = Math.sign(o.vx) * Math.sign(n.vx) < 0 || Math.sign(o.vy) * Math.sign(n.vy) < 0;
        if (landed || wall) audio.clink(vol, pan);
        if (hopped) audio.roll(vol, pan);
      }
      prev.current = { list: session.nades, at: session.bulletsAt };
    }
    const k = Math.min(1.2, (now - session.bulletsAt) / 50);
    for (let i = 0; i < 6; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const n = session.nades[i];
      g.visible = !!n;
      if (!n) continue;
      const t = Math.min(NADE_TTL, NADE_TTL - n.ttl + k);
      g.position.set((n.x + n.vx * k) / 256, nadeY(t), (n.y + n.vy * k) / 256);
      // tumbling in the air, rolling on the ground
      g.rotation.set(now / (t < 11 ? 70 : 160), Math.atan2(n.vy, n.vx), 0);
      const body = g.children[0] as THREE.Mesh;
      (body.material as THREE.MeshStandardMaterial).color.set(NADE_COLOR[n.kind] ?? "#555");
      const led = g.children[1] as THREE.Mesh;
      led.visible = NADE_LIGHT[n.kind] !== "#000" && Math.floor(now / (n.ttl < 6 ? 60 : 160)) % 2 === 0;
      (led.material as THREE.MeshBasicMaterial).color.set(NADE_LIGHT[n.kind] ?? "#fff");
    }
  });
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <group key={i} ref={(el) => (groups.current[i] = el)} visible={false}>
          <mesh castShadow>
            <capsuleGeometry args={[0.07, 0.08, 4, 8]} />
            <meshStandardMaterial roughness={0.6} metalness={0.5} />
          </mesh>
          <mesh position={[0, 0.13, 0]}>
            <sphereGeometry args={[0.03, 6, 6]} />
            <meshBasicMaterial toneMapped={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/** Holding G: a dotted arc to where the throw lands, and a ring for what it'll cover. */
function ThrowPreview({ session }: { session: Session }) {
  const dots = useRef<THREE.InstancedMesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const wasHeld = useRef(0);
  useFrame(() => {
    const d = dots.current;
    const r = ring.current;
    if (!d || !r) return;
    const v = session.view;
    const p = session.myPos();
    const kind = v?.inv?.gadget ?? 0;
    const show = !!controls.gadgetHeld && !!p && v?.me.alive === 1 && (v?.inv?.count ?? 0) > 0 && kind >= 1 && kind <= 5 && session.room?.status === ST_LIVE;
    if (controls.gadgetHeld && controls.gadgetHeld !== wasHeld.current && show) audio.fuse();
    wasHeld.current = controls.gadgetHeld;
    const path = show ? flightPath(p!.x, p!.y, session.input.aim) : null;
    if (!path) {
      d.count = 0;
      r.visible = false;
      return;
    }
    // dots every half tick along the lob
    let n = 0;
    for (let t = 0; t < NADE_TTL && n < 36; t += 0.5) {
      const a = path[Math.floor(t)];
      const b = path[Math.min(NADE_TTL, Math.floor(t) + 1)];
      const f = t - Math.floor(t);
      tmp.position.set((a[0] + (b[0] - a[0]) * f) / 256, nadeY(t), (a[1] + (b[1] - a[1]) * f) / 256);
      const s = 1 - (t / NADE_TTL) * 0.5;
      tmp.scale.set(s, s, s);
      tmp.updateMatrix();
      d.setMatrixAt(n++, tmp.matrix);
    }
    d.count = n;
    d.instanceMatrix.needsUpdate = true;
    const end = path[NADE_TTL];
    r.visible = true;
    r.position.set(end[0] / 256, 0.04, end[1] / 256);
    const rad = BLAST_R[kind] ?? 1;
    r.scale.set(rad, rad, 1);
    (r.material as THREE.MeshBasicMaterial).color.set(kind === 1 ? "#ff5a3c" : kind === 3 ? "#ffffff" : "#ffd84a");
  });
  return (
    <>
      <instancedMesh ref={dots} args={[undefined, undefined, 36]} frustumCulled={false}>
        <sphereGeometry args={[0.055, 6, 6]} />
        <meshBasicMaterial color="#ffd84a" transparent opacity={0.9} toneMapped={false} depthWrite={false} />
      </instancedMesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.94, 1, 48]} />
        <meshBasicMaterial transparent opacity={0.55} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

// ------------------------------------------------------------------ rain

function Rain({ session }: { session: Session }) {
  const N = 1400;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const seed = new Float32Array(N * 2 * 3);
    const end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * 36;
      const z = Math.random() * 36;
      const ph = Math.random();
      seed.set([x, z, ph, x, z, ph], i * 6);
      end[i * 2] = 0;
      end[i * 2 + 1] = 1;
    }
    g.setAttribute("position", new THREE.BufferAttribute(seed, 3));
    g.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector2(16, 16) }, uFlash: { value: 0 } },
        vertexShader: `attribute float aEnd; uniform float uTime; uniform vec2 uCenter; varying float vA;
          void main(){
            vec3 s = position;
            float x = uCenter.x + mod(s.x - uCenter.x + 18.0, 36.0) - 18.0;
            float z = uCenter.y + mod(s.y - uCenter.y + 18.0, 36.0) - 18.0;
            float y = 11.0 - mod(s.z * 11.0 + uTime * 16.0, 11.0);
            y -= aEnd * 0.5;
            x += aEnd * 0.08;
            vA = (1.0 - aEnd * 0.7) * smoothstep(0.0, 1.5, y);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(x, y, z, 1.0);
          }`,
        fragmentShader: `uniform float uFlash; varying float vA; void main(){ gl_FragColor = vec4(0.62, 0.72, 0.95, vA * (0.16 + uFlash * 0.5)); }`,
      }),
    [],
  );
  useFrame(({ clock }) => {
    mat.uniforms.uTime.value = clock.elapsedTime;
    mat.uniforms.uFlash.value = feel.lightning;
    const p = session.myPos();
    if (p) mat.uniforms.uCenter.value.set(p.x / 256, p.y / 256);
  });
  return <lineSegments geometry={geo} material={mat} frustumCulled={false} />;
}

/** A storm overhead: every so often the whole Yard flashes white for a heartbeat. */
function Lightning({ session }: { session: Session }) {
  const sky = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const next = useRef(performance.now() + 7000 + Math.random() * 6000);
  const seq = useRef<number[]>([]);
  useFrame(() => {
    const now = performance.now();
    const live = session.room?.status === ST_LIVE || session.room?.status === ST_COUNTDOWN;
    if (live && now > next.current && prefs.weather) {
      next.current = now + 16000 + Math.random() * 26000;
      // flicker pattern: start times (ms) and strengths
      seq.current = [now, now + 90, now + 210, now + 330];
      audio.thunder(0.5 + Math.random() * 2);
    }
    let f = 0;
    const s = seq.current;
    if (s.length) {
      const t = now - s[0];
      if (t < 70) f = 1;
      else if (t < 140) f = 0.15;
      else if (t < 200) f = 0.75;
      else if (t < 520) f = 0.4 * (1 - (t - 200) / 320);
      else seq.current = [];
    }
    feel.lightning = f;
    if (sky.current) sky.current.intensity = f * 1.6;
    if (sun.current) sun.current.intensity = f * 2.4;
  });
  return (
    <>
      <hemisphereLight ref={sky} args={["#cfdcff", "#1a1c2a", 0]} />
      <directionalLight ref={sun} position={[6, 20, 2]} color="#dfe8ff" intensity={0} />
    </>
  );
}

// ------------------------------------------------------------------ dust in your light

function DustMotes({ session }: { session: Session }) {
  const N = 320;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) pos.set([Math.random() * 20, 0.2 + Math.random() * 2.2, Math.random() * 20], i * 3);
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uPlayer: { value: new THREE.Vector2() }, uDir: { value: new THREE.Vector2(1, 0) }, uOn: { value: 1 } },
        vertexShader: `uniform float uTime; uniform vec2 uPlayer; uniform vec2 uDir; varying float vA;
          void main(){
            vec3 p = position;
            p.x += sin(uTime * 0.3 + p.y * 3.0) * 0.4;
            p.z += cos(uTime * 0.25 + p.x) * 0.4;
            p.y += sin(uTime * 0.5 + p.z * 2.0) * 0.15;
            float x = uPlayer.x + mod(p.x - uPlayer.x + 10.0, 20.0) - 10.0;
            float z = uPlayer.y + mod(p.z - uPlayer.y + 10.0, 20.0) - 10.0;
            vec2 rel = vec2(x, z) - uPlayer;
            float d = length(rel);
            float cone = smoothstep(0.82, 0.93, dot(rel / max(d, 0.001), uDir));
            vA = cone * smoothstep(9.5, 2.0, d) * smoothstep(0.4, 1.4, d);
            vec4 mv = modelViewMatrix * vec4(x, p.y, z, 1.0);
            gl_PointSize = clamp(26.0 / -mv.z, 1.0, 4.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `uniform float uOn; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float r = 1.0 - smoothstep(0.2, 0.5, length(c)); gl_FragColor = vec4(1.0, 0.94, 0.8, vA * r * 0.45 * uOn); }`,
      }),
    [],
  );
  useFrame(({ clock }) => {
    mat.uniforms.uTime.value = clock.elapsedTime;
    const p = session.myPos();
    if (!p) return;
    const a = angleToRad(session.input.aim);
    mat.uniforms.uPlayer.value.set(p.x / 256, p.y / 256);
    mat.uniforms.uDir.value.set(Math.cos(a), Math.sin(a));
    mat.uniforms.uOn.value = session.view?.me.alive && !(session.view.me.flare > 0) ? 1 : 0;
  });
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

// ------------------------------------------------------------------ poison outside the zone

function ZoneGround({ session }: { session: Session }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uZone: { value: new THREE.Vector3(16, 16, 40) } },
        vertexShader: `varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform float uTime; uniform vec3 uZone; varying vec2 vW;
          float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
          void main(){
            float d = length(vW - uZone.xy);
            float out_ = smoothstep(uZone.z - 0.1, uZone.z + 0.8, d);
            float edge = exp(-abs(d - uZone.z) * 5.0);
            float fog = n(vW * 0.8 + vec2(uTime * 0.3, -uTime * 0.2)) * 0.6 + n(vW * 2.1 - uTime * 0.4) * 0.4;
            vec3 col = mix(vec3(0.42, 0.12, 0.75), vec3(0.75, 0.35, 1.0), fog);
            float a = out_ * (0.16 + fog * 0.18) + edge * 0.35;
            gl_FragColor = vec4(col, a);
          }`,
      }),
    [],
  );
  useFrame(({ clock }) => {
    const r = session.room;
    mat.uniforms.uTime.value = clock.elapsedTime;
    if (r) mat.uniforms.uZone.value.set(r.zone.x / 256, r.zone.y / 256, r.zone.r > 0 ? r.zone.r / 256 : 99);
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position={[MAP_W / 2, 0.03, MAP_W / 2]} material={mat} renderOrder={1}>
      <planeGeometry args={[MAP_W + 10, MAP_W + 10]} />
    </mesh>
  );
}

// ------------------------------------------------------------------ reactions

/** Watches the session for things that should be felt: your hits, getting hit, footsteps, enemy shots. */
function floatText(x: number, y: number, text: string, kill: boolean) {
  const host = document.querySelector(".game");
  if (!host) return;
  const d = document.createElement("div");
  d.className = `dmg-float${kill ? " kill" : ""}`;
  d.textContent = text;
  d.style.left = `${x + (Math.random() - 0.5) * 30}px`;
  d.style.top = `${y}px`;
  host.appendChild(d);
  setTimeout(() => d.remove(), 900);
}

function Reactions({ session }: { session: Session }) {
  const { camera } = useThree();
  const lastFx = useRef(0);
  const hp = useRef<Map<number, number>>(new Map());
  const step = useRef({ x: 0, y: 0, acc: 0 });
  const lastFire = useRef(0);
  useEffect(() => {
    hp.current.clear();
  }, [session]);
  useFrame(() => {
    const now = performance.now();
    const v = session.view;
    // your trigger finger (for hit attribution)
    if ((session.input.buttons & 1) === 1) lastFire.current = now;

    for (const f of session.fx) {
      if (f.id <= lastFx.current) continue;
      if (f.kind === "hit") {
        feel.shake = Math.min(1.4, feel.shake + 0.9);
        feel.hurtAt = now;
      } else if (f.kind === "loot") {
        const col = ["#fff", "#ffd166", "#06d6a0", "#4cc9f0", "#ff5ccd"][f.sub ?? 0];
        sparks(f.x / 256, 0.4, f.y / 256, col, 22, { speed: 1.6, up: 3.2, life: 0.8, grav: 3 });
      } else if (f.kind === "death") {
        sparks(f.x / 256, 0.8, f.y / 256, "#ff2e4d", 34, { speed: 3, up: 3, life: 0.9, grav: 6 });
        sparks(f.x / 256, 0.3, f.y / 256, "#9fb4ff", 16, { speed: 1, up: 4, life: 1.4, grav: -0.5 });
      } else if (f.kind === "shot") {
        const a = angleToRad(f.angle ?? 0);
        const me = session.myPos();
        if (me) {
          const d = Math.hypot(f.x - me.x, f.y - me.y) / 256;
          const rel = Math.atan2(f.y - me.y, f.x - me.x) - angleToRad(session.input.aim);
          const tr = session.tracks.get(f.sub ?? -1);
          const w = tr?.samples[tr.samples.length - 1]?.weapon ?? 0;
          audio.shotAt(w, d, Math.sin(rel));
        }
        sparks(f.x / 256 + Math.cos(a) * 0.7, 0.72, f.y / 256 + Math.sin(a) * 0.7, "#ffcf7a", 5, { speed: 4, dir: a, spread: 0.7, up: 0.4, life: 0.12, grav: 0 });
      }
    }
    if (session.fx.length) lastFx.current = session.fx[session.fx.length - 1].id;

    // enemies you can see losing health
    for (const tr of session.tracks.values()) {
      const sm = tr.samples[tr.samples.length - 1];
      if (!sm) continue;
      const before = hp.current.get(tr.seat);
      hp.current.set(tr.seat, sm.hp);
      if (before !== undefined && sm.hp < before && tr.visible) {
        sparks(sm.x / 256, 0.8, sm.y / 256, "#ff2e4d", 14, { speed: 2, up: 2, life: 0.55, grav: 7 });
        if (now - lastFire.current < 600) {
          feel.hitAt = now;
          audio.hitmark();
          // your damage, floating off the target
          const v3 = new THREE.Vector3(sm.x / 256, 1.5, sm.y / 256).project(camera);
          if (v3.z < 1) floatText(((v3.x + 1) / 2) * window.innerWidth, ((1 - v3.y) / 2) * window.innerHeight, String(before - sm.hp), sm.hp === 0);
        }
      }
    }

    // footstep dust
    const p = session.myPos();
    if (p && v?.me.alive && session.room?.status === ST_LIVE) {
      const s = step.current;
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      s.x = p.x;
      s.y = p.y;
      if (d < 200) s.acc += d;
      const every = session.sprinting ? 150 : 230;
      if (s.acc > every) {
        s.acc = 0;
        if (!(session.input.buttons & 32)) audio.step(0, session.sprinting ? 0.5 : 0.28, session.sprinting);
        sparks(p.x / 256, 0.05, p.y / 256, session.sprinting ? "#8a8fa0" : "#5c606c", session.sprinting ? 6 : 3, { speed: 0.6, up: 0.5, life: 0.5, grav: 0.5 });
      }
    }
  });
  return null;
}

/** Red smoke over the supply drop: seen from anywhere, like PUBG's flare smoke. */
function DropBeacon({ session }: { session: Session }) {
  const col = useRef<THREE.Mesh>(null);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uTime; varying vec2 vUv;
          void main(){ float w = 0.5 + 0.5 * sin(vUv.y * 18.0 - uTime * 2.5 + vUv.x * 12.0);
            float a = (1.0 - vUv.y) * (0.18 + 0.12 * w);
            gl_FragColor = vec4(1.0, 0.18, 0.15, a); }`,
      }),
    [],
  );
  const puff = useRef(0);
  useFrame(({ clock }, dt) => {
    mat.uniforms.uTime.value = clock.elapsedTime;
    const d = session.drop;
    const on = !!d && performance.now() - d.at < 4000 && session.room?.status === ST_LIVE;
    if (!col.current) return;
    col.current.visible = on;
    if (!on || !d) return;
    col.current.position.set(d.x / 256, 6, d.y / 256);
    puff.current += dt;
    if (puff.current > 0.12) {
      puff.current = 0;
      sparks(d.x / 256, 0.6, d.y / 256, "#ff4d3d", 3, { speed: 0.3, up: 3.5, life: 2.4, grav: -0.4 });
    }
  });
  return (
    <mesh ref={col} material={mat} visible={false} frustumCulled={false}>
      <cylinderGeometry args={[0.35, 0.9, 12, 24, 1, true]} />
    </mesh>
  );
}

/** Smoke clouds (from smoke pings) and explosions (from boom pings). A fixed pool: no new lights or materials. */
const SMOKE_PUFFS = 7;
function SmokeAndBooms({ session }: { session: Session }) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(200,205,215,0.9)");
    grad.addColorStop(0.6, "rgba(150,155,165,0.45)");
    grad.addColorStop(1, "rgba(120,125,135,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }, []);
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const boomLight = useRef<THREE.PointLight>(null);
  const seen = useRef(new Set<number>());
  useFrame(({ clock }) => {
    const now = performance.now();
    // drop clouds we haven't heard about for a while
    for (const [k, c] of session.smokes) if (now - c.at > 2500) session.smokes.delete(k);
    const clouds = [...session.smokes.values()].slice(0, 4);
    for (let i = 0; i < 4 * SMOKE_PUFFS; i++) {
      const sp = sprites.current[i];
      if (!sp) continue;
      const c = clouds[Math.floor(i / SMOKE_PUFFS)];
      sp.visible = !!c;
      if (!c) continue;
      const k = i % SMOKE_PUFFS;
      const a = k * 0.9 + clock.elapsedTime * 0.15;
      const r = k === 0 ? 0 : 1.4;
      sp.position.set(c.x / 256 + Math.cos(a) * r, 0.9 + (k % 3) * 0.55, c.y / 256 + Math.sin(a) * r);
      const sc = 3.2 + Math.sin(clock.elapsedTime * 0.6 + k) * 0.3;
      sp.scale.set(sc, sc, 1);
    }
    // explosions: sparks once, and the one shared flash light
    let flash = 0;
    session.booms.forEach((b, i) => {
      const age = now - b.at;
      const id = Math.round(b.at);
      if (!seen.current.has(id)) {
        seen.current.add(id);
        sparks(b.x / 256, 0.6, b.y / 256, "#ffb347", 40, { speed: 6, up: 3, life: 0.6, grav: 8 });
        sparks(b.x / 256, 0.4, b.y / 256, "#6b6f78", 18, { speed: 1.2, up: 2.5, life: 1.6, grav: -0.3 });
      }
      if (age < 300 && boomLight.current) {
        boomLight.current.position.set(b.x / 256, 1.5, b.y / 256);
        flash = Math.max(flash, 1 - age / 300);
      }
      void i;
    });
    if (seen.current.size > 64) seen.current.clear();
    if (boomLight.current) boomLight.current.intensity = flash * 40;
  });
  return (
    <>
      {Array.from({ length: 4 * SMOKE_PUFFS }, (_, i) => (
        <sprite key={i} ref={(el) => (sprites.current[i] = el)} visible={false}>
          <spriteMaterial map={tex} transparent depthWrite={false} opacity={0.85} color="#9aa0aa" />
        </sprite>
      ))}
      <pointLight ref={boomLight} color="#ffb070" intensity={0} distance={9} decay={1.4} />
    </>
  );
}

export function Effects({ session }: { session: Session }) {
  const p = usePrefs();
  const rich = gfx(p) === "high";
  useEffect(() => {
    const t = setInterval(() => {
      const live = session.room?.status === ST_LIVE || session.room?.status === ST_COUNTDOWN;
      audio.setRain(prefs.weather && live ? 1 : 0);
    }, 1000);
    return () => {
      clearInterval(t);
      audio.setRain(0);
    };
  }, [session]);
  return (
    <>
      <Sparks />
      <Tracers session={session} />
      <ZoneGround session={session} />
      <Reactions session={session} />
      <DropBeacon session={session} />
      <SmokeAndBooms session={session} />
      <Nades session={session} />
      <ThrowPreview session={session} />
      {p.weather && <Lightning session={session} />}
      {p.weather && rich && <Rain session={session} />}
      {rich && <DustMotes session={session} />}
    </>
  );
}

