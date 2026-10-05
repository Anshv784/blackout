import { chromium } from "playwright";
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
  const errs: string[] = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto("http://127.0.0.1:5173/");
  await p.getByRole("button", { name: "ENTER" }).click({ timeout: 30000 });
  // headless runs at a few fps; sample by the intro's own clock via the progress bar
  const shots = [4, 9, 13, 19, 24, 31];
  for (const at of shots) {
    await p.waitForFunction((target) => {
      const el = document.querySelector(".intro-progress i") as HTMLElement | null;
      return !!el && parseFloat(el.style.width) >= (target / 38) * 100;
    }, at, { timeout: 240000 });
    await p.screenshot({ path: `demo/intro-${at}.png` });
  }
  console.log("errors", errs);
  await b.close();
})();
