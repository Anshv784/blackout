// What makes a legend skin a legend: it doesn't stay on the gun. Each one sheds something into
// the air around it: butterflies lift off the Monarch, embers rise from the Dragon, petals fall
// from Sakura, bubbles from the Koi, sparks arc off the Storm. One small GPU particle system per
// gun (all the motion is in the shader, nothing is updated on the CPU), drawn in the gun's own
// space so it follows the gun as it moves.
import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SKIN_TIME } from "./skins";

export const isLegend = (skin: number) => skin >= 16 && skin <= 27;

const VERT = /* glsl */ `
attribute vec4 seed;      // x along the gun, y height, phase, random
uniform float uT;
uniform float uScale;     // pixels per unit at distance 1
varying float vLife;
varying float vRnd;
varying float vSpin;
float h(float n){ return fract(sin(n) * 43758.5453); }
void main(){
  float rate = KIND == 22 ? 0.75 : KIND == 21 ? 1.6 : KIND == 26 ? 0.18 : KIND == 24 ? 0.12 : 0.35;
  float life = fract(uT * rate * (0.7 + 0.6 * seed.w) + seed.z);
  vLife = life; vRnd = seed.w;
  vec3 p = vec3(seed.x, seed.y, (h(seed.w * 91.0) - 0.5) * 0.08);
  float sz = 0.03;
  vSpin = uT * (1.0 + seed.w * 2.0) + seed.w * 30.0;
#if KIND == 16
  // butterflies: lift off and flutter up and away, drifting forward
  p += vec3(life * 0.25, life * 0.32 + sin(life * 12.0 + seed.w * 9.0) * 0.03, (seed.w - 0.5) * life * 0.4);
  sz = 0.055;
#elif KIND == 17 || KIND == 19
  // embers: rise, wobble, burn out
  p += vec3(sin(life * 9.0 + seed.w * 20.0) * 0.02, life * 0.35, cos(life * 7.0 + seed.w * 11.0) * 0.02);
  sz = KIND == 19 ? 0.04 : 0.024;
#elif KIND == 18 || KIND == 25
  // bubbles: rise, swaying
  p += vec3(sin(life * 6.0 + seed.w * 10.0) * 0.015, life * 0.28, 0.0);
  sz = 0.018 + seed.w * 0.02;
#elif KIND == 20
  // petals: fall from above the gun and drift back
  p += vec3(-life * 0.2 + sin(life * 6.0 + seed.w * 7.0) * 0.04, 0.22 - life * 0.42, (seed.w - 0.5) * 0.25 * life);
  sz = 0.045;
#elif KIND == 21
  // sparks: jump off the gun, short and sharp
  p += vec3((seed.w - 0.5) * 0.12 * life, (h(seed.w * 13.0) - 0.3) * 0.18 * life, (h(seed.w * 7.0) - 0.5) * 0.12 * life);
  sz = 0.03;
#elif KIND == 22
  // pulses: a ring of red sparks thrown off on each beat
  p += vec3(0.0, (seed.w - 0.5) * 0.12 * life, (h(seed.w * 5.0) - 0.5) * 0.12 * life);
  sz = 0.02;
#elif KIND == 23
  // moon dust: slow pale motes
  p += vec3(sin(life * 3.0 + seed.w * 9.0) * 0.03, life * 0.2, cos(life * 2.0 + seed.w * 4.0) * 0.03);
  sz = 0.016;
#elif KIND == 24
  // stars orbiting the gun
  float a = seed.z * 6.2831 + uT * 0.25 * (0.6 + seed.w);
  p = vec3(seed.x, 0.02 + sin(a) * 0.1, cos(a) * 0.1);
  sz = 0.02 + 0.02 * seed.w;
#elif KIND == 26
  // wisps: a few soft blue flames circling slowly
  float a = seed.z * 6.2831 + uT * 0.6 * (0.5 + seed.w);
  p = vec3(0.25 + fract(seed.z + uT * 0.04) * 0.8, 0.03 + sin(a * 1.3) * 0.07, cos(a) * 0.09);
  sz = 0.07;
#elif KIND == 27
  // gold sparks flicked off the gears on each tick
  p += vec3((seed.w - 0.5) * 0.1 * life, 0.05 + life * 0.12 - life * life * 0.2, (h(seed.w * 3.0) - 0.5) * 0.1 * life);
  sz = 0.022;
#endif
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float scale = length(modelMatrix[0].xyz);
  gl_PointSize = sz * scale * uScale / max(0.05, -mv.z);
}
`;

const FRAG = /* glsl */ `
uniform float uT;
uniform float uGlow;
varying float vLife;
varying float vRnd;
varying float vSpin;
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0; q.y = -q.y;
  float fade = smoothstep(0.0, 0.12, vLife) * (1.0 - smoothstep(0.7, 1.0, vLife));
  vec3 col = vec3(1.0); float a = 0.0;
#if KIND == 16
  // a butterfly, wings beating
  float flap = 0.25 + 0.75 * abs(sin(uT * 14.0 + vRnd * 30.0));
  vec2 b = vec2(abs(q.x) / flap, q.y);
  float up = length((b - vec2(0.42, 0.18)) / vec2(0.42, 0.36));
  float lo = length((b - vec2(0.28, -0.25)) / vec2(0.26, 0.24));
  float wing = min(up, lo);
  float body = length(q / vec2(0.06, 0.45));
  a = (1.0 - smoothstep(0.85, 1.0, wing)) + (1.0 - step(1.0, body));
  float rim = smoothstep(0.6, 0.85, wing);
  col = mix(vec3(1.0, 0.45, 0.05), vec3(0.05), max(rim, step(body, 1.0)));
  col += vec3(1.0, 0.5, 0.1) * 0.4 * (1.0 - rim);
#elif KIND == 17 || KIND == 19 || KIND == 27
  float d = length(q);
  a = exp(-d * d * 6.0);
  vec3 hot = KIND == 27 ? vec3(1.0, 0.75, 0.35) : KIND == 19 ? vec3(1.0, 0.62, 0.18) : vec3(1.0, 0.35, 0.06);
  col = mix(hot, vec3(1.0, 0.95, 0.7), exp(-d * d * 30.0)) * 2.0;
  a *= 0.6 + 0.4 * sin(uT * 20.0 + vRnd * 50.0);
#elif KIND == 18 || KIND == 25
  float d = length(q);
  a = smoothstep(1.0, 0.8, d) * (0.25 + 0.75 * smoothstep(0.55, 0.85, d));
  a += 0.8 * exp(-length(q - vec2(-0.35, 0.35)) * 10.0);
  col = KIND == 18 ? vec3(0.75, 0.95, 1.0) : mix(vec3(0.3, 0.95, 1.0), vec3(0.95, 0.4, 1.0), vRnd) * 1.6;
#elif KIND == 20
  vec2 r = rot(vSpin) * q;
  r.x /= max(0.3, abs(cos(vSpin * 0.7)));
  float pe = length(r / vec2(0.55, 0.85));
  float notch = length((r - vec2(0.0, 0.85)) / vec2(0.2, 0.25));
  a = (1.0 - smoothstep(0.9, 1.0, pe)) * step(1.0, notch);
  col = mix(vec3(1.0, 0.85, 0.9), vec3(0.95, 0.45, 0.62), pe);
#elif KIND == 21
  // a forked spark
  vec2 r = rot(vRnd * 6.28) * q;
  float zig = abs(r.y - 0.25 * sin(r.x * 9.0 + vRnd * 20.0));
  a = (1.0 - smoothstep(0.03, 0.12, zig)) * (1.0 - smoothstep(0.7, 1.0, abs(r.x)));
  col = vec3(0.75, 0.85, 1.0) * 3.0;
  a *= step(0.4, fract(uT * 9.0 + vRnd * 7.0));
#elif KIND == 22
  float d = length(q);
  a = exp(-d * d * 8.0);
  col = vec3(1.0, 0.15, 0.12) * 2.2;
#elif KIND == 23
  float d = length(q);
  a = exp(-d * d * 7.0) * 0.8;
  col = vec3(0.95, 0.9, 0.75) * 1.4;
#elif KIND == 24
  // a four-point star, twinkling
  float d = min(abs(q.x) * 6.0 + abs(q.y), abs(q.y) * 6.0 + abs(q.x));
  a = (1.0 - smoothstep(0.0, 0.9, d)) + exp(-dot(q, q) * 20.0);
  col = vec3(0.85, 0.9, 1.0) * 2.0;
  a *= 0.5 + 0.5 * sin(uT * 3.0 + vRnd * 40.0);
  fade = 1.0;
#elif KIND == 26
  // a blue flame: a teardrop pulled upward, flickering
  vec2 f = vec2(q.x * (1.0 + max(q.y, 0.0) * 1.6), q.y + 0.2);
  float drop = length(vec2(f.x / 0.42, f.y / (f.y > 0.0 ? 1.0 : 0.42)));
  float fl = 0.85 + 0.15 * sin(uT * 18.0 + vRnd * 9.0 + q.y * 6.0);
  a = (1.0 - smoothstep(0.4, 1.0 * fl, drop));
  col = mix(vec3(0.15, 0.45, 1.0), vec3(0.6, 0.85, 1.0), smoothstep(0.3, 0.0, drop)) * 1.2;
  fade = 1.0;
#endif
  a *= fade;
  if (a < 0.02) discard;
  gl_FragColor = vec4(col * uGlow, a);
}
`;

const mats = new Map<string, THREE.ShaderMaterial>();
const uScale = { value: 900 };

export function LegendFx({ skin, display }: { skin: number; display: boolean }) {
  const n = display ? 46 : 22;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      seed[i * 4] = 0.15 + Math.random() * 0.85; // along the gun (part space: the barrel runs +x)
      seed[i * 4 + 1] = -0.04 + Math.random() * 0.1;
      seed[i * 4 + 2] = Math.random();
      seed[i * 4 + 3] = Math.random();
    }
    g.setAttribute("seed", new THREE.BufferAttribute(seed, 4));
    // positions are computed in the shader; a placeholder keeps three.js happy
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.6, 0, 0), 2);
    return g;
  }, [n]);
  const key = `${skin}:${display}`;
  let mat = mats.get(key);
  if (!mat) {
    mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: { KIND: skin },
      uniforms: { uT: SKIN_TIME, uScale, uGlow: { value: display ? 1 : 0.7 } },
      transparent: true,
      depthWrite: false,
      blending: skin === 16 || skin === 20 ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    mats.set(key, mat);
  }
  useFrame(({ size, camera, gl }) => {
    // pixels per unit at distance 1, for this canvas
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 45;
    uScale.value = (size.height * gl.getPixelRatio()) / (2 * Math.tan((fov * Math.PI) / 360));
  });
  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={5} />;
}
