import { chromium } from "playwright";
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1400, height: 860 } });
  await p.addInitScript("localStorage.setItem('bo-intro-seen','1')");
  await p.goto("http://127.0.0.1:5173/");
  await p.getByRole("button", { name: /CREATE A ROOM/ }).click({ timeout: 30000 });
  await p.getByRole("button", { name: "PLAY AS GUEST" }).click();
  await p.getByRole("button", { name: "ENTER AS GUEST" }).click();
  await p.waitForURL(/\/r\//, { timeout: 60000 });
  await p.getByRole("button", { name: "START THE NIGHT" }).click({ timeout: 60000 });
  await p.locator(".hud-clock").waitFor({ timeout: 90000 });
  await p.waitForTimeout(9000);
  await p.screenshot({ path: "demo/hud-clock.png" });
  await p.keyboard.press("Escape").catch(() => {});
  await b.close();
})();
