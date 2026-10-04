// Renders the README banner and grabs the landing page for docs/assets.
import { chromium } from "playwright";
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1520, height: 400 } });
  await p.goto(`file://${process.argv[2]}`);
  await p.waitForTimeout(1500);
  await p.locator(".b").screenshot({ path: "docs/assets/banner.png" });
  const h = await b.newPage({ viewport: { width: 1440, height: 860 } });
  await h.addInitScript("localStorage.setItem('bo-intro-seen','1')");
  await h.goto("http://127.0.0.1:5173/");
  await h.waitForTimeout(9000);
  await h.screenshot({ path: "docs/assets/home.png" });
  await b.close();
})();
