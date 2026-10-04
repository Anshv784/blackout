// Atmosphere and impact effects for the match: rain + lightning, sparks, tracers,
// dust in your flashlight, footstep dust, and the poisoned ground outside the zone.
// Everything here is drawn from data you're already allowed to see: lightning lights
// the walls, never the players (others only exist in your scene while in your view).
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Session } from "../game/session";
import { ST_LIVE, ST_COUNTDOWN } from "../chain/layout";
import { isWall, angleToRad } from "../game/sim";
import { audio } from "../game/audio";
import { feel } from "../game/feel";
import { prefs, usePrefs } from "../game/prefs";

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
  if (prefs.quality === "low") n = Math.ceil(n / 2);
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
          if (hit === "wall") sparks(hx / 256, 0.7, hy / 256, "#ffc56b", 9, { speed: 3.2, dir: back, spread: 2.2, up: 2.2, life: 0.35 });
          else sparks(hx / 256, 0.75, hy / 256, "#ff2e4d", 12, { speed: 2.2, dir: back + Math.PI, spread: 1.6, up: 1.6, life: 0.5, grav: 7 });
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
    <mesh rotation-x={-Math.PI / 2} position={[16, 0.03, 16]} material={mat} renderOrder={1}>
      <planeGeometry args={[40, 40]} />
    </mesh>
  );
}

// ------------------------------------------------------------------ reactions

/** Watches the session for things that should be felt: your hits, getting hit, footsteps, enemy shots. */
function Reactions({ session }: { session: Session }) {
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
        sparks(p.x / 256, 0.05, p.y / 256, session.sprinting ? "#8a8fa0" : "#5c606c", session.sprinting ? 6 : 3, { speed: 0.6, up: 0.5, life: 0.5, grav: 0.5 });
      }
    }
  });
  return null;
}

export function Effects({ session }: { session: Session }) {
  const p = usePrefs();
  const rich = p.quality === "high";
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
      {p.weather && <Lightning session={session} />}
      {p.weather && rich && <Rain session={session} />}
      {rich && <DustMotes session={session} />}
    </>
  );
}

