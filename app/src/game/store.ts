import { create } from "zustand";
import type { Room, View, World, Recording } from "../chain/layout";

export type Route = { page: "home" } | { page: "room"; roomId: bigint } | { page: "how" } | { page: "board" };

export interface FeedItem {
  key: string;
  text: string;
  at: number;
  mine: boolean;
}

export interface ChainStats {
  tick: number;
  tps: number;
  rtt: number;
  txSent: number;
  viewsRecv: number;
  lastSig: string;
  sealed: boolean;
}

interface State {
  route: Route;
  name: string;
  wallet: string | null;
  room: Room | null;
  view: View | null;
  mySeat: number | null;
  error: string | null;
  busy: string | null;
  stats: ChainStats;
  reveal: { world: World | null; rec: Recording | null } | null;
  toasts: FeedItem[];
  setRoute: (r: Route) => void;
  set: (p: Partial<State>) => void;
  toast: (text: string, mine?: boolean) => void;
}

export const useStore = create<State>((set, get) => ({
  route: { page: "home" },
  name: "",
  wallet: (() => {
    try {
      return localStorage.getItem("bo-wallet");
    } catch {
      return null;
    }
  })(),
  room: null,
  view: null,
  mySeat: null,
  error: null,
  busy: null,
  stats: { tick: 0, tps: 0, rtt: 0, txSent: 0, viewsRecv: 0, lastSig: "", sealed: true },
  reveal: null,
  toasts: [],
  setRoute: (route) => set({ route }),
  set: (p) => set(p),
  toast: (text, mine = false) => {
    const item = { key: `${Date.now()}-${Math.random()}`, text, at: Date.now(), mine };
    set({ toasts: [...get().toasts.slice(-4), item] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.key !== item.key) }), 4000);
  },
}));
