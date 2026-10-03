// Headless visual check: plays a real match in Chromium against bots and screenshots each phase.
//   npx tsx scripts/visual.ts <roomId> [outDir]
import { chromium } from "playwright";
import fs from "fs";

const roomId = process.argv[2] ?? "4";
const out = process.argv[3] ?? "/tmp/blackout-shots";
fs.mkdirSync(out, { recursive: true });
const URL = process.env.URL ?? "http://127.0.0.1:5173/";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  ...(process.env.VIDEO ? { recordVideo: { dir: process.env.VIDEO, size: { width: 1280, height: 720 } } } : {}),
});
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`);
});

await page.goto(URL, { waitUntil: "networkidle" });
await sleep(2500);
await page.screenshot({ path: `${out}/01-home.png` });
log("home");

await page.goto(`${URL}#/r/${roomId}`);
await page.waitForSelector(".lobby, .game, .reveal", { timeout: 30000 });
await sleep(1500);
if (await page.$(".reveal")) {
  log("room in reveal — pressing play again");
  await page.click("text=PLAY AGAIN");
  await page.waitForSelector(".lobby", { timeout: 30000 });
}
await page.screenshot({ path: `${out}/02-lobby.png` });
log("lobby");
await page.click("text=TAKE A SEAT");
await page.waitForSelector("text=LEAVE SEAT", { timeout: 30000 });
await sleep(800);
await page.click(`.fill .chip:has-text('${process.env.FILL ?? "6"}')`).catch(() => {});
await page.screenshot({ path: `${out}/03-seated.png` });
log("seated");
await page.click("text=START MATCH");
await page.waitForSelector(".game canvas", { timeout: 30000 });
log("game started");
await sleep(1500);
await page.screenshot({ path: `${out}/04-countdown.png` });

if (process.env.MODE === "look") {
  // stand mostly still and sweep the flashlight: screenshots while alive
  await sleep(3500);
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2;
    await page.mouse.move(720 + Math.cos(ang) * 300, 450 + Math.sin(ang) * 260, { steps: 10 });
    if (i % 3 === 1) {
      await page.keyboard.down("d");
      await sleep(500);
      await page.keyboard.up("d");
    }
    await sleep(900);
    await page.screenshot({ path: `${out}/look-${String(i).padStart(2, "0")}.png` });
  }
  log("look shots done", await page.evaluate(() => (window as any).__session?.view?.me.alive));
  await browser.close();
  process.exit(0);
}
// play: wander with WASD, sweep the mouse, fire bursts
const keys = ["w", "a", "s", "d"];
let shot = 5;
const start = Date.now();
while (Date.now() - start < 150_000) {
  if (await page.$(".reveal")) break;
  const k = keys[Math.floor(Math.random() * 4)];
  await page.keyboard.down(k);
  const ang = Math.random() * Math.PI * 2;
  await page.mouse.move(720 + Math.cos(ang) * 260, 450 + Math.sin(ang) * 220, { steps: 6 });
  if (Math.random() < 0.5) await page.mouse.down();
  await sleep(700 + Math.random() * 600);
  await page.mouse.up();
  await page.keyboard.up(k);
  if (Date.now() - start > shot * 1000 && shot < 60) {
    await page.screenshot({ path: `${out}/05-play-${String(shot).padStart(2, "0")}.png` });
    log("play shot", shot);
    shot += 12;
  }
}
await page.screenshot({ path: `${out}/06-end.png` });
log("end/reveal?", !!(await page.$(".reveal")));
await page.waitForSelector(".reveal canvas", { timeout: 60000 }).catch(() => {});
await sleep(2500);
await page.screenshot({ path: `${out}/07-reveal-dark.png` });
await sleep(7000);
await page.screenshot({ path: `${out}/08-reveal-lights.png` });
log("reveal shots");
const stats = await page.evaluate(() => {
  const s: any = (window as any).__session;
  return s ? { rtt: s.rtt, views: s.viewsRecv, tx: s.txSent, room: s.room?.status } : null;
});
log("session stats", stats);
log("errors", errors.slice(0, 15));
await ctx.close();
await browser.close();
