import { useEffect, useRef, useState } from "react";
import { useStore } from "../game/store";
import type { Session } from "../game/session";
import { ST_COUNTDOWN, ST_ENDED, ST_LIVE, ST_STARTING, WEAPON_NAME } from "../chain/layout";
import { angleToRad } from "../game/sim";
import { SEAT_COLORS } from "../scene/Avatar";
import { GameMenu, MatchClock } from "./GameMenu";
import { onBanner, type Banner } from "../game/feel";
import { FATIGUE_MAX } from "../game/sim";

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

  const lost = (() => {
    const now = performance.now();
    for (const tr of session.tracks.values()) if (!tr.visible && now - tr.lastSeen < 1600 && now - tr.lastSeen > 280) return room?.names[tr.seat] || "someone";
    return null;
  })();
  if (!room || !view) return <div className="hud"><div className="center-msg">Opening your private view…</div></div>;
  const me = view.me;
  const aim = session.input.aim;
  const countdown = room.status === ST_COUNTDOWN ? Math.max(1, Math.ceil((60 - room.tick) / 20)) : null;
  const hitAge = hit ? (performance.now() - hit.at) / 900 : 1;
  const myPos = session.myPos();
  const death = room.feed.slice(0, Math.min(16, room.feedHead)).find((f) => f.victim === session.mySeat) ?? null;
  const survived = Math.max(0, ((death ? death.tick : room.tick) - 60) / 20);
  const humansAlive = room.alive.filter((a, i) => a === 1 && room.isBot[i] === 0 && i !== session.mySeat).length;
  const outside = myPos && Math.hypot(myPos.x - room.zone.x, myPos.y - room.zone.y) > room.zone.r;

  return (
    <div className="hud">
      <div className="hud-top-left">
        <div className="alive">
          <b>{room.aliveCount}</b> ALIVE
        </div>
        <div className="kills">☠ {view.kills} kills</div>
      </div>
      <MatchClock room={room} />
      <GameMenu session={session} room={room} />

      {room.status === ST_STARTING && (
        <div className="center-msg">
          <div className="spinner" />
          Requesting a seed from MagicBlock VRF…
          <small>spawns, loot and the zone are rolled from it — and sealed in the TEE</small>
        </div>
      )}
      {countdown && (
        <div className="night-card">
          <div className="nc-kicker">THE WARDEN IS WATCHING</div>
          <h1>NIGHT {room.matchNo}</h1>
          <div className="nc-roster">
            {room.names.map((n, i) =>
              n ? (
                <span key={i} style={{ ["--c" as any]: SEAT_COLORS[i], animationDelay: `${i * 0.12}s` }} className={i === session.mySeat ? "me" : ""}>
                  {n}
                </span>
              ) : null,
            )}
          </div>
          <div className="nc-count" key={countdown}>
            {countdown}
          </div>
          <small>find the dark · your gun gives you away</small>
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
          <div className="dead-kicker">THE DARK TOOK YOU</div>
          <h2>#{view.place || "?"}</h2>
          <p className="killer">
            {death ? (death.killer === 255 ? "lost outside the zone" : <>
                killed by <b style={{ color: SEAT_COLORS[death.killer] }}>{room.names[death.killer]}</b> · {WEAPON_NAME[death.weapon] ?? "?"}
              </>) : "eliminated"}
          </p>
          <div className="dead-stats">
            <div>
              <b>{fmt(survived)}</b>
              <span>survived</span>
            </div>
            <div>
              <b>{view.kills}</b>
              <span>kills</span>
            </div>
            <div>
              <b>{room.aliveCount}</b>
              <span>still alive</span>
            </div>
          </div>
          <small>
            {humansAlive > 0
              ? `${humansAlive} other player${humansAlive > 1 ? "s" : ""} still in the dark. No ghosting — the dead see nothing. The lights come on when they fall.`
              : "Turning the lights on…"}
          </small>
          <a className="btn ghost" style={{ pointerEvents: "auto", marginTop: 16 }} href="#/">
            LEAVE TO THE GATE
          </a>
        </div>
      )}
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
      {lost && room.status === ST_LIVE && me.alive ? <div className="lost-hint">{lost} slipped into the dark</div> : null}
      {me.flare > 0 && <div className="flare-banner">FLARE · YOU SEE EVERYONE · {Math.ceil(me.flare / 20)}s</div>}

      {me.alive && me.hp <= 35 && room.status === ST_LIVE && <div className="low-hp" style={{ ["--k" as any]: String(1 - me.hp / 35) }} />}
      <Banners />
      <div className="hud-bottom-left">
        <Stamina session={session} />
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

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;


/** Big centre-screen moments: kills, streaks, the zone moving, the final few. */
function Banners() {
  const [list, setList] = useState<Banner[]>([]);
  useEffect(() => {
    const off = onBanner((b) => setList((l) => [...l.slice(-2), b]));
    const t = setInterval(() => setList((l) => l.filter((b) => performance.now() - b.at < 2600)), 300);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);
  return (
    <div className="banners">
      {list.map((b) => (
        <div key={b.id} className={`banner ${b.tone}`}>
          <b>{b.text}</b>
          {b.sub && <small>{b.sub}</small>}
        </div>
      ))}
    </div>
  );
}

/** Sprint stamina: only shows while it isn't full. Smooth: read from the prediction every frame. */
function Stamina({ session }: { session: Session }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = ref.current;
      if (!el) return;
      const fat = session.predMoved >>> 8;
      const winded = (session.predMoved & 4) !== 0;
      const left = 1 - fat / FATIGUE_MAX;
      el.style.opacity = fat > 0 ? "1" : "0";
      el.classList.toggle("winded", winded);
      (el.firstChild as HTMLElement).style.width = `${left * 100}%`;
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [session]);
  return (
    <div className="bar stamina" ref={ref}>
      <i />
      <span>SPRINT</span>
    </div>
  );
}
