// The trailer is cut like a launch ad: short clips lifted from one choreographed night that
// runs across both maps. Each clip plays story time [src, src + (to - from)) at ad time [from, to).
// heart / zone set the score's heartbeat and the zone hum when the clip starts.
export interface Clip {
  from: number;
  to: number;
  src: number;
  /** story seconds per ad second (>1 = sped up) */
  rate?: number;
  heart?: number;
  zone?: number;
  /** fade through black into this beat (the move between maps) */
  dip?: boolean;
}
// the story plays in real time; these beats only set the score (heartbeat, zone hum) and where the
// picture dips to black between scenes
// the story plays in real time; these beats only set the score (heartbeat, zone hum), and the one
// fade through black is where the night moves from the Yard to the Meadow
export const CLIPS: Clip[] = [
  { from: 0, to: 6, src: 0, heart: 0, zone: 0 }, // the lights die
  { from: 6, to: 13, src: 6 }, // DUSK wakes, the torch
  { from: 13, to: 22, src: 13, heart: 0.9 }, // NYX hunts; the beam passes over him
  { from: 22, to: 29, src: 22, heart: 0.3 }, // WRAITH sprays and dies
  { from: 29, to: 33, src: 29, heart: 0, zone: 1 }, // the Warden; the circle closes on the Yard
  { from: 33, to: 37.2, src: 33, zone: 0, dip: true }, // out into the Meadow
  { from: 37.2, to: 44.6, src: 37.2, heart: 0.5 }, // the grass; the silent crossbow
  { from: 44.6, to: 51.5, src: 44.6, heart: 0 }, // the throw; the bow
  { from: 51.5, to: 55, src: 51.5, zone: 1 }, // the last circle
  { from: 55, to: 60.2, src: 55, heart: 1, zone: 0 }, // NYX on the bridge
  { from: 60.2, to: 90, src: 60.2, heart: 0 }, // one bolt; one walks out
];
export const AD_LENGTH = 67;
export const clipAt = (adT: number) => CLIPS.find((c) => adT < c.to) ?? CLIPS[CLIPS.length - 1];
/** story time for an ad time */
export const storyTime = (adT: number) => {
  const c = clipAt(adT);
  return c.src + (adT - c.from) * (c.rate ?? 1);
};
