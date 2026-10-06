import { useEffect, useRef, useState } from "react";
import { controls, gadgetDown, gadgetUp } from "../game/controls";
import { audio } from "../game/audio";
import { GadgetIcon } from "./Icons";
import type { Session } from "../game/session";

/** True on phones and tablets (or once anything is touched). */
export function useTouch() {
  const [touch, setTouch] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches);
  useEffect(() => {
    const on = () => setTouch(true);
    window.addEventListener("touchstart", on, { once: true });
    return () => window.removeEventListener("touchstart", on);
  }, []);
  return touch;
}

/**
 * Phone controls, laid out like a mobile shooter: left thumb moves (push to the rim to run),
 * right thumb drags anywhere to look, buttons sit under the right thumb. The camera is the same
 * third-person shoulder view as on desktop: the crosshair is the centre of the screen.
 */
export function TouchControls({ session }: { session: Session }) {
  const touch = useTouch();
  const [crouch, setCrouch] = useState(false);
  const [ads, setAds] = useState(false);
  const [gadget, setGadget] = useState(0);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!touch) return;
    controls.view = "chase"; // top-down has no aim on a phone
    const t = setInterval(() => {
      setCrouch(controls.crouch);
      setAds(controls.ads);
      setGadget(session.view?.inv?.count ? session.view.inv.gadget : 0);
      setCount(session.view?.inv?.count ?? 0);
    }, 150);
    return () => {
      clearInterval(t);
      controls.touchMove = null;
      controls.touchFire = false;
      controls.touchSprint = false;
    };
  }, [touch, session]);
  if (!touch) return null;
  return (
    <div className="touch-ui">
      <LookPad />
      <Stick
        onMove={(x, y) => {
          controls.touchMove = x === 0 && y === 0 ? null : [x, y];
          const run = x * x + y * y > 0.92 && y < -0.5; // push forward to the rim to run
          if (run && !controls.touchSprint) controls.crouch = false;
          controls.touchSprint = run;
        }}
      />
      <HoldButton className="tb fire left" label="fire" look onDown={() => fire(true)} onUp={() => fire(false)} />
      <div className="tb-cluster">
        <HoldButton className="tb fire" label="fire" look onDown={() => fire(true)} onUp={() => fire(false)} />
        <TapButton className={`tb ads ${ads ? "on" : ""}`} label="scope" onTap={() => (controls.ads = !controls.ads)}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" /><path d="M12 2v6M12 16v6M2 12h6M16 12h6" /></svg>
        </TapButton>
        <TapButton className="tb jump" label="jump" onTap={() => tapKey(" ")}>
          <svg viewBox="0 0 24 24"><path d="M12 4l-6 7h4v8h4v-8h4z" /></svg>
        </TapButton>
        <TapButton className={`tb crouch ${crouch ? "on" : ""}`} label="crouch" onTap={() => (controls.crouch = !controls.crouch)}>
          <svg viewBox="0 0 24 24"><circle cx="13" cy="5" r="2.2" /><path d="M12 8l-3 5 4 2-1 5M9 13l-3 3M13 15l4 1" /></svg>
        </TapButton>
        <TapButton className="tb reload" label="reload" onTap={() => { controls.reload = true; controls.reloadUntil = performance.now() + 200; setTimeout(() => (controls.reload = false), 200); }}>
          <svg viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4" /></svg>
        </TapButton>
        <TapButton className="tb swap" label="swap" onTap={() => tapKey("x")}>
          <svg viewBox="0 0 24 24"><path d="M4 8h14l-3-3M20 16H6l3 3" /></svg>
        </TapButton>
        <HoldButton className={`tb gadget ${gadget ? "" : "empty"}`} label="gadget" onDown={gadgetDown} onUp={gadgetUp}>
          <GadgetIcon gadget={gadget || 1} />
          {gadget > 0 && <b className="tb-n">{count}</b>}
        </HoldButton>
      </div>
    </div>
  );
}

function fire(on: boolean) {
  controls.touchFire = on;
  if (on) controls.fireUntil = performance.now() + 160;
}

/** press a key for a few frames (swap, jump) */
function tapKey(k: string) {
  controls.keys.add(k);
  if (k === " ") controls.crouch = false;
  setTimeout(() => controls.keys.delete(k), 160);
}

/** drag to turn the camera, like the mouse on desktop */
function look(dx: number, dy: number) {
  const k = controls.sens * 0.00016 * (1 - controls.adsK * 0.5);
  controls.camYaw += dx * k;
  controls.camPitch = Math.max(0.02, Math.min(1.15, controls.camPitch + dy * k * 0.7));
}

function useDrag(el: React.RefObject<HTMLElement | null>, h: { down?: () => void; up?: () => void; look?: boolean }) {
  const hRef = useRef(h);
  hRef.current = h;
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let id: number | null = null;
    let lx = 0;
    let ly = 0;
    const start = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (id !== null) return;
      audio.unlock();
      const t = e.changedTouches[0];
      id = t.identifier;
      lx = t.clientX;
      ly = t.clientY;
      node.classList.add("down");
      hRef.current.down?.();
    };
    const move = (e: TouchEvent) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches))
        if (t.identifier === id) {
          if (hRef.current.look) look(t.clientX - lx, t.clientY - ly);
          lx = t.clientX;
          ly = t.clientY;
        }
    };
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches))
        if (t.identifier === id) {
          id = null;
          node.classList.remove("down");
          hRef.current.up?.();
        }
    };
    node.addEventListener("touchstart", start, { passive: false });
    node.addEventListener("touchmove", move, { passive: false });
    node.addEventListener("touchend", end);
    node.addEventListener("touchcancel", end);
    return () => {
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", end);
    };
  }, [el]);
}

/** the right side of the screen: drag anywhere to look */
function LookPad() {
  const ref = useRef<HTMLDivElement>(null);
  useDrag(ref, { look: true });
  return <div className="look-pad" ref={ref} />;
}

/** fire and gadget: held. Fire buttons also turn the camera while you hold them, so you can track. */
function HoldButton({ className, label, look, onDown, onUp, children }: { className: string; label: string; look?: boolean; onDown: () => void; onUp: () => void; children?: React.ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  useDrag(ref, { down: onDown, up: onUp, look });
  return (
    <button ref={ref} className={className} aria-label={label}>
      {children ?? <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 3v5M12 16v5M3 12h5M16 12h5" /></svg>}
    </button>
  );
}

function TapButton({ className, label, onTap, children }: { className: string; label: string; onTap: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  useDrag(ref, { down: onTap });
  return (
    <button ref={ref} className={className} aria-label={label}>
      {children}
    </button>
  );
}

/** the move stick: appears where your left thumb lands */
function Stick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const zone = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const cb = useRef(onMove);
  cb.current = onMove;
  useEffect(() => {
    const el = zone.current!;
    const R = 52;
    let id: number | null = null;
    let cx = 0;
    let cy = 0;
    const update = (t: Touch) => {
      let dx = t.clientX - cx;
      let dy = t.clientY - cy;
      const m = Math.hypot(dx, dy);
      if (m > R) {
        dx = (dx / m) * R;
        dy = (dy / m) * R;
      }
      knob.current!.style.transform = `translate(${dx}px, ${dy}px)`;
      cb.current(dx / R, dy / R);
    };
    const start = (e: TouchEvent) => {
      e.preventDefault();
      if (id !== null) return;
      audio.unlock();
      const t = e.changedTouches[0];
      id = t.identifier;
      const r = el.getBoundingClientRect();
      // the stick centres under the thumb (kept inside the zone)
      cx = Math.max(r.left + R, Math.min(r.right - R, t.clientX));
      cy = Math.max(r.top + R, Math.min(r.bottom - R, t.clientY));
      base.current!.style.left = `${cx - r.left}px`;
      base.current!.style.top = `${cy - r.top}px`;
      base.current!.classList.add("live");
      update(t);
    };
    const move = (e: TouchEvent) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) if (t.identifier === id) update(t);
    };
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches))
        if (t.identifier === id) {
          id = null;
          knob.current!.style.transform = "";
          base.current!.classList.remove("live");
          base.current!.style.left = "";
          base.current!.style.top = "";
          cb.current(0, 0);
        }
    };
    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, []);
  return (
    <div className="stick-zone" ref={zone}>
      <div className="stick" ref={base}>
        <div className="knob" ref={knob} />
      </div>
    </div>
  );
}
