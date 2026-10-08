// Seat colours, shared by the 3D scene and the HUD (kept free of three.js so the HUD stays light).
export const SEAT_COLORS = ["#ffd166", "#ef476f", "#06d6a0", "#4cc9f0", "#c77dff", "#ff8c42", "#90e0ef", "#f15bb5"];
/** length of the cinematic intro, seconds */
export const INTRO_LENGTH = 50;

/** The eight who woke up in the Yard. Bots play under these names; the intro introduces them. */
export const CAST: { name: string; role: string; line: string; weapon: number; at: number }[] = [
  { name: "SHADE", role: "ex-recon", line: "waits in the corners you didn't check", weapon: 3, at: 6.8 },
  { name: "NYX", role: "sniper", line: "never needs a second shot", weapon: 4, at: 7.95 },
  { name: "WRAITH", role: "infiltrator", line: "you won't hear Wraith coming", weapon: 1, at: 9.1 },
  { name: "UMBRA", role: "breacher", line: "shotgun, no patience", weapon: 2, at: 10.25 },
  { name: "HUSH", role: "field medic", line: "keeps everyone alive but you", weapon: 0, at: 11.4 },
  { name: "GLOOM", role: "demolitions", line: "always has one more frag", weapon: 3, at: 12.55 },
  { name: "VESPER", role: "night-vision junkie", line: "sees you before you see the dark", weapon: 1, at: 13.7 },
  { name: "DUSK", role: "survivor", line: "always makes the final circle", weapon: 3, at: 14.85 },
];
