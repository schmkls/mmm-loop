// Canned step-6 agent. SCENARIO_REPORT: ok (default) | nothing
import fs from "node:fs";

const prompt = await Bun.stdin.text();
const mode = process.env.SCENARIO_REPORT ?? "ok";
if (mode === "nothing") process.exit(0);

const reportPath = /create or edit `([^`]+)`/.exec(prompt)![1]!;
const num = /<section id="sprint-(\d{2})">/.exec(prompt)![1]!;
const marker = `<section id="sprint-${num}">`;

const section =
  `${marker}<h2>Sprint ${num}</h2><svg width="10" height="10"></svg>` +
  `<p>Canned summary.</p><div class="quiz"><button onclick="this.nextSibling.hidden=false">reveal</button><span hidden>42</span></div></section>`;

let html = fs.existsSync(reportPath)
  ? fs.readFileSync(reportPath, "utf8")
  : "<style>body{font:16px sans-serif}</style>\n<main>\n</main>\n";

if (html.includes(marker)) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  html = html.replace(new RegExp(`${escaped}[\\s\\S]*?</section>`), section);
} else {
  html = html.replace("</main>", `${section}\n</main>`);
}
fs.writeFileSync(reportPath, html);
