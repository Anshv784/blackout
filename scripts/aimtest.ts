import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => localStorage.setItem("bo-intro-seen", "1"));
const p = await ctx.newPage();
await p.goto("http://127.0.0.1:5173/#/r/13");
await p.waitForSelector(".dock >> text=TAKE A SEAT", { timeout: 30000 });
await p.click(".dock >> text=TAKE A SEAT"); await p.waitForSelector("text=START THE NIGHT", { timeout: 90000 });
await p.click("text=START THE NIGHT"); await p.waitForSelector(".game canvas", { timeout: 30000 });
await p.waitForTimeout(6000);
await p.mouse.move(640, 300);
for (const [x, y] of [[640, 300], [900, 300], [380, 300], [640, 150], [640, 300]]) {
  await p.mouse.move(x, y, { steps: 5 });
  await p.waitForTimeout(700);
  const aim = await p.evaluate(() => (window as any).__session.input.aim);
  const cross = await p.evaluate(() => { const el = document.querySelector(".crosshair") as HTMLElement; return el?.style.transform; });
  console.log(`cursor ${x},${y} -> aim ${Math.round((aim / 65536) * 360)}° crosshair ${cross}`);
}
await p.screenshot({ path: "/private/tmp/claude-501/-Users-anshverma/babdf4cb-cebe-4f9c-af2c-654d38d13736/scratchpad/laser.png" });
await b.close();
