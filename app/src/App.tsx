import { useEffect, useState } from "react";
import { Intro } from "./ui/Intro";
import { audio } from "./game/audio";
import { useStore, type Route } from "./game/store";
import { loadName } from "./game/identity";
import { installKeyboard } from "./game/controls";
import { Home } from "./ui/Home";
import { RoomPage } from "./ui/RoomPage";
import { Board } from "./ui/Board";
import { How } from "./ui/How";
import { Toasts } from "./ui/Toasts";
import { WalletGate } from "./ui/WalletGate";
import { loadProfile, localNameFor, provider } from "./game/wallet";

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  const m = h.match(/^r\/(\d+)/);
  if (m) return { page: "room", roomId: BigInt(m[1]) };
  if (h.startsWith("how")) return { page: "how" };
  if (h.startsWith("board")) return { page: "board" };
  return { page: "home" };
}

export function go(path: string) {
  window.location.hash = path;
}

const introSeen = () => {
  try {
    return localStorage.getItem("bo-intro-seen") === "1";
  } catch {
    return true;
  }
};

export function App() {
  const route = useStore((s) => s.route);
  const set = useStore((s) => s.set);
  const [intro, setIntro] = useState(() => !introSeen() && !window.location.hash.startsWith("#/r/"));
  useEffect(() => {
    // the dread starts on the first interaction (browsers block autoplay)
    const start = () => {
      audio.unlock();
      audio.startAmbience(1);
    };
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    (window as any).__replayIntro = () => setIntro(true);
    // restore a previously connected wallet + its on-chain profile, silently
    const saved = useStore.getState().wallet;
    if (saved) {
      provider()?.connect?.({ onlyIfTrusted: true }).catch(() => {});
      const local = localNameFor(saved);
      if (local) useStore.getState().set({ name: local });
      loadProfile(saved).then((prof) => {
        if (prof) useStore.getState().set({ profile: prof, ...(prof.name ? { name: prof.name } : {}) });
      });
    }
  }, []);
  useEffect(() => {
    installKeyboard();
    set({ name: loadName(), route: parseHash() });
    const on = () => set({ route: parseHash() });
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [set]);
  if (intro) return <Intro onDone={() => setIntro(false)} />;
  return (
    <>
      {route.page === "home" && <Home />}
      {route.page === "room" && <RoomPage key={route.roomId.toString()} roomId={route.roomId} />}
      {route.page === "board" && <Board />}
      {route.page === "how" && <How />}
      <Toasts />
      <WalletGate />
    </>
  );
}
