import { chromium } from "playwright";
import fs from "fs";
const files = fs.readdirSync("demo").filter((f) => /^f-[\d_]+\.png$/.test(f)).sort((a, b) => parseFloat(a.slice(2).replace("_", ".")) - parseFloat(b.slice(2).replace("_", ".")));
const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(3,1fr);gap:4px">${files
  .map((f) => `<div style="position:relative"><img src="file://${process.cwd()}/demo/${f}" style="width:100%;display:block"><b style="position:absolute;left:6px;top:4px;color:#ff0;font:bold 22px monospace;text-shadow:0 0 4px #000">${f.slice(2, -4).replace("_", ".")}s</b></div>`)
  .join("")}</body>`;
fs.writeFileSync("/tmp/sheet.html", html);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1800, height: 1000 } });
  await p.goto("file:///tmp/sheet.html");
  await p.waitForTimeout(800);
  await p.screenshot({ path: "demo/sheet.png", fullPage: true });
  await b.close();
})();
