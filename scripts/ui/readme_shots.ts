// Captures every README image in docs/assets from the running dev server (npm run dev).
//   npx tsx scripts/ui/readme_shots.ts
// home · story (a trailer frame) · lobby · storm (a live night) · map · settings · verdict
import { chromium, type Page } from "playwright";

const URL = "http://127.0.0.1:5173/";
const OUT = "docs/assets";
const shot = (p: Page, name: string) => p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 86, timeout: 180000 });
const seen = "localStorage.setItem('bo-intro-seen','1');localStorage.setItem('bo-guest','1');localStorage.setItem('bo-name','DUSK')";
// third person needs the pointer captured; headless can't, so pretend it is
const lock = "Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => document.querySelector('canvas') })";

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });

  // landing
  const home = await (await b.newContext({ viewport: { width: 1440, height: 860 } })).newPage();
  await home.addInitScript(seen);
  await home.goto(URL);
  await home.waitForTimeout(9000);
  await shot(home, "home");
  await home.context().close();

  // the story: NYX's torch sweeping past DUSK in the dark
  const story = await (await b.newContext({ viewport: { width: 1400, height: 788 } })).newPage();
  await story.goto(URL);
  await story.getByRole("button", { name: "ENTER" }).click({ timeout: 30000 });
  await story.waitForTimeout(5000);
  await story.evaluate("globalThis.__introT = 20.4");
  await story.waitForTimeout(3500);
  await shot(story, "story");
  await story.context().close(); // one WebGL page at a time, or swiftshader starves

  // a night, from the lobby to the verdict
  const ctx = await b.newContext({ viewport: { width: 1400, height: 860 } });
  await ctx.addInitScript(seen);
  const p = await ctx.newPage();
  await p.goto(URL);
  await p.getByRole("button", { name: /CREATE A ROOM/ }).click({ timeout: 30000 });
  await p.waitForURL(/\/r\//, { timeout: 60000 });
  const id = p.url().match(/\/r\/(\d+)/)![1];
  await p.waitForTimeout(4000);
  await shot(p, "lobby");
  await p.getByRole("button", { name: "START THE NIGHT" }).click({ timeout: 60000 });
  await p.locator(".compass").waitFor({ timeout: 90000 });
  await p.evaluate(lock);
  await p.locator(".night-card").waitFor({ state: "detached", timeout: 90000 });
  // look toward the crossroads (open ground) instead of whatever wall you spawned facing
  await p.evaluate("(() => { const q = window.__session.myPos(); const c = window.__controls; c.camYaw = Math.atan2(24 * 256 - q.y, 24 * 256 - q.x); c.camPitch = 0.3; })()");
  await p.waitForTimeout(6000);
  await shot(p, "storm");
  await p.keyboard.press("Tab");
  await p.waitForTimeout(2500);
  await shot(p, "map");
  await p.keyboard.press("Tab");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(2000);
  await shot(p, "settings");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(20000); // let the night run so the replay has something in it
  // end the night as host: lights on, the verdict and replay
  await p.evaluate(`(async () => { const { client } = await import('/src/game/identity.ts'); await client.sendEr([client.endNowIx(${id}n)]); })()`);
  await p.locator(".reveal-top").waitFor({ timeout: 120000 });
  await p.waitForTimeout(15000);
  await shot(p, "verdict");

  // the phone shot comes from the touch run (scripts/ui/mobile.ts → demo/m-live.png):
  //   sips -s format jpeg demo/m-live.png --out docs/assets/phone.jpg

  console.log("done");
  await b.close();
})();
