import { memo, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, Noise, ChromaticAberration } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";
import { Arena } from "./Arena";
import { Avatar, SEAT_COLORS, aimToRotY } from "./Avatar";
import type { Session } from "../game/session";
import { ST_COUNTDOWN, ST_LIVE, ST_ENDED } from "../chain/layout";
import { controls, wheelZoom } from "../game/controls";
import { radToAngle, angleToRad } from "../game/sim";
import { audio } from "../game/audio";

const CONE_RAD = (7000 / 65536) * Math.PI * 2; // half-angle used on chain
const VISION_TILES = 10;
const LOOT_COLORS = ["#fff", "#06d6a0", "#4cc9f0", "#ff8c42", "#ef476f", "#f15bb5"];
const LOOT_LABEL = ["", "MEDKIT", "ARMOR", "SMG", "SHOTGUN", "FLARE"];
const COOLDOWN_MS = [350, 100, 800];

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
    g.position.set(pos.x / 256, 0, pos.y / 256);
    const aim = session.input.aim;
    if (aimGroup.current) aimGroup.current.rotation.y = aimToRotY(aim);
    const a = angleToRad(aim);
    target.position.set(pos.x / 256 + Math.cos(a) * 6, 0.2, pos.y / 256 + Math.sin(a) * 6);
    const flare = v.me.flare > 0;
    if (spot.current) {
      spot.current.intensity = alive ? (flare ? 0 : 55) : 0;
    }
    beam.uniforms.uStrength.value = alive && !flare ? 0.07 : 0;
    // local muzzle flash on fire (server is authoritative for the bullet)
    const now = performance.now();
    const firing = (session.input.buttons & 1) === 1 && alive && v.me.reload === 0 && v.me.mag > 0 && session.room?.status === ST_LIVE;
    if (firing && now - lastShot.current > (COOLDOWN_MS[v.me.weapon] ?? 350)) {
      lastShot.current = now;
      audio.shoot(v.me.weapon);
      if (flash.current) flash.current.intensity = 14;
    }
    if (flash.current) flash.current.intensity *= 0.72;
  });

  return (
    <group ref={group}>
      <group ref={aimGroup}>
        <Avatar color={SEAT_COLORS[session.mySeat ?? 0]} me weapon={session.view?.me.weapon ?? 0} />
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
  const ghosts = useRef<(THREE.Mesh | null)[]>([]);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  const hpBars = useRef<(HTMLElement | null)[]>([]);
  const room = session.room;
  useFrame(() => {
    const now = performance.now();
    for (let s = 0; s < 8; s++) {
      const g = refs.current[s];
      const gh = ghosts.current[s];
      if (!g || !gh) continue;
      const tr = session.tracks.get(s);
      if (!tr || s === session.mySeat || !session.view?.me.alive) {
        g.visible = false;
        gh.visible = false;
        const lab = labels.current[s];
        if (lab) lab.style.display = "none";
        continue;
      }
      const smp = session.sampleTrack(tr, now);
      if (!smp) {
        g.visible = false;
        gh.visible = false;
        continue;
      }
      if (tr.visible) {
        g.visible = true;
        gh.visible = false;
        g.position.set(smp.x / 256, 0, smp.y / 256);
        g.rotation.y = aimToRotY(smp.aim);
        const hp = hpBars.current[s];
        if (hp) hp.style.width = `${Math.max(0, smp.hp)}%`;
      } else {
        g.visible = false;
        const age = (now - tr.lastSeen) / 2000;
        gh.visible = age < 1;
        if (age < 1) {
          const last = tr.samples[tr.samples.length - 1];
          gh.position.set(last.x / 256, 0.03, last.y / 256);
          (gh.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - age);
        }
      }
      const lab = labels.current[s];
      if (lab) lab.style.display = tr.visible ? "flex" : "none";
    }
  });
  return (
    <>
      {Array.from({ length: 8 }, (_, s) => (
        <group key={s}>
          <group ref={(el) => (refs.current[s] = el)} visible={false}>
            <Avatar color={SEAT_COLORS[s]} />
            <Html position={[0, 1.6, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
              <div className="tag" ref={(el) => (labels.current[s] = el)} style={{ ["--c" as any]: SEAT_COLORS[s] }}>
                <span>{room?.names[s] || `#${s}`}</span>
                <i>
                  <b ref={(el) => (hpBars.current[s] = el)} />
                </i>
              </div>
            </Html>
          </group>
          <mesh ref={(el) => (ghosts.current[s] = el)} rotation-x={-Math.PI / 2} visible={false}>
            <ringGeometry args={[0.3, 0.42, 24]} />
            <meshBasicMaterial color={SEAT_COLORS[s]} transparent opacity={0.4} toneMapped={false} />
          </mesh>
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

function LootCrates({ session }: { session: Session }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  useFrame(({ clock }) => {
    const loot = session.view?.loot ?? [];
    for (let i = 0; i < 12; i++) {
      const g = refs.current[i];
      if (!g) continue;
      const l = loot.find((x) => x.id === i);
      g.visible = !!l;
      const lab0 = labels.current[i];
      if (lab0) lab0.style.display = l ? "block" : "none";
      if (!l) continue;
      g.position.set(l.x / 256, 0.45 + Math.sin(clock.elapsedTime * 2 + i) * 0.08, l.y / 256);
      g.rotation.y = clock.elapsedTime * 1.4 + i;
      const mat = (g.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.color.set(LOOT_COLORS[l.kind]);
      mat.emissive.set(LOOT_COLORS[l.kind]);
      const lab = labels.current[i];
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
          <mesh>
            <octahedronGeometry args={[0.3, 0]} />
            <meshStandardMaterial emissiveIntensity={2.6} toneMapped={false} />
          </mesh>
          <pointLight intensity={1.6} distance={2.2} decay={1.6} color="#fff6d8" />
          <Html position={[0, 0.55, 0]} center style={{ pointerEvents: "none" }}>
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
      void main(){ float lines = 0.5 + 0.5*sin(vUv.y*60.0 - uTime*4.0); float fade = pow(1.0 - vUv.y, 2.0);
      gl_FragColor = vec4(uColor, (0.10 + 0.25*lines) * fade); }`,
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
    wall.current.position.set(r.zone.x / 256, 1.25, r.zone.y / 256);
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
        <cylinderGeometry args={[1, 1, 2.5, 96, 1, true]} />
      </mesh>
      <mesh ref={next} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.992, 1, 160]} />
        <meshBasicMaterial color="#cfd8ff" transparent opacity={0.32} />
      </mesh>
    </>
  );
}

const PING_COLORS = ["#fff", "#9fb4ff", "#ff5d5d", "#ffd166", "#c9c9c9"];

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
    const shots = session.fx.filter((f) => f.kind === "shot" && now - f.at < 120).slice(-6);
    for (let i = 0; i < 6; i++) {
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
      {Array.from({ length: 6 }, (_, i) => (
        <pointLight key={i} ref={(el) => (flashes.current[i] = el)} color="#ffb347" intensity={0} distance={4} decay={1.5} />
      ))}
    </>
  );
}

function CameraRig({ session }: { session: Session }) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(16, 0, 16));
  const pos = useRef(new THREE.Vector3(16, 30, 30));
  useFrame((_, dt) => {
    const p = session.myPos();
    const r = session.room;
    const playing = p && r && (r.status === ST_LIVE || r.status === ST_COUNTDOWN) && session.view?.me.alive;
    let wantLook: THREE.Vector3;
    let wantPos: THREE.Vector3;
    if (playing && controls.view === "chase" && !controls.touchMove && controls.touchAim === null) {
      // over-the-shoulder: behind you along your aim, looking ahead into the beam
      const a = angleToRad(session.input.aim);
      const px = p!.x / 256;
      const pz = p!.y / 256;
      const d = controls.chaseDist;
      wantLook = new THREE.Vector3(px + Math.cos(a) * 3.2, 0.6, pz + Math.sin(a) * 3.2);
      wantPos = new THREE.Vector3(px - Math.cos(a) * d, controls.chaseHeight, pz - Math.sin(a) * d);
      const k = 1 - Math.pow(0.000002, dt);
      pos.current.lerp(wantPos, k);
      look.current.lerp(wantLook, k);
    } else {
      const tx = p && playing ? p.x / 256 : p ? p.x / 256 : 16;
      const tz = p && playing ? p.y / 256 : p ? p.y / 256 : 16;
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
  });
  return null;
}

/** Mouse/keyboard → session input. Touch joysticks write into `controls` directly. */
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
      if (controls.view === "chase" && document.pointerLockElement === el) {
        controls.chaseAim = (controls.chaseAim + Math.round(e.movementX * controls.sens) + 65536) % 65536;
        return;
      }
      const r = el.getBoundingClientRect();
      mouse.current.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      controls.mouseActive = true;
    };
    const down = (e: PointerEvent) => {
      audio.unlock();
      if (e.pointerType === "touch") return;
      if (controls.view === "chase" && document.pointerLockElement !== el) {
        controls.chaseAim = session.input.aim;
        el.requestPointerLock?.();
        return; // the locking click doesn't fire
      }
      if (e.button === 0) {
        controls.fire = true;
        controls.fireUntil = performance.now() + 160;
      }
    };
    const up = (e: PointerEvent) => {
      if (e.button === 0) controls.fire = false;
    };
    const lockChange = () => (controls.locked = document.pointerLockElement === el);
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
      el.removeEventListener("wheel", wheel);
    };
  }, [gl, session]);
  useFrame(() => {
    const p = session.myPos();
    let aim = session.input.aim;
    if (controls.touchAim !== null) aim = controls.touchAim;
    else if (controls.view === "chase" && controls.locked) aim = controls.chaseAim;
    else if (p && controls.mouseActive && controls.view === "top") {
      ray.setFromCamera(mouse.current, camera);
      if (ray.ray.intersectPlane(plane, hit)) aim = radToAngle(Math.atan2(hit.z - p.y / 256, hit.x - p.x / 256));
    }
    const k = controls.keys;
    // aim-relative: W walks toward the mouse, S backs off, A/D strafe around it
    const fwd = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
    const side = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
    const ar = angleToRad(aim);
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
    const buttons = (controls.fire || controls.touchFire || now < controls.fireUntil ? 1 : 0) | (controls.reload || now < controls.reloadUntil ? 2 : 0);
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
    const k = hit ? Math.max(0, 1 - (now - hit.at) / 350) : 0;
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

export const GameScene = memo(function GameScene({ session }: { session: Session }) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
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
      <Bullets session={session} />
      <LootCrates session={session} />
      <Zone session={session} />
      <Fx session={session} />
      <CameraRig session={session} />
      <InputController session={session} />
      <FpsMeter />
      <Post session={session} />
    </Canvas>
  );
});
