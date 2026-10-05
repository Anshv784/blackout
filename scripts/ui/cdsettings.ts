import { chromium } from "playwright";
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 860 } });
  await ctx.addInitScript("localStorage.setItem('bo-intro-seen','1');localStorage.setItem('bo-guest','1');localStorage.setItem('bo-name','TESTER');localStorage.setItem('bo-prefs-v1', JSON.stringify({weather:false}))");
  const p = await ctx.newPage();
  const errs: string[] = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
  await p.goto("http://127.0.0.1:5173/");
  await p.getByRole("button", { name: /CREATE A ROOM/ }).click({ timeout: 30000 });
  await p.waitForURL(/\/r\//, { timeout: 60000 });
  await p.getByRole("button", { name: "START THE NIGHT" }).click({ timeout: 60000 });
  await p.locator(".night-card").waitFor({ timeout: 90000 });
  console.log("countdown up");
  await p.keyboard.press("p");
  await p.waitForTimeout(800);
  console.log("settings open:", await p.locator(".set-card").count());
  await p.screenshot({ path: "demo/cd-settings.png" });
  await p.waitForTimeout(4000);
  await p.screenshot({ path: "demo/cd-settings2.png" });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(1500);
  console.log("settings after esc:", await p.locator(".set-card").count(), "night card:", await p.locator(".night-card").count());
  for (let i = 0; i < 6; i++) {
    await p.waitForTimeout(2000);
    const clock = await p.locator(".hud-clock b").innerText().catch(() => "?");
    console.log("t+", (i + 1) * 2, "clock", clock, "card", await p.locator(".night-card").count());
  }
  await p.screenshot({ path: "demo/cd-after.png" });
  console.log("errors", errs.slice(0, 6));
  await b.close();
})();
