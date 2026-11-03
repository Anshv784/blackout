// The map choice in the lobby: a card per map with a top-down picture drawn from the real layout.
import { useEffect, useRef } from "react";
import { MAPS, type MapInfo } from "../game/maps";
import { WALL_CHARS } from "../game/gen";

/** ground and wall colours per map, for the picture (lighter than the minimap so it reads small) */
const PALETTE: Record<number, Record<string, string>> = {
  0: { ".": "#1a1d26", ",": "#2c2a1e", "=": "#23262f", _: "#262a36", "#": "#3a4a72", C: "#4d76a0", B: "#727890", T: "#9aa1b3", F: "#5d6880", K: "#8a6a42", S: "#1a1d26", L: "#1a1d26", l: "#1a1d26" },
  1: { ".": "#2c4220", ",": "#3a5626", "=": "#7a5e3c", _: "#5a4630", "#": "#1c2c16", H: "#4f7a36", R: "#8d9093", T: "#2f5a26", W: "#2f6f9a", B: "#8a6e4c", S: "#2c4220", L: "#2c4220", l: "#2c4220" },
};

export function drawMap(c: HTMLCanvasElement, map: MapInfo) {
  const n = map.rows.length;
  const s = Math.floor(c.width / n);
  const g = c.getContext("2d")!;
  const pal = PALETTE[map.id] ?? PALETTE[0];
  g.fillStyle = pal["."];
  g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const ch = map.rows[y][x];
      g.fillStyle = pal[ch] ?? pal["."];
      g.fillRect(x * s, y * s, s, s);
      // walls get a little height: a light top edge and a dark shadow below
      if (WALL_CHARS.includes(ch) && ch !== "W") {
        g.fillStyle = "rgba(255,255,255,0.12)";
        g.fillRect(x * s, y * s, s, 1);
        g.fillStyle = "rgba(0,0,0,0.35)";
        g.fillRect(x * s, y * s + s, s, Math.max(1, s / 3));
      }
    }
  // lights as warm glows
  for (const [lx, ly] of map.lamps) {
    const cx = (lx + 0.5) * s;
    const cy = (ly + 0.5) * s;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, s * 3);
    gr.addColorStop(0, "rgba(255,200,120,0.55)");
    gr.addColorStop(1, "rgba(255,200,120,0)");
    g.fillStyle = gr;
    g.fillRect(cx - s * 3, cy - s * 3, s * 6, s * 6);
  }
  // night vignette
  const v = g.createRadialGradient(c.width / 2, c.height / 2, c.width * 0.25, c.width / 2, c.height / 2, c.width * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.55)");
  g.fillStyle = v;
  g.fillRect(0, 0, c.width, c.height);
}

function Thumb({ map }: { map: MapInfo }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawMap(ref.current, map);
  }, [map]);
  return <canvas ref={ref} width={192} height={192} className="mp-thumb" />;
}

export function MapPicker({ value, canChange, busy, onPick }: { value: number; canChange: boolean; busy: boolean; onPick: (id: number) => void }) {
  return (
    <div className="map-picker">
      <label>
        MAP <em>{canChange ? "host picks" : "host decides"}</em>
      </label>
      {MAPS.map((m) => {
        const on = m.id === value;
        return (
          <button key={m.id} className={`mp-card ${on ? "on" : ""}`} disabled={!canChange || busy || on} onClick={() => onPick(m.id)}>
            <Thumb map={m} />
            <div className="mp-text">
              <b>{m.name}</b>
              <span>{m.blurb}</span>
            </div>
            {on && <i className="mp-tick">SELECTED</i>}
          </button>
        );
      })}
    </div>
  );
}
