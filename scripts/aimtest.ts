import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => localStorage.setItem("bo-intro-seen", "1"));
const p = await ctx.newPage();
await p.goto("http://127.0.0.1:5173/#/r/13");
await p.waitForSelector("text=TAKE A SEAT", { timeout: 30000 });
await p.click("text=TAKE A SEAT"); await p.waitForSelector("text=START MATCH", { timeout: 90000 });
await p.click("text=START MATCH"); await p.waitForSelector(".game canvas", { timeout: 30000 });
await p.waitForTimeout(6000);
await p.mouse.move(640, 360);
for (const [x, y] of [[740, 360], [940, 360], [640, 360], [340, 360], [640, 360]]) {
  await p.mouse.move(x, y, { steps: 5 });
  await p.waitForTimeout(700);
  const aim = await p.evaluate(() => (window as any).__session.input.aim);
  console.log(`cursor ${x},${y} -> aim ${Math.round((aim / 65536) * 360)}°`);
}
await p.screenshot({ path: "/private/tmp/claude-501/-Users-anshverma/babdf4cb-cebe-4f9c-af2c-654d38d13736/scratchpad/laser.png" });
await b.close();
