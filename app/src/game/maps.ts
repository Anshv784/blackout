// The two maps. Everything that needs the layout (movement mirror, 3D scene, minimap, replay
// check) reads the active one from here; the room's setting decides which (see session).
import { create } from "zustand";
import { MAP_ROWS, LAMPS, SPAWNS, LOOT_SPOTS, MAP_ROWS_MEADOW, LAMPS_MEADOW, SPAWNS_MEADOW, LOOT_SPOTS_MEADOW } from "./gen";

export interface MapInfo {
  id: number;
  name: string;
  blurb: string;
  rows: string[];
  lamps: [number, number][];
  spawns: [number, number][];
  loot: [number, number][];
}
export const MAPS: MapInfo[] = [
  { id: 0, name: "THE YARD", blurb: "containers, warehouses, floodlights", rows: MAP_ROWS, lamps: LAMPS, spawns: SPAWNS, loot: LOOT_SPOTS },
  { id: 1, name: "THE MEADOW", blurb: "open fields, hedgerows, a creek", rows: MAP_ROWS_MEADOW, lamps: LAMPS_MEADOW, spawns: SPAWNS_MEADOW, loot: LOOT_SPOTS_MEADOW },
];

type Listener = (m: MapInfo) => void;
const listeners = new Set<Listener>();
let active = MAPS[0];
export const activeMap = () => active;
export function onMapChange(f: Listener) {
  listeners.add(f);
  return () => listeners.delete(f);
}
/** React side: re-render when the map changes */
export const useMapStore = create<{ id: number }>(() => ({ id: 0 }));
export function setActiveMap(id: number) {
  const next = MAPS[id] ?? MAPS[0];
  if (next === active) return;
  active = next;
  for (const f of listeners) f(next);
  useMapStore.setState({ id: next.id });
}
