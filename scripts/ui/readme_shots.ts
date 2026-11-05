// Captures every README image in docs/assets from the running dev server (npm run dev).
//   npx tsx scripts/ui/readme_shots.ts [only,these,names]
// home · story (a trailer frame) · operator · gunsmith · lobby · storm (a night in the Yard)
// · map · settings · verdict · meadow (a trailer frame)
import { chromium, type Browser, type Page } from "playwright";

const URL = "http://127.0.0.1:5173/";
const OUT = "docs/assets";
const ONLY = process.argv[2]?.split(",");
const want = (n: string) => !ONLY || ONLY.includes(n);
const shot = (p: Page, name: string) => p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 86, timeout: 180000 });
const seen = "localStorage.setItem('bo-intro-seen','1');localStorage.setItem('bo-guest','1');localStorage.setItem('bo-name','DUSK')";
// third person needs the pointer captured; headless can't, so pretend it is
const lock = "Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => document.querySelector('canvas') })";

async function page(b: Browser, w = 1440, h = 860, skipIntro = true) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  if (skipIntro) await ctx.addInitScript(seen);
  return ctx.newPage();
}

/** Create a room, optionally pick a map, start, and wait until the night card is gone. */
async function night(p: Page) {
  await p.goto(URL);
  await p.getByRole("button", { name: /CREATE ROOM/ }).click({ timeout: 60000 });
  await p.waitForURL(/\/r\//, { timeout: 90000 });
  const id = p.url().match(/\/r\/(\d+)/)![1];
  await p.waitForTimeout(5000);
  return id;
}

async function live(p: Page) {
  await p.getByRole("button", { name: "START THE NIGHT" }).click({ timeout: 60000 });
  await p.locator(".compass").waitFor({ timeout: 120000 });
  await p.evaluate(lock);
  await p.locator(".night-card").waitFor({ state: "detached", timeout: 90000 }).catch(() => {});
  // look toward the middle of the map instead of whatever wall you spawned facing
  await p.evaluate(`(() => { const q = window.__session.myPos(); const c = window.__controls; c.camYaw = Math.atan2(24 * 256 - q.y, 24 * 256 - q.x); c.camPitch = 0.3; })()`);
  await p.waitForTimeout(6000);
}

// ends the night as host; harmless if it already ended (you died and the bots finished it)
const endNight = (p: Page, id: string) =>
  p.evaluate(`(async () => { const { client } = await import('/src/game/identity.ts'); await client.sendEr([client.endNowIx(${id}n)]); })()`).catch((e) => console.log("end_now:", String(e).split("|")[0].slice(0, 160)));

(async () => {
  const b = await chromium.launch({ channel: "chrome", args: ["--enable-webgl", "--ignore-gpu-blocklist"] });

  if (want("home")) {
    const p = await page(b);
    await p.goto(URL);
    await p.waitForTimeout(12000);
    await shot(p, "home");
    await p.context().close(); // one WebGL page at a time, or swiftshader starves
  }

  // trailer frames: the Yard (story) and the Meadow (meadow), frozen at a moment of the cut
  for (const [name, t] of [["story", process.env.STORY_T ?? "3.2"], ["meadow", process.env.MEADOW_T ?? "20.0"]] as const) {
    if (!want(name)) continue;
    const p = await page(b, 1400, 788, false);
    await p.goto(URL);
    await p.getByRole("button", { name: "ENTER" }).click({ timeout: 30000 });
    await p.waitForTimeout(5000);
    await p.evaluate(`globalThis.__introT = ${t}`);
    await p.waitForTimeout(5000);
    await shot(p, name);
    await p.context().close();
  }

  if (want("operator") || want("gunsmith")) {
    const p = await page(b);
    await p.goto(URL + "#/characters");
    await p.waitForTimeout(12000);
    if (want("operator")) await shot(p, "operator");
    if (want("gunsmith")) {
      await p.getByRole("button", { name: "GUNSMITH" }).click();
      await p.waitForTimeout(8000);
      await shot(p, "gunsmith");
    }
    await p.context().close();
  }

  if (want("lobby") || want("storm") || want("map") || want("settings") || want("verdict")) {
    const p = await page(b, 1400, 860);
    const id = await night(p);
    if (want("lobby")) await shot(p, "lobby");
    await live(p);
    if (want("storm")) await shot(p, "storm");
    await p.keyboard.press("Tab");
    await p.waitForTimeout(2500);
    if (want("map")) await shot(p, "map");
    await p.keyboard.press("Tab");
    await p.keyboard.press("Escape");
    await p.waitForTimeout(2000);
    if (want("settings")) await shot(p, "settings");
    await p.keyboard.press("Escape");
    if (want("verdict")) {
      await p.waitForTimeout(20000); // let the night run so the replay has something in it
      await endNight(p, id);
      await p.locator(".reveal-top").waitFor({ timeout: 120000 });
      await p.waitForTimeout(15000);
      await shot(p, "verdict");
    } else await endNight(p, id);
    await p.context().close();
  }

  // the phone shot comes from the touch run (scripts/ui/mobile.ts → demo/m-live.png):
  //   sips -s format jpeg demo/m-live.png --out docs/assets/phone.jpg

  console.log("done");
  await b.close();
})();
