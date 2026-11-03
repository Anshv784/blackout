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
}
export const CLIPS: Clip[] = [
  { from: 0, to: 2.5, src: 1.0, rate: 1.2, heart: 0, zone: 0 }, // the lights die
  { from: 2.5, to: 4.5, src: 8.5 }, // DUSK wakes, torch clicks on
  { from: 4.5, to: 7.5, src: 16.2, rate: 1.2, heart: 0.9 }, // the beam passes over him
  { from: 7.5, to: 10, src: 24.6, heart: 0.3 }, // WRAITH sprays and dies
  { from: 10, to: 12, src: 29.8, heart: 0, zone: 1 }, // the Warden
  { from: 12, to: 14.5, src: 33.8, rate: 1.4, zone: 0 }, // the Meadow from above
  { from: 14.5, to: 16.5, src: 38.5, rate: 1.3, heart: 0.5 }, // in the tall grass
  { from: 16.5, to: 18.8, src: 42.6 }, // the silent crossbow
  { from: 18.8, to: 21.6, src: 46.0, heart: 0 }, // aimed throw, blast
  { from: 21.6, to: 23.4, src: 49.8 }, // loot the body
  { from: 23.4, to: 25.6, src: 52.0, rate: 1.3, zone: 1 }, // the circle closes
  { from: 25.6, to: 30, src: 57.0, heart: 1, zone: 0 }, // one bolt
  { from: 30, to: 45, src: 62.0, heart: 0 }, // the one who walks out
];
export const AD_LENGTH = 34;
export const clipAt = (adT: number) => CLIPS.find((c) => adT < c.to) ?? CLIPS[CLIPS.length - 1];
/** story time for an ad time */
export const storyTime = (adT: number) => {
  const c = clipAt(adT);
  return c.src + (adT - c.from) * (c.rate ?? 1);
};
