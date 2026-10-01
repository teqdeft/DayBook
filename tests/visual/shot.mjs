// Screenshots a Daybook page for comparing with the design canvas (docs/design/1x/*.png).
// Uses the installed Chrome, signs in through the dev-only sign-in route, and saves a PNG.
//
//   node tests/visual/shot.mjs --as vishal@company.com --path /today --out scratch/shots/today.png
//   options: --width 1440 --height 900 --full (full page) --click "text=New project" (repeatable)
//            --wait 500 (ms after load) --base http://localhost:3000 --scheme dark
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

function readArgs(argv) {
  const args = { click: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    const next = argv[i + 1];
    if (key === 'full') args.full = true;
    else if (key === 'click') {
      args.click.push(next);
      i += 1;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

const args = readArgs(process.argv.slice(2));
const base = args.base ?? 'http://localhost:3000';
const width = Number(args.width ?? 1440);
const height = Number(args.height ?? 900);
const out = args.out ?? 'scratch/shots/shot.png';
// Git Bash rewrites '/today' to 'C:/Program Files/Git/today'; undo that.
const route = String(args.path ?? '/')
  .replace(/\\/g, '/')
  .replace(/^[A-Za-z]:\/.*?\/Git(?=\/)/i, '');

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: args.scheme === 'dark' ? 'dark' : 'light',
  });
  if (args.as) {
    const response = await context.request.post(`${base}/api/auth/dev-login`, {
      data: { email: args.as },
      headers: { Origin: base },
    });
    if (!response.ok())
      throw new Error(`dev-login failed: ${response.status()} ${await response.text()}`);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  for (const selector of args.click) {
    await page.locator(selector).first().click();
    await page.waitForTimeout(400);
  }
  if (args.wait) await page.waitForTimeout(Number(args.wait));
  mkdirSync(path.dirname(out), { recursive: true });
  // caret: 'initial' — hiding the caret writes a style onto inputs, which React reports as a
  // hydration mismatch when the screenshot lands before a slow dev page has hydrated.
  await page.screenshot({ path: out, fullPage: Boolean(args.full), caret: 'initial' });
  console.log(`saved ${out} (${page.url()})`);
  if (errors.length) console.log(`browser errors:\n  ${errors.join('\n  ')}`);
} finally {
  await browser.close();
}
