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
  /** not offered on the Operator page (its rig can't play the shared emotes) */
  hidden?: boolean;
}
export const CHARACTERS: CharacterDef[] = [
  { id: 0, key: "vanguard", name: "VANGUARD", role: "the original · field kit", url: "/models/soldier-v2.glb", camo: true, hidden: true },
  { id: 1, key: "heraklios", name: "TITAN", role: "heavy armour · officer", url: "/models/chars/heraklios.glb" },
  { id: 2, key: "ganfaul", name: "GRIM", role: "scarred · relentless", url: "/models/chars/ganfaul.glb" },
  { id: 3, key: "arissa", name: "VIPER", role: "scout · light on her feet", url: "/models/chars/arissa.glb" },
  { id: 4, key: "maria", name: "ECHO", role: "ranger · patient", url: "/models/chars/maria.glb" },
  { id: 5, key: "vampire", name: "NOX", role: "night stalker", url: "/models/chars/vampire.glb" },
  { id: 6, key: "medea", name: "VEIL", role: "duelist · cold-blooded", url: "/models/chars/medea.glb" },
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
/** gun skins: a pattern printed over the gun (the finish tints it) */
export const SKINS: { key: string; name: string }[] = [
  { key: "plain", name: "Factory" },
  { key: "woodland", name: "Woodland" },
  { key: "digital", name: "Digital" },
  { key: "tiger", name: "Tiger" },
  { key: "carbon", name: "Carbon" },
  { key: "hex", name: "Hex" },
  { key: "ember", name: "Ember" },
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
  skin: number;
}
export const DEFAULT_LOOK: Look = { char: 1, outfit: 0, finish: 0, emote: 3, skin: 0 }; // taunt by default
/** the operators you can pick */
export const ROSTER = CHARACTERS.filter((c) => !c.hidden);

const MAGIC = 0xb0;
const clampLook = (l: Partial<Look>): Look => ({
  // a retired operator (the original) becomes TITAN
  char: CHARACTERS[l.char ?? 1] && !CHARACTERS[l.char ?? 1].hidden ? (l.char ?? 1) : 1,
  outfit: Math.min(OUTFITS.length - 1, Math.max(0, l.outfit ?? 0)),
  finish: Math.min(FINISHES.length - 1, Math.max(0, l.finish ?? 0)),
  emote: Math.min(EMOTES.length - 1, Math.max(0, l.emote ?? DEFAULT_LOOK.emote)),
  skin: Math.min(SKINS.length - 1, Math.max(0, l.skin ?? 0)),
});
/** write the look into bytes 13-15 of a 16-byte name (the name itself is at most 12) */
export function encodeLook(name16: Uint8Array, l: Look) {
  name16[12] = 0;
  name16[13] = MAGIC | (l.skin & 0xf); // high nibble marks a look, low nibble is the gun skin
  name16[14] = (l.char & 0xf) | ((l.outfit & 0xf) << 4);
  name16[15] = (l.finish & 0xf) | ((l.emote & 0xf) << 4);
}
/** a seat with no look chosen (bots, older clients): a different operator per seat */
export const seatDefault = (seat: number): Look => ({ ...DEFAULT_LOOK, char: ROSTER[seat % ROSTER.length].id, outfit: seat % 3 === 2 ? 1 : 0 });
export function decodeLook(name16: Uint8Array, seat = 0): Look {
  if ((name16[13] & 0xf0) !== MAGIC) return seatDefault(seat);
  return clampLook({ char: name16[14] & 0xf, outfit: name16[14] >> 4, finish: name16[15] & 0xf, emote: name16[15] >> 4, skin: name16[13] & 0xf });
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

/** the gun last picked on the Operator page (shown on the home screen), the KESTREL by default */
export function previewGun(): number {
  try {
    const v = Number(localStorage.getItem("bo-preview-gun"));
    return Number.isInteger(v) && v >= 0 && v <= 7 && localStorage.getItem("bo-preview-gun") !== null ? v : 3;
  } catch {
    return 3;
  }
}
