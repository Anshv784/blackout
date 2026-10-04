import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { Session } from "../game/session";
import { useStore } from "../game/store";
import { client } from "../game/identity";
import { ST_LOBBY, ST_STARTING, ST_COUNTDOWN, ST_LIVE, ST_ENDED, ST_REVEALED, STATUS_NAME, type Room } from "../chain/layout";
import { GameScene } from "../scene/GameScene";
import { Hud } from "./Hud";
import { Reveal } from "./Reveal";
import { TouchControls } from "./TouchControls";
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

const LobbyStage = lazy(() => import("../scene/LobbyStage").then((m) => ({ default: m.LobbyStage })));
const Backdrop = lazy(() => import("../scene/Backdrop").then((m) => ({ default: m.Backdrop })));

const EMPTY = "11111111111111111111111111111111";
const flags = () => new URLSearchParams(window.location.hash.split("?")[1] ?? "");

export function RoomPage({ roomId }: { roomId: bigint }) {
  const session = useMemo(() => new Session(roomId), [roomId]);
  const room = useStore((s) => s.room);
  const mySeat = useStore((s) => s.mySeat);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    useStore.getState().set({ room: null, view: null, mySeat: null, reveal: null });
    session.start().catch((e) => setErr(String(e?.message ?? e)));
    (window as any).__session = session;
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

  const playing = mySeat !== null && [ST_STARTING, ST_COUNTDOWN, ST_LIVE, ST_ENDED].includes(room.status);
  if (room.status === ST_REVEALED) return <Reveal session={session} />;
  if (playing)
    return (
      <div className="game">
        <GameScene session={session} />
        <Hud session={session} />
        <TouchControls />
        <ChainPanel session={session} />
        <Crosshair />
      </div>
    );
  if (room.status !== ST_LOBBY) return <Spectate room={room} />;
  return <Lobby session={session} room={room} />;
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
  const canStart = mySeat !== null && hostIdx === mySeat;
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
  const LEVELS = ["MEDIUM", "EASY", "HARD"];
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
      toast(String(e?.message ?? e).replace(/\(.*\)$/, "").slice(0, 120));
    });
  };
  const seats: SeatInfo[] = Array.from({ length: staked ? 8 : size }, (_, i) => {
    const taken = room.players[i].toBase58() !== EMPTY || room.isBot[i] === 1;
    return {
      name: room.names[i],
      taken,
      bot: room.isBot[i] === 1,
      me: i === mySeat,
      host: taken && i === effectiveHost,
      away: taken && room.isBot[i] === 0 && !fresh(i),
      canMakeHost: canStart && taken && room.isBot[i] === 0 && i !== mySeat && fresh(i),
      canKick: canStart && !staked && taken && room.isBot[i] === 0 && i !== mySeat,
      openHint: staked ? "stake to sit" : undefined,
    };
  });

  const run = async (label: string, f: () => Promise<void>) => {
    audio.unlock();
    setBusy(label);
    try {
      await f();
    } catch (e: any) {
      toast(String(e?.message ?? e).replace(/\(.*\)$/, "").slice(0, 140));
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
        if (!sol) throw new Error("Staked rooms need a Solana wallet (Phantom) on devnet");
        const pk = await connectWallet();
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
        <LobbyStage seats={seats} onTake={(i) => mySeat === null && !locked && take(i)} onMakeHost={(i) => run("host", () => session.makeHost(i))} onKick={(i) => setAskKick(i)} />
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
        {staked && <p className="sub">Pot {(Number(room.pot) / 1e9).toFixed(2)} SOL · humans only, no bots. The winner is paid on Solana by a Magic Action the moment the match commits, and staked wins are what the leaderboard ranks.</p>}
        {quick.current && <p className="sub">Opening the gate for you…</p>}
      </div>

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
          <label>{isPrivate ? "ROOM CODE · share it with friends" : "INVITE"}</label>
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
        </div>

        <div className="dock-cell main">
          {mySeat === null ? (
            <button className="btn primary huge" disabled={!!busy} onClick={() => take()}>
              {busy === "join" ? (staked ? "BUYING TICKET…" : "SITTING DOWN…") : staked ? `STAKE ${(Number(room.stake) / 1e9).toFixed(2)} SOL & SIT` : "TAKE A SEAT"}
            </button>
          ) : canStart ? (
            <button className="btn primary huge" disabled={!!busy || (staked ? humans < 2 : size < 2)} onClick={() => run("start", () => session.startMatch(staked ? 0 : size))}>
              {busy === "start" ? "WAKING THE WARDEN…" : staked && humans < 2 ? `WAITING FOR ${2 - humans} MORE STAKER` : "START THE NIGHT"}
            </button>
          ) : (
            <div className="waiting">
              <div className="warden-loader small" /> the host starts the night
            </div>
          )}
          {mySeat !== null && (
            <a className="dock-leave" onClick={exit}>
              {canStart ? "close room" : "exit room"}
            </a>
          )}
        </div>

        <div className="dock-cell bots">
          {!staked ? (
            <>
              <label>SEATS</label>
              <div className="stepper">
                <button onClick={() => resize(size - 1)} disabled={!canStart || !!busy || size <= Math.max(2, humans)}>
                  −
                </button>
                <b>{size}</b>
                <button onClick={() => resize(size + 1)} disabled={!canStart || !!busy || size >= 8}>
                  +
                </button>
              </div>
              <small>
                {humans} {humans === 1 ? "player" : "players"} + {Math.max(0, size - humans)} {size - humans === 1 ? "bot" : "bots"}
                {canStart ? "" : " · host decides"}
              </small>
              <div className="bot-level">
                <span>BOTS</span>
                {[1, 0, 2].map((lv) => (
                  <button
                    key={lv}
                    className={`lv-${lv} ${room.botLevel === lv ? "on" : ""}`}
                    disabled={!canStart || !!busy}
                    onClick={() => room.botLevel !== lv && run("bots", () => session.setBots(lv))}
                  >
                    {LEVELS[lv]}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <label>THE POT</label>
              <b className="pot">{(Number(room.pot) / 1e9).toFixed(2)} SOL</b>
              <small>
                {humans} staker{humans === 1 ? "" : "s"} · {(Number(room.stake) / 1e9).toFixed(2)} SOL each · no bots · winner takes all
              </small>
            </>
          )}
        </div>
      </div>
      <div className="keys-hint">
        <span>click to aim</span>
        <span>W A S D move</span>
        <span>Q / E turn</span>
        <span>click fire</span>
        <span>R reload</span>
        <span>V view</span>
        <span>M sound</span>
      </div>
    </div>
  );
}
