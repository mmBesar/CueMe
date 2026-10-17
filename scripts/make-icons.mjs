// Renders web/icon.svg to the PNG sizes the apps need. Run: node scripts/make-icons.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const svg = fs.readFileSync('web/icon.svg', 'utf8');
// CHROME env var wins; otherwise Playwright's own downloaded Chromium.
const CHROME = process.env.CHROME || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
  ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const targets = [
  ['assets/icon-1024.png', 1024], ['assets/icon-512.png', 512], ['assets/icon-256.png', 256],
  ['android/app/src/main/res/mipmap-mdpi/ic_launcher.png', 48],
  ['android/app/src/main/res/mipmap-hdpi/ic_launcher.png', 72],
  ['android/app/src/main/res/mipmap-xhdpi/ic_launcher.png', 96],
  ['android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', 144],
  ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 192],
];
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
for (const [out, size] of targets) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await p.screenshot({ path: out, omitBackground: true });
  await p.close();
}
await b.close();
console.log('icons written');
