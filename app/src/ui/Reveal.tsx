import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../game/store";
import type { Session } from "../game/session";
import { ReplayScene, type ReplayCtl } from "../scene/ReplayScene";
import { SEAT_COLORS } from "../scene/Avatar";
import { roomPda, worldPda, recPda } from "../chain/client";
import { explorerAddr, roomLink } from "../config";
import { audio } from "../game/audio";
import { go } from "../App";
import { verifyMatch } from "../game/verify";
import { connectWallet } from "../game/wallet";
import { client } from "../game/identity";

const EMPTY = "11111111111111111111111111111111";

export function Reveal({ session }: { session: Session }) {
  const room = useStore((s) => s.room)!;
  const reveal = useStore((s) => s.reveal);
  const mySeat = useStore((s) => s.mySeat);
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
  const pov = mySeat ?? (room.winner !== 255 ? room.winner : 0);

  const highlight = useMemo(() => {
    if (!rec) return 0;
    // the moment the POV died, else the last frame
    for (let f = 1; f < rec.frames; f++) if (rec.data[f - 1][pov].alive && !rec.data[f][pov].alive) return f;
    return rec.frames - 1;
  }, [rec, pov]);

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

  // auto "lights on" at the highlight the first time through
  const fired = useRef(false);
  const [card, setCard] = useState(false);
  const [tab, setTab] = useState<"results" | "verify">("results");
  useEffect(() => {
    if (!fired.current && rec && t >= highlight - 2) {
      fired.current = true;
      toggleLights(true);
      // the verdict lands a beat after the lights
      setTimeout(() => setCard(true), 2600);
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
    const stream = out.captureStream(30);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
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
      g.font = "600 18px 'JetBrains Mono', monospace";
      g.fillStyle = "rgba(255,255,255,0.75)";
      g.textAlign = "right";
      g.fillText("BLACKOUT · sealed in a MagicBlock TEE", out.width - 28, 40);
      g.textAlign = "left";
      setRecording(Math.ceil((DUR - el) / 1000));
      if (el < DUR) raf = requestAnimationFrame(paint);
      else mr.stop();
    };
    mr.onstop = () => {
      cancelAnimationFrame(raf);
      setRecording(null);
      const blob = new Blob(chunks, { type: "video/webm" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `blackout-room${room.roomId}-match${room.matchNo}.webm`;
      a.click();
      toast("Clip saved — post it on X 🔦", true);
    };
    mr.start(250);
    paint();
  };

  const [askClose, setAskClose] = useState(false);
  const iHost = mySeat !== null && room.host.equals(client.publicKey);
  const closeRoom = async () => {
    setBusy(true);
    try {
      if (mySeat !== null) await session.closeFromReveal(mySeat, iHost);
    } finally {
      setBusy(false);
      go("/");
    }
  };

  const playAgain = async () => {
    setBusy(true);
    try {
      await session.reset();
    } catch (e: any) {
      toast(String(e?.message ?? e).slice(0, 120));
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
        <ReplayScene rec={rec} room={room} world={world} me={pov} ctl={ctl} onTime={setT} follow={follow} />
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
            {mySeat === null ? (
              <h1>{winnerName} survived the night</h1>
            ) : room.winner === mySeat ? (
              <h1 className="win">YOU SURVIVED THE NIGHT</h1>
            ) : (
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
          <span className={`lights-badge ${lights ? "on" : ""}`}>{lights ? "LIGHTS ON" : mySeat !== null ? "YOUR VIEW" : `${room.names[pov]}'S VIEW`}</span>
          <h2>{room.winner === mySeat ? "👑 YOU WON" : `👑 ${winnerName} WINS`}</h2>
        </div>
        <div className="reveal-actions">
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
                {room.isBot[s] ? <em> bot</em> : null}
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
                  toast(String(e?.message ?? e).slice(0, 120));
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
