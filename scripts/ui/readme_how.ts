import { chromium } from "playwright";
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  await p.addInitScript("localStorage.setItem('bo-intro-seen','1')");
  await p.goto("http://127.0.0.1:5173/#/how");
  await p.waitForTimeout(2000);
  await p.getByRole("button", { name: "PEEK AT A MATCH" }).click();
  await p.waitForTimeout(10000);
  await p.screenshot({ path: "/tmp/how-top.png" });
  await b.close();
})();
