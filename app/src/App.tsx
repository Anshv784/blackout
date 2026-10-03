import { useEffect } from "react";
import { useStore, type Route } from "./game/store";
import { loadName } from "./game/identity";
import { installKeyboard } from "./game/controls";
import { Home } from "./ui/Home";
import { RoomPage } from "./ui/RoomPage";
import { Board } from "./ui/Board";
import { How } from "./ui/How";
import { Toasts } from "./ui/Toasts";

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

export function App() {
  const route = useStore((s) => s.route);
  const set = useStore((s) => s.set);
  useEffect(() => {
    installKeyboard();
    set({ name: loadName(), route: parseHash() });
    const on = () => set({ route: parseHash() });
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [set]);
  return (
    <>
      {route.page === "home" && <Home />}
      {route.page === "room" && <RoomPage key={route.roomId.toString()} roomId={route.roomId} />}
      {route.page === "board" && <Board />}
      {route.page === "how" && <How />}
      <Toasts />
    </>
  );
}
