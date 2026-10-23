// e2e.mjs – automated end-to-end test in a real headless browser (Edge via playwright-core)
// Prereq: static server on :8123 (python -m http.server 8123) — Run: node e2e.mjs
import { chromium } from 'playwright-core';
import assert from 'assert';
import fs from 'fs';

const BASE = 'http://localhost:8123';
const SHOTS = 'e2e-shots';
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}: ${e.message}`); }
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });

function watch(page, bucket) {
  page.on('console', m => { if (m.type() === 'error') bucket.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => bucket.push('PAGEERROR: ' + String(e)));
}

// play one full trick by clicking REAL UI elements only; screenshot after every card play
// (select a legal card, then confirm with "بازی کن")
async function playFullTrick(page) {
  for (let i = 0; i < 12; i++) {
    if (await page.locator('#trick-continue').count()) return;
    if (await page.locator('#pass-confirm').count()) {
      await page.click('#pass-confirm');
      await page.waitForSelector('.hand-area .card', { timeout: 3000 });
    }
    await page.locator('.hand-area .card[data-legal="1"]').first().click();
    await page.click('#play-confirm');
    await page.screenshot({ path: `${SHOTS}/play-${i + 1}.png` });
    await page.waitForTimeout(80);
  }
  throw new Error('trick never resolved within 12 actions');
}

// ============================================================ A) full trick, table cards valid
const errors1 = [];
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  watch(page, errors1);
  await page.goto(`${BASE}/?debug=1&seed=123`);
  await page.waitForSelector('#pass-confirm');
  await page.screenshot({ path: `${SHOTS}/start.png` });

  for (let i = 0; i < 4; i++) {
    if (await page.locator('#pass-confirm').count()) {
      await page.click('#pass-confirm');
      await page.waitForSelector('.hand-area .card', { timeout: 3000 });
    }
    await page.locator('.hand-area .card[data-legal="1"]').first().click();
    await page.click('#play-confirm');
    await page.screenshot({ path: `${SHOTS}/play-${i + 1}.png` }); // screenshot after each of the 4 plays
    await page.waitForTimeout(80);
  }
  await page.waitForSelector('#trick-continue', { timeout: 3000 });

  const tableCards = await page.locator('.trick-area .card').allTextContents();
  const names = await page.locator('.trick-area .card-player').allTextContents();
  const winnerIdx = await page.evaluate(() => window.Game.getState().lastTrickInfo.winnerIdx);
  var ledSuit = await page.evaluate(() => window.Game.getState().lastTrickInfo.ledSuit);
  console.log('table cards after trick:', JSON.stringify(tableCards));
  console.log('player labels:', JSON.stringify(names), '| winner seat:', winnerIdx);

  check('a1: exactly 4 table cards after the trick', () => assert.strictEqual(tableCards.length, 4));
  check('a2: no "undefined" in any table card text', () => {
    for (const t of tableCards) assert.ok(!t.includes('undefined'), `"undefined" in: ${t}`);
  });
  check('a3: every card shows a valid rank + suit symbol', () => {
    // corner shows "rank+symbol" and the big center shows the symbol again -> e.g. "K♥♥"
    for (const t of tableCards) assert.ok(/^(K|Q|J|10|[2-9])[♥♠♦♣]{2}$/.test(t.trim()), `bad card text: "${t}"`);
  });
  check('a4: every table card labeled with a real player name', () => {
    assert.strictEqual(names.length, 4);
    for (const n of names) assert.ok(n && n !== 'undefined' && n !== '?', `bad player label: ${n}`);
  });
  await page.screenshot({ path: `${SHOTS}/trick-result.png` });

  // ============================================================ C) pass screen before the guess names the WINNING team
  await page.click('#trick-continue');
  await page.waitForSelector('#pass-title');
  const phase = await page.evaluate(() => window.Game.getState().phase);
  const winnerName = await page.evaluate(() => {
    const s = window.Game.getState();
    return s.players[s.lastTrickInfo.winnerIdx];
  });
  const title = await page.textContent('#pass-title');
  check('c1: phase is GUESS_PASS_SCREEN', () => assert.strictEqual(phase, 'GUESS_PASS_SCREEN'));
  check('c2: pass screen names a member of the winning team', () => {
    assert.ok(title.includes('دستگاه را به'), `title: ${title}`);
    assert.ok(title.includes(winnerName), `"${title}" should contain winner "${winnerName}"`);
  });
  await page.screenshot({ path: `${SHOTS}/guess-pass.png` });

  // ============================================================ B) guess screen: 6 cards, select, confirm, result
  await page.click('#pass-confirm');
  await page.waitForSelector('.guess-card');
  const nGuessCards = await page.locator('.guess-card').count();
  check('b1: exactly 6 face-down guess cards', () => assert.strictEqual(nGuessCards, 6));
  const interactive = await page.locator('.guess-card').first().evaluate(el => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return cs.pointerEvents !== 'none' && cs.visibility !== 'hidden' && el.contains(hit);
  });
  check('b2: guess cards actually clickable (no overlay blocking)', () => assert.ok(interactive));
  await page.screenshot({ path: `${SHOTS}/guess-pick.png` });

  await page.locator('.guess-card').first().click();
  const selCount = await page.locator('.guess-card.selected').count();
  const confirmEnabled = await page.locator('#guess-confirm').isEnabled();
  check('b3: selected state visible', () => assert.strictEqual(selCount, 1));
  check('b3: confirm button enabled after selection', () => assert.ok(confirmEnabled));
  await page.click('#guess-confirm');
  await page.waitForSelector('#guess-result-message');
  const msg = (await page.textContent('#guess-result-message')).trim();
  const revealed = (await page.locator('.guess-face').textContent()).trim();
  check('b4: Persian result message appears', () => assert.ok(msg.length > 3, `message: "${msg}"`));
  check('b5: revealed card is a valid special card', () => {
    // ace: corner "A ♥" + big symbol; jokers: mark + Persian label ("جوکر رنگی"/"جوکر بی‌رنگ")
    assert.ok(/^A ?[♥♠♦♣]/.test(revealed) || revealed.includes('جوکر'), `revealed: "${revealed}"`);
  });
  await page.screenshot({ path: `${SHOTS}/guess-result.png` });
  await page.click('#guess-continue');
  const afterGuess = await page.evaluate(() => window.Game.getState().phase);
  check('b6: game continues after guess', () => assert.ok(['PASS_SCREEN', 'GAME_OVER'].includes(afterGuess)));
  console.log('guess message:', msg, '| revealed:', revealed);
}

// ============================================================ D) force ace-of-led -> trump set -> no more guess screens
const errors2 = [];
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  watch(page, errors2);
  await page.goto(`${BASE}/?debug=1&seed=123&force=${ledSuit}&slot=0`); // same seed -> same deal; forced ace of led suit at slot 0
  await page.waitForSelector('#pass-confirm');

  await playFullTrick(page, 'd'); // trick 1 (same deal as test A: identical seed)
  await page.click('#trick-continue');
  await page.waitForSelector('#pass-confirm');
  await page.click('#pass-confirm');
  await page.waitForSelector('.guess-card');
  await page.locator('.guess-card').first().click(); // slot 0 = forced ace of the led suit
  await page.click('#guess-confirm');
  await page.waitForSelector('#guess-result-message');
  const msgD = (await page.textContent('#guess-result-message')).trim();
  const trump = await page.evaluate(() => window.Game.getState().trump);
  check('d1: forced ace-of-led-suit sets trump', () => assert.strictEqual(trump, ledSuit));
  console.log('d1 result message:', msgD);

  // continue: play one more full trick – NO guess screen may appear anywhere
  await page.click('#guess-continue');
  let sawGuessCards = false;
  for (let i = 0; i < 12; i++) {
    if (await page.locator('#trick-continue').count()) break;
    sawGuessCards = sawGuessCards || (await page.locator('.guess-card').count()) > 0;
    if (await page.locator('#pass-confirm').count()) {
      await page.click('#pass-confirm');
      await page.waitForSelector('.hand-area .card', { timeout: 3000 });
    }
    await page.locator('.hand-area .card[data-legal="1"]').first().click();
    await page.click('#play-confirm');
    await page.waitForTimeout(80);
  }
  await page.waitForSelector('#trick-continue');
  await page.click('#trick-continue');
  await page.waitForTimeout(600); // allow the collect animation to finish (state advances ~320ms later)
  const phaseAfter = await page.evaluate(() => window.Game.getState().phase);
  const guessCardsOnScreen = await page.locator('.guess-card').count();
  check('d2: no guess screen once trump is set', () => {
    assert.strictEqual(phaseAfter, 'PASS_SCREEN');
    assert.strictEqual(guessCardsOnScreen, 0);
    assert.ok(!sawGuessCards, 'a guess screen appeared during the trump-set trick');
  });
  await page.screenshot({ path: `${SHOTS}/after-trump-set.png` });
  console.log('errors page 2:', JSON.stringify(errors2));
}

await browser.close();
console.log('\nall console/page errors:', JSON.stringify([...errors1, ...errors2]));

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL E2E CHECKS PASSED');
