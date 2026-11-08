// A live preview of a gun skin: the same shader the gun uses, drawn on a small curved strip.
// One shared WebGL renderer draws every swatch on the page and copies it into each tile's canvas
// (a WebGL context per tile would run out fast). Every skin has its own slot in one 4x4 atlas,
// so a frame is one GPU read however many tiles are open. Animated skins redraw ~30 times a
// second; still ones are drawn once.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { SKIN_GLSL, SKIN_TIME, tickSkins } from "../scene/skins";
import { SKINS } from "../game/look";

const W = 192;
const H = 128;

type Target = { canvas: HTMLCanvasElement; skin: number; drawn: boolean };
const targets = new Set<Target>();
let gl: THREE.WebGLRenderer | null = null;
let failed = false;
let scene: THREE.Scene;
let cam: THREE.OrthographicCamera;
let quad: THREE.Mesh;
const mats = new Map<number, THREE.ShaderMaterial>();
let raf = 0;
let last = 0;

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
// the strip is lit like a rounded receiver: a key light from above, a rim below, a specular band
const FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uSkinT;
${SKIN_GLSL}
void main(){
  float y = vUv.y * 2.0 - 1.0;
  vec3 n = normalize(vec3(0.0, y * 0.9, sqrt(max(0.0, 1.0 - y * y * 0.81))));
  vec3 p = vec3(0.2 + vUv.x * 0.36, vUv.y * 0.24, n.z * 0.02);
  vec3 col; vec3 emi = vec3(0.0); float rough = 0.5; float metal = 0.1;
  skinShade(p, vec3(0.0, 0.0, 1.0), n.z, uSkinT, col, emi, rough, metal);
  vec3 L = normalize(vec3(-0.3, 0.75, 0.6));
  float diff = max(dot(n, L), 0.0);
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, H), 0.0), mix(8.0, 90.0, 1.0 - rough)) * (1.0 - rough) * mix(0.35, 1.0, metal);
  vec3 base = col * (1.0 - metal * 0.5);
  vec3 c = base * (0.18 + 0.95 * diff) + mix(vec3(1.0), col, metal) * spec * 0.9 + emi;
  c += vec3(0.35, 0.45, 0.7) * pow(1.0 - n.z, 3.0) * 0.25;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function init() {
  if (gl || failed) return !!gl;
  try {
    gl = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: "low-power" });
    gl.setPixelRatio(1);
    gl.setSize(W * 4, H * 4, false);
    gl.setScissorTest(true);
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.15;
    gl.outputColorSpace = THREE.SRGBColorSpace;
  } catch {
    failed = true;
    return false;
  }
  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  scene.add(quad);
  return true;
}

function matFor(skin: number) {
  let m = mats.get(skin);
  if (!m) {
    m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, defines: { SKIN_ID: skin }, uniforms: { uSkinT: SKIN_TIME } });
    mats.set(skin, m);
  }
  return m;
}

/** slot (x, y) of a skin in the atlas, in canvas pixels from the top left */
const slot = (skin: number) => [(skin % 4) * W, Math.floor(skin / 4) * H] as const;
function render(skin: number) {
  const [x, y] = slot(skin);
  const gy = 3 * H - y; // WebGL counts from the bottom
  gl!.setViewport(x, gy, W, H);
  gl!.setScissor(x, gy, W, H);
  quad.material = matFor(skin);
  gl!.render(scene, cam);
}
function copy(t: Target) {
  const [x, y] = slot(t.skin);
  t.canvas.getContext("2d")?.drawImage(gl!.domElement, x, y, W, H, 0, 0, t.canvas.width, t.canvas.height);
  t.drawn = true;
}
function frame(force: boolean) {
  const due = [...targets].filter((t) => force || !t.drawn || SKINS[t.skin]?.live);
  if (!due.length) return;
  for (const skin of new Set(due.map((t) => t.skin))) render(skin);
  for (const t of due) copy(t);
}

function loop(now: number) {
  raf = 0;
  if (!targets.size || !gl) return;
  if (!document.hidden && now - last > 33) {
    last = now;
    tickSkins();
    frame(false);
  }
  raf = requestAnimationFrame(loop);
}

function add(t: Target) {
  if (!init()) return;
  targets.add(t);
  render(t.skin);
  copy(t);
  if (!raf) raf = requestAnimationFrame(loop);
}

/** A skin preview. With `gun`, the strip is cut to that gun's silhouette (its thumbnail) and the
 *  thumbnail's own shading is laid over it, so the tile shows that gun wearing the skin. */
export function SkinSwatch({ i, big = false, gun }: { i: number; big?: boolean; gun?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !i) return;
    const t: Target = { canvas: c, skin: i, drawn: false };
    add(t);
    return () => {
      targets.delete(t);
    };
  }, [i]);
  const w = big ? W : 32;
  const h = big ? H : 32;
  if (gun === undefined)
    return i ? <canvas ref={ref} width={w} height={h} className={big ? "lk-fill" : "cs-skin"} /> : <i className={big ? "lk-fill sk-factory" : "cs-skin sk-factory"} />;
  const thumb = `url(/models/guns/thumbs/${gun}.webp)`;
  return (
    <i className="lk-fill sk-gun">
      {i ? (
        <>
          <canvas ref={ref} width={w} height={h} style={{ WebkitMaskImage: thumb, maskImage: thumb }} />
          <img src={`/models/guns/thumbs/${gun}.webp`} alt="" className="sk-shade" />
        </>
      ) : (
        <img src={`/models/guns/thumbs/${gun}.webp`} alt="" className="sk-plain" />
      )}
    </i>
  );
}
