// Render the 1200x630 social card from a real gameplay screenshot.
import { chromium } from "playwright";
import fs from "fs";
const shot = process.argv[2];
const out = process.argv[3];
const img = fs.readFileSync(shot).toString("base64");
const html = `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>body{margin:0;width:1200px;height:630px;background:#05060a;font-family:'Chakra Petch';overflow:hidden;position:relative}
.bg{position:absolute;inset:0;background:url(data:image/png;base64,${img}) center/cover;filter:saturate(1.1)}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,#05060aee 0%,#05060acc 38%,#05060a33 70%,transparent)}
.t{position:absolute;left:64px;top:150px;color:#fff}
h1{font-size:118px;margin:0;letter-spacing:6px;line-height:1}
p{font-size:34px;color:#c9d1e6;margin:18px 0 0;line-height:1.3}
b{color:#ffd166}
.k{position:absolute;left:64px;bottom:56px;font-family:'JetBrains Mono';font-size:20px;color:#9aa4bd;letter-spacing:2px}
.dot{display:inline-block;width:12px;height:12px;border-radius:50%;background:#06d6a0;margin-right:10px;box-shadow:0 0 12px #06d6a0}
</style></head><body><div class="bg"></div><div class="shade"></div>
<div class="t"><h1>BLACKOUT</h1><p>Nobody can see you.<br><b>Not even the chain.</b></p></div>
<div class="k"><span class="dot"></span>REAL-TIME BATTLE ROYALE · MAGICBLOCK PRIVATE EPHEMERAL ROLLUP</div></body></html>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.setContent(html, { waitUntil: "networkidle" });
await p.screenshot({ path: out });
await b.close();
console.log("og", out);
