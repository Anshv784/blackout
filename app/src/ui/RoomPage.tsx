import { MapPicker } from "./MapPicker";
import { friendlyError } from "../game/errors";
import { EmoteWheel } from "./EmoteWheel";
import { EMOTES, useLook } from "../game/look";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { Session, stakedStartAt, stakersSeated } from "../game/session";
import { useStore } from "../game/store";
import { client } from "../game/identity";
import { ST_LOBBY, ST_STARTING, ST_COUNTDOWN, ST_LIVE, ST_ENDED, ST_REVEALED, STATUS_NAME, BOT_LEVEL_NAME, lobbyDeadline, type Room } from "../chain/layout";
import { Hud } from "./Hud";
import { Reveal } from "./Reveal";
import { TouchControls, useTouch } from "./TouchControls";
import { LagCheck } from "./LagCheck";
import { fullscreenOnTouch } from "./Fullscreen";
import { controls } from "../game/controls";
import { ChainPanel } from "./ChainPanel";
import { Crosshair } from "./Crosshair";
import { roomLink } from "../config";
import { go } from "../App";
import { audio } from "../game/audio";
import { connectWallet, requireRealWallet, requireWallet } from "../game/wallet";
import { codeToText, newCode, seatElsewhere, sweepRooms, textToCode } from "../game/rooms";
import { AlreadyInRoom } from "./AlreadyInRoom";
import { TopBar } from "./TopBar";
import type { SeatInfo } from "../scene/LobbyStage";

const GameScene = lazy(() => import("../scene/GameScene").then((m) => ({ default: m.GameScene })));
const LobbyStage = lazy(() => import("../scene/LobbyStage").then((m) => ({ default: m.LobbyStage })));
const Backdrop = lazy(() => import("../scene/Backdrop").then((m) => ({ default: m.Backdrop })));

const EMPTY = "11111111111111111111111111111111";
const flags = () => new URLSearchParams(window.location.hash.split("?")[1] ?? "");

export function RoomPage({ roomId }: { roomId: bigint }) {
  const touch = useTouch();
  const session = useMemo(() => new Session(roomId), [roomId]);
  const room = useStore((s) => s.room);
  const mySeat = useStore((s) => s.mySeat);
  const [err, setErr] = useState<string | null>(null);
  // the end of a night gets its moment: after a night you played, the game view stays up a few
  // seconds after the room flips to the reveal (longer if you won) before the replay takes over
  const sawLive = useRef(false);
  const endedAt = useRef<number | null>(null);
  const [, rerender] = useState(0);
  // per night: PLAY AGAIN puts the same room back in the lobby, and the next night gets its own moment
  if (room?.status === ST_LIVE) sawLive.current = true;
  else if (room?.status === ST_LOBBY) sawLive.current = false;
  const over = !!room && (room.status === ST_ENDED || room.status === ST_REVEALED);
  if (!over) endedAt.current = null;
  else if (endedAt.current === null) endedAt.current = performance.now();
  const lingerFor = room && mySeat !== null && room.winner === mySeat ? 6000 : 4000;
  // only for a seat at the table (someone just watching goes straight to the reveal)
  const linger =
    !!room && mySeat !== null && room.status === ST_REVEALED && sawLive.current && endedAt.current !== null && performance.now() - endedAt.current < lingerFor;
  useEffect(() => {
    if (!linger) return;
    const k = window.setTimeout(() => rerender((x) => x + 1), 400);
    return () => clearTimeout(k);
  });

  // once you're watching a replay it stays on your screen after the room reopens for the next night,
  // until you leave it or the next night starts
  const holding = useRef(false);
  if (room?.status === ST_REVEALED && !linger) holding.current = true;
  else if (room && room.status !== ST_LOBBY && room.status !== ST_REVEALED) holding.current = false;

  useEffect(() => {
    useStore.getState().set({ room: null, view: null, mySeat: null, reveal: null });
    session.start().catch((e) => setErr(friendlyError(e)));
    // test handles for scripts/ui (dev server only, never in the live build)
    if (import.meta.env.DEV) Object.assign(window as any, { __session: session, __controls: controls, __store: useStore, __look: useLook });
    const bye = () => {
      // walking away from a lobby frees your seat (and the room, if you were alone)
      if (session.room?.status === ST_LOBBY && session.mySeat !== null) session.leave().catch(() => {});
    };
    window.addEventListener("pagehide", bye);
    return () => {
      window.removeEventListener("pagehide", bye);
      bye();
      session.stop();
    };
  }, [session]);

  if (err) return <Center title="The Warden isn't answering" sub={err} />;
  if (!room) return <Center title="Opening the gate…" sub="authenticating with the Warden (MagicBlock TEE)" spinner />;

  const playing = mySeat !== null && ([ST_STARTING, ST_COUNTDOWN, ST_LIVE, ST_ENDED].includes(room.status) || linger);
  if ((room.status === ST_REVEALED && !linger) || (holding.current && room.status === ST_LOBBY))
    return (
      <Reveal
        session={session}
        onDone={() => {
          holding.current = false;
          rerender((x) => x + 1);
        }}
      />
    );
  if (playing)
    return (
      <div className={`game ${touch ? "touch" : ""}`}>
        <Suspense fallback={null}>
          <GameScene session={session} />
        </Suspense>
        <Hud session={session} />
        <TouchControls session={session} />
        {touch && (
          <div className="rotate-hint">
            <svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M20 9a8 8 0 0 1 0 6M4 9a8 8 0 0 0 0 6" /></svg>
            <b>TURN YOUR PHONE</b>
            <small>the night plays sideways</small>
          </div>
        )}
        <ChainPanel session={session} />
        <LagCheck session={session} />
        <Crosshair />
      </div>
    );
  if (room.status !== ST_LOBBY) return <Spectate room={room} />;
  return <Lobby session={session} room={room} />;
}

/** A free lobby can't wait forever: a public one starts itself with bots, a private one closes. */
function LobbyClock({ room }: { room: Room }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const k = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(k);
  }, []);
  const limit = lobbyDeadline(room);
  if (limit === null) return null;
  const left = Math.max(0, Math.ceil(limit - Date.now() / 1000));
  const t = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <div className={`lobby-clock ${left <= 30 ? "soon" : ""}`}>
      {room.unlisted ? (
        left > 0 ? (
          <>room closes in <b>{t}</b> unless the night starts</>
        ) : (
          "closing the room…"
        )
      ) : left > 0 ? (
        <>night starts by itself in <b>{t}</b> · bots fill the empty seats</>
      ) : (
        "starting the night…"
      )}
    </div>
  );
}

function Center({ title, sub, spinner }: { title: string; sub?: string; spinner?: boolean }) {
  return (
    <div className="center-screen">
      {spinner && <div className="warden-loader" />}
      <h2>{title}</h2>
      {sub && <p>{sub}</p>}
      <a className="back" onClick={() => go("/")}>
        ← back to the gate
      </a>
    </div>
  );
}

function Spectate({ room }: { room: Room }) {
  // a finished night nobody called finish on: do it, so the lights come on for everyone
  useEffect(() => {
    if (room.status === ST_ENDED) sweepRooms({ [Number(room.roomId)]: room }, 0);
  }, [room.status]);
  return (
    <div className="gate">
      <Suspense fallback={<div className="backdrop" />}>
        <Backdrop focus="lobby" />
      </Suspense>
      <div className="gate-shade" />
      <TopBar />
      <div className="spectate-card">
        <div className="kicker">
          <span className="dot red" /> ROOM {room.roomId.toString()} · NIGHT {room.matchNo} · {STATUS_NAME[room.status]}
        </div>
        <h2>The match is sealed.</h2>
        <p>
          <b>{room.aliveCount}</b> still alive. Spectators see nothing — every position lives in a TEE account with zero readers. The moment the last one falls, the lights come
          on and the full replay unlocks right here.
        </p>
        <div className="row">
          <button className="btn" onClick={() => go("/")}>
            BACK TO THE GATE
          </button>
        </div>
      </div>
    </div>
  );
}

function Lobby({ session, room }: { session: Session; room: Room }) {
  const name = useStore((s) => s.name);
  const toast = useStore((s) => s.toast);
  const mySeat = useStore((s) => s.mySeat);
  const wallet = useStore((s) => s.wallet);
  const [busy, setBusy] = useState<string | null>(null);
  const startAsk = useStore((s) => s.startAsk);
  const [askedAt, setAskedAt] = useState(0);
  const [, setNow] = useState(0);
  useEffect(() => {
    // the "asked" states fade after 15 s
    if (!startAsk && !askedAt) return;
    const k = window.setTimeout(() => setNow(Date.now()), 15100);
    return () => clearTimeout(k);
  }, [startAsk, askedAt]);
  const [fill, setFill] = useState(6);
  const [copied, setCopied] = useState(false);
  const quick = useRef(flags().get("quick") === "1");
  const invite = flags().get("invite") === "1";
  const urlCode = textToCode(flags().get("code") ?? "");
  const autoDone = useRef(false);

  // mirror the on-chain host rule: a host who stopped heart-beating is replaced by the first live seat
  const nowSlot = Math.max(...room.lastSeen);
  const fresh = (i: number) => room.players[i].toBase58() !== EMPTY && room.isBot[i] === 0 && nowSlot - room.lastSeen[i] <= 4500;
  // the host is the room's creator; no hand-offs — if they're gone the room is closed
  const hostIdx = room.players.findIndex((p, i) => room.isBot[i] === 0 && room.host.toBase58() !== EMPTY && p.equals(room.host));
  const hostPresent = hostIdx >= 0 && fresh(hostIdx);
  const effectiveHost = hostPresent ? hostIdx : -1;
  // a staked table has no host (it starts itself): only free rooms have someone in charge
  const canStart = mySeat !== null && room.stake === 0n && hostIdx === mySeat;
  const closed = !hostPresent && room.stake === 0n && !canStart && !busy;
  // only people still here count (stale seats are cleared on-chain when the night starts)
  const humans = [0, 1, 2, 3, 4, 5, 6, 7].filter(fresh).length;
  const staked = room.stake > 0n;
  // private rooms: you need the code (from the creator's link, or typed in) to sit down
  const isPrivate = room.unlisted && room.privateCode !== 0;
  const codeText = isPrivate ? codeToText(room.privateCode) : "";
  const link = isPrivate ? `${roomLink(room.roomId)}?code=${codeText.replace("-", "")}` : roomLink(room.roomId);
  const [typed, setTyped] = useState("");
  const knownCode = textToCode(typed) ?? urlCode;
  const locked = isPrivate && mySeat === null && knownCode !== room.privateCode;
  const [askKick, setAskKick] = useState<number | null>(null);
  // one room at a time: are you seated somewhere else?
  const [other, setOther] = useState<{ id: number; room: Room } | null>(null);
  const [showOther, setShowOther] = useState(false);
  useEffect(() => {
    if (mySeat !== null) return;
    seatElsewhere(Number(room.roomId)).then((o) => {
      setOther(o);
      if (o) setShowOther(true);
    });
  }, [room.roomId, mySeat]);
  const LEVELS = BOT_LEVEL_NAME.map((n) => n.toUpperCase());
  // you were seated, the host is still here, and you didn't leave: the host removed you
  const wasIn = useRef(false);
  const leaving = useRef(false);
  const [kicked, setKicked] = useState(false);
  useEffect(() => {
    if (mySeat !== null) wasIn.current = true;
    else if (wasIn.current && !leaving.current && hostPresent) setKicked(true);
  }, [mySeat]);

  // optimistic seat count so rapid clicks build on each other instead of re-sending the same value
  const [pendingSize, setPendingSize] = useState<number | null>(null);
  useEffect(() => {
    if (pendingSize !== null && room.maxPlayers === pendingSize) setPendingSize(null);
  }, [room.maxPlayers, pendingSize]);
  const size = pendingSize ?? room.maxPlayers;
  const resize = (n: number) => {
    setPendingSize(n);
    session.setSize(n).catch((e) => {
      setPendingSize(null);
      toast(friendlyError(e));
    });
  };
  const myLook = useLook((st) => st.look);
  const setLook = useLook((st) => st.set);
  const [lobbyEmote, setLobbyEmote] = useState(0);
  // the others' lobby emotes: a seat's counter (128-255, see set_look) changing means "play it now".
  // The value already there when the page opens is ignored.
  const killsKey = room.kills.join(",");
  const seenKills = useRef<number[] | null>(null);
  const [othersEmote, setOthersEmote] = useState<number[]>(() => Array(8).fill(0));
  useEffect(() => {
    const prev = seenKills.current;
    seenKills.current = room.kills.slice();
    if (!prev) return;
    const now = performance.now();
    let changed = false;
    const next = othersEmote.slice();
    room.kills.forEach((k, s) => {
      if (s !== mySeat && k >= 128 && k !== prev[s]) {
        next[s] = now;
        changed = true;
      }
    });
    if (changed) setOthersEmote(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [killsKey]);
  const [wheel, setWheel] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key.toLowerCase() === "b" && !e.repeat) setWheel({ x: window.innerWidth / 2, y: window.innerHeight * 0.45 });
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const seats: SeatInfo[] = Array.from({ length: staked ? 8 : size }, (_, i) => {
    const taken = room.players[i].toBase58() !== EMPTY || room.isBot[i] === 1;
    return {
      name: room.names[i],
      look: i === mySeat ? myLook : room.looks[i],
      emoteAt: i === mySeat ? lobbyEmote : othersEmote[i] || undefined,
      taken,
      bot: room.isBot[i] === 1,
      me: i === mySeat,
      host: taken && i === effectiveHost,
      away: taken && room.isBot[i] === 0 && !fresh(i),
      canMakeHost: canStart && taken && room.isBot[i] === 0 && i !== mySeat && fresh(i),
      canKick: canStart && !staked && taken && room.isBot[i] === 0 && i !== mySeat,
      openHint: staked ? "stake to sit" : room.duos ? `team ${(i >> 1) + 1} · bot if empty` : undefined,
      team: room.duos ? (i >> 1) + 1 : undefined,
    };
  });

  const run = async (label: string, f: () => Promise<void>) => {
    audio.unlock();
    setBusy(label);
    try {
      await f();
    } catch (e: any) {
      toast(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const take = (seat?: number) =>
    other
      ? (setShowOther(true), Promise.resolve())
      : new Promise<void>((resolve) => (staked ? requireRealWallet : requireWallet)(() => resolve(doTake(seat))));
  const doTake = (seat?: number) =>
    run("join", async () => {
      if (staked) {
        const { provider } = await import("../game/wallet");
        const sol = provider();
        if (!sol) throw new Error("Staked tables need a Solana wallet, like Phantom. Install one and try again.");
        const pk = await connectWallet();
        await session.reclaimTickets();
        await session.buyTicket(sol);
        await session.join(name || "GHOST", new PublicKey(pk), 0, seat);
      } else {
        const w = useStore.getState().wallet;
        await session.join(useStore.getState().name || name || "GHOST", w ? new PublicKey(w) : null, isPrivate ? (knownCode ?? 0) : 0, seat);
      }
    });

  // arriving from an invite link: sit down right away (wallet gate first if needed)
  useEffect(() => {
    if (autoDone.current || staked || mySeat !== null || busy) return;
    if ((quick.current || invite || urlCode) && !locked) {
      autoDone.current = true;
      take();
    }
  }, [mySeat, busy]);

  const [askExit, setAskExit] = useState(false);
  const exit = () => (mySeat !== null ? setAskExit(true) : go("/"));
  const doExit = () =>
    run("leave", async () => {
      setAskExit(false);
      leaving.current = true;
      if (mySeat !== null) await session.leave().catch(() => {});
      go("/");
    });

  const copy = () => {
    navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="lobby2">
      <Suspense fallback={<div className="backdrop" />}>
        <LobbyStage seats={seats} onTake={(i) => mySeat === null && !locked && take(i)} onMakeHost={(i) => run("host", () => session.makeHost(i))} onKick={(i) => setAskKick(i)} onSelf={(x, y) => setWheel({ x, y })} />
      </Suspense>
      <TopBar />
      <div className="lobby2-head">
        <div className="kicker">
          <span className="dot" /> {isPrivate ? "🔒 PRIVATE ROOM" : `ROOM ${room.roomId}`} · NIGHT {room.matchNo + 1} {staked ? `· ${(Number(room.stake) / 1e9).toFixed(2)} SOL STAKE` : ""}
        </div>
        <h2>
          {mySeat === null
            ? `${room.names[effectiveHost] || "Someone"}'s room — take a seat.`
            : canStart
              ? "Your room. Pick the seats, then start the night."
              : `Waiting for ${room.names[effectiveHost] || "the host"} to start…`}
        </h2>
        {staked && <p className="sub">Pot {(Number(room.pot) / 1e9).toFixed(2)} SOL · 10% fee (funds the daily prize, keeps tables running, and the rest goes to future tournaments) · humans only, no bots. The winner is paid on Solana by a Magic Action the moment the match commits, and staked wins are what the leaderboard ranks.</p>}
        {quick.current && <p className="sub">Opening the gate for you…</p>}
      </div>

      <MapPicker value={room.map} canChange={!!canStart} drawn={staked} busy={!!busy} onPick={(id) => run("map", () => session.setMode(room.duos, id))} />
      <button className="exit-room" onClick={exit} disabled={busy === "leave"}>
        ← {canStart ? "CLOSE ROOM" : "EXIT ROOM"}
      </button>
      {askExit && (
        <div className="room-closed" onClick={() => setAskExit(false)}>
          <div className="room-closed-card" onClick={(e) => e.stopPropagation()}>
            <div className="vc-kicker">{canStart ? "CLOSE ROOM" : "EXIT ROOM"}</div>
            <h2>{canStart ? "Close this room?" : "Leave this room?"}</h2>
            <p>
              {canStart
                ? humans > 1
                  ? `You're the host. Everyone inside (${humans - 1} other ${humans - 1 === 1 ? "player" : "players"}) will be sent back to the gate.`
                  : "You're the host. The room closes and frees up for someone else."
                : "You'll give up your seat and go back to the gate."}
            </p>
            {canStart && humans > 1 && (
              <div className="handover">
                <label>OR HAND THE ROOM OVER AND LEAVE</label>
                <div className="row center wrap">
                  {[0, 1, 2, 3, 4, 5, 6, 7]
                    .filter((i) => i !== mySeat && fresh(i))
                    .map((i) => (
                      <button
                        key={i}
                        className="btn small"
                        onClick={() =>
                          run("leave", async () => {
                            await session.makeHost(i);
                            setAskExit(false);
                            leaving.current = true;
                            await session.leave().catch(() => {});
                            go("/");
                          })
                        }
                      >
                        {room.names[i]} becomes host
                      </button>
                    ))}
                </div>
              </div>
            )}
            <div className="row center">
              <button className="btn" onClick={() => setAskExit(false)}>
                STAY
              </button>
              <button className="btn danger" onClick={doExit} disabled={busy === "leave"}>
                {busy === "leave" ? "CLOSING…" : canStart ? "CLOSE ROOM" : "LEAVE"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showOther && other && mySeat === null && (
        <AlreadyInRoom
          id={other.id}
          room={other.room}
          onClose={() => setShowOther(false)}
          onLeft={() => {
            setOther(null);
            toast(`Left room ${other.id}. You can sit down here now.`);
          }}
        />
      )}
      {askKick !== null && (
        <div className="room-closed" onClick={() => setAskKick(null)}>
          <div className="room-closed-card" onClick={(e) => e.stopPropagation()}>
            <div className="vc-kicker">KICK PLAYER</div>
            <h2>Remove {room.names[askKick] || "this player"}?</h2>
            <p>{isPrivate ? "They're sent back to the gate and the room gets a new code, so their old one stops working. Share the new code with anyone still on the way." : "They're sent back to the gate. This is a public room, so they could take a seat again."}</p>
            <div className="row center">
              <button className="btn" onClick={() => setAskKick(null)}>
                CANCEL
              </button>
              <button
                className="btn danger"
                disabled={busy === "kick"}
                onClick={() => {
                  const seat = askKick;
                  setAskKick(null);
                  run("kick", () => session.kick(seat, isPrivate ? newCode() : 0));
                }}
              >
                KICK
              </button>
            </div>
          </div>
        </div>
      )}
      {kicked && (
        <div className="room-closed">
          <div className="room-closed-card">
            <div className="vc-kicker">REMOVED</div>
            <h2>The host removed you from this room.</h2>
            <p>You can create your own room from the gate. You'll be the host there.</p>
            <button className="btn primary huge" onClick={() => go("/")}>
              BACK TO THE GATE
            </button>
          </div>
        </div>
      )}
      {locked && !kicked && !closed && (
        <div className="room-closed">
          <div className="room-closed-card">
            <div className="vc-kicker">🔒 PRIVATE ROOM</div>
            <h2>{room.names[effectiveHost] || "Someone"}'s room needs a code</h2>
            <p>Ask the host for the 6-character room code.{urlCode ? " The code in your link has changed." : ""}</p>
            <input
              className="code-input"
              autoFocus
              placeholder="ABC-123"
              maxLength={7}
              value={typed}
              onChange={(e) => setTyped(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && textToCode(typed) === room.privateCode) take();
              }}
            />
            {typed.replace("-", "").length === 6 && textToCode(typed) !== room.privateCode && <div className="wgate-err">That code doesn't open this room.</div>}
            <div className="row center">
              <button className="btn" onClick={() => go("/")}>
                BACK
              </button>
            </div>
          </div>
        </div>
      )}
      {closed && (
        <div className="room-closed">
          <div className="room-closed-card">
            <div className="vc-kicker">ROOM CLOSED</div>
            <h2>{mySeat !== null ? "The host left the Yard." : "This room has no host."}</h2>
            <p>A night can only start with its host in the room. Create your own room from the gate — you'll be the host.</p>
            <button className="btn primary huge" onClick={doExit}>
              BACK TO THE GATE
            </button>
          </div>
        </div>
      )}
      <div className="dock">
        <div className="dock-cell invite">
          <label className="dock-head">
            <span>{isPrivate ? "ROOM CODE" : "INVITE"}</span>
            <em>{isPrivate ? "share it with friends" : "friends join from this link"}</em>
          </label>
          {isPrivate && mySeat !== null && (
            <div className="row code-row">
              <b className="room-code">{codeText}</b>
              <button
                className="btn small"
                onClick={() => {
                  navigator.clipboard?.writeText(codeText);
                  toast(`Code ${codeText} copied`);
                }}
              >
                COPY CODE
              </button>
            </div>
          )}
          <div className="row" style={isPrivate && mySeat === null ? { display: "none" } : undefined}>
            <code>{link.replace(/^https?:\/\//, "")}</code>
            <button className="btn small" onClick={copy}>
              {copied ? "COPIED" : "COPY"}
            </button>
            <a
              className="btn small x"
              target="_blank"
              rel="noreferrer"
              href={`https://x.com/intent/post?text=${encodeURIComponent(`Drop into BLACKOUT with me — a battle royale where nobody can see you, not even the chain. 🔦\n\n${link}`)}`}
            >
              POST
            </a>
          </div>
          <div className="dock-facts">
            <span>
              <i>ROOM</i>
              {room.roomId.toString()}
            </span>
            <span>
              <i>TYPE</i>
              {isPrivate ? "Private" : staked ? "Staked" : "Public"}
            </span>
            <span>
              <i>MAP</i>
              {staked ? "Drawn" : room.map === 1 ? "Meadow" : "Yard"}
            </span>
          </div>
        </div>

        <div className="dock-cell main">
          <label className="dock-head">
            <span>THE NIGHT</span>
            <em>
              {humans}/{size} seated · {staked ? "map drawn at the start" : room.map === 1 ? "Meadow" : "Yard"}
            </em>
          </label>
          {mySeat === null ? (
            <button className="btn primary huge" disabled={!!busy} onClick={() => take()}>
              {busy === "join" ? (staked ? "BUYING TICKET…" : "SITTING DOWN…") : staked ? `STAKE ${(Number(room.stake) / 1e9).toFixed(2)} SOL & SIT` : "TAKE A SEAT"}
            </button>
          ) : staked && mySeat !== null ? (
            <StakedCountdown room={room} />
          ) : canStart ? (
            <button className={`btn primary huge ${startAsk && Date.now() - startAsk.at < 15000 ? "asked" : ""}`} disabled={!!busy || (staked ? humans < 2 : size < 2)} onClick={() => {
              fullscreenOnTouch();
              run("start", () => session.startMatch(staked ? 0 : size));
            }}>
              {busy === "start" ? "WAKING THE WARDEN…" : staked && humans < 2 ? `WAITING FOR ${2 - humans} MORE STAKER` : "START THE NIGHT"}
              {startAsk && Date.now() - startAsk.at < 15000 && <small>{startAsk.name} is ready to play</small>}
            </button>
          ) : (
            <div className="waiting-card">
              <span className="wc-pulse" />
              <div>
                <b>Waiting for {room.names[effectiveHost] || "the host"}</b>
                <span>
                  {humans} of {size} seats taken · empty ones get bots
                </span>
              </div>
              {mySeat !== null && !staked && (
                <button
                  className="btn wc-ask"
                  disabled={!!busy || Date.now() - askedAt < 15000}
                  onClick={() =>
                    run("ask", async () => {
                      await session.askStart();
                      setAskedAt(Date.now());
                    })
                  }
                >
                  {busy === "ask" ? "ASKING…" : Date.now() - askedAt < 15000 ? "ASKED ✓" : "ASK TO START"}
                </button>
              )}
            </div>
          )}
          <div className="dock-seats">
            {Array.from({ length: size }, (_, i) => {
              const taken = room.players[i].toBase58() !== EMPTY;
              return <i key={i} className={taken ? (i === mySeat ? "me" : "on") : ""} />;
            })}
            <span>{size - humans > 0 ? `${size - humans} ${size - humans === 1 ? "bot" : "bots"} fill the empty seats` : "every seat is taken"}</span>
          </div>
          <LobbyClock room={room} />
          {mySeat !== null && (
            <a className="dock-leave" onClick={exit}>
              {canStart ? "close room" : "exit room"}
            </a>
          )}
        </div>

        <div className="dock-cell bots">
          {!staked ? (
            <div className="night-set">
              <label>
                <span>NIGHT SETTINGS{canStart ? "" : <b className="ns-host"> HOST DECIDES</b>}</span>
                <em className="ns-sum-inline">
                  {humans}P + {Math.max(0, size - humans)} {size - humans === 1 ? "bot" : "bots"} · 5:00
                </em>
              </label>
              {!canStart ? (
                <div className="ns-chips">
                  <span><i>SEATS</i>{size}</span>
                  <span><i>BOTS</i>{BOT_LEVEL_NAME[room.botLevel] ?? "Medium"}</span>
                  <span><i>MODE</i>{room.duos ? "Duos" : "Solo"}</span>
                  <span><i>MAP</i>{room.map === 1 ? "Meadow" : "Yard"}</span>
                </div>
              ) : (
              <div className="ns-grid">
              <div className="ns-row">
                <span>Seats</span>
                <div className="ns-step">
                  <button onClick={() => resize(size - 1)} disabled={!canStart || !!busy || size <= Math.max(2, humans)}>
                    −
                  </button>
                  <b>{size}</b>
                  <button onClick={() => resize(size + 1)} disabled={!canStart || !!busy || size >= 8}>
                    +
                  </button>
                </div>
              </div>
              <div className="ns-row">
                <span>Bots</span>
                <div className="seg">
                  {[1, 0, 2].map((lv) => (
                    <button key={lv} className={room.botLevel === lv ? "on" : ""} disabled={!canStart || !!busy} onClick={() => room.botLevel !== lv && run("bots", () => session.setBots(lv))}>
                      {BOT_LEVEL_NAME[lv]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ns-row">
                <span>Mode</span>
                <div className="seg">
                  {[false, true].map((d) => (
                    <button key={String(d)} className={room.duos === d ? "on" : ""} disabled={!canStart || !!busy} onClick={() => room.duos !== d && run("mode", () => session.setMode(d, room.map))}>
                      {d ? "Duos" : "Solo"}
                    </button>
                  ))}
                </div>
              </div>
              </div>
              )}
            </div>
          ) : (
            <>
              <label>THE POT</label>
              <b className="pot">{(Number(room.pot) / 1e9).toFixed(2)} SOL</b>
              <small>
                {humans} staker{humans === 1 ? "" : "s"} · {(Number(room.stake) / 1e9).toFixed(2)} SOL each · no bots · winner gets {(Number(room.pot) * 0.9 / 1e9).toFixed(3)} SOL after the 10% fee
              </small>
            </>
          )}
        </div>
      </div>
      {wheel && mySeat !== null && (
        <EmoteWheel
          x={wheel.x}
          y={wheel.y}
          current={myLook.emote}
          onClose={() => setWheel(null)}
          onPick={(k) => {
            setLook({ emote: k });
            setLobbyEmote(performance.now());
            // ...and for everyone else at the table (after the look itself has gone out)
            window.setTimeout(() => session.lobbyEmote(), 50);
            setWheel(null);
          }}
        />
      )}
      <div className="keys-hint">
        {[
          ["Mouse", "aim"],
          ["WASD", "move"],
          ["Shift", "run"],
          ["Space", "jump"],
          ["C", "sneak"],
          ["Ctrl", "prone"],
          ["B", "emote"],
          ["RMB", "scope"],
          ["G", "throw"],
          ["Wheel", "swap"],
          ["R", "reload"],
          ["Tab", "map"],
        ].map(([k, a]) => (
          <span key={k}>
            <kbd>{k}</kbd>
            {a}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A staked table starts itself: full at once, otherwise a minute after the last staker sat down. */
function StakedCountdown({ room }: { room: Room }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const seated = stakersSeated(room);
  const at = stakedStartAt(room);
  const left = at === null ? null : Math.max(0, Math.ceil(at - Date.now() / 1000));
  return (
    <div className="waiting-card staked-count">
      <span className="wc-pulse" />
      <div>
        <b>
          {at === null
            ? `Waiting for ${2 - Math.min(seated, 1)} more staker${seated === 0 ? "s" : ""}`
            : left === 0
              ? "Starting the night…"
              : `Starts in 0:${String(left).padStart(2, "0")}`}
        </b>
        <span>
          {seated} of {room.maxPlayers} seats · {at === null ? "the night starts itself once two are in" : "a new staker adds time, never past 3 min · full table starts at once"}
        </span>
      </div>
    </div>
  );
}
