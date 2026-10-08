import { useMemo, useRef, useEffect } from "react";
import { TOUCH } from "../game/device";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { MAP_W } from "../game/gen";
import { Arena } from "./Arena";
import { Avatar, SEAT_COLORS, aimToRotY } from "./Avatar";
import { stillMotion, type Motion } from "./Soldier";
import { isWall } from "../game/sim";
import { audio } from "../game/audio";
import type { Recording, Room, World } from "../chain/layout";
import { lineOfSight, AMBIENT_R, VISION_R, CONE_HALF, angleToRad } from "../game/sim";

export interface ReplayCtl {
  t: number; // frame (float)
  playing: boolean;
  speed: number;
  lights: number; // 0 = your view, 1 = lights on (animated)
  lightsTarget: number;
  follow: boolean;
}

const CONE_RAD = (CONE_HALF / 65536) * Math.PI * 2;

function frameAt(rec: Recording, t: number, seat: number) {
  const n = rec.frames;
  const i = Math.max(0, Math.min(n - 1, Math.floor(t)));
  const j = Math.min(n - 1, i + 1);
  const a = rec.data[i][seat];
  const b = rec.data[j][seat];
  const k = Math.min(1, Math.max(0, t - i));
  let da = b.aim - a.aim;
  if (da > 32768) da -= 65536;
  if (da < -32768) da += 65536;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, aim: (a.aim + da * k + 65536) % 65536, alive: a.alive, firing: a.firing || b.firing, flare: a.flare, hit: a.hit };
}

/** Same rule the TEE used: cone + ambient circle + line of sight. */
function wouldSee(me: { x: number; y: number; aim: number; flare: boolean }, o: { x: number; y: number; firing: boolean }) {
  if (me.flare) return true;
  const dx = o.x - me.x;
  const dy = o.y - me.y;
  const d2 = dx * dx + dy * dy;
  if (d2 <= AMBIENT_R * AMBIENT_R) return lineOfSight(me.x, me.y, o.x, o.y);
  if (d2 <= VISION_R * VISION_R) {
    const a = Math.atan2(dy, dx);
    let diff = Math.abs(a - angleToRad(me.aim)) % (Math.PI * 2);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff <= CONE_RAD) return lineOfSight(me.x, me.y, o.x, o.y);
  }
  if (o.firing && d2 <= (16 * 256) ** 2) return lineOfSight(me.x, me.y, o.x, o.y);
  return false;
}

function zoneAt(world: World | null, tick: number) {
  if (!world) return null;
  const t = Math.max(0, tick - 60);
  let x = (MAP_W / 2) * 256;
  let y = (MAP_W / 2) * 256;
  let r = 35 * 256;
  for (const ph of world.zone) {
    if (t < ph.start) break;
    if (t >= ph.end || ph.end === ph.start) {
      x = ph.x;
      y = ph.y;
      r = ph.r;
    } else {
      const k = (t - ph.start) / (ph.end - ph.start);
      x += (ph.x - x) * k;
      y += (ph.y - y) * k;
      r += (ph.r - r) * k;
      break;
    }
  }
  return { x, y, r };
}

function Players({ rec, room, me, ctl }: { rec: Recording; room: Room; me: number | null; ctl: React.MutableRefObject<ReplayCtl> }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const trails = useRef<(THREE.Line | null)[]>([]);
  const tags = useRef<(HTMLDivElement | null)[]>([]);
  const trailGeos = useMemo(() => Array.from({ length: 8 }, () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(60 * 3), 3));
    return g;
  }), []);
  const lines = useMemo(
    () => trailGeos.map((g, s) => new THREE.Line(g, new THREE.LineBasicMaterial({ color: SEAT_COLORS[s], transparent: true, opacity: 0.65, toneMapped: false }))),
    [trailGeos],
  );
  useEffect(() => {
    trails.current = lines;
  }, [lines]);
  // the soldiers' bodies, driven from the recording
  const motions = useMemo(() => Array.from({ length: 8 }, () => ({ current: stillMotion() }) as React.MutableRefObject<Motion>), []);
  // gunfire: a tracer per seat from the muzzle to the first wall, plus a muzzle flash and hit flash
  const tracers = useRef<(THREE.Mesh | null)[]>([]);
  const flashes = useRef<(THREE.Mesh | null)[]>([]);
  const hits = useRef<(THREE.Mesh | null)[]>([]);
  const lastShot = useRef<number[]>(Array(8).fill(-1));
  const occupied = useMemo(() => Array.from({ length: 8 }, (_, s) => rec.data[0]?.[s]?.alive || room.isBot[s] === 1 || room.players[s].toBase58() !== "11111111111111111111111111111111"), [rec, room]);
  useFrame(() => {
    const c = ctl.current;
    const meF = me !== null ? frameAt(rec, c.t, me) : null;
    for (let s = 0; s < 8; s++) {
      const g = groups.current[s];
      const tr = trails.current[s];
      if (!g || !tr) continue;
      if (!occupied[s]) {
        g.visible = false;
        tr.visible = false;
        const tg = tags.current[s];
        if (tg) tg.style.display = "none";
        continue;
      }
      const f = frameAt(rec, c.t, s);
      g.position.set(f.x / 256, 0, f.y / 256);
      g.rotation.y = aimToRotY(f.aim);
      const back = frameAt(rec, Math.max(0, c.t - 0.5), s);
      const step = Math.hypot(f.x - back.x, f.y - back.y) / Math.max(1, rec.every); // units per tick
      const mo = motions[s].current;
      mo.speed = !f.alive || step < 8 ? 0 : step > 70 ? 2 : 1;
      mo.firing = f.firing;
      mo.downed = !f.alive;
      const seenByMe = s === me || !meF || !meF.alive ? true : wouldSee(meF, f);
      // in "your view" only what the TEE would have shown you; lights on = everyone
      const show = f.alive && (c.lights > 0.5 || seenByMe);
      g.visible = show || (!f.alive && c.lights > 0.5);
      // shots: a tracer to the first wall, a muzzle flash, the sound (once per shot, while playing)
      const tr2 = tracers.current[s];
      const fl = flashes.current[s];
      const hm = hits.current[s];
      const shooting = f.alive && f.firing && g.visible;
      if (tr2 && fl) {
        tr2.visible = fl.visible = shooting;
        if (shooting) {
          const a = (f.aim / 65536) * Math.PI * 2;
          const cx = Math.cos(a);
          const cz = Math.sin(a);
          let len = 0.6;
          while (len < 14 && !isWall(Math.floor(f.x / 256 + cx * len), Math.floor(f.y / 256 + cz * len))) len += 0.25;
          const mx = f.x / 256 + cx * 0.75;
          const mz = f.y / 256 + cz * 0.75;
          tr2.position.set(mx + (cx * (len - 0.75)) / 2, 0.95, mz + (cz * (len - 0.75)) / 2);
          tr2.rotation.set(0, -a, 0);
          tr2.scale.set(Math.max(0.1, len - 0.75), 1, 1);
          (tr2.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.random() * 0.4;
          fl.position.set(mx, 0.95, mz);
          fl.scale.setScalar(0.6 + Math.random() * 0.6);
          const frame = Math.floor(c.t);
          if (c.playing && lastShot.current[s] !== frame && c.speed <= 1.5) {
            lastShot.current[s] = frame;
            audio.shoot(0);
          }
        }
      }
      if (hm) {
        hm.visible = f.hit && g.visible;
        if (hm.visible) hm.position.set(f.x / 256, 0.9, f.y / 256);
      }
      tr.visible = c.lights > 0.5;
      const pos = trailGeos[s].getAttribute("position") as THREE.BufferAttribute;
      for (let k = 0; k < 60; k++) {
        const ff = frameAt(rec, Math.max(0, c.t - k * 0.5), s);
        pos.setXYZ(k, ff.x / 256, 0.05, ff.y / 256);
      }
      pos.needsUpdate = true;
      const tag = tags.current[s];
      if (tag) tag.style.display = g.visible ? "flex" : "none";
    }
  });
  return (
    <>
      {Array.from({ length: 8 }, (_, s) => (
        <group key={s}>
          <group ref={(el) => (groups.current[s] = el)} visible={false}>
            <Avatar color={SEAT_COLORS[s]} me={s === me} motion={motions[s]} />
            <Html position={[0, 1.6, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
              <div className="tag" ref={(el) => (tags.current[s] = el)} style={{ ["--c" as any]: SEAT_COLORS[s] }}>
                <span>
                  {room.place[s] === 1 ? "👑 " : ""}
                  {room.names[s] || `#${s}`}
                  {s === me ? " (YOU)" : ""}
                </span>
              </div>
            </Html>
          </group>
          <primitive object={lines[s]} />
          <mesh ref={(el) => (tracers.current[s] = el)} visible={false}>
            <boxGeometry args={[1, 0.035, 0.035]} />
            <meshBasicMaterial color="#ffe6a8" transparent opacity={0.6} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
          <mesh ref={(el) => (flashes.current[s] = el)} visible={false}>
            <sphereGeometry args={[0.18, 10, 8]} />
            <meshBasicMaterial color="#ffc46b" transparent opacity={0.9} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
          <mesh ref={(el) => (hits.current[s] = el)} visible={false}>
            <sphereGeometry args={[0.32, 10, 8]} />
            <meshBasicMaterial color="#ff2e4d" transparent opacity={0.45} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Lights({ rec, me, ctl }: { rec: Recording; me: number | null; ctl: React.MutableRefObject<ReplayCtl> }) {
  const amb = useRef<THREE.AmbientLight>(null);
  const dir = useRef<THREE.DirectionalLight>(null);
  const spot = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const { scene } = useThree();
  useEffect(() => {
    scene.add(target);
    if (spot.current) spot.current.target = target;
    return () => {
      scene.remove(target);
    };
  }, [scene, target]);
  useFrame((_, dt) => {
    const c = ctl.current;
    c.lights += (c.lightsTarget - c.lights) * Math.min(1, dt * 3.5);
    if (amb.current) amb.current.intensity = 0.03 + c.lights * 0.55;
    if (dir.current) dir.current.intensity = c.lights * 1.6;
    if (spot.current && me !== null) {
      const f = frameAt(rec, c.t, me);
      spot.current.position.set(f.x / 256, 1.75, f.y / 256);
      const a = angleToRad(f.aim);
      target.position.set(f.x / 256 + Math.cos(a) * 6, 0.2, f.y / 256 + Math.sin(a) * 6);
      spot.current.intensity = f.alive ? 55 * (1 - c.lights * 0.6) : 0;
    }
  });
  return (
    <>
      <ambientLight ref={amb} intensity={0.03} color="#b8c6ff" />
      <directionalLight ref={dir} position={[10, 30, 18]} intensity={0} color="#e8eeff" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={20} shadow-camera-bottom={-20} />
      <spotLight ref={spot} angle={CONE_RAD} penumbra={0.35} distance={11} decay={1.1} color="#fff1d0" castShadow shadow-mapSize={[1024, 1024]} />
    </>
  );
}

function ZoneRing({ world, ctl, rec }: { world: World | null; ctl: React.MutableRefObject<ReplayCtl>; rec: Recording }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const z = zoneAt(world, ctl.current.t * rec.every);
    if (!ref.current || !z) return;
    ref.current.position.set(z.x / 256, 0.05, z.y / 256);
    ref.current.scale.set(z.r / 256, z.r / 256, 1);
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2}>
      <ringGeometry args={[0.97, 1, 128]} />
      <meshBasicMaterial color="#a64dff" transparent opacity={0.7} toneMapped={false} />
    </mesh>
  );
}

function Driver({ rec, me, ctl, onTime }: { rec: Recording; me: number | null; ctl: React.MutableRefObject<ReplayCtl>; onTime: (t: number) => void }) {
  const { camera } = useThree();
  const last = useRef(0);
  useFrame((_, dt) => {
    const c = ctl.current;
    if (c.playing) {
      c.t += dt * (20 / rec.every) * c.speed; // recorder frames per second of match time
      if (c.t >= rec.frames - 1) {
        c.t = rec.frames - 1;
        c.playing = false;
      }
    }
    if (c.follow && me !== null) {
      const f = frameAt(rec, c.t, me);
      const target = new THREE.Vector3(f.x / 256, 0, f.y / 256);
      const h = 12 + c.lights * 10;
      camera.position.lerp(new THREE.Vector3(target.x, h, target.z + 7 + c.lights * 6), Math.min(1, dt * 3));
      camera.lookAt(target);
    }
    if (performance.now() - last.current > 100) {
      last.current = performance.now();
      onTime(c.t);
    }
  });
  return null;
}

export function ReplayScene({
  rec,
  room,
  world,
  me,
  ctl,
  onTime,
  follow,
}: {
  rec: Recording;
  room: Room;
  world: World | null;
  me: number | null;
  ctl: React.MutableRefObject<ReplayCtl>;
  onTime: (t: number) => void;
  follow: boolean;
}) {
  return (
    <Canvas
      shadows={!TOUCH}
      dpr={TOUCH ? 1 : [1, 1.75]}
      camera={{ fov: 46, position: [MAP_W / 2, 48, MAP_W / 2 + 26], near: 0.1, far: 200 }}
      gl={{ antialias: !TOUCH, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.1;
      }}
    >
      <color attach="background" args={["#030305"]} />
      <Lights rec={rec} me={me} ctl={ctl} />
      <Arena lit />
      <Players rec={rec} room={room} me={me} ctl={ctl} />
      <ZoneRing world={world} ctl={ctl} rec={rec} />
      <Driver rec={rec} me={me} ctl={ctl} onTime={onTime} />
      <OrbitControls target={[MAP_W / 2, 0, MAP_W / 2]} enabled={!follow} maxPolarAngle={1.35} />
      {!TOUCH && (
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.9} luminanceThreshold={0.3} mipmapBlur />
          <Vignette offset={0.2} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
