import fs from "fs";
import { inputVelocity, moveBody, sprintStep, packMoved, SPRINT_SPEED, SPEED, BTN_SPRINT } from "../app/src/game/sim.ts";
import { SPAWNS } from "../app/src/game/gen.ts";
let s = 12345;
const next = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s; };
let out = "";
for (const [sx, sy] of SPAWNS.slice(0, 5)) {
  const p = { x: sx * 256 + 128, y: sy * 256 + 128 };
  let moved = 0;
  for (let i = 0; i < 400; i++) {
    const dx = ((next() >>> 16) % 255) - 127;
    const dy = ((next() >>> 16) % 255) - 127;
    const buttons = (s >>> 9) % 7 < 3 ? BTN_SPRINT | ((s >>> 12) & 1) : 0;
    const [sprinting, fatigue, winded] = sprintStep(moved, buttons, dx, dy);
    const [vx, vy] = inputVelocity(dx, dy, sprinting ? SPRINT_SPEED : SPEED);
    const ox = p.x, oy = p.y;
    moveBody(p, vx, vy);
    moved = packMoved(ox !== p.x || oy !== p.y, sprinting, winded, fatigue);
    out += `${p.x},${p.y},${fatigue};`;
  }
}
const rust = fs.readFileSync("/tmp/blackout-mirror-rust.txt", "utf8");
console.log(rust === out ? `MATCH: ${out.split(";").length - 1} steps identical` : `MISMATCH at char ${[...out].findIndex((c, i) => c !== rust[i])}`);
