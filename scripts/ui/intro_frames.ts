// Freeze the trailer at exact moments and screenshot each (for reviewing shots).
import { chromium } from "playwright";
const times = (process.argv[2] ?? "1,5,7.5,8.5,9.5,10.5,12,14.5,17,18.5,22,26,29,30.5,32.5").split(",").map(Number);
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs: string[] = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto("http://127.0.0.1:5173/");
  await p.getByRole("button", { name: "ENTER" }).click({ timeout: 30000 });
  await p.waitForTimeout(6000);
  for (const t of times) {
    await p.evaluate(`globalThis.__introT = ${t}`);
    await p.waitForTimeout(2200);
    await p.screenshot({ path: `demo/f-${String(t).replace(".", "_")}.png` });
  }
  console.log("errors", errs);
  await b.close();
})();
