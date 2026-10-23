// ui-shots.mjs – visual verification: screenshots + overflow assertions at
// 360x640 (phone) and 1280x800 (desktop) for the 7 required screens.
// Run: node ui-shots.mjs   (needs the static server on :8123)
import { chromium } from 'playwright-core';
import fs from 'fs';

const BASE = 'http://localhost:8123';
const savedFiles = [];
let failures = 0;

function check(name, cond, extra = '') {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}${extra ? ' – ' + extra : ''}`); }
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });

async function openCtx(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  return ctx;
}

async function shotAndCheck(page, ctx, label, width) {
  await page.waitForTimeout(250); // let fonts/layout settle
  const m = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }));
  check(`no horizontal overflow @${width}px – ${label}`, m.scrollW <= m.innerW + 1,
    `scrollWidth=${m.scrollW}, innerWidth=${m.innerW}`);
  const file = `e2e-shots/${label}-${width}.png`;
  await page.screenshot({ path: file, fullPage: false });
  savedFiles.push(file);
}

// select a legal card then confirm with "بازی کن"
async function playCard(page) {
  await page.locator('.hand-area .card[data-legal="1"]').first().click();
  await page.click('#play-confirm');
  await page.waitForTimeout(120);
}

async function playFour(page) {
  for (let i = 0; i < 4; i++) {
    if (await page.locator('#pass-confirm').count()) {
      await page.click('#pass-confirm');
      await page.waitForSelector('.hand-area .card', { timeout: 3000 });
    }
    await page.locator('.hand-area .card[data-legal="1"]').first().click();
    await page.click('#play-confirm');
    await page.waitForTimeout(120);
  }
  await page.waitForSelector('#trick-continue', { timeout: 3000 });
}

for (const [width, height] of [[360, 640], [1280, 800]]) {
  // ---------- start screen (normal mode, names filled for realism) ----------
  {
    const ctx = await openCtx(width, 640);
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGEERROR:', String(e)));
    await page.goto(BASE + '/');
    await page.waitForSelector('form input');
    await page.fill('form input >> nth=0', 'علی');
    await page.fill('form input >> nth=1', 'مریم');
    await page.fill('form input >> nth=2', 'رضا');
    await page.fill('form input >> nth=3', 'سارا');
    await shotAndCheck(page, ctx, 'start', width);

    // 2..6: deterministic debug page
    const dctx = await openCtx(width, 640);
    const d = await dctx.newPage();
    d.on('pageerror', e => console.log('PAGEERROR:', String(e)));
    await d.goto(BASE + '/?debug=1&seed=123');
    await d.waitForSelector('#pass-confirm');
    await shotAndCheck(d, dctx, 'pass', width);

    // playing turn with 12 cards in hand
    await d.click('#pass-confirm');
    await d.waitForSelector('.hand-area .card');
    const handCount = await d.locator('.hand-area .card').count();
    check(`12 cards in hand @${width}px`, parseInt(handCount, 10) === 12, `got ${handCount}`);
    await shotAndCheck(d, dctx, 'playing', width);

    // trick result
    await playFour(d);
    await d.waitForTimeout(350);
    await shotAndCheck(d, dctx, 'trick-result', width);

    // guess pick (6 cards)
    await d.click('#trick-continue');
    await d.waitForSelector('#pass-title');
    await d.click('#pass-confirm');
    await d.waitForSelector('.guess-card');
    await shotAndCheck(d, dctx, 'guess-pick', width);

    // guess result (after flip)
    await d.locator('.guess-card').first().click();
    await d.click('#guess-confirm');
    await d.waitForSelector('#guess-result-message');
    await d.waitForTimeout(900); // flip animation ~700ms
    await shotAndCheck(d, dctx, 'guess-result', width);

    // ---------- game over: fast-forward to the 12th trick ----------
    await d.click('#guess-continue'); // -> PASS_SCREEN
    await d.waitForSelector('#pass-confirm');
    await d.evaluate(() => {
      const st = window.Game.getState();
      st.tricksA = 11; st.tricksB = 0; st.tricksPlayed = 11; // jump to the last trick
    });
    await playFour(d);
    await d.click('#trick-continue');
    await d.waitForTimeout(600); // collect animation
    await d.waitForSelector('#pass-confirm', { timeout: 3000 }); // guess pass screen (trump unset)
    await d.click('#pass-confirm');
    await d.waitForSelector('.guess-card');
    await d.locator('.guess-card').first().click();
    await d.click('#guess-confirm');
    await d.waitForSelector('#guess-result-message');
    await d.waitForTimeout(900);
    await d.click('#guess-continue');
    await d.waitForTimeout(400);
    const goPhase = await d.evaluate(() => window.Game.getState().phase);
    check(`game over reached @${width}px`, await d.evaluate(() => window.Game.getState().phase) === 'GAME_OVER');
    await shotAndCheck(d, dctx, 'game-over', width);
    await dctx.close();
    await ctx.close();
  }
}

await browser.close();
console.log('\nscreenshots saved:');
savedFiles.forEach(f => console.log('  ' + f));
if (failures > 0) { console.log(`\n${failures} CHECK(S) FAILED`); process.exit(1); }
console.log('\nALL VISUAL CHECKS PASSED');
