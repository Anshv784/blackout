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
float sk_h2(vec2 p){ return sk_h(vec3(p, 3.7)); }
// turn a height into a bent normal (screen-space derivatives, as three.js does for bump maps)
vec3 sk_bump(vec3 pos, vec3 nrm, float h, float scale){
  vec3 dpx = dFdx(pos), dpy = dFdy(pos);
  vec2 dh = vec2(dFdx(h), dFdy(h)) * scale;
  vec3 r1 = cross(dpy, nrm), r2 = cross(nrm, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * nrm - grad);
}
mat2 sk_rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
// one heartbeat over x in 0..1: P wave, the QRS spike, T wave
float sk_ecg(float x){
  return 0.012 * exp(-pow((x - 0.2) / 0.03, 2.0)) - 0.01 * exp(-pow((x - 0.36) / 0.008, 2.0)) + 0.07 * exp(-pow((x - 0.4) / 0.012, 2.0))
       - 0.022 * exp(-pow((x - 0.44) / 0.01, 2.0)) + 0.02 * exp(-pow((x - 0.62) / 0.05, 2.0));
}

void skinShade(vec3 p, vec3 n, float ndv, float t, out vec3 col, inout vec3 emi, inout float rough, inout float metal, inout float hgt){
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
#elif SKIN_ID == 16
  // Monarch: a migration of butterflies drifting toward the muzzle, wings beating
  vec2 uv = sk_plane(p, n);
  col = vec3(0.07, 0.05, 0.08) + 0.04 * sk_fbm(p * 30.0);
  rough = 0.45; metal = 0.15;
  vec2 g = uv * 6.5 + vec2(-t * 0.22, sin(t * 0.3) * 0.15);
  vec2 id = floor(g); vec2 f = fract(g) - 0.5;
  float hp = sk_h2(id);
  if (hp > 0.12) {
    vec2 c = vec2(sk_h2(id + 3.1), sk_h2(id + 7.7)) * 0.2 - 0.1;
    vec2 q = sk_rot(-0.5 + hp) * (f - c) / (0.95 + 0.35 * sk_h2(id + 1.3));
    float flap = 0.15 + 0.85 * abs(sin(t * 6.5 + hp * 40.0));
    q.x /= flap;
    vec2 a = vec2(abs(q.x), q.y);
    float up = length((a - vec2(0.17, 0.07)) / vec2(0.17, 0.14));
    float lo = length((a - vec2(0.11, -0.1)) / vec2(0.11, 0.1));
    float wing = min(up, lo);
    float body = length(q / vec2(0.022, 0.16));
    hgt = max(hgt, (1.0 - smoothstep(0.75, 1.0, wing)) * 0.8 + (1.0 - smoothstep(0.6, 1.0, body)));
    if (wing < 1.0) {
      float ang = atan(a.y + 0.03, a.x + 0.01);
      float vein = smoothstep(0.8, 0.97, abs(sin(ang * 5.0 + a.x * 14.0)));
      float rim = smoothstep(0.6, 0.76, wing);
      vec3 orange = mix(vec3(0.95, 0.38, 0.03), vec3(1.0, 0.66, 0.15), clamp(a.x * 4.0, 0.0, 1.0));
      col = mix(orange, vec3(0.03, 0.02, 0.02), max(vein * 0.9, rim));
      float dots = rim * (1.0 - smoothstep(0.015, 0.035, abs(wing - 0.93))) * step(0.55, fract(ang * 4.5 + 0.2));
      col = mix(col, vec3(0.95), dots);
      emi = pow(orange, vec3(2.2)) * 0.3 * (1.0 - rim) * (1.0 - vein) + vec3(1.0) * dots * 0.4;
      rough = 0.6; metal = 0.0;
    }
    if (body < 1.0) { col = vec3(0.03); emi = vec3(0.0); }
  }
#elif SKIN_ID == 17
  // Dragon: crimson scales edged in gold; a breath of fire rolls from the stock to the muzzle
  vec2 uv = sk_plane(p, n) * vec2(30.0, 24.0);
  float sd = 0.78, sid = 0.0;
  for (int k = 0; k < 2; k++) {
    float rr = floor(uv.y) + float(k);
    float sh = mod(rr, 2.0) * 0.5;
    for (int j = -1; j <= 1; j++) {
      vec2 c = vec2(floor(uv.x - sh) + float(j) + 0.5 + sh, rr);
      float d = length((uv - c) * vec2(1.0, 1.15));
      if (d < 0.78 && sd >= 0.78) { sd = d; sid = sk_h2(c); }
    }
  }
  float rim = smoothstep(0.6, 0.76, sd);
  hgt = 1.0 - (sd / 0.78) * (sd / 0.78);
  col = mix(vec3(0.55, 0.05, 0.04), vec3(0.1, 0.01, 0.015), smoothstep(0.05, 0.7, sd)) * (0.8 + 0.4 * sid);
  col = mix(col, vec3(0.9, 0.66, 0.25), rim);
  float bx = fract(t * 0.22) * 1.9 - 0.45;
  float heat = exp(-pow(p.x - bx, 2.0) * 28.0) * (0.6 + 0.4 * sk_n(p * 40.0 + t * 3.0));
  emi = vec3(1.0, 0.45, 0.08) * rim * (0.12 + 2.4 * heat) + vec3(1.0, 0.2, 0.02) * heat * 0.6 * (1.0 - smoothstep(0.0, 0.6, sd));
  emi += vec3(0.6, 0.05, 0.0) * 0.06 * (0.5 + 0.5 * sin(t * 1.3 + sid * 9.0));
  rough = mix(0.35, 0.25, rim); metal = mix(0.35, 0.8, rim);
#elif SKIN_ID == 18
  // Koi: carp swimming laps through a lit pond, opposite ways in neighbouring lanes
  vec2 uv = sk_plane(p, n);
  float w1 = sk_fbm(vec3(uv * 9.0, t * 0.25));
  float caus = pow(1.0 - abs(sk_fbm(vec3(uv * 14.0 + w1, t * 0.4)) * 2.0 - 1.0), 6.0);
  col = mix(vec3(0.03, 0.16, 0.2), vec3(0.06, 0.28, 0.32), w1);
  emi = vec3(0.3, 0.8, 0.9) * caus * 0.22;
  rough = 0.15; metal = 0.1;
  // lanes along the body of the gun, a fish every ~0.4 m, neighbouring lanes swimming opposite ways
  float lane = floor(uv.y / 0.07);
  float dir = mod(lane, 2.0) * 2.0 - 1.0;
  float ph = sk_h2(vec2(lane, 1.0));
  float xx = uv.x * dir - t * 0.06 + ph;
  float cid = floor(xx / 0.42);
  float ly = (lane + 0.5) * 0.07 + sin(t * 0.9 + ph * 6.0 + cid) * 0.008;
  vec2 q = vec2(xx - (cid + 0.5) * 0.42 + (sk_h2(vec2(cid, lane)) - 0.5) * 0.12, uv.y - ly);
  if (sk_h2(vec2(cid, lane + 5.0)) < 0.2) q.x += 9.0; // an empty stretch now and then
  q.y += sin(q.x * 60.0 - t * 8.0) * 0.006 * (1.0 - smoothstep(-0.08, 0.02, q.x));
  float body = length(q / vec2(0.065, 0.02));
  vec2 tq = q + vec2(0.075, 0.0);
  bool tail = tq.x < 0.0 && tq.x > -0.04 && abs(tq.y) < -tq.x * 0.75;
  float shadow = length((q - vec2(0.01, -0.012)) / vec2(0.07, 0.024));
  hgt = 0.15 * caus + max(0.0, 1.0 - body * body) + (tail ? 0.5 : 0.0);
  if (shadow < 1.0) col *= 0.55;
  if (body < 1.0 || tail) {
    float spot = sk_n(vec3(q * vec2(45.0, 65.0), ph * 10.0 + cid * 3.0));
    vec3 koi = mix(vec3(0.96, 0.93, 0.88), vec3(0.95, 0.28, 0.06), smoothstep(0.48, 0.55, spot));
    if (tail) koi = mix(koi, vec3(1.0), 0.4);
    float eye = length((vec2(q.x, abs(q.y)) - vec2(0.045, 0.008)) / 0.0045);
    col = eye < 1.0 ? vec3(0.02) : koi;
    emi = koi * 0.1;
    rough = 0.3; metal = 0.0;
  }
#elif SKIN_ID == 19
  // Phoenix: blazing plumage that burns down to ash and is reborn from the grip outward
  vec2 uv = sk_plane(p, n);
  float cyc = fract(t / 9.0);
  float ablaze = cyc < 0.62 ? 1.0 : cyc < 0.8 ? 1.0 - smoothstep(0.62, 0.8, cyc) : smoothstep(0.0, 0.06, (cyc - 0.8) * 9.0 - abs(p.x - 0.35));
  vec2 fu = uv * vec2(12.0, 38.0);
  float row = floor(fu.y);
  fu.x += row * 0.37;
  vec2 ff = fract(fu) - 0.5;
  float plume = length(ff * vec2(1.0, 1.8));
  float barb = 0.5 + 0.5 * sin(ff.x * 40.0 + abs(ff.y) * 70.0);
  vec3 fire = mix(vec3(0.85, 0.12, 0.02), vec3(1.0, 0.72, 0.2), 0.5 + 0.5 * sin(uv.x * 7.0 + ff.x * 1.5));
  vec3 ash = vec3(0.24, 0.23, 0.22) * (0.6 + 0.6 * sk_n(p * 80.0));
  float rachis = (1.0 - smoothstep(0.02, 0.05, abs(ff.y))) * step(-0.45, ff.x);
  hgt = (1.0 - smoothstep(0.0, 0.6, plume)) * (0.6 + 0.4 * ablaze) + rachis * 0.3 + barb * 0.08;
  vec3 feather = fire * (0.5 + 0.5 * barb) * (1.0 - 0.8 * smoothstep(0.3, 0.5, plume));
  feather = mix(feather, vec3(1.0, 0.85, 0.5), rachis * 0.6);
  col = mix(ash, feather, ablaze);
  float flame = sk_fbm(vec3(uv * vec2(10.0, 14.0) - vec2(0.0, t * 1.4), t * 0.3));
  emi = (fire * (0.2 + 0.45 * barb) + vec3(1.0, 0.6, 0.15) * smoothstep(0.55, 0.8, flame) * 1.2) * ablaze;
  float emb = step(0.982, sk_h(floor(vec3(uv * 120.0 - vec2(0.0, t * 3.0), 1.0)))) * (1.0 - ablaze);
  emi += vec3(1.0, 0.4, 0.05) * emb * 2.2;
  rough = mix(0.9, 0.45, ablaze); metal = 0.0;
#elif SKIN_ID == 20
  // Sakura: black lacquer, a gold branch, blossoms falling and tumbling past
  vec2 uv = sk_plane(p, n);
  col = vec3(0.1, 0.025, 0.05) + vec3(0.05, 0.0, 0.03) * sk_fbm(p * 12.0);
  float br = abs(uv.y - 0.01 - 0.05 * sin(uv.x * 6.0) - 0.02 * sk_fbm(vec3(uv * 20.0, 1.0)));
  float branch = 1.0 - smoothstep(0.005, 0.01, br);
  col = mix(col, vec3(0.8, 0.6, 0.22), branch);
  hgt = branch * 0.7;
  metal = mix(0.2, 0.8, branch); rough = 0.25;
  vec2 g = (uv + vec2(t * 0.025, t * 0.05)) * 9.0;
  vec2 id = floor(g); vec2 f = fract(g) - 0.5;
  float h = sk_h2(id);
  if (h > 0.3) {
    vec2 c = vec2(sk_h2(id + 2.3), sk_h2(id + 5.1)) * 0.4 - 0.2;
    float spin = t * (0.6 + h) + h * 20.0;
    vec2 q = sk_rot(spin) * (f - c);
    q.x /= max(0.25, abs(cos(spin * 0.7)));
    float pe = length(q / vec2(0.13, 0.2));
    float notch = length((q - vec2(0.0, 0.2)) / vec2(0.05, 0.06));
    if (pe < 1.0 && notch > 1.0) {
      hgt = 1.0 - pe * pe;
      vec3 pink = mix(vec3(1.0, 0.84, 0.9), vec3(0.95, 0.45, 0.62), smoothstep(0.0, 1.0, pe));
      col = pink; emi = pink * 0.22; rough = 0.5; metal = 0.0;
    }
  }
#elif SKIN_ID == 21
  // Storm: slate clouds rolling along; lightning strikes, lighting them from inside
  vec2 uv = sk_plane(p, n);
  float cl = sk_fbm(vec3(uv * 6.0 + vec2(t * 0.08, 0.0), t * 0.05));
  col = mix(vec3(0.09, 0.1, 0.14), vec3(0.34, 0.36, 0.44), smoothstep(0.3, 0.8, cl));
  hgt = cl;
  rough = 0.5; metal = 0.2;
  float slot = floor(t / 1.3);
  float age = fract(t / 1.3) * 1.3;
  float sx = sk_h(vec3(slot, 1.0, 2.0)) * 1.2;
  float flash = exp(-age * 9.0) + 0.6 * exp(-max(0.0, age - 0.12) * 14.0) * step(0.12, age);
  float by = 0.01 + (sk_h(vec3(slot, 3.0, 1.0)) - 0.5) * 0.08 + (sk_fbm(vec3(uv.x * 14.0, slot, 0.0)) - 0.5) * 0.09 + (sk_n(vec3(uv.x * 60.0, slot, 2.0)) - 0.5) * 0.015;
  float bd = abs(uv.y - by);
  float reach = smoothstep(0.0, 0.05, age * 8.0 - abs(uv.x - sx));
  float core = (1.0 - smoothstep(0.0015, 0.004, bd)) * reach;
  float halo = exp(-bd * 60.0) * reach;
  emi = (vec3(0.85, 0.9, 1.0) * core * 4.0 + vec3(0.4, 0.5, 1.0) * halo * 0.8) * flash;
  emi += vec3(0.3, 0.35, 0.6) * flash * 0.2 * smoothstep(0.4, 0.8, cl);
#elif SKIN_ID == 22
  // Last Breath: a heart monitor; the sweep runs the gun, and every fourth pass it flatlines
  vec2 uv = sk_plane(p, n);
  col = vec3(0.03, 0.02, 0.02);
  vec2 gr = abs(fract(uv * 50.0) - 0.5);
  col += vec3(0.1, 0.012, 0.012) * (1.0 - smoothstep(0.0, 0.06, min(gr.x, gr.y)));
  rough = 0.35; metal = 0.25;
  float pass = floor(t * 0.45);
  float amp = mod(pass, 4.0) == 3.0 ? 0.0 : 1.0;
  float lane = (floor(uv.y / 0.12) + 0.4) * 0.12;
  float bx = fract(uv.x / 0.3);
  float e = sk_ecg(bx) * amp;
  float slope = (sk_ecg(bx + 0.002) - sk_ecg(bx - 0.002)) * amp / (0.004 * 0.3);
  float d = abs(uv.y - lane - e) / sqrt(1.0 + slope * slope);
  float line = 1.0 - smoothstep(0.0012, 0.0035, d);
  hgt = line * 0.8 - (1.0 - smoothstep(0.0, 0.06, min(gr.x, gr.y))) * 0.25;
  float sx = fract(t * 0.45) * 1.6 - 0.3;
  float behind = sx - uv.x;
  float trail = behind > 0.0 ? exp(-behind * 3.0) : 0.0;
  vec3 red = amp > 0.5 ? vec3(1.0, 0.15, 0.12) : vec3(0.9, 0.9, 0.95);
  emi = red * line * (0.12 + 2.4 * trail) + vec3(1.0, 0.7, 0.6) * line * exp(-abs(behind) * 60.0) * 3.0;
#elif SKIN_ID == 23
  // Hunter's Moon: a night sky on the gun; the moon on the receiver waxes and wanes, clouds cross it
  vec2 uv = sk_plane(p, n);
  col = mix(vec3(0.02, 0.03, 0.08), vec3(0.06, 0.08, 0.18), smoothstep(-0.15, 0.15, uv.y));
  vec3 sc = floor(vec3(uv * 200.0, 4.0));
  emi = vec3(0.9) * step(0.985, sk_h(sc)) * (0.4 + 0.6 * sin(t * 2.0 + sk_h(sc + 1.0) * 30.0));
  vec2 mq = uv - vec2(0.42, 0.01); float mr = 0.055; float md = length(mq);
  float ph = t * 0.5;
  vec3 sphere = vec3(mq / mr, sqrt(max(0.0, 1.0 - dot(mq, mq) / (mr * mr))));
  float lit = smoothstep(-0.05, 0.1, dot(sphere, vec3(sin(ph), 0.0, cos(ph))));
  hgt = md < mr ? sphere.z * 0.9 - 0.25 * sk_fbm(vec3(mq * 90.0, 2.0)) : 0.0;
  if (md < mr) {
    vec3 moon = vec3(0.95, 0.86, 0.62) * (0.7 + 0.4 * sk_fbm(vec3(mq * 90.0, 2.0)));
    col = mix(vec3(0.03, 0.03, 0.06), moon * 0.4, lit);
    emi = moon * lit * 1.1;
  }
  emi += vec3(0.9, 0.7, 0.4) * exp(-max(0.0, md - mr) * 40.0) * 0.25 * (0.55 + 0.45 * cos(ph));
  float cloud = smoothstep(0.55, 0.8, sk_fbm(vec3(uv * vec2(8.0, 14.0) + vec2(t * 0.06, 0.0), 1.0)));
  col = mix(col, vec3(0.08, 0.08, 0.11), cloud * 0.85);
  emi = emi * (1.0 - cloud * 0.8) + vec3(0.5, 0.45, 0.35) * cloud * exp(-md * 12.0) * 0.4;
  rough = 0.4; metal = 0.2;
#elif SKIN_ID == 24
  // Constellation: stars joined into figures one line at a time, held, then let go
  vec2 uv = sk_plane(p, n) * 10.0;
  col = vec3(0.015, 0.02, 0.055) + vec3(0.02, 0.02, 0.06) * sk_fbm(vec3(uv * 0.8, 0.0));
  rough = 0.3; metal = 0.3;
  vec2 id = floor(uv);
  float lines = 0.0, star = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = id + vec2(float(i), float(j));
    vec2 sp = c + 0.2 + 0.6 * vec2(sk_h2(c), sk_h2(c + 9.1));
    float tw = 0.6 + 0.4 * sin(t * (1.0 + sk_h2(c + 2.0) * 3.0) + sk_h2(c) * 40.0);
    star = max(star, exp(-length(uv - sp) * 16.0) * tw);
    for (int k = 0; k < 2; k++) {
      vec2 nc = c + (k == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
      float on = step(0.45, sk_h2(c * 1.3 + nc * 0.37));
      vec2 np = nc + 0.2 + 0.6 * vec2(sk_h2(nc), sk_h2(nc + 9.1));
      float cyc = fract(t * 0.12 + sk_h2(c * 1.7 + float(k)));
      float grow = smoothstep(0.0, 0.3, cyc);
      float fade = 1.0 - smoothstep(0.75, 0.95, cyc);
      vec2 pa = uv - sp, ba = np - sp;
      float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      float ld = length(pa - ba * hh);
      lines = max(lines, on * step(hh, grow) * fade * (1.0 - smoothstep(0.012, 0.03, ld)));
    }
  }
  col += vec3(0.25, 0.35, 0.6) * lines * 0.3;
  hgt = star * 0.9 + lines * 0.3;
  emi = vec3(0.85, 0.9, 1.0) * star * 1.6 + vec3(0.4, 0.6, 1.0) * lines * 0.9;
#elif SKIN_ID == 25
  // Abyss: the deep sea; jellyfish pulse their way up, glowing with their own light
  vec2 uv = sk_plane(p, n);
  col = mix(vec3(0.005, 0.015, 0.04), vec3(0.012, 0.045, 0.09), smoothstep(-0.2, 0.15, uv.y));
  float w = sk_fbm(vec3(uv * 10.0, t * 0.2));
  emi = vec3(0.1, 0.35, 0.5) * pow(1.0 - abs(sk_fbm(vec3(uv * 18.0 + w * 1.5, t * 0.35)) * 2.0 - 1.0), 8.0) * 0.12;
  rough = 0.2; metal = 0.15;
  vec2 g = (uv - vec2(0.0, t * 0.025)) * vec2(4.5, 3.6);
  vec2 id = floor(g); vec2 f = fract(g) - 0.5;
  float h = sk_h2(id + 4.0);
  if (h > 0.3) {
    vec2 c = vec2(sk_h2(id + 1.0), sk_h2(id + 2.0)) * 0.3 - 0.15;
    vec2 q = (f - c) / (0.7 + 0.4 * h);
    float pulse = 0.85 + 0.15 * sin(t * 2.5 + h * 30.0);
    vec2 bq = vec2(q.x / pulse, q.y * pulse);
    float bell = length(bq / vec2(0.22, 0.16));
    float dome = (bell < 1.0 && bq.y > -0.02) ? 1.0 : 0.0;
    float rim = dome * smoothstep(0.65, 1.0, bell);
    float tent = 0.0;
    for (int k = -2; k <= 2; k++) {
      float tx = float(k) * 0.06 + sin(q.y * 25.0 + t * 2.0 + float(k)) * 0.02 * (-q.y * 4.0);
      tent += (q.y < 0.0 && q.y > -0.4) ? (1.0 - smoothstep(0.004, 0.012, abs(q.x - tx))) * (1.0 + q.y * 2.5) : 0.0;
    }
    vec3 hue = mix(vec3(0.2, 0.9, 1.0), vec3(0.9, 0.3, 1.0), sk_h2(id + 8.0));
    hgt = dome * (1.0 - bell * bell) + clamp(tent, 0.0, 1.0) * 0.3;
    col += hue * 0.12 * dome;
    emi += hue * (dome * (0.25 + 0.9 * rim) + clamp(tent, 0.0, 1.0) * 0.5) * (0.7 + 0.3 * pulse);
  }
#elif SKIN_ID == 26
  // Wisp: marsh moss; blue spirit flames wander the gun, flickering
  vec2 uv = sk_plane(p, n);
  float moss = sk_fbm(p * 18.0);
  col = mix(vec3(0.03, 0.05, 0.03), vec3(0.09, 0.13, 0.06), moss);
  hgt = moss * 0.6 + sk_n(p * 90.0) * 0.25;
  rough = 0.75; metal = 0.0;
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    vec2 c = vec2(fract(t * 0.045 * (1.0 + fk * 0.3) + fk * 0.31) * 1.5 - 0.2, 0.01 + 0.06 * sin(t * 0.7 + fk * 2.1));
    vec2 q = uv - c;
    float fl = sk_n(vec3(q * 120.0 - vec2(0.0, t * 6.0), fk));
    vec2 fq = vec2(q.x * (1.0 + max(q.y, 0.0) * 22.0), q.y);
    float drop = length(vec2(fq.x / 0.017, fq.y / (fq.y > 0.0 ? 0.05 : 0.017)));
    float flame = 1.0 - smoothstep(0.5, 1.0 + 0.4 * fl, drop);
    float halo = exp(-length(q) * 25.0);
    emi += vec3(0.4, 0.75, 1.0) * flame * 2.0 + vec3(0.1, 0.4, 0.9) * halo * 0.5;
    col += vec3(0.05, 0.1, 0.2) * halo;
  }
#elif SKIN_ID == 27
  // Clockwork: brass gears that tick (never glide), neighbours turning against each other
  vec2 uv = sk_plane(p, n) * 9.0;
  vec2 id = floor(uv); vec2 f = fract(uv) - 0.5;
  float dir = mod(id.x + id.y, 2.0) * 2.0 - 1.0;
  float step2 = floor(t * 2.0) + smoothstep(0.0, 0.25, fract(t * 2.0));
  float a = atan(f.y, f.x) + dir * step2 * 0.314 + dir * 0.157;
  float r = length(f);
  float teeth = 0.4 + 0.06 * smoothstep(-0.3, 0.3, sin(a * 10.0));
  float gear = 1.0 - smoothstep(teeth - 0.015, teeth + 0.015, r);
  float hub = smoothstep(0.07, 0.09, r);
  float cut = (r > 0.14 && r < 0.29) ? smoothstep(0.025, 0.045, abs(sin(a * 2.5)) * r) : 1.0;
  float m = gear * hub * cut;
  hgt = m * (0.8 + 0.2 * (1.0 - smoothstep(0.09, 0.14, r)));
  vec3 brass = vec3(0.8, 0.6, 0.26) * (0.8 + 0.2 * sin(a * 2.0 + id.x));
  col = mix(vec3(0.07, 0.045, 0.025), brass, m);
  emi = vec3(1.0, 0.65, 0.25) * m * 0.12 * (1.0 - smoothstep(0.0, 0.3, fract(t * 2.0)));
  rough = mix(0.6, 0.28, m); metal = mix(0.2, 0.7, m);
#endif
#if SKIN_ID >= 16
  // a legend glows at its edges in its own colour, so it reads as one even across the room
  const vec3 RIMS[12] = vec3[12](vec3(1.0, 0.5, 0.1), vec3(1.0, 0.3, 0.05), vec3(0.3, 0.9, 1.0), vec3(1.0, 0.6, 0.15),
    vec3(1.0, 0.55, 0.75), vec3(0.55, 0.7, 1.0), vec3(1.0, 0.2, 0.15), vec3(0.95, 0.85, 0.6),
    vec3(0.6, 0.75, 1.0), vec3(0.4, 0.9, 1.0), vec3(0.35, 0.65, 1.0), vec3(1.0, 0.75, 0.35));
  emi += RIMS[SKIN_ID - 16] * pow(1.0 - ndv, 4.0) * (0.28 + 0.12 * sin(t * 1.7));
#endif
  // the palettes above are written as screen colours; light works in linear
  col = pow(max(col, vec3(0.0)), vec3(2.2));
}
`;

export const SKIN_COUNT = 28;

/**
 * Paint a skin onto a (cloned) standard material. `tint` is the gun finish, `glow` scales the
 * self-lit parts (lower in a match, where bloom picks them up and the night is dark).
 */
export function applySkin(mat: THREE.MeshStandardMaterial, skin: number, tint: THREE.Color | null, glow: number) {
  if (!skin) return mat;
  mat.defines = { ...(mat.defines ?? {}), SKIN_ID: skin };
  const tintV = tint ? new THREE.Color(1, 1, 1).lerp(tint, 0.6).multiplyScalar(1.05) : new THREE.Color(1, 1, 1);
  // relief depth follows the gun's on-screen scale (the bench shows guns bigger than a match does)
  const uniforms = { uSkinT: SKIN_TIME, uSkinTint: { value: tintV }, uSkinGlow: { value: glow }, uSkinRelief: { value: glow >= 1 ? 1.4 : 1 } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 skinPos;\nattribute vec3 skinNrm;\nvarying vec3 vSkP;\nvarying vec3 vSkN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSkP = skinPos;\nvSkN = skinNrm;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vSkP;\nvarying vec3 vSkN;\nuniform float uSkinT;\nuniform vec3 uSkinTint;\nuniform float uSkinGlow;\nuniform float uSkinRelief;\n" + SKIN_GLSL,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          // the model's own paint survives as light and shade under the pattern
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          float detail = mix(1.0, clamp(lum * 2.2, 0.35, 1.15), 0.5);
          vec3 sc; vec3 se = vec3(0.0); float sr = roughnessFactor; float sm = metalnessFactor; float sh = 0.0;
          float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
          skinShade(vSkP, normalize(vSkN), ndv, uSkinT, sc, se, sr, sm, sh);
          #if SKIN_ID >= 16
          // legends are relief, not paint: the pattern's height bends the light
          normal = sk_bump(-vViewPosition, normal, sh, 0.0035 * uSkinRelief);
          #endif
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
