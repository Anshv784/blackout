import { useEffect, useRef, useState } from "react";
import { useStore } from "../game/store";
import type { Session } from "../game/session";
import { ST_COUNTDOWN, ST_ENDED, ST_LIVE, ST_STARTING, WEAPON_NAME, FIRE_MODE, GADGET_NAME, NIGHT_MOD, DOWNED } from "../chain/layout";
import { angleToRad } from "../game/sim";
import { SEAT_COLORS } from "../game/colors";
import { GameMenu, MatchClock } from "./GameMenu";
import { onBanner, type Banner } from "../game/feel";
import { FATIGUE_MAX } from "../game/sim";
import { controls } from "../game/controls";

const MAX_MAG = [10, 30, 5, 30, 5];
const PING_GLYPH = ["", "👣", "💥", "✦", "⟳", "📦", "🎯", "☁", "📡", "💣"];

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
      <div className="hud-top-left pubg">
        <div className="chip-stat">
          <b>{room.aliveCount}</b>
          <span>ALIVE</span>
        </div>
        <div className="chip-stat kill">
          <b>{view.kills}</b>
          <span>KILLED</span>
        </div>
      </div>
      <Compass session={session} />
      <MatchClock room={room} />
      {room.nightMod > 0 && <div className="mod-chip">{NIGHT_MOD[room.nightMod]}</div>}
      {view.inv.nvg > 0 && me.alive === 1 && <div className="nvg-tint" />}
      {view.inv.blind > 0 && <div className="flash-white" style={{ opacity: Math.min(1, view.inv.blind / 40) }} />}
      {room.duos && <Partner view={view} room={room} mySeat={session.mySeat} />}
      {me.alive === DOWNED && (
        <div className="downed">
          <b>YOU'RE DOWN</b>
          <small>crawl to cover · your partner can revive you</small>
          <div className="dn-bar bleed">
            <i style={{ width: `${(me.armor / 300) * 100}%` }} />
            <span>BLEEDING OUT</span>
          </div>
          {me.hp > 0 && (
            <div className="dn-bar revive">
              <i style={{ width: `${(me.hp / 60) * 100}%` }} />
              <span>BEING REVIVED</span>
            </div>
          )}
        </div>
      )}
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
      {me.alive && (room.status === ST_LIVE || room.status === ST_COUNTDOWN) && <ClickToPlay />}
      <div className="hud-health">
        <Stamina session={session} />
        {me.armor > 0 && (
          <div className="armor-row">
            <span>VEST</span>
            <div className="bar armor">
              <i style={{ width: `${me.armor}%` }} />
            </div>
          </div>
        )}
        <div className={`bar hp ${me.hp <= 35 ? "low" : ""}`}>
          <i style={{ width: `${me.hp}%` }} />
          <span>{me.hp}</span>
        </div>
      </div>
      <div className="hud-weapon">
        <div className="hw-top">
          <span className="hw-name">{WEAPON_NAME[me.weapon]}</span>
          <span className="hw-mode">{FIRE_MODE[me.weapon]}</span>
        </div>
        <div className={`hw-ammo ${me.mag === 0 && me.reload === 0 ? "empty" : ""}`}>
          {me.reload > 0 ? (
            <span className="reloading">RELOADING…</span>
          ) : (
            <>
              <b>{me.mag}</b>
              <small>/ {MAX_MAG[me.weapon]}</small>
            </>
          )}
        </div>
        <div className="hw-hint">{me.mag === 0 && me.reload === 0 ? "PRESS R TO RELOAD" : "RMB AIM · R RELOAD"}</div>
      </div>
      <div className="hud-slots">
        <div className={`slot ${view.inv.sec >= 0 ? "" : "empty"}`}>
          <i>X</i>
          <span>{view.inv.sec >= 0 ? `${WEAPON_NAME[view.inv.sec]} · ${view.inv.secMag}` : "2ND GUN"}</span>
        </div>
        <div className={`slot gadget ${view.inv.gadget ? "" : "empty"}`}>
          <i>G</i>
          <span>{view.inv.gadget ? `${GADGET_NAME[view.inv.gadget]} ×${view.inv.count}` : "GADGET"}</span>
        </div>
        {view.inv.nvg > 0 && (
          <div className="slot nvg">
            <span>NIGHT VISION {Math.ceil(view.inv.nvg / 20)}s</span>
          </div>
        )}
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

/** PUBG-style heading strip: where you're facing, with the next safe zone marked. */
function Compass({ session }: { session: Session }) {
  const strip = useRef<HTMLDivElement>(null);
  const zone = useRef<HTMLElement>(null);
  const deg = useRef<HTMLElement>(null);
  const dropM = useRef<HTMLElement>(null);
  const bountyM = useRef<HTMLElement>(null);
  const PX = 4; // pixels per degree
  useEffect(() => {
    let raf = 0;
    const bearingOf = (rad: number) => (((rad * 180) / Math.PI + 90) % 360 + 360) % 360;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const a = controls.view === "chase" ? controls.camYaw : angleToRad(session.input.aim);
      const b = bearingOf(a);
      if (strip.current) strip.current.style.transform = `translateX(${240 - (b + 360) * PX}px)`;
      if (deg.current) deg.current.textContent = String(Math.round(b) % 360).padStart(3, "0");
      const r = session.room;
      const p = session.myPos();
      if (zone.current && r && p) {
        const zb = bearingOf(Math.atan2(r.next.y - p.y, r.next.x - p.x));
        let d = zb - b;
        d = ((d + 540) % 360) - 180;
        const far = Math.hypot(r.next.x - p.x, r.next.y - p.y) > r.next.r * 0.6;
        zone.current.style.opacity = far && Math.abs(d) < 58 ? "1" : "0";
        zone.current.style.transform = `translateX(${d * PX}px)`;
      }
      const mark = (el: HTMLElement | null, bearing: number | null) => {
        if (!el) return;
        if (bearing === null) {
          el.style.opacity = "0";
          return;
        }
        const dd = ((bearing - b + 540) % 360) - 180;
        el.style.opacity = Math.abs(dd) < 58 ? "1" : "0";
        el.style.transform = `translateX(${dd * PX}px)`;
      };
      const now = performance.now();
      const dr = session.drop;
      mark(dropM.current, dr && p && now - dr.at < 4000 ? bearingOf(Math.atan2(dr.y - p.y, dr.x - p.x)) : null);
      const bo = session.bounty;
      mark(bountyM.current, bo && now - bo.at < 6000 ? bearingOf((bo.angle / 65536) * Math.PI * 2) : null);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [session]);
  const marks: JSX.Element[] = [];
  for (let k = 0; k < 360 * 3; k += 15) {
    const v = k % 360;
    const label = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" }[v];
    marks.push(
      <i key={k} style={{ left: k * PX }} className={label ? (label.length === 1 ? "card" : "mid") : ""}>
        {label ?? v}
      </i>,
    );
  }
  return (
    <div className="compass">
      <div className="cmp-window">
        <div className="cmp-strip" ref={strip}>
          {marks}
        </div>
        <em className="cmp-zone" ref={zone} title="next safe zone" />
        <em className="cmp-drop" ref={dropM} title="supply drop" />
        <em className="cmp-bounty" ref={bountyM} title="kill leader" />
      </div>
      <b className="cmp-deg" ref={deg}>000</b>
    </div>
  );
}

/** Third person needs the mouse captured: say so whenever it isn't. */
function ClickToPlay() {
  const [locked, setLocked] = useState(!!document.pointerLockElement);
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => setLocked(!!document.pointerLockElement);
    document.addEventListener("pointerlockchange", f);
    const t = setInterval(() => tick((x) => x + 1), 500); // follows view / menu changes
    return () => {
      document.removeEventListener("pointerlockchange", f);
      clearInterval(t);
    };
  }, []);
  if (locked || controls.view !== "chase" || controls.menu || matchMedia("(pointer:coarse)").matches) return null;
  return (
    <div className="click-to-play">
      <b>CLICK TO PLAY</b>
      <small>mouse turns · WASD moves · click fire · right-click aim · Shift sprint · Esc menu</small>
    </div>
  );
}

/** Duos: your partner's health, even when they're out of your light (partners always see each other). */
function Partner({ view, room, mySeat }: { view: NonNullable<ReturnType<typeof useStore.getState>["view"]>; room: NonNullable<ReturnType<typeof useStore.getState>["room"]>; mySeat: number | null }) {
  if (mySeat === null) return null;
  const mate = mySeat ^ 1;
  const p = view.players.find((x) => x.seat === mate);
  const dead = room.alive[mate] === 0;
  const down = p ? (p.flags & 16) !== 0 : false;
  return (
    <div className="partner" style={{ ["--c" as any]: SEAT_COLORS[mate] }}>
      <span>PARTNER · {room.names[mate] || "—"}</span>
      <div className={`pt-bar ${down ? "down" : ""}`}>
        <i style={{ width: dead ? "0%" : `${down ? 100 : p?.hp ?? 0}%` }} />
      </div>
      <em>{dead ? "OUT" : down ? "DOWN · go revive" : `${p?.hp ?? "?"} HP`}</em>
    </div>
  );
}
