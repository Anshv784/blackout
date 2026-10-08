// What each key does, during the game. A card that opens by itself for the first seconds of a
// night (H brings it back), and small prompts that appear only when a key matters right now.
import { useEffect, useRef, useState } from "react";
import type { Session } from "../game/session";
import { controls } from "../game/controls";
import { ST_LIVE, GADGET_NAME, WEAPON_NAME } from "../chain/layout";
import { GadgetIcon } from "./Icons";

const OPEN_FOR = 25000; // ms the card stays up when a night starts

type Row = [keys: string[], what: string, note?: string];
const MOVE: Row[] = [
  [["W", "A", "S", "D"], "move"],
  [["Shift"], "run", "tap · or W W"],
  [["C"], "sneak", "silent"],
  [["Space"], "jump"],
];
const FIGHT: Row[] = [
  [["Mouse"], "look"],
  [["LMB"], "fire"],
  [["RMB"], "aim / scope"],
  [["R"], "reload"],
  [["Wheel"], "swap gun", "or X"],
  [["G"], "throw", "hold to aim"],
];
const VIEW: Row[] = [
  [["Tab"], "map"],
  [["V"], "camera"],
  [["M"], "mute"],
  [["Esc"], "settings"],
  [["H"], "this card"],
];

export function KeyGuide({ session, touch }: { session: Session; touch: boolean }) {
  const [open, setOpen] = useState(false);
  const live = session.room?.status === ST_LIVE;
  const match = session.room?.matchNo ?? 0;
  const shownFor = useRef(-1);
  // opens by itself once per night
  useEffect(() => {
    if (!live || shownFor.current === match) return;
    shownFor.current = match;
    setOpen(true);
    const t = setTimeout(() => setOpen(false), OPEN_FOR);
    return () => clearTimeout(t);
  }, [live, match]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (controls.menu || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key.toLowerCase() === "h" && !e.repeat) setOpen((o) => !o);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  if (touch) return null; // the phone buttons carry their own icons and labels
  if (!open)
    return (
      <div className="key-guide closed" onClick={() => setOpen(true)}>
        <kbd>H</kbd> controls
      </div>
    );
  return (
    <div className="key-guide" onClick={() => setOpen(false)}>
      <div className="kg-col">
        <Group title="MOVE" rows={MOVE} />
        <Group title="VIEW" rows={VIEW} />
      </div>
      <Group title="FIGHT" rows={FIGHT} />
      <small>
        <kbd>H</kbd> hide
      </small>
    </div>
  );
}

function Group({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="kg-group">
      <b>{title}</b>
      {rows.map(([keys, what, note]) => (
        <div className="kg-row" key={what}>
          <span className="kg-keys">
            {keys.map((k) => (
              <kbd key={k} className={k.length > 2 ? "wide" : ""}>
                {k}
              </kbd>
            ))}
          </span>
          <span className="kg-what">
            {what}
            {note && <em>{note}</em>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One-line prompts above the health bar, only while they're useful. */
export function ActionHints({ session, touch }: { session: Session; touch: boolean }) {
  const [hints, setHints] = useState<{ id: string; key: string; text: string; tone?: string; icon?: number }[]>([]);
  const firstSeen = useRef(new Map<string, number>());
  useEffect(() => {
    const t = setInterval(() => {
      const v = session.view;
      const r = session.room;
      if (!v || !r || r.status !== ST_LIVE || v.me.alive !== 1) return setHints([]);
      const now = performance.now();
      // a prompt for something new shows for 7 s, once per thing
      const fresh = (id: string) => {
        const at = firstSeen.current.get(id);
        if (at === undefined) {
          firstSeen.current.set(id, now);
          return true;
        }
        return now - at < 7000;
      };
      const k = (desk: string, phone: string) => (touch ? phone : desk);
      const out: typeof hints = [];
      if (controls.gadgetHeld && v.inv.count > 0 && v.inv.gadget !== 6) out.push({ id: "throw", key: k("G", "◉"), text: k("release to throw · right-click to cancel", "lift your thumb to throw"), tone: "gold", icon: v.inv.gadget });
      else if (v.me.mag === 0 && v.me.reload === 0) out.push({ id: "reload", key: k("R", "⟳"), text: "empty: reload", tone: "red" });
      if (v.inv.count > 0 && v.inv.gadget && fresh(`g${v.inv.gadget}`) && !controls.gadgetHeld)
        out.push({ id: "gadget", key: k("G", "◉"), text: v.inv.gadget === 6 ? `${GADGET_NAME[6]}: press to switch on` : `${GADGET_NAME[v.inv.gadget]}: hold to aim, let go to throw`, icon: v.inv.gadget });
      if (v.inv.sec >= 0 && fresh(`s${v.inv.sec}`)) out.push({ id: "swap", key: k("X", "⇄"), text: `swap to ${WEAPON_NAME[v.inv.sec]}` });
      const pm = session.predMoved;
      if (pm & 8) out.push({ id: "sneak", key: k("C", "↓"), text: "sneaking: silent, harder to see · press again to stand", tone: "dim" });
      else if (pm & 4) out.push({ id: "winded", key: k("Shift", "»"), text: "out of breath: can't sprint yet", tone: "dim" });
      setHints((h) => (h.map((x) => x.id + x.text).join() === out.map((x) => x.id + x.text).join() ? h : out));
    }, 150);
    return () => clearInterval(t);
  }, [session, touch]);
  if (!hints.length) return null;
  return (
    <div className="action-hints">
      {hints.map((h) => (
        <div key={h.id} className={`ah ${h.tone ?? ""}`}>
          <kbd className={h.key.length > 2 ? "wide" : ""}>{h.key}</kbd>
          {h.icon ? <GadgetIcon gadget={h.icon} className="ah-icon" /> : null}
          <span>{h.text}</span>
        </div>
      ))}
    </div>
  );
}
