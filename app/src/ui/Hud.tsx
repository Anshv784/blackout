import { useEffect, useRef, useState } from "react";
import { useStore } from "../game/store";
import type { Session } from "../game/session";
import { ST_COUNTDOWN, ST_ENDED, ST_LIVE, ST_STARTING, WEAPON_NAME } from "../chain/layout";
import { angleToRad } from "../game/sim";
import { MAP_ROWS } from "../game/gen";
import { SEAT_COLORS } from "../scene/Avatar";
import { controls, toggleView, setSetting } from "../game/controls";

const MAX_MAG = [10, 30, 5];
const PING_GLYPH = ["", "👣", "💥", "✦", "⟳"];

export function Hud({ session }: { session: Session }) {
  const room = useStore((s) => s.room);
  const view = useStore((s) => s.view);
  const [pings, setPings] = useState<{ id: number; angle: number; kind: number; at: number }[]>([]);
  const [hit, setHit] = useState<{ angle: number; at: number } | null>(null);
  const seen = useRef(0);

  useEffect(() => {
    const t = setInterval(() => {
      const now = performance.now();
      const fx = session.fx.filter((f) => f.id > seen.current);
      if (fx.length) seen.current = fx[fx.length - 1].id;
      const newP = fx.filter((f) => f.kind === "ping").map((f) => ({ id: f.id, angle: f.angle ?? 0, kind: f.sub ?? 1, at: f.at }));
      const newH = fx.filter((f) => f.kind === "hit").pop();
      if (newH) setHit({ angle: newH.angle ?? 0, at: newH.at });
      setPings((p) => [...p.filter((x) => now - x.at < 1600), ...newP].slice(-10));
    }, 60);
    return () => clearInterval(t);
  }, [session]);

  if (!room || !view) return <div className="hud"><div className="center-msg">Opening your private view…</div></div>;
  const me = view.me;
  const aim = session.input.aim;
  const countdown = room.status === ST_COUNTDOWN ? Math.max(1, Math.ceil((60 - room.tick) / 20)) : null;
  const t = Math.max(0, room.tick - 60);
  const secs = Math.floor(t / 20);
  const hitAge = hit ? (performance.now() - hit.at) / 900 : 1;
  const myPos = session.myPos();
  const humansAlive = room.alive.filter((a, i) => a === 1 && room.isBot[i] === 0 && i !== session.mySeat).length;
  const outside = myPos && Math.hypot(myPos.x - room.zone.x, myPos.y - room.zone.y) > room.zone.r;

  return (
    <div className="hud">
      <div className="hud-top-left">
        <div className="alive">
          <b>{room.aliveCount}</b> ALIVE
        </div>
        <div className="timer">
          {String(Math.floor(secs / 60)).padStart(1, "0")}:{String(secs % 60).padStart(2, "0")} · ZONE {room.zonePhase > 0 ? `PHASE ${room.zonePhase}` : "STABLE"}
        </div>
        <div className="kills">☠ {view.kills} kills</div>
      </div>
      <Minimap session={session} />

      {room.status === ST_STARTING && (
        <div className="center-msg">
          <div className="spinner" />
          Requesting a seed from MagicBlock VRF…
          <small>spawns, loot and the zone are rolled from it — and sealed in the TEE</small>
        </div>
      )}
      {countdown && (
        <div className="countdown" key={countdown}>
          {countdown}
          <small>find the dark</small>
        </div>
      )}
      {room.status === ST_ENDED && (
        <div className="center-msg big">
          {room.winner === session.mySeat ? "👑 LAST ONE STANDING" : `${room.names[room.winner] ?? "?"} WINS`}
          <small>turning the lights on…</small>
        </div>
      )}
      {room.status === ST_LIVE && !me.alive && (
        <div className="dead">
          <h2>ELIMINATED</h2>
          <p>#{view.place || "?"} of {room.nPlayers + room.nBots}</p>
          <small>
            {humansAlive > 0
              ? `${humansAlive} other player${humansAlive > 1 ? "s" : ""} still in the dark · ${room.aliveCount} alive. No ghosting — the dead see nothing. The lights come on when they fall.`
              : "Turning the lights on…"}
          </small>
          <a className="btn ghost" style={{ pointerEvents: "auto", marginTop: 16 }} href="#/">
            LEAVE TO ROOMS
          </a>
        </div>
      )}
      {controls.view === "chase" && me.alive && (room.status === ST_LIVE || room.status === ST_COUNTDOWN) ? (
        controls.locked ? <div className="reticle" /> : <div className="lock-hint">CLICK TO LOOK AROUND · V to switch view</div>
      ) : null}
      <CameraSettings />
      {outside && room.status === ST_LIVE && me.alive ? <div className="zone-warn">OUTSIDE THE ZONE — GET TO THE CIRCLE</div> : null}

      {/* sound pings around the screen edge */}
      <div className="ping-ring">
        {pings.map((p) => {
          const rel = angleToRad(p.angle);
          const age = (performance.now() - p.at) / 1600;
          return (
            <div
              key={p.id}
              className={`ping k${p.kind}`}
              style={{ transform: `rotate(${(rel * 180) / Math.PI}deg) translateX(min(38vw, 38vh))`, opacity: 1 - age }}
            >
              <span style={{ transform: `rotate(${(-rel * 180) / Math.PI}deg)` }}>{PING_GLYPH[p.kind]}</span>
            </div>
          );
        })}
      </div>
      {hit && hitAge < 1 && (
        <div className="hit-arc" style={{ transform: `rotate(${(angleToRad(hit.angle) * 180) / Math.PI}deg)`, opacity: 1 - hitAge }} />
      )}
      {hit && hitAge < 0.4 && <div className="hit-flash" style={{ opacity: 0.4 - hitAge }} />}
      {me.flare > 0 && <div className="flare-banner">FLARE · YOU SEE EVERYONE · {Math.ceil(me.flare / 20)}s</div>}

      <div className="hud-bottom-left">
        <div className="bar hp">
          <i style={{ width: `${me.hp}%` }} />
          <span>{me.hp}</span>
        </div>
        {me.armor > 0 && (
          <div className="bar armor">
            <i style={{ width: `${me.armor}%` }} />
            <span>{me.armor}</span>
          </div>
        )}
      </div>
      <div className="hud-bottom-right">
        <div className="weapon">{WEAPON_NAME[me.weapon]}</div>
        <div className="ammo">
          {me.reload > 0 ? <span className="reloading">RELOADING</span> : (
            <>
              <b>{me.mag}</b>/{MAX_MAG[me.weapon]}
            </>
          )}
        </div>
      </div>
      <div className="aim-hint" style={{ display: "none" }}>{aim}</div>
    </div>
  );
}

function Minimap({ session }: { session: Session }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = ref.current;
      const r = session.room;
      if (!c || !r) return;
      const g = c.getContext("2d")!;
      const s = c.width / 32;
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = "rgba(5,6,10,0.75)";
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#273454";
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (MAP_ROWS[y][x] === "#") g.fillRect(x * s, y * s, s, s);
      g.strokeStyle = "#a64dff";
      g.lineWidth = 2;
      g.beginPath();
      g.arc((r.zone.x / 256) * s, (r.zone.y / 256) * s, (r.zone.r / 256) * s, 0, Math.PI * 2);
      g.stroke();
      if (r.next.r < r.zone.r - 10) {
        g.strokeStyle = "rgba(255,255,255,0.7)";
        g.setLineDash([3, 3]);
        g.beginPath();
        g.arc((r.next.x / 256) * s, (r.next.y / 256) * s, (r.next.r / 256) * s, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
      const p = session.myPos();
      if (p) {
        const a = angleToRad(session.input.aim);
        g.fillStyle = "rgba(255,240,200,0.18)";
        g.beginPath();
        g.moveTo((p.x / 256) * s, (p.y / 256) * s);
        g.arc((p.x / 256) * s, (p.y / 256) * s, 10 * s, a - 0.67, a + 0.67);
        g.fill();
        g.fillStyle = SEAT_COLORS[session.mySeat ?? 0];
        g.beginPath();
        g.arc((p.x / 256) * s, (p.y / 256) * s, 3, 0, Math.PI * 2);
        g.fill();
      }
      // enemies only if currently in your view
      for (const [seat, tr] of session.tracks) {
        if (!tr.visible || !tr.samples.length) continue;
        const sm = tr.samples[tr.samples.length - 1];
        g.fillStyle = SEAT_COLORS[seat];
        g.fillRect((sm.x / 256) * s - 2, (sm.y / 256) * s - 2, 4, 4);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [session]);
  return <canvas className="minimap" ref={ref} width={160} height={160} />;
}

function CameraSettings() {
  const [open, setOpen] = useState(false);
  const [, bump] = useState(0);
  const slider = (label: string, k: "chaseDist" | "chaseHeight" | "topZoom" | "sens", min: number, max: number, step: number) => (
    <label className="cam-row">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={controls[k]}
        onChange={(e) => {
          setSetting(k, Number(e.target.value));
          bump((x) => x + 1);
        }}
      />
    </label>
  );
  return (
    <div className="cam" onPointerDown={(e) => e.stopPropagation()}>
      <div className="cam-buttons">
        <button
          onClick={() => {
            toggleView();
            bump((x) => x + 1);
          }}
        >
          {controls.view === "chase" ? "VIEW: BEHIND" : "VIEW: TOP"} <i>V</i>
        </button>
        <button onClick={() => setOpen(!open)}>⚙</button>
      </div>
      {open && (
        <div className="cam-panel">
          {controls.view === "chase" ? (
            <>
              {slider("Distance", "chaseDist", 2.5, 14, 0.1)}
              {slider("Height", "chaseHeight", 1.8, 10, 0.1)}
              {slider("Mouse speed", "sens", 8, 120, 1)}
            </>
          ) : (
            slider("Zoom", "topZoom", 7, 28, 0.5)
          )}
          <small>Mouse wheel zooms too</small>
        </div>
      )}
    </div>
  );
}
