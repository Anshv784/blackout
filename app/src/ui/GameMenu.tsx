// In-match chrome: the countdown clock, the full map (Tab) and the settings menu (Esc / P).
import { useEffect, useRef, useState } from "react";
import type { Session } from "../game/session";
import type { Room } from "../chain/layout";
import { ST_LIVE } from "../chain/layout";
import { angleToRad, COUNTDOWN_TICKS, matchTicks, zoneSchedule } from "../game/sim";
import { MAP_ROWS, MAP_W, WALL_CHARS, LAMPS } from "../game/gen";
import { SEAT_COLORS } from "../game/colors";
import { controls, setLaser, setSetting, toggleView } from "../game/controls";
import { DEFAULT_PREFS, resetPrefs, setPref, usePrefs } from "../game/prefs";
import { audio } from "../game/audio";
import { client } from "../game/identity";


const mmss = (ticks: number) => {
  const s = Math.max(0, Math.ceil(ticks / 20));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Counts down to the end of the night, with what the zone does next underneath. */
export function MatchClock({ room }: { room: Room }) {
  const t = room.status === ST_LIVE ? Math.max(0, room.tick - COUNTDOWN_TICKS) : 0;
  const left = matchTicks(room.matchLen) - t;
  const ZONE = zoneSchedule(room.matchLen);
  let zone = "FINAL ZONE";
  let urgent = false;
  for (const ph of ZONE) {
    if (t < ph.start) {
      zone = `ZONE CLOSES IN ${mmss(ph.start - t)}`;
      urgent = ph.start - t <= 100;
      break;
    }
    if (t < ph.end) {
      zone = `ZONE SHRINKING · ${mmss(ph.end - t)}`;
      urgent = true;
      break;
    }
  }
  return (
    <div className={`hud-clock ${left <= 200 ? "final" : ""}`}>
      <b>{mmss(left)}</b>
      <span className={urgent ? "urgent" : ""}>{zone}</span>
    </div>
  );
}

/** Shared by the minimap and the full map. Only what you can see right now is drawn. */
export function drawMap(c: HTMLCanvasElement, session: Session, big: boolean) {
  const r = session.room;
  if (!r) return;
  const g = c.getContext("2d")!;
  const s = c.width / MAP_W;
  const cellT = MAP_W / 8; // tiles per grid square
  const px = (v: number) => (v / 256) * s;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = big ? "rgba(5,6,10,0.92)" : "rgba(5,6,10,0.75)";
  g.fillRect(0, 0, c.width, c.height);
  if (big) {
    g.strokeStyle = "rgba(255,255,255,0.05)";
    g.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      g.beginPath();
      g.moveTo(i * cellT * s, 0);
      g.lineTo(i * cellT * s, c.height);
      g.moveTo(0, i * cellT * s);
      g.lineTo(c.width, i * cellT * s);
      g.stroke();
    }
    g.fillStyle = "rgba(255,255,255,0.28)";
    g.font = `${Math.round(s * 0.7)}px ui-monospace, monospace`;
    for (let i = 0; i < 8; i++) {
      g.fillText("ABCDEFGH"[i], i * cellT * s + s * 0.3, s * 0.9);
      g.fillText(String(i + 1), s * 0.3, i * cellT * s + s * 1.9);
    }
  }
  g.fillStyle = "#273454";
  // ground and walls by type: roads, field, buildings, containers, fences
  const TILE: Record<string, string> = { "=": "#1c1f27", ",": "#2a2618", _: "#232733", "#": "#273454", C: "#3b5a7a", B: "#5a5f72", T: "#7d8496", F: "#4b5566", K: "#6b5234" };
  for (let y = 0; y < MAP_W; y++)
    for (let x = 0; x < MAP_W; x++) {
      const col = TILE[MAP_ROWS[y][x]];
      if (!col || (!big && !WALL_CHARS.includes(MAP_ROWS[y][x]))) continue;
      g.fillStyle = col;
      g.fillRect(x * s, y * s, s, s);
    }
  if (big) {
    g.fillStyle = "#ffc777";
    for (const [lx, ly] of LAMPS) {
      g.beginPath();
      g.arc((lx + 0.5) * s, (ly + 0.5) * s, s * 0.35, 0, Math.PI * 2);
      g.fill();
    }
    g.font = `${Math.round(s * 1.1)}px ui-monospace, monospace`;
    g.fillStyle = "rgba(255,255,255,0.35)";
    for (const [tx, ty, label] of [[4, 21, "YARD"], [31, 3, "WAREHOUSE"], [3, 28, "OFFICES"], [30, 31, "FIELD"]] as const) g.fillText(label, tx * s, ty * s);
  }
  // supply drop
  const dr = session.drop;
  if (dr && performance.now() - dr.at < 4000) {
    g.fillStyle = "#ff3b3b";
    g.fillRect(px(dr.x) - (big ? 6 : 3), px(dr.y) - (big ? 6 : 3), big ? 12 : 6, big ? 12 : 6);
  }
  // outside the zone is poison: tint it
  g.save();
  g.fillStyle = "rgba(166,77,255,0.16)";
  g.beginPath();
  g.rect(0, 0, c.width, c.height);
  g.arc(px(r.zone.x), px(r.zone.y), px(r.zone.r), 0, Math.PI * 2, true);
  g.fill("evenodd");
  g.restore();
  g.strokeStyle = "#a64dff";
  g.lineWidth = big ? 3 : 2;
  g.beginPath();
  g.arc(px(r.zone.x), px(r.zone.y), px(r.zone.r), 0, Math.PI * 2);
  g.stroke();
  if (r.next.r < r.zone.r - 10) {
    g.strokeStyle = "rgba(255,255,255,0.75)";
    g.setLineDash(big ? [8, 6] : [3, 3]);
    g.beginPath();
    g.arc(px(r.next.x), px(r.next.y), px(r.next.r), 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  const p = session.myPos();
  if (p) {
    const a = angleToRad(session.input.aim);
    g.fillStyle = "rgba(255,240,200,0.18)";
    g.beginPath();
    g.moveTo(px(p.x), px(p.y));
    g.arc(px(p.x), px(p.y), 10 * s, a - 0.67, a + 0.67);
    g.fill();
    if (big && r.next.r < r.zone.r - 10) {
      // route to safety
      g.strokeStyle = "rgba(255,209,102,0.5)";
      g.setLineDash([4, 6]);
      g.beginPath();
      g.moveTo(px(p.x), px(p.y));
      g.lineTo(px(r.next.x), px(r.next.y));
      g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = SEAT_COLORS[session.mySeat ?? 0];
    g.beginPath();
    g.arc(px(p.x), px(p.y), big ? 7 : 3, 0, Math.PI * 2);
    g.fill();
    if (big) {
      g.strokeStyle = "#fff";
      g.lineWidth = 2;
      g.stroke();
    }
  }
  for (const [seat, tr] of session.tracks) {
    if (!tr.visible || !tr.samples.length) continue;
    const sm = tr.samples[tr.samples.length - 1];
    const d = big ? 5 : 2;
    g.fillStyle = SEAT_COLORS[seat];
    g.fillRect(px(sm.x) - d, px(sm.y) - d, d * 2, d * 2);
  }
}

export function Minimap({ session, onOpen }: { session: Session; onOpen: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (ref.current) drawMap(ref.current, session, false);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [session]);
  return <canvas className="minimap" ref={ref} width={192} height={192} onPointerDown={(e) => e.stopPropagation()} onClick={onOpen} title="Open map (Tab)" />;
}

function MapOverlay({ session, room, onClose }: { session: Session; room: Room; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (ref.current) drawMap(ref.current, session, true);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [session]);
  const p = session.myPos();
  const outside = p && Math.hypot(p.x - room.zone.x, p.y - room.zone.y) > room.zone.r;
  const cell = p ? `${"ABCDEFGH"[Math.min(7, Math.floor(p.x / 256 / (MAP_W / 8)))]}${Math.min(8, Math.floor(p.y / 256 / (MAP_W / 8)) + 1)}` : "—";
  return (
    <div className="menu-overlay" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
      <div className="map-card" onClick={(e) => e.stopPropagation()}>
        <div className="menu-head">
          <h3>THE YARD</h3>
          <span>
            you're at <b>{cell}</b> · {room.aliveCount} alive {outside ? <em>· OUTSIDE THE ZONE</em> : null}
          </span>
          <button className="menu-x" onClick={onClose}>
            ✕ <i>TAB</i>
          </button>
        </div>
        <canvas ref={ref} width={640} height={640} className="map-big" />
        <div className="map-legend">
          <span>
            <i className="lg-me" /> you
          </span>
          <span>
            <i className="lg-zone" /> zone
          </span>
          <span>
            <i className="lg-next" /> next zone
          </span>
          <span>
            <i className="lg-enemy" /> seen right now
          </span>
          <small>The dark hides everyone you can't see, on the map too.</small>
        </div>
      </div>
    </div>
  );
}

type Tab = "controls" | "camera" | "crosshair" | "display" | "audio";

function Settings({ onClose }: { onClose: () => void }) {
  const p = usePrefs();
  const [tab, setTab] = useState<Tab>("controls");
  const [, bump] = useState(0);
  const [muted, setMuted] = useState(audio.muted);
  useEffect(() => {
    const off = audio.onMute(setMuted);
    return () => {
      off();
    };
  }, []);
  const refresh = () => bump((x) => x + 1);

  const range = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void, show?: (v: number) => string) => (
    <label className="set-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => (set(Number(e.target.value)), refresh())} />
      <em>{show ? show(value) : value}</em>
    </label>
  );
  const toggle = (label: string, on: boolean, set: (v: boolean) => void, hint?: string) => (
    <div className="set-row">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <button className={`set-toggle ${on ? "on" : ""}`} onClick={() => (set(!on), refresh())}>
        <i />
      </button>
    </div>
  );
  function choice<T extends string>(label: string, value: T, opts: [T, string][], set: (v: T) => void) {
    return (
      <div className="set-row">
        <span>{label}</span>
        <div className="set-seg">
          {opts.map(([v, l]) => (
            <button key={v} className={v === value ? "on" : ""} onClick={() => (set(v), refresh())}>
              {l}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const tabs: [Tab, string][] = [
    ["controls", "Controls"],
    ["camera", "Camera"],
    ["crosshair", "Crosshair"],
    ["display", "Display"],
    ["audio", "Audio"],
  ];
  const COLORS = ["#ffd166", "#ffffff", "#4dff9a", "#38e1ff", "#ff5ccd"];

  return (
    <div className="menu-overlay" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
      <div className="set-card" onClick={(e) => e.stopPropagation()}>
        <div className="menu-head">
          <h3>SETTINGS</h3>
          <span>saved in this browser · the night keeps going while you're here</span>
          <button className="menu-x" onClick={onClose}>
            ✕ <i>ESC</i>
          </button>
        </div>
        <div className="set-body">
          <nav className="set-tabs">
            {tabs.map(([t, l]) => (
              <button key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>
                {l}
              </button>
            ))}
            <button
              className="set-reset"
              onClick={() => {
                resetPrefs();
                setSetting("sens", 36);
                setSetting("chaseDist", 7.5);
                setSetting("chaseHeight", 5.5);
                setSetting("topZoom", 14);
                setLaser(false);
                audio.setVolume(DEFAULT_PREFS.volume);
                refresh();
              }}
            >
              Reset all
            </button>
          </nav>
          <div className="set-pane">
            {tab === "controls" && (
              <>
                {range("Mouse sensitivity", controls.sens, 8, 120, 1, (v) => setSetting("sens", v))}
                {toggle("Invert vertical aim", p.invertY, (v) => setPref("invertY", v))}
                {range("Turn speed (Q / E)", p.turnSpeed, 0.4, 2.5, 0.1, (v) => setPref("turnSpeed", v), (v) => `${v.toFixed(1)}×`)}
                {choice("Arrow keys", p.arrows, [["move", "Move"], ["camera", "Turn camera"]], (v) => setPref("arrows", v))}
                <div className="set-keys">
                  <span><b>W A S D</b> move</span>
                  <span><b>Shift</b> sprint (loud)</span>
                  <span><b>Mouse</b> aim</span>
                  <span><b>Click / Space</b> fire</span>
                  <span><b>Right mouse</b> aim down sights</span>
                  <span><b>R</b> reload</span>
                  <span><b>Q / E</b> turn</span>
                  <span><b>V</b> view</span>
                  <span><b>Tab</b> map</span>
                  <span><b>M</b> sound</span>
                  <span><b>Esc / P</b> settings</span>
                  <span><b>Wheel</b> zoom</span>
                </div>
              </>
            )}
            {tab === "camera" && (
              <>
                {choice("View", controls.view, [["chase", "Behind"], ["top", "Top-down"]], (v) => v !== controls.view && toggleView())}
                {range("Distance", controls.chaseDist, 2.5, 14, 0.1, (v) => setSetting("chaseDist", v), (v) => v.toFixed(1))}
                {range("Height", controls.chaseHeight, 1.8, 10, 0.1, (v) => setSetting("chaseHeight", v), (v) => v.toFixed(1))}
                {range("Top-down zoom", controls.topZoom, 7, 28, 0.5, (v) => setSetting("topZoom", v), (v) => v.toFixed(1))}
                {range("Field of view", p.fov, 35, 80, 1, (v) => setPref("fov", v), (v) => `${v}°`)}
                {range("Smoothing", p.camSmooth, 0, 1, 0.05, (v) => setPref("camSmooth", v), (v) => (v < 0.3 ? "snappy" : v > 0.75 ? "floaty" : "normal"))}
                {toggle("Hit flash", p.hitFlash, (v) => setPref("hitFlash", v), "screen distortion when you take a hit")}
                {toggle("Screen shake", p.shake, (v) => setPref("shake", v), "when you're hit")}
              </>
            )}
            {tab === "crosshair" && (
              <>
                {choice("Style", p.xStyle, [["cross", "Cross"], ["dot", "Dot"], ["circle", "Circle"]], (v) => setPref("xStyle", v))}
                <div className="set-row">
                  <span>Color</span>
                  <div className="set-colors">
                    {COLORS.map((c) => (
                      <button key={c} className={c === p.xColor ? "on" : ""} style={{ background: c }} onClick={() => setPref("xColor", c)} />
                    ))}
                  </div>
                </div>
                {range("Size", p.xSize, 0.6, 1.8, 0.05, (v) => setPref("xSize", v), (v) => `${Math.round(v * 100)}%`)}
                {toggle("Laser sight", controls.laser, (v) => setLaser(v), "a beam from your gun; turns red on a target")}
                <div className="set-preview">
                  <div className={`crosshair x-${p.xStyle}`} style={{ position: "relative", transform: `scale(${p.xSize})` }}>
                    <u />
                    <i className="t" />
                    <i className="b" />
                    <i className="l" />
                    <i className="r" />
                    <b />
                  </div>
                  <small>turns red when an enemy is in your line of fire</small>
                </div>
              </>
            )}
            {tab === "display" && (
              <>
                {choice("Graphics", p.quality, [["high", "High"], ["low", "Low (faster)"]], (v) => setPref("quality", v))}
                {toggle("Storm", p.weather, (v) => setPref("weather", v), "rain, lightning and thunder over the Yard")}
                {range("Brightness", p.exposure, 0.7, 1.8, 0.05, (v) => setPref("exposure", v), (v) => `${Math.round((v / 1.1) * 100)}%`)}
                {toggle("Player names", p.names, (v) => setPref("names", v))}
                {toggle("Network bar", p.netStats, (v) => setPref("netStats", v), "TEE tick rate, ping and fps")}
                {range("Minimap size", p.mapSize, 100, 220, 10, (v) => setPref("mapSize", v), (v) => `${v}px`)}
              </>
            )}
            {tab === "audio" && (
              <>
                {toggle("Sound", !muted, (on) => audio.setMuted(!on), "M toggles it in game")}
                {range("Volume", p.volume, 0, 1, 0.05, (v) => audio.setVolume(v), (v) => `${Math.round(v * 100)}%`)}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExitConfirm({ onClose, session, host }: { onClose: () => void; session: Session; host: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const endAndClose = async () => {
    if (document.pointerLockElement) document.exitPointerLock();
    try {
      await session.endAndClose(setBusy);
    } catch {
      /* close anyway */
    }
    window.location.hash = "/";
  };
  return (
    <div className="menu-overlay" onPointerDown={(e) => e.stopPropagation()} onClick={() => !busy && onClose()}>
      <div className="exit-card" onClick={(e) => e.stopPropagation()}>
        <h3>{host ? "Leave or end the night?" : "Leave the night?"}</h3>
        <p>
          {host
            ? "Leaving only takes you out. As the host you can also end the night for everyone and close the room."
            : "You'll vanish from the Yard and count as eliminated."}
        </p>
        {busy && <p className="dim">{busy}</p>}
        {host && (
          <button className="btn danger wide" disabled={!!busy} onClick={endAndClose} style={{ marginBottom: 10 }}>
            {busy ? "CLOSING…" : "END NIGHT & CLOSE ROOM"}
          </button>
        )}
        <div className="row">
          <button className="btn" onClick={onClose}>
            STAY
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (document.pointerLockElement) document.exitPointerLock();
              window.location.hash = "/";
            }}
          >
            LEAVE
          </button>
        </div>
      </div>
    </div>
  );
}

/** Top-right toolbar plus the overlays it opens. */
export function GameMenu({ session, room }: { session: Session; room: Room }) {
  const [open, setOpenRaw] = useState<null | "map" | "settings" | "exit">(null);
  const openRef = useRef(open);
  // closing a menu is a click or key press, so the browser lets us take the mouse back
  // straight away: you're back in the game without an extra click
  const setOpen = (next: null | "map" | "settings" | "exit" | ((o: typeof open) => typeof open)) => {
    const v = typeof next === "function" ? next(openRef.current) : next;
    if (openRef.current && !v && controls.view === "chase") {
      const c = document.querySelector(".game canvas") as HTMLCanvasElement | null;
      try {
        (c?.requestPointerLock?.() as any)?.catch?.(() => {});
      } catch {
        /* the browser may refuse right after Esc: the click-to-play prompt covers it */
      }
    }
    openRef.current = v;
    setOpenRaw(v);
  };
  const [muted, setMuted] = useState(audio.muted);
  useEffect(() => {
    const off = audio.onMute(setMuted);
    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    if (open && document.pointerLockElement) document.exitPointerLock();
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" && (e.target as HTMLInputElement).type !== "range") return;
      const k = e.key.toLowerCase();
      if (k === "tab") {
        e.preventDefault();
        setOpen((o) => (o === "map" ? null : "map"));
      } else if (k === "escape" || k === "p") {
        setOpen((o) => (o ? null : "settings"));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);

  // Esc while the mouse is captured only releases it (the key never reaches the page),
  // so a lost capture opens settings, like a pause menu.
  useEffect(() => {
    let wasLocked = !!document.pointerLockElement;
    const change = () => {
      const locked = !!document.pointerLockElement;
      if (wasLocked && !locked) setOpen((o) => o ?? "settings");
      wasLocked = locked;
    };
    document.addEventListener("pointerlockchange", change);
    return () => document.removeEventListener("pointerlockchange", change);
  }, []);

  // nothing should keep moving you while a menu is up
  useEffect(() => {
    controls.menu = !!open;
    if (open) {
      controls.keys.clear();
      controls.fire = false;
    }
  }, [open]);

  return (
    <>
      <Minimap session={session} onOpen={() => setOpen("map")} />
      <div className="game-tools" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => setOpen("map")}>
          MAP <i>TAB</i>
        </button>
        <button onClick={() => setOpen("settings")}>
          ⚙ SETTINGS <i>ESC</i>
        </button>
        <button onClick={() => audio.toggleMute()} title="Sound (M)">
          {muted ? "🔇" : "🔊"}
        </button>
        <button className="danger" onClick={() => setOpen("exit")}>
          EXIT
        </button>
      </div>
      {open === "map" && <MapOverlay session={session} room={room} onClose={() => setOpen(null)} />}
      {open === "settings" && <Settings onClose={() => setOpen(null)} />}
      {open === "exit" && <ExitConfirm onClose={() => setOpen(null)} session={session} host={room.host.equals(client.publicKey)} />}
    </>
  );
}

