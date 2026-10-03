import { useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { Session } from "../game/session";
import { useStore } from "../game/store";
import { saveName, client } from "../game/identity";
import { ST_LOBBY, ST_STARTING, ST_COUNTDOWN, ST_LIVE, ST_ENDED, ST_REVEALED, STATUS_NAME, type Room } from "../chain/layout";
import { GameScene } from "../scene/GameScene";
import { Hud } from "./Hud";
import { Reveal } from "./Reveal";
import { TouchControls } from "./TouchControls";
import { ChainPanel } from "./ChainPanel";
import { SEAT_COLORS } from "../scene/Avatar";
import { roomLink } from "../config";
import { go } from "../App";
import { audio } from "../game/audio";

const EMPTY = "11111111111111111111111111111111";

export function RoomPage({ roomId }: { roomId: bigint }) {
  const session = useMemo(() => new Session(roomId), [roomId]);
  const room = useStore((s) => s.room);
  const mySeat = useStore((s) => s.mySeat);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    useStore.getState().set({ room: null, view: null, mySeat: null, reveal: null });
    session.start().catch((e) => setErr(String(e?.message ?? e)));
    (window as any).__session = session;
    return () => session.stop();
  }, [session]);

  if (err) return <Center title="Can't reach the TEE" sub={err} />;
  if (!room) return <Center title="Connecting to the Private Ephemeral Rollup…" sub="authenticating your session key with the TEE validator" spinner />;

  const playing = mySeat !== null && [ST_STARTING, ST_COUNTDOWN, ST_LIVE, ST_ENDED].includes(room.status);
  if (room.status === ST_REVEALED) return <Reveal session={session} />;
  if (playing)
    return (
      <div className="game">
        <GameScene session={session} />
        <Hud session={session} />
        <TouchControls />
        <ChainPanel session={session} />
      </div>
    );
  if (room.status !== ST_LOBBY) return <Spectate room={room} />;
  return <Lobby session={session} room={room} />;
}

function Center({ title, sub, spinner }: { title: string; sub?: string; spinner?: boolean }) {
  return (
    <div className="center-screen">
      {spinner && <div className="spinner" />}
      <h2>{title}</h2>
      {sub && <p>{sub}</p>}
      <a className="back" onClick={() => go("/")}>
        ← back
      </a>
    </div>
  );
}

function Spectate({ room }: { room: Room }) {
  return (
    <div className="center-screen spectate">
      <div className="sealed-orb" />
      <h2>Match in progress — sealed</h2>
      <p>
        {room.aliveCount} alive · tick {room.tick} · {STATUS_NAME[room.status]}
      </p>
      <p className="dim">
        Spectators see nothing. Every position lives inside a TEE account with zero readers. When the last player falls, the World is flipped public and the replay
        unlocks right here.
      </p>
      <a className="back" onClick={() => go("/")}>
        ← back to rooms
      </a>
    </div>
  );
}

function Lobby({ session, room }: { session: Session; room: Room }) {
  const name = useStore((s) => s.name);
  const set = useStore((s) => s.set);
  const toast = useStore((s) => s.toast);
  const mySeat = useStore((s) => s.mySeat);
  const wallet = useStore((s) => s.wallet);
  const [busy, setBusy] = useState<string | null>(null);
  const [fill, setFill] = useState(6);
  const [copied, setCopied] = useState(false);
  // mirror the on-chain host rule: a host who stopped heart-beating is replaced by the first live seat
  const nowSlot = Math.max(...room.lastSeen);
  const fresh = (i: number) => room.players[i].toBase58() !== EMPTY && room.isBot[i] === 0 && nowSlot - room.lastSeen[i] <= 4500;
  const hostIdx = room.players.findIndex((p, i) => room.isBot[i] === 0 && p.equals(room.host));
  const effectiveHost = hostIdx >= 0 && fresh(hostIdx) ? hostIdx : [0, 1, 2, 3, 4, 5, 6, 7].find(fresh) ?? -1;
  const canStart = mySeat !== null && effectiveHost === mySeat;
  const humans = room.players.filter((p, i) => room.isBot[i] === 0 && p.toBase58() !== EMPTY).length;
  const link = roomLink(room.roomId);
  const lastWinner = room.matchNo > 0 && room.winner !== 255 ? room.names[room.winner] : null;

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

  const connectWallet = async () => {
    const sol = (window as any).phantom?.solana ?? (window as any).solana;
    if (!sol) {
      toast("No Solana wallet found — you can still play; wins go to your session key");
      return;
    }
    const res = await sol.connect();
    set({ wallet: res.publicKey.toString() });
  };

  return (
    <div className="lobby">
      <header className="lobby-head">
        <a className="back" onClick={() => go("/")}>
          ← BLACKOUT
        </a>
        <div className="lobby-title">
          ROOM {room.roomId.toString()} <span className="badge st-0">LOBBY</span>
        </div>
        <div className="lobby-sub">
          match #{room.matchNo + 1} · {humans}/8 players
          {room.stake > 0n ? ` · ${(Number(room.stake) / 1e9).toFixed(2)} SOL stake · pot ${(Number(room.pot) / 1e9).toFixed(2)} SOL` : ""}
        </div>
      </header>

      <div className="lobby-body">
        <div className="seats">
          {Array.from({ length: 8 }, (_, i) => {
            const empty = room.players[i].toBase58() === EMPTY && room.isBot[i] === 0;
            const me = i === mySeat;
            const host = !empty && i === effectiveHost;
            const away = !empty && room.isBot[i] === 0 && !fresh(i);
            return (
              <div key={i} className={`seat ${empty ? "empty" : ""} ${me ? "me" : ""}`} style={{ ["--c" as any]: SEAT_COLORS[i] }}>
                <div className="seat-dot" />
                <div className="seat-name">{empty ? "open seat" : room.names[i] || "PLAYER"}{away ? <em className="away"> · away</em> : null}</div>
                <div className="seat-tags">
                  {me && <span>YOU</span>}
                  {host && <span>HOST</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="lobby-side">
          {mySeat === null ? (
            <div className="panel">
              <label>CALLSIGN</label>
              <input
                value={name}
                maxLength={12}
                onChange={(e) => {
                  saveName(e.target.value);
                  set({ name: e.target.value.toUpperCase().replace(/[^A-Z0-9_\-]/g, "").slice(0, 12) });
                }}
              />
              {room.stake > 0n ? (
                <button
                  className="btn primary big wide"
                  disabled={!!busy}
                  onClick={() =>
                    run("join", async () => {
                      const sol = (window as any).phantom?.solana ?? (window as any).solana;
                      if (!sol) throw new Error("Staked rooms need a Solana wallet (Phantom) on devnet");
                      const res = await sol.connect();
                      set({ wallet: res.publicKey.toString() });
                      await session.buyTicket(sol);
                      await session.join(name || "GHOST", new PublicKey(res.publicKey.toString()));
                    })
                  }
                >
                  {busy === "join" ? "BUYING TICKET…" : `STAKE ${(Number(room.stake) / 1e9).toFixed(2)} SOL & SIT`}
                </button>
              ) : (
                <button className="btn primary big wide" disabled={!!busy} onClick={() => run("join", () => session.join(name || "GHOST", wallet ? new PublicKey(wallet) : null))}>
                  {busy === "join" ? "TAKING SEAT…" : "TAKE A SEAT"}
                </button>
              )}
              {room.stake > 0n && <p className="hint">Devnet SOL. Winner takes the pot, paid on Solana by a Magic Action the moment the match commits.</p>}
              <p className="hint">Your seat's view account is re-permissioned so only your session key can read it.</p>
            </div>
          ) : (
            <div className="panel">
              {canStart ? (
                <>
                  {room.stake > 0n ? <label>STAKED ROOM · HUMANS ONLY</label> : <label>FILL EMPTY SEATS WITH BOTS UP TO</label>}
                  <div className="fill">
                    {[2, 4, 6, 8].map((n) => (
                      <button key={n} className={`chip ${fill === n ? "on" : ""}`} onClick={() => setFill(n)}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <button className="btn primary big wide" disabled={!!busy || Math.max(humans, fill) < 2} onClick={() => run("start", () => session.startMatch(fill))}>
                    {busy === "start" ? "REQUESTING VRF…" : "START MATCH"}
                  </button>
                  <p className="hint">Bots run inside the TEE too — they only know what their own flashlight shows them.</p>
                </>
              ) : (
                <div className="waiting">
                  <div className="spinner small" /> Waiting for {room.names[effectiveHost] || "the host"} to start…
                </div>
              )}
              <button className="btn ghost wide" disabled={!!busy} onClick={() => run("leave", () => session.leave())}>
                LEAVE SEAT
              </button>
            </div>
          )}

          <div className="panel">
            <label>INVITE</label>
            <div className="share">
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
              <button
                className="btn"
                onClick={() => {
                  navigator.clipboard?.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "COPIED" : "COPY"}
              </button>
            </div>
            <a
              className="btn x wide"
              target="_blank"
              rel="noreferrer"
              href={`https://x.com/intent/post?text=${encodeURIComponent(`Drop into BLACKOUT with me — a battle royale where nobody can see you, not even the chain. 🔦\n\n${link}`)}`}
            >
              POST INVITE ON X
            </a>
          </div>

          <div className="panel small">
            <label>PAYOUT / LEADERBOARD WALLET</label>
            {wallet ? <code>{wallet.slice(0, 6)}…{wallet.slice(-6)}</code> : <button className="btn ghost wide" onClick={connectWallet}>CONNECT WALLET (OPTIONAL)</button>}
          </div>

          {lastWinner && (
            <div className="panel small">
              <label>LAST MATCH</label>
              <div>👑 {lastWinner}</div>
            </div>
          )}
        </div>
      </div>
      <div className="controls-help">
        <span>W toward mouse · S back · A/D strafe</span>
        <span>MOUSE aim</span>
        <span>CLICK fire</span>
        <span>R reload</span>
        <span>walk over loot to grab it</span>
      </div>
    </div>
  );
}
