// Gun skins, drawn live by a shader on top of the gun's own material.
//
// Every skin is procedural and works in "gun space" (metres, +x down the barrel), baked into each
// mesh as a `skinPos` / `skinNrm` attribute. So a pattern is the same size on every gun, doesn't
// depend on how a model was UV-unwrapped, and doesn't swim as the gun moves. The model's own
// normal and roughness maps stay, so the bolts and seams still read through the paint.
// The same GLSL draws the swatches on the Operator page (ui/SkinSwatch).
import * as THREE from "three";

/** one clock for every animated skin (seconds, wrapped so floats stay precise) */
export const SKIN_TIME = { value: 0 };
export const tickSkins = () => {
  SKIN_TIME.value = (performance.now() / 1000) % 3600;
};

export const SKIN_GLSL = /* glsl */ `
float sk_h(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sk_n(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sk_h(i), sk_h(i + vec3(1,0,0)), f.x), mix(sk_h(i + vec3(0,1,0)), sk_h(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(sk_h(i + vec3(0,0,1)), sk_h(i + vec3(1,0,1)), f.x), mix(sk_h(i + vec3(0,1,1)), sk_h(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float sk_fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * sk_n(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s / 0.9375; }
// cells: x = distance to the nearest centre, y = gap to the second nearest (0 on a cell wall).
// The centres wander with t when amp > 0.
vec2 sk_vor(vec3 p, float t, float amp){
  vec3 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(sk_h(i + g), sk_h(i + g + 19.1), sk_h(i + g + 47.3));
    o = 0.5 + (o - 0.5) * (1.0 - amp) + amp * 0.45 * sin(t + 6.2831 * o);
    vec3 r = g + o - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(sqrt(d1), sqrt(d2) - sqrt(d1));
}
// a flat pattern laid on the face the surface mostly faces (sides of the gun: x along, y up)
vec2 sk_plane(vec3 p, vec3 n){ vec3 a = abs(n); return (a.x > a.y && a.x > a.z) ? p.zy : (a.y > a.z ? p.xz : p.xy); }

void skinShade(vec3 p, vec3 n, float ndv, float t, out vec3 col, inout vec3 emi, inout float rough, inout float metal){
  col = vec3(0.5);
#if SKIN_ID == 1
  // Woodland: khaki, olive, brown, black blotches
  float a = sk_fbm(p * 9.0), b = sk_fbm(p * 11.0 + 5.3), c = sk_fbm(p * 15.0 + 11.1);
  col = vec3(0.6, 0.56, 0.4);
  col = mix(col, vec3(0.3, 0.37, 0.17), smoothstep(0.49, 0.51, a));
  col = mix(col, vec3(0.36, 0.24, 0.14), smoothstep(0.55, 0.57, b));
  col = mix(col, vec3(0.1, 0.1, 0.09), smoothstep(0.6, 0.62, c));
  rough = 0.72; metal = 0.05;
#elif SKIN_ID == 2
  // Digital: square pixels, four urban greys
  vec3 q = floor(p * 55.0);
  float v = sk_fbm(q * 0.11) + 0.18 * (sk_h(q) - 0.5);
  col = v < 0.44 ? vec3(0.14, 0.16, 0.19) : v < 0.53 ? vec3(0.33, 0.37, 0.43) : v < 0.62 ? vec3(0.52, 0.57, 0.63) : vec3(0.74, 0.78, 0.83);
  rough = 0.62; metal = 0.12;
#elif SKIN_ID == 3
  // Tiger: burnt orange with black slashes
  float w = p.x * 58.0 + p.y * 12.0 + sk_fbm(p * 7.0) * 10.0;
  float s = sin(w) * (0.6 + 0.8 * sk_n(p * 9.0 + 3.0));
  col = mix(vec3(0.9, 0.48, 0.12), vec3(0.08, 0.06, 0.05), smoothstep(0.22, 0.3, s));
  col *= 0.85 + 0.3 * sk_n(p * 60.0);
  rough = 0.5; metal = 0.15;
#elif SKIN_ID == 4
  // Carbon: 2x2 twill weave under a glossy clear coat
  vec2 uv = sk_plane(p, n) * 70.0;
  vec2 c = floor(uv), f = fract(uv);
  bool across = mod(c.x + floor(c.y * 0.5) * 2.0 + c.y, 4.0) < 2.0;
  float bulge = across ? sin(f.y * 3.14159) : sin(f.x * 3.14159);
  float fibre = 0.75 + 0.25 * sin((across ? f.x : f.y) * 60.0);
  col = vec3(0.1, 0.105, 0.12) + vec3(0.26, 0.27, 0.3) * bulge * fibre;
  rough = 0.18; metal = 0.35;
#elif SKIN_ID == 5
  // Hex Grid: dark plates, bright seams, a pulse rolling down the gun
  vec2 uv = sk_plane(p, n) * 32.0;
  const vec2 S = vec2(1.0, 1.7320508);
  vec4 hc = floor(vec4(uv, uv - vec2(0.5, 1.0)) / S.xyxy) + 0.5;
  vec4 h = vec4(uv - hc.xy * S, uv - (hc.zw + 0.5) * S);
  vec4 cell = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hc.xy) : vec4(h.zw, hc.zw + 0.5);
  vec2 hp = abs(cell.xy);
  float edge = 0.5 - max(dot(hp, S * 0.5), hp.x);
  float line = 1.0 - smoothstep(0.02, 0.07, edge);
  float shade = sk_h(vec3(cell.zw, 1.0));
  col = mix(vec3(0.16, 0.18, 0.22) + 0.06 * shade, vec3(0.5, 0.58, 0.68), line);
  float wave = pow(0.5 + 0.5 * sin(p.x * 9.0 - t * 2.6), 10.0);
  float lit = step(0.82, sk_h(vec3(cell.zw, floor(t * 1.5))));
  emi = vec3(0.15, 0.7, 1.0) * (line * (0.12 + 1.4 * wave) + (1.0 - line) * lit * 0.18 * (0.5 + 0.5 * sin(t * 4.0 + shade * 9.0)));
  rough = mix(0.4, 0.25, line); metal = 0.35;
#elif SKIN_ID == 6
  // Ember: charred crust over cracks that are still burning; heat rolls through them
  vec2 v = sk_vor(p * 20.0, 0.0, 0.0);
  float crack = 1.0 - smoothstep(0.0, 0.09, v.y);
  float heat = sk_fbm(p * 6.0 + vec3(t * 0.12, -t * 0.5, 0.0));
  float flick = 0.75 + 0.25 * sin(t * 7.0 + heat * 12.0);
  col = vec3(0.05, 0.04, 0.035) * (0.7 + 0.6 * sk_n(p * 45.0));
  col = mix(col, vec3(0.5, 0.12, 0.02), crack * 0.6);
  vec3 hot = mix(vec3(1.0, 0.22, 0.02), vec3(1.0, 0.72, 0.25), smoothstep(0.5, 0.8, heat));
  emi = hot * crack * (0.35 + 1.6 * smoothstep(0.35, 0.75, heat)) * flick;
  emi += vec3(0.7, 0.13, 0.0) * 0.12 * smoothstep(0.6, 0.85, heat);
  rough = 0.85; metal = 0.0;
#elif SKIN_ID == 7
  // Damascus: folded-steel bands; a strip of light sweeps down the barrel
  float l = p.x * 40.0 + sk_fbm(p * vec3(4.0, 22.0, 22.0)) * 10.0;
  float bands = 0.5 + 0.5 * sin(l * 6.0 + sk_fbm(p * 34.0) * 6.0);
  float b = smoothstep(0.2, 0.8, bands);
  col = mix(vec3(0.26, 0.27, 0.3), vec3(0.6, 0.62, 0.66), b);
  float d = p.x - (fract(t * 0.25) * 2.4 - 0.6) - p.y * 0.8;
  emi = vec3(1.0, 0.9, 0.72) * exp(-d * d * 180.0) * (0.15 + 0.9 * b);
  rough = mix(0.5, 0.18, b); metal = 0.75;
#elif SKIN_ID == 8
  // Circuit: a board with gold traces; signals race along them, pads blink
  vec2 uv = sk_plane(p, n) * 40.0;
  vec2 c = floor(uv), f = fract(uv);
  float dir = sk_h(vec3(c, 7.0));
  bool horiz = dir < 0.5;
  float trace = horiz ? 1.0 - smoothstep(0.07, 0.12, abs(f.y - 0.5)) : 1.0 - smoothstep(0.07, 0.12, abs(f.x - 0.5));
  trace *= step(0.22, sk_h(vec3(c, 11.0)));
  float isPad = step(0.84, sk_h(vec3(c, 3.0)));
  float pad = isPad * (1.0 - smoothstep(0.18, 0.24, length(f - 0.5)));
  float m = max(trace, pad);
  col = mix(vec3(0.05, 0.24, 0.19), vec3(0.85, 0.68, 0.3), m);
  float along = horiz ? uv.x : uv.y;
  float lane = sk_h(vec3(horiz ? c.y : c.x, horiz ? 1.0 : 2.0, 5.0));
  float head = fract(along * 0.09 - t * (0.6 + lane * 0.8) + lane * 7.0);
  float pulse = smoothstep(0.85, 1.0, head) * (1.0 - smoothstep(0.995, 1.0, head));
  emi = vec3(0.1, 1.0, 0.75) * (trace * pulse * 2.4 + pad * (0.15 + 0.6 * step(0.6, fract(t * 0.7 + dir * 5.0))));
  rough = mix(0.6, 0.28, m); metal = mix(0.1, 0.7, m);
#elif SKIN_ID == 9
  // Molten: a cooling crust on lava that keeps moving
  vec3 q = p * 7.0;
  float f1 = sk_fbm(q + vec3(t * 0.12, -t * 0.22, 0.0));
  float f2 = sk_fbm(q * 1.8 + f1 * 2.6 - vec3(0.0, t * 0.35, t * 0.1));
  float heat = smoothstep(0.5, 0.72, f2);
  col = mix(vec3(0.06, 0.045, 0.04), vec3(0.3, 0.07, 0.015), heat);
  col *= 0.8 + 0.4 * sk_n(p * 50.0);
  emi = mix(vec3(0.95, 0.13, 0.0), vec3(1.0, 0.8, 0.3), smoothstep(0.68, 0.9, f2)) * heat * 1.9;
  rough = mix(0.88, 0.45, heat); metal = 0.0;
#elif SKIN_ID == 10
  // Aurora: night-blue lacquer with green and violet curtains drifting along it
  float b = p.x * 5.0 + sk_fbm(p * 4.0 + vec3(0.0, 0.0, t * 0.15)) * 3.0 - t * 0.3;
  float band = pow(0.5 + 0.5 * sin(b * 2.4), 2.5);
  vec3 ac = mix(vec3(0.1, 1.0, 0.55), vec3(0.6, 0.25, 1.0), 0.5 + 0.5 * sin(b * 1.3 + 1.0));
  ac = mix(ac, vec3(0.1, 0.55, 1.0), 0.3 + 0.3 * sin(b * 0.7 + t * 0.2));
  float glow = band * smoothstep(0.3, 0.75, sk_fbm(p * 9.0 - vec3(t * 0.25, 0.0, 0.0)));
  col = vec3(0.02, 0.03, 0.07) + ac * 0.3 * glow;
  emi = ac * glow * 1.15;
  rough = 0.4; metal = 0.15;
#elif SKIN_ID == 11
  // Void: black with a slow nebula and stars that twinkle
  float neb = sk_fbm(p * 5.0 + vec3(t * 0.05, 0.0, t * 0.03));
  float neb2 = sk_fbm(p * 9.0 - vec3(0.0, t * 0.04, 0.0) + neb * 2.0);
  vec3 nc = mix(vec3(0.35, 0.05, 0.6), vec3(0.05, 0.25, 0.75), neb2);
  float cloud = smoothstep(0.45, 0.85, neb2);
  col = vec3(0.008, 0.008, 0.016) + nc * 0.14 * cloud;
  vec3 sp = p * 150.0; vec3 sc = floor(sp); float sr = sk_h(sc);
  float star = step(0.975, sr) * (1.0 - smoothstep(0.0, 0.42, length(fract(sp) - 0.5)));
  float tw = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * (1.5 + sr * 5.0) + sr * 80.0), 3.0);
  emi = nc * 0.55 * cloud + vec3(1.0, 0.95, 0.88) * star * tw * 2.6;
  rough = 0.22; metal = 0.4;
#elif SKIN_ID == 12
  // Glitch: black, magenta and cyan blocks; rows tear sideways and blocks flicker
  float tq = floor(t * 9.0);
  vec2 uv = sk_plane(p, n);
  float row = floor(uv.y * 55.0);
  float tear = sk_h(vec3(row, tq, 2.0)) > 0.86 ? (sk_h(vec3(row, tq, 3.0)) - 0.5) * 0.25 : 0.0;
  vec3 cell = vec3(floor((uv.x + tear) * 26.0), floor(uv.y * 38.0), 0.0);
  float r = sk_h(cell + 0.37);
  float blink = step(0.94, sk_h(cell + vec3(tq * 1.31, 0.0, 9.0)));
  vec3 hue = r < 0.8 ? vec3(1.0, 0.08, 0.6) : vec3(0.08, 0.9, 1.0);
  float lit = step(0.62, r);
  float scan = 0.8 + 0.2 * sin(uv.y * 900.0 - t * 30.0);
  col = mix(vec3(0.03, 0.03, 0.04), hue * 0.35, lit);
  emi = (hue * lit * (0.3 + 1.2 * blink) + vec3(0.85) * blink * (1.0 - lit) * 0.5) * scan;
  rough = 0.4; metal = 0.3;
#elif SKIN_ID == 13
  // Frost: pale ice in crystal facets; a few points glint
  vec2 v = sk_vor(p * 26.0, 0.0, 0.0);
  float edges = 1.0 - smoothstep(0.0, 0.05, v.y);
  col = mix(vec3(0.5, 0.66, 0.8), vec3(0.12, 0.25, 0.4), smoothstep(0.1, 0.8, v.x));
  col *= 0.8 + 0.4 * sk_n(p * 70.0);
  col = mix(col, vec3(0.85, 0.93, 1.0), edges * 0.75);
  vec3 gp = p * 200.0; float gr = sk_h(floor(gp));
  float glint = step(0.965, gr) * (1.0 - smoothstep(0.0, 0.45, length(fract(gp) - 0.5))) * pow(max(0.0, sin(t * (1.2 + gr * 3.0) + gr * 50.0)), 14.0);
  emi = vec3(0.75, 0.92, 1.0) * (glint * 3.5 + edges * 0.06);
  rough = 0.2; metal = 0.1;
#elif SKIN_ID == 14
  // Prism: iridescent; the colour slides with the viewing angle and with time
  float h = fract(ndv * 1.4 + p.x * 0.9 + t * 0.07 + sk_fbm(p * 5.0) * 0.35);
  vec3 rainbow = 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67)));
  col = rainbow * 0.8 + 0.12;
  emi = rainbow * (0.12 + 0.25 * pow(1.0 - ndv, 2.0));
  rough = 0.14; metal = 0.7;
#elif SKIN_ID == 15
  // Toxic: dark sludge; green bubbles swell and wander
  vec2 v = sk_vor(p * 18.0, t * 0.9, 1.0);
  float centre = 1.0 - smoothstep(0.0, 0.55, v.x);
  float rim = 1.0 - smoothstep(0.0, 0.06, v.y);
  float bub = smoothstep(0.6, 1.0, centre);
  col = mix(vec3(0.025, 0.05, 0.02), vec3(0.16, 0.42, 0.05), centre * 0.6);
  emi = vec3(0.35, 1.0, 0.1) * (bub * (0.55 + 0.55 * sin(t * 2.4 + v.x * 12.0)) + rim * 0.22);
  rough = 0.45; metal = 0.1;
#endif
  // the palettes above are written as screen colours; light works in linear
  col = pow(max(col, vec3(0.0)), vec3(2.2));
}
`;

export const SKIN_COUNT = 16;

/**
 * Paint a skin onto a (cloned) standard material. `tint` is the gun finish, `glow` scales the
 * self-lit parts (lower in a match, where bloom picks them up and the night is dark).
 */
export function applySkin(mat: THREE.MeshStandardMaterial, skin: number, tint: THREE.Color | null, glow: number) {
  if (!skin) return mat;
  mat.defines = { ...(mat.defines ?? {}), SKIN_ID: skin };
  const tintV = tint ? new THREE.Color(1, 1, 1).lerp(tint, 0.6).multiplyScalar(1.05) : new THREE.Color(1, 1, 1);
  const uniforms = { uSkinT: SKIN_TIME, uSkinTint: { value: tintV }, uSkinGlow: { value: glow } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 skinPos;\nattribute vec3 skinNrm;\nvarying vec3 vSkP;\nvarying vec3 vSkN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSkP = skinPos;\nvSkN = skinNrm;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vSkP;\nvarying vec3 vSkN;\nuniform float uSkinT;\nuniform vec3 uSkinTint;\nuniform float uSkinGlow;\n" + SKIN_GLSL,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          // the model's own paint survives as light and shade under the pattern
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          float detail = mix(1.0, clamp(lum * 2.2, 0.35, 1.15), 0.5);
          vec3 sc; vec3 se = vec3(0.0); float sr = roughnessFactor; float sm = metalnessFactor;
          float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
          skinShade(vSkP, normalize(vSkN), ndv, uSkinT, sc, se, sr, sm);
          diffuseColor.rgb = sc * detail * uSkinTint;
          roughnessFactor = sr;
          metalnessFactor = sm;
          totalEmissiveRadiance += se * uSkinGlow;
        }`,
      );
  };
  mat.customProgramCacheKey = () => "gunskin" + skin;
  mat.needsUpdate = true;
  return mat;
}

/** Bake the gun-space position and normal of every vertex into the geometry (once per geometry). */
export function bakeSkinSpace(geo: THREE.BufferGeometry, toGun: THREE.Matrix4) {
  if (geo.getAttribute("skinPos")) return;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return;
  const nrm = geo.getAttribute("normal") as THREE.BufferAttribute | undefined;
  const nm = new THREE.Matrix3().getNormalMatrix(toGun);
  const P = new Float32Array(pos.count * 3);
  const N = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toGun);
    P[i * 3] = v.x;
    P[i * 3 + 1] = v.y;
    P[i * 3 + 2] = v.z;
    if (nrm) v.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
    else v.set(0, 0, 1);
    N[i * 3] = v.x;
    N[i * 3 + 1] = v.y;
    N[i * 3 + 2] = v.z;
  }
  geo.setAttribute("skinPos", new THREE.BufferAttribute(P, 3));
  geo.setAttribute("skinNrm", new THREE.BufferAttribute(N, 3));
}
