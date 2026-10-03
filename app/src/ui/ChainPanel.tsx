import { useEffect, useState } from "react";
import { useStore } from "../game/store";
import type { Session } from "../game/session";
import { viewPda, worldPda } from "../chain/client";

/** Live proof of the integration while you play. */
export function ChainPanel({ session }: { session: Session }) {
  const stats = useStore((s) => s.stats);
  const room = useStore((s) => s.room);
  const [open, setOpen] = useState(false);
  const [rtt, setRtt] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setRtt(Math.round(session.rtt)), 500);
    return () => clearInterval(t);
  }, [session]);
  if (!room) return null;
  const world = worldPda(room.roomId).toBase58();
  const view = session.mySeat !== null ? viewPda(room.roomId, session.mySeat).toBase58() : "";
  return (
    <div className={`chain ${open ? "open" : ""}`} onClick={() => setOpen(!open)}>
      <div className="chain-row">
        <span className="lock">🔒</span> SEALED IN TEE · {stats.tps.toFixed(1)} ticks/s · {rtt}ms
      </div>
      {open && (
        <div className="chain-detail" onClick={(e) => e.stopPropagation()}>
          <div>
            <b>World</b> <code>{world.slice(0, 8)}…</code> private · 0 readers
          </div>
          <div>
            <b>Your view</b> <code>{view.slice(0, 8)}…</code> private · readable by you only
          </div>
          <div>
            <b>Crank</b> ticking every 50 ms · tick {stats.tick}
          </div>
          <div>
            <b>Inputs</b> {stats.txSent} gasless txs from your session key
          </div>
          <div>
            <b>Views</b> {stats.viewsRecv} private updates over the TEE websocket
          </div>
          <div className="dim">Validator: MagicBlock devnet TEE (Intel TDX) · Private Ephemeral Rollup</div>
        </div>
      )}
    </div>
  );
}
