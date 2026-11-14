import { botStyle, ST_REVEALED } from "../chain/layout";
import { friendlyError } from "../game/errors";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../game/store";
import { reclaimTickets, type Session } from "../game/session";
import { lazy, Suspense } from "react";
import type { ReplayCtl } from "../scene/ReplayScene";
const ReplayScene = lazy(() => import("../scene/ReplayScene").then((m) => ({ default: m.ReplayScene })));
import { SEAT_COLORS } from "../game/colors";
import { roomPda, worldPda, recPda } from "../chain/client";
import { explorerAddr, roomLink } from "../config";
import { audio } from "../game/audio";
import { go } from "../App";
import { verifyMatch } from "../game/verify";
import { connectWallet } from "../game/wallet";
import { client } from "../game/identity";
import { recordNight } from "../game/career";

const EMPTY = "11111111111111111111111111111111";

/** The night's winner, on top of the results card: a trophy that drops in with rays and gold
 *  confetti for you, a smaller one naming the winner for everyone else. */
function WinnerTrophy({ mine, name, winnings }: { mine: boolean; name: string; winnings: number }) {
  return (
    <div className={`vc-trophy ${mine ? "mine" : ""}`}>
      {mine && <div className="vt-rays" />}
      {mine && (
        <div className="vt-confetti" aria-hidden>
          {Array.from({ length: 28 }, (_, i) => (
            <i key={i} style={{ ["--x" as string]: `${Math.cos((i / 28) * Math.PI * 2) * (130 + (i % 3) * 40)}px`, ["--y" as string]: `${Math.sin((i / 28) * Math.PI * 2) * (90 + (i % 4) * 25) - 40}px`, ["--r" as string]: `${i * 47}deg`, animationDelay: `${0.35 + (i % 5) * 0.03}s` }} />
          ))}
        </div>
      )}
      <svg className="vt-cup" viewBox="0 0 100 110" aria-hidden>
        <defs>
          <linearGradient id="vtGold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff1b8" />
            <stop offset="0.45" stopColor="#ffd166" />
            <stop offset="1" stopColor="#c48a17" />
          </linearGradient>
        </defs>
        <path d="M27 8 H73 V40 Q73 66 50 70 Q27 66 27 40 Z" fill="url(#vtGold)" stroke="#8a5f12" strokeWidth="2.5" />
        <path d="M27 16 Q10 16 12 31 Q14 44 29 47" fill="none" stroke="url(#vtGold)" strokeWidth="5" strokeLinecap="round" />
        <path d="M73 16 Q90 16 88 31 Q86 44 71 47" fill="none" stroke="url(#vtGold)" strokeWidth="5" strokeLinecap="round" />
        <rect x="44" y="70" width="12" height="14" fill="#c9971f" />
        <rect x="31" y="84" width="38" height="13" rx="3" fill="#2f3446" stroke="#8a5f12" strokeWidth="1.5" />
        <path d="M50 22 l4 8.5 9.3 1.2 -6.8 6.4 1.7 9.2 -8.2 -4.5 -8.2 4.5 1.7 -9.2 -6.8 -6.4 9.3 -1.2z" fill="#fff6d6" opacity="0.9" />
        <path className="vt-shine" d="M33 12 Q36 40 46 62" fill="none" stroke="#fffbe8" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
      </svg>
      <div className="vt-text">
        <b>{mine ? "YOU WON" : `${name} WINS`}</b>
        <span>{mine ? "Last one standing" : "last one standing"}</span>
        {winnings > 0 && <em>{mine ? `+${winnings.toFixed(3)} SOL · sent to your wallet` : `takes ${winnings.toFixed(3)} SOL`}</em>}
      </div>
    </div>
  );
}

export function Reveal({ session, onDone }: { session: Session; onDone: () => void }) {
  // the room may reopen for the next night while you watch: keep showing the night you played
  const liveRoom = useStore((s) => s.room)!;
  const liveSeat = useStore((s) => s.mySeat);
  const snap = useRef({ room: liveRoom, seat: liveSeat });
  if (liveRoom.status === ST_REVEALED) snap.current = { room: liveRoom, seat: liveSeat };
  const room = snap.current.room;
  const mySeat = snap.current.seat;
  const reopened = liveRoom.status !== ST_REVEALED;
  const reveal = useStore((s) => s.reveal);
  const [reopenIn, setReopenIn] = useState<number | null>(null);
  useEffect(() => {
    const k = window.setInterval(() => setReopenIn(session.reopenIn()), 500);
    return () => clearInterval(k);
  }, [session]);
  const toast = useStore((s) => s.toast);
  const ctl = useRef<ReplayCtl>({ t: 0, playing: false, speed: 1, lights: 0, lightsTarget: 0, follow: true });
  const [t, setT] = useState(0);
  const [lights, setLights] = useState(false);
  const [follow, setFollow] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const rec = reveal?.rec ?? null;
  const wallet = useStore((st) => st.wallet);
  const [linking, setLinking] = useState<"idle" | "busy" | "done">("idle");
  const world = reveal?.world ?? null;
  // Which seat to tell the story from: you, or the winner if you were spectating
  const basePov = mySeat ?? (room.winner !== 255 ? room.winner : 0);
  // kill cam: replay your last seconds through your killer's eyes
  const [camSeat, setCamSeat] = useState<number | null>(null);
  const pov = camSeat ?? basePov;
  // your service record (Operator page): this night counted once, on this device
  useEffect(() => {
    if (mySeat !== null) recordNight(room, mySeat);
  }, [room.roomId, room.matchNo, mySeat]);

  const highlight = useMemo(() => {
    if (!rec) return 0;
    // the moment the POV died, else the last frame
    for (let f = 1; f < rec.frames; f++) if (rec.data[f - 1][basePov].alive && !rec.data[f][basePov].alive) return f;
    return rec.frames - 1;
  }, [rec, basePov]);

  const killCamFrom = (() => {
    if (mySeat === null) return null;
    const d = room.feed.slice(0, Math.min(16, room.feedHead)).find((f) => f.victim === mySeat);
    return d && d.killer !== 255 && d.killer !== mySeat ? d.killer : null;
  })();
  const startKillCam = () => {
    if (!rec || killCamFrom === null) return;
    setCard(false);
    setCamSeat(killCamFrom);
    setLights(false);
    ctl.current.lightsTarget = 0;
    ctl.current.follow = true;
    setFollow(true);
    ctl.current.t = Math.max(0, highlight - Math.round(100 / rec.every));
    ctl.current.speed = 0.5;
    ctl.current.playing = true;
    setPlaying(true);
  };

  useEffect(() => {
    if (!rec) return;
    // open on the dramatic beat: a few seconds before the highlight, in the dark
    ctl.current.t = Math.max(0, highlight - 60);
    ctl.current.playing = true;
    setPlaying(true);
  }, [rec, highlight]);

  const toggleLights = (on?: boolean) => {
    const next = on ?? !lights;
    setLights(next);
    ctl.current.lightsTarget = next ? 1 : 0;
    if (next) audio.lightsOn();
  };

  // a staked night: once it settles (a few seconds after the lights), the tickets it didn't use
  // (a called-off night) and every ticket's rent go back to their wallets without anyone asking
  useEffect(() => {
    if (room.stake === 0n) return;
    const ks = [12_000, 45_000].map((ms) => window.setTimeout(() => void reclaimTickets(), ms));
    return () => ks.forEach(clearTimeout);
  }, [room.roomId, room.matchNo, room.stake]);

  // auto "lights on" at the highlight the first time through
  const fired = useRef(false);
  const [card, setCard] = useState(false);
  const [tab, setTab] = useState<"results" | "verify">("results");
  useEffect(() => {
    if (!fired.current && rec && t >= highlight - 2) {
      fired.current = true;
      toggleLights(true);
      // the verdict lands well after the lights: let the last moments play first
      setTimeout(() => setCard(true), 5000);
    }
  }, [t, highlight, rec]);
  // no recording yet (very short match): still show the verdict
  useEffect(() => {
    const k = setTimeout(() => !fired.current && setCard(true), 9000);
    return () => clearTimeout(k);
  }, []);

  const makeClip = async () => {
    const canvas = document.querySelector<HTMLCanvasElement>(".reveal canvas");
    if (!canvas || !rec || !("MediaRecorder" in window)) {
      toast("Clip recording isn't supported in this browser");
      return;
    }
    // compose canvas + caption into a 1280x720 frame
    const out = document.createElement("canvas");
    out.width = 1280;
    out.height = 720;
    const g = out.getContext("2d")!;
    // Chrome and Firefox record WebM; Safari (every iPhone) only MP4. Asking for a type the browser
    // can't record throws, which used to leave the button doing nothing on iPhones.
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4;codecs=avc1", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime || typeof out.captureStream !== "function") {
      toast("Clip recording isn't supported in this browser");
      return;
    }
    const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
    const type = mime.split(";")[0];
    const stream = out.captureStream(30);
    const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    fired.current = true;
    toggleLights(false);
    setFollow(true);
    ctl.current.follow = true;
    ctl.current.t = Math.max(0, highlight - 50);
    ctl.current.speed = 1;
    ctl.current.playing = true;
    setPlaying(true);
    // the night's full VRF seed is burned into every frame: anyone watching the clip can check it
    // against this night's replay (How it works → verify), so a win can't be faked with an edit
    const fullSeed = world ? Array.from(world.seed).map((b) => b.toString(16).padStart(2, "0")).join("") : "";
    const start = performance.now();
    const DUR = 11000;
    let flipped = false;
    let raf = 0;
    const paint = () => {
      const el = performance.now() - start;
      if (!flipped && el > 4800) {
        flipped = true;
        toggleLights(true);
      }
      const s = Math.max(out.width / canvas.width, out.height / canvas.height);
      const w = canvas.width * s;
      const h = canvas.height * s;
      g.fillStyle = "#000";
      g.fillRect(0, 0, out.width, out.height);
      g.drawImage(canvas, (out.width - w) / 2, (out.height - h) / 2, w, h);
      g.fillStyle = "rgba(0,0,0,0.45)";
      g.fillRect(0, 0, out.width, 64);
      g.font = "700 30px 'Chakra Petch', sans-serif";
      g.fillStyle = flipped ? "#ffd166" : "#9fb4ff";
      g.fillText(flipped ? "LIGHTS ON — where everyone really was" : "WHAT I COULD SEE", 28, 42);
      if (fullSeed) {
        g.font = "600 13px 'JetBrains Mono', monospace";
        g.fillStyle = "#ffd166";
        g.textAlign = "right";
        g.fillText(`VRF SEED ${fullSeed}`, out.width - 24, 38);
        g.textAlign = "left";
      }
      setRecording(Math.ceil((DUR - el) / 1000));
      if (el < DUR) raf = requestAnimationFrame(paint);
      else mr.stop();
    };
    mr.onstop = () => {
      cancelAnimationFrame(raf);
      setRecording(null);
      const blob = new Blob(chunks, { type });
      const name = `blackout-room${room.roomId}-match${room.matchNo}.${ext}`;
      const won = mySeat !== null && room.winner === mySeat;
      const text = `${won ? "Won a night" : "Lost a night"} in BLACKOUT, the battle royale where nobody can see you, not even the chain. Lights on 🔦 @magicblock`;
      const url = location.origin;
      const file = new File([blob], name, { type });
      // phones: straight into the share sheet with the clip attached
      if (navigator.canShare?.({ files: [file] })) {
        navigator.share({ files: [file], text: `${text} ${url}` }).catch(() => {});
        return;
      }
      // desktop: save the clip and open a ready post on X to attach it to
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank", "noopener");
      toast("Clip saved: drop it into the post that just opened 🔦", true);
    };
    mr.start(250);
    paint();
  };

  const [askClose, setAskClose] = useState(false);
  const iHost = mySeat !== null && room.host.equals(client.publicKey);
  const closeRoom = async () => {
    setBusy(true);
    try {
      if (liveSeat !== null) await session.closeFromReveal(liveSeat, iHost);
    } finally {
      setBusy(false);
      go("/");
    }
  };

  const playAgain = async () => {
    if (reopened) return onDone();
    setBusy(true);
    try {
      await session.reset();
      onDone();
    } catch (e: any) {
      // it may have just reopened on its own: that's what PLAY AGAIN wanted anyway
      if (useStore.getState().room?.status === ST_REVEALED) toast(friendlyError(e));
      else onDone();
    } finally {
      setBusy(false);
    }
  };

  const verified = useMemo(() => {
    if (!world || !rec) return null;
    const occupied = Array.from({ length: 8 }, (_, s) => room.isBot[s] === 1 || room.players[s].toBase58() !== EMPTY);
    try {
      return verifyMatch(room, world, rec, occupied);
    } catch {
      return null;
    }
  }, [world, rec, room]);
  const order = Array.from({ length: 8 }, (_, i) => i)
    .filter((i) => room.place[i] > 0)
    .sort((a, b) => room.place[a] - room.place[b]);
  const winnerName = room.winner !== 255 ? room.names[room.winner] : "nobody";
  // a staked night's winner is paid the pot less the house fee (config.rs FEE_BPS = 10%)
  const stakers = room.players.filter((p, i) => room.isBot[i] === 0 && p.toBase58() !== EMPTY).length;
  const winnings = room.stake > 0n ? (Number(room.stake) * stakers * 0.9) / 1e9 : 0;
  // dev server only: localStorage "bo-preview-win" shows the winner's view of the card (stripped from the live build)
  const previewWin = import.meta.env.DEV && (() => { try { return localStorage.getItem("bo-preview-win") === "1"; } catch { return false; } })();
  const seed = world ? Array.from(world.seed.slice(0, 16)).map((b) => b.toString(16).padStart(2, "0")).join("") : "";
  const myPlace = mySeat !== null ? room.place[mySeat] : 0;
  const myDeath = mySeat !== null ? room.feed.slice(0, Math.min(16, room.feedHead)).find((f) => f.victim === mySeat) ?? null : null;
  const survivedTicks = myDeath ? myDeath.tick - 60 : room.endTick - 60;
  const mySurvived = `${Math.floor(Math.max(0, survivedTicks) / 20 / 60)}:${String(Math.floor((Math.max(0, survivedTicks) / 20) % 60)).padStart(2, "0")}`;
  const shareText =
    mySeat !== null
      ? myPlace === 1
        ? `I won a round of BLACKOUT — a battle royale where nobody can see you, not even the chain. Every position sealed in a @magicblock TEE until the lights came on. 🔦`
        : `Got #${myPlace} in BLACKOUT. I never saw them coming — literally. Every position sealed in a @magicblock TEE until the lights came on. 🔦`
      : `Watched a BLACKOUT match: a battle royale where every position is sealed in a @magicblock TEE until the lights come on. 🔦`;

  return (
    <div className="reveal">
      {rec ? (
        <Suspense fallback={null}>
          <ReplayScene rec={rec} room={room} world={world} me={pov} ctl={ctl} onTime={setT} follow={follow} />
        </Suspense>
      ) : (
        <div className="center-screen">
          <div className="spinner" />
          <h2>Turning the lights on…</h2>
          <p>flipping the World + recorder permissions to public</p>
        </div>
      )}

      {card && (
        <div className="verdict" onClick={() => setCard(false)}>
          <div className="verdict-card" onClick={(e) => e.stopPropagation()}>
            <div className="vc-kicker">NIGHT {room.matchNo} · ROOM {room.roomId.toString()}</div>
            {room.winner !== 255 && <WinnerTrophy mine={room.winner === mySeat || previewWin} name={winnerName} winnings={winnings} />}
            {room.stake > 0n && room.winner === 255 && room.place.every((p) => p === 0) ? (
              // the rollup stalled too long to settle safely: the program called the night off
              <h1>Night called off · every ticket carries to your next night</h1>
            ) : mySeat === null || room.winner === mySeat || previewWin ? null : (
              <h1>
                #{myPlace} <span>of {order.length}</span>
              </h1>
            )}
            {mySeat !== null && room.winner !== mySeat && myDeath && (
              <p className="vc-killer">
                {myDeath.killer === 255 ? (
                  "the zone closed in on you"
                ) : (
                  <>
                    killed by <b style={{ color: SEAT_COLORS[myDeath.killer] }}>{room.names[myDeath.killer]}</b>
                  </>
                )}
              </p>
            )}
            <div className="vc-stats">
              <div>
                <b>{mySeat !== null ? room.kills[mySeat] : room.kills[room.winner] ?? 0}</b>
                <span>kills</span>
              </div>
              <div>
                <b>{mySurvived}</b>
                <span>survived</span>
              </div>
              <div>
                <b>{winnerName}</b>
                <span>last one standing</span>
              </div>
            </div>
            {reopened ? (
              <p className="vc-reopened">The room is open again for the next night. This replay stays here until you leave it.</p>
            ) : (
              reopenIn !== null && (
                <p className="vc-reopened">
                  Room reopens for the next night in <b className="vc-timer">{reopenIn}s</b>. Your replay stays on screen.
                </p>
              )
            )}
            <div className="vc-actions">
              <button className="btn primary huge" onClick={playAgain} disabled={busy}>
                {busy ? "RESEALING THE YARD…" : "PLAY AGAIN"}
              </button>
              {mySeat !== null && (
                <a className="vc-close" onClick={() => setAskClose(true)}>
                  {iHost ? "done for tonight? close the room" : "done for tonight? leave the room"}
                </a>
              )}
              <div className="row">
                <button className="btn" onClick={() => setCard(false)}>
                  WATCH THE REPLAY
                </button>
                {killCamFrom !== null && (
                  <button className="btn" onClick={startKillCam}>
                    ☠ KILL CAM
                  </button>
                )}
                <button
                  className="btn"
                  onClick={() => {
                    setCard(false);
                    setTimeout(makeClip, 300);
                  }}
                >
                  🎬 MAKE CLIP
                </button>
                <a className="btn x" target="_blank" rel="noreferrer" href={`https://x.com/intent/post?text=${encodeURIComponent(`${shareText}\n\nPlay: ${roomLink(room.roomId)}`)}`}>
                  POST ON X
                </a>
              </div>
            </div>
            <small>The lights are on: every position from this match is now public and verifiable.</small>
          </div>
        </div>
      )}
      {askClose && (
        <div className="room-closed" onClick={() => setAskClose(false)}>
          <div className="room-closed-card" onClick={(e) => e.stopPropagation()}>
            <div className="vc-kicker">{iHost ? "CLOSE ROOM" : "LEAVE ROOM"}</div>
            <h2>{iHost ? "Close this room?" : "Leave this room?"}</h2>
            <p>
              {iHost
                ? "You're the host. Everyone is sent back to the gate and the room frees up. The replay stays verifiable on-chain until the room is used again."
                : "You give up your seat and go back to the gate. The others can keep playing."}
            </p>
            <div className="row center">
              <button className="btn" onClick={() => setAskClose(false)}>
                STAY
              </button>
              <button className="btn danger" onClick={closeRoom} disabled={busy}>
                {busy ? "CLOSING…" : iHost ? "CLOSE ROOM" : "LEAVE"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="reveal-top">
        <a className="back" onClick={() => go("/")}>
          ← BLACKOUT
        </a>
        <div className="reveal-title">
          <span className={`lights-badge ${lights ? "on" : ""}`}>
            {camSeat !== null ? `KILL CAM · ${room.names[camSeat]}'S VIEW` : lights ? "LIGHTS ON" : mySeat !== null ? "YOUR VIEW" : `${room.names[pov]}'S VIEW`}
          </span>
          {camSeat !== null && (
            <button className="btn small" style={{ pointerEvents: "auto", marginTop: 6 }} onClick={() => { setCamSeat(null); ctl.current.speed = 1; }}>
              BACK TO YOUR VIEW
            </button>
          )}
          <h2>{room.winner === mySeat ? "👑 YOU WON" : `👑 ${winnerName} WINS`}</h2>
        </div>
        <div className="reveal-actions">
          <span className="ra-reopen">{reopened ? "room open again" : reopenIn !== null ? <>room reopens in <b className="vc-timer">{reopenIn}s</b></> : null}</span>
          {mySeat !== null && (
            <button className="btn ghost-danger" onClick={() => setAskClose(true)} disabled={busy}>
              {iHost ? "CLOSE ROOM" : "LEAVE ROOM"}
            </button>
          )}
          <button className="btn primary" onClick={playAgain} disabled={busy}>
            {busy ? "RESEALING…" : "PLAY AGAIN"}
          </button>
        </div>
      </div>

      {rec && (
        <div className="replay-bar">
          <button
            className="btn icon"
            onClick={() => {
              ctl.current.playing = !ctl.current.playing;
              if (ctl.current.t >= rec.frames - 1) ctl.current.t = 0;
              setPlaying(ctl.current.playing);
            }}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <div className="scrub">
            <input
              type="range"
              min={0}
              max={rec.frames - 1}
              step={0.1}
              value={t}
              onChange={(e) => {
                ctl.current.t = Number(e.target.value);
                setT(ctl.current.t);
              }}
            />
            <div className="marks">
              {room.feed.slice(0, Math.min(16, room.feedHead)).map((f, i) => (
                <i key={i} title={`${room.names[f.killer] ?? "ZONE"} ✕ ${room.names[f.victim]}`} style={{ left: `${((Math.max(0, f.tick - 60) / rec.every) / (rec.frames - 1)) * 100}%`, background: SEAT_COLORS[f.victim] }} />
              ))}
            </div>
          </div>
          <span className="time">
            {Math.floor((t * rec.every / 20) / 60)}:{String(Math.floor((t * rec.every / 20) % 60)).padStart(2, "0")}
          </span>
          {[1, 2, 4].map((s) => (
            <button key={s} className={`chip ${ctl.current.speed === s ? "on" : ""}`} onClick={() => (ctl.current.speed = s)}>
              {s}×
            </button>
          ))}
          <button className={`btn lights ${lights ? "on" : ""}`} onClick={() => toggleLights()}>
            {lights ? "🌑 LIGHTS OFF" : "💡 LIGHTS ON"}
          </button>
          <button
            className={`chip ${follow ? "on" : ""}`}
            onClick={() => {
              setFollow(!follow);
              ctl.current.follow = !follow;
            }}
          >
            FOLLOW
          </button>
          <button className="btn primary" onClick={makeClip} disabled={recording !== null}>
            {recording !== null ? `● REC ${recording}s` : "🎬 MAKE CLIP"}
          </button>
        </div>
      )}

      <div className="reveal-side">
        <div className="tabs">
          <button className={tab === "results" ? "on" : ""} onClick={() => setTab("results")}>RESULTS</button>
          <button className={tab === "verify" ? "on" : ""} onClick={() => setTab("verify")}>VERIFY</button>
        </div>
        {tab === "results" ? (
          <>
        <div className="panel">
          <label>RESULTS</label>
          {order.map((s) => (
            <div key={s} className={`result ${s === mySeat ? "me" : ""}`} style={{ ["--c" as any]: SEAT_COLORS[s] }}>
              <span className="pl">#{room.place[s]}</span>
              <span className="nm">
                {room.names[s]}
                {room.isBot[s] ? <em> bot{botStyle(room.matchNo, s) ? ` · ${botStyle(room.matchNo, s).toLowerCase()}` : ""}</em> : null}
              </span>
              <span className="kl">{room.kills[s]} ☠</span>
            </div>
          ))}
        </div>
        {mySeat !== null && !wallet && linking !== "done" && (
          <div className="panel nudge">
            <label>{room.winner === mySeat ? "THIS WIN WASN'T SAVED" : "PLAYING AS A GUEST"}</label>
            <div>You played as a guest, so this night wasn't saved and you're not on the leaderboard. Connect a wallet to keep your callsign and stats from the next night on.</div>
            <button
              className="btn primary wide"
              disabled={linking === "busy"}
              onClick={async () => {
                setLinking("busy");
                try {
                  await connectWallet();
                  setLinking("done");
                  toast("Wallet connected — your next nights will be saved", true);
                } catch (e: any) {
                  setLinking("idle");
                  toast(friendlyError(e));
                }
              }}
            >
              {linking === "busy" ? "SAVING…" : "CONNECT WALLET"}
            </button>
          </div>
        )}
          </>
        ) : (
          <>
        <div className="panel verify">
          <label>VERIFY</label>
          <div>
            Seed <code>{seed ? `${seed.slice(0, 16)}…` : "…"}</code> {room.seedRevealed === 2 ? <em>(fallback)</em> : <b>MagicBlock VRF</b>}
          </div>
          <div>
            World <a href={explorerAddr(worldPda(room.roomId).toBase58())} target="_blank" rel="noreferrer">sealed → public</a> at the final kill
          </div>
          {verified && (
            <div className="checks">
              Re-derived from the seed in your browser:{" "}
              <span className={verified.spawns ? "ok" : "bad"}>spawns {verified.spawns ? "✓" : "✗"}</span>{" "}
              <span className={verified.loot ? "ok" : "bad"}>loot {verified.loot ? "✓" : "✗"}</span>{" "}
              <span className={verified.zone ? "ok" : "bad"}>zone {verified.zone ? "✓" : "✗"}</span>
            </div>
          )}
          <div>
            Recorder {rec?.frames ?? 0} frames · <code>{recPda(room.roomId, 0).toBase58().slice(0, 6)}…</code>
          </div>
          <div>
            Settlement: room committed to Solana + Magic Action ·{" "}
            <a href={explorerAddr(roomPda(room.roomId).toBase58())} target="_blank" rel="noreferrer">
              explorer ↗
            </a>
          </div>
          <a className="btn x wide" target="_blank" rel="noreferrer" href={`https://x.com/intent/post?text=${encodeURIComponent(`${shareText}\n\nPlay: ${roomLink(room.roomId)}`)}`}>
            POST ON X
          </a>
        </div>
          </>
        )}
      </div>
      {room.players.every((p, i) => p.toBase58() === EMPTY || room.isBot[i]) && null}
    </div>
  );
}
