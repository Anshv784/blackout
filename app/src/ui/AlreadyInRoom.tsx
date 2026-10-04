import { useState } from "react";
import { client } from "../game/identity";
import { go } from "../App";
import { ST_LOBBY, type Room } from "../chain/layout";

/** One room at a time: shown when you try to open or join a room while seated in another. */
export function AlreadyInRoom({ id, room, onClose, onLeft }: { id: number; room: Room; onClose: () => void; onLeft?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seat = room.players.findIndex((p, i) => room.isBot[i] === 0 && p.equals(client.publicKey));
  const host = room.host.equals(client.publicKey);
  const lobby = room.status === ST_LOBBY;
  const leave = async () => {
    setBusy(true);
    setErr(null);
    try {
      await client.sendEr([client.leaveIx(BigInt(id), seat)]);
      onLeft?.();
      onClose();
    } catch (e: any) {
      setErr(String(e?.message ?? e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="room-closed" onClick={onClose}>
      <div className="room-closed-card" onClick={(e) => e.stopPropagation()}>
        <div className="vc-kicker">ONE ROOM AT A TIME</div>
        <h2>{lobby ? `You're already in Room ${id}` : `Your night in Room ${id} is still running`}</h2>
        <p>
          {lobby
            ? host
              ? "You're hosting it. Go back to it, or close it first to open a different room."
              : "You have a seat there. Go back to it, or give up that seat to join this one."
            : "You can only be in one room at a time. Head back and finish the night, or wait for the lights to come on."}
        </p>
        {err && <div className="wgate-err">{err}</div>}
        <div className="row center wrap">
          <button className="btn primary" onClick={() => go(`/r/${id}`)}>
            BACK TO ROOM {id}
          </button>
          {lobby && seat >= 0 && (
            <button className="btn danger" onClick={leave} disabled={busy}>
              {busy ? "LEAVING…" : host ? `CLOSE ROOM ${id}` : `LEAVE ROOM ${id}`}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}
