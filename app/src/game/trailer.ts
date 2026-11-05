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
  /** no dip to black at this beat (it is not a scene change) */
  nodip?: boolean;
}
// the story plays in real time; these beats only set the score (heartbeat, zone hum) and where the
// picture dips to black between scenes
export const CLIPS: Clip[] = [
  { from: 0, to: 6, src: 0, heart: 0, zone: 0 }, // the lights die
  { from: 6, to: 13, src: 6 }, // DUSK wakes, the torch
  { from: 13, to: 22, src: 13, heart: 0.9 }, // NYX hunts; the beam passes over him
  { from: 22, to: 29, src: 22, heart: 0.3 }, // WRAITH sprays and dies
  { from: 29, to: 33, src: 29, heart: 0, zone: 1 }, // the Warden; the circle closes
  { from: 33, to: 38.5, src: 33, heart: 0.4, zone: 0.6 }, // NYX walks to the lamp
  { from: 38.5, to: 43.2, src: 38.5, nodip: true }, // DUSK waits
  { from: 43.2, to: 52, src: 43.2, heart: 0, nodip: true }, // one shot; one walks out
  { from: 52, to: 90, src: 52 },
];
export const AD_LENGTH = 52;
export const clipAt = (adT: number) => CLIPS.find((c) => adT < c.to) ?? CLIPS[CLIPS.length - 1];
/** story time for an ad time */
export const storyTime = (adT: number) => {
  const c = clipAt(adT);
  return c.src + (adT - c.from) * (c.rate ?? 1);
};
