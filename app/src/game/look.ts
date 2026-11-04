// What your soldier looks like: character, outfit tone, gun finish, signature emote.
// Saved in this browser, and carried to everyone else in the spare bytes of your seat's name
// (names are at most 12 characters; bytes 13-15 of the 16 hold the look). No program change.
import { create } from "zustand";

export interface CharacterDef {
  id: number;
  key: string;
  name: string;
  role: string;
  url: string;
  /** the original Vanguard model gets the woodland camo repaint */
  camo?: boolean;
}
export const CHARACTERS: CharacterDef[] = [
  { id: 0, key: "vanguard", name: "VANGUARD", role: "the original · field kit", url: "/models/soldier-v2.glb", camo: true },
  { id: 1, key: "heraklios", name: "TITAN", role: "heavy armour · officer", url: "/models/chars/heraklios.glb" },
  { id: 2, key: "ganfaul", name: "GRIM", role: "scarred · relentless", url: "/models/chars/ganfaul.glb" },
  { id: 3, key: "arissa", name: "VIPER", role: "scout · light on her feet", url: "/models/chars/arissa.glb" },
  { id: 4, key: "maria", name: "ECHO", role: "ranger · patient", url: "/models/chars/maria.glb" },
  { id: 5, key: "vampire", name: "NOX", role: "night stalker", url: "/models/chars/vampire.glb" },
];
export const ANIMS_URL = "/models/chars/anims.glb";

/** outfit tones: multiplied over the character's own colours (0 keeps them as made) */
export const OUTFITS: { name: string; tint: string }[] = [
  { name: "Original", tint: "#ffffff" },
  { name: "Woodland", tint: "#9fb07a" },
  { name: "Desert", tint: "#d8bf8e" },
  { name: "Urban", tint: "#a4abb6" },
  { name: "Midnight", tint: "#5f6a8a" },
  { name: "Arctic", tint: "#e8eef5" },
  { name: "Crimson", tint: "#c27a74" },
];
/** gun finishes: the colour the gun's metal and polymer are tinted */
export const FINISHES: { name: string; tint: string }[] = [
  { name: "Gunmetal", tint: "#ffffff" },
  { name: "Tan", tint: "#d9c39b" },
  { name: "Olive", tint: "#9aa678" },
  { name: "Arctic", tint: "#e9eef4" },
  { name: "Gold", tint: "#f2cf6a" },
  { name: "Crimson", tint: "#d0766d" },
];
export const EMOTES: { key: string; name: string; clip: string }[] = [
  { key: "salute", name: "Salute", clip: "emote_salute" },
  { key: "victory", name: "Victory", clip: "emote_victory" },
  { key: "wave", name: "Wave", clip: "emote_wave" },
  { key: "taunt", name: "Taunt", clip: "emote_taunt" },
  { key: "dance", name: "Dance", clip: "emote_dance" },
  { key: "clap", name: "Clap", clip: "emote_clap" },
];

export interface Look {
  char: number;
  outfit: number;
  finish: number;
  emote: number;
}
export const DEFAULT_LOOK: Look = { char: 0, outfit: 0, finish: 0, emote: 0 };

const MAGIC = 0xb7;
const clampLook = (l: Partial<Look>): Look => ({
  char: Math.min(CHARACTERS.length - 1, Math.max(0, l.char ?? 0)),
  outfit: Math.min(OUTFITS.length - 1, Math.max(0, l.outfit ?? 0)),
  finish: Math.min(FINISHES.length - 1, Math.max(0, l.finish ?? 0)),
  emote: Math.min(EMOTES.length - 1, Math.max(0, l.emote ?? 0)),
});
/** write the look into bytes 13-15 of a 16-byte name (the name itself is at most 12) */
export function encodeLook(name16: Uint8Array, l: Look) {
  name16[12] = 0;
  name16[13] = MAGIC;
  name16[14] = (l.char & 0xf) | ((l.outfit & 0xf) << 4);
  name16[15] = (l.finish & 0xf) | ((l.emote & 0xf) << 4);
}
export function decodeLook(name16: Uint8Array): Look {
  if (name16[13] !== MAGIC) return DEFAULT_LOOK;
  return clampLook({ char: name16[14] & 0xf, outfit: name16[14] >> 4, finish: name16[15] & 0xf, emote: name16[15] >> 4 });
}

const load = (): Look => {
  try {
    return clampLook(JSON.parse(localStorage.getItem("bo-look") ?? "{}"));
  } catch {
    return DEFAULT_LOOK;
  }
};
export const useLook = create<{ look: Look; set: (l: Partial<Look>) => void }>((set, get) => ({
  look: load(),
  set: (l) => {
    const look = clampLook({ ...get().look, ...l });
    try {
      localStorage.setItem("bo-look", JSON.stringify(look));
    } catch {
      /* private mode: the look just isn't remembered */
    }
    set({ look });
  },
}));
export const getLook = () => useLook.getState().look;
