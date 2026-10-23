// script.js – UI glue (Midnight & Gold visual layer) for Fatemeh Ahmadi
import { Game, SUIT_INFO } from './logic.js';

const app = document.getElementById('app');

// ---------- Persian digits ----------
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const toFa = (n) => String(n).replace(/\d/g, d => FA_DIGITS[d]);
const teamOf = (seat) => (seat % 2 === 0 ? 'A' : 'B');

// ---------- URL debug mode: ?debug=1&seed=123&force=S&slot=0 ----------
const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const DEBUG_SEED = parseInt(params.get('seed') || '123', 10);
function parseForce(p) {
  const f = p.get('force');
  if (!f) return null;
  if (f === 'joker_colored') return { kind: 'joker', variant: 'colored' };
  if (f === 'joker_plain') return { kind: 'joker', variant: 'plain' };
  if (['H', 'S', 'D', 'C'].includes(f)) return { kind: 'ace', suit: f };
  return null;
}
function debugOpts(extra = {}) {
  if (!DEBUG) return extra;
  return {
    seed: DEBUG_SEED,
    force: parseForce(params),
    guessSlot: parseInt(params.get('slot') || '0', 10),
    ...extra,
  };
}

// ---------- THE single card renderer (hand, table, trick result) ----------
function renderCard(card) {
  if (!card || !card.suit || !card.rank) {
    throw new Error(`renderCard: invalid card ${JSON.stringify(card)}`);
  }
  const info = SUIT_INFO[card.suit];
  if (!info) throw new Error(`renderCard: unknown suit ${card.suit}`);
  const el = document.createElement('div');
  el.className = `card ${info.color}`;
  el.dataset.suit = card.suit;
  el.dataset.rank = card.rank;
  const corner = document.createElement('span');
  corner.className = 'corner';
  corner.textContent = card.rank + info.symbol;
  const center = document.createElement('span');
  center.className = 'center-sym';
  center.textContent = info.symbol;
  el.append(corner, center);
  return el;
}

// revealed special card face (aces + jokers)
function specialFace(card, { cls = 'guess-face' } = {}) {
  const d = document.createElement('div');
  d.className = cls;
  const mark = document.createElement('div');
  mark.className = 'center-sym';
  const label = document.createElement('div');
  label.className = 'special-label';
  if (card.kind === 'ace') {
    const info = SUIT_INFO[card.suit];
    const corner = document.createElement('div');
    corner.className = 'corner';
    corner.textContent = `A ${info.symbol}`;
    mark.textContent = info.symbol;
    mark.classList.add('center-sym', info.color);
    label.textContent = `آسِ ${info.fa}`;
    d.classList.add(card.suit);
    d.append(mark, label);
  } else {
    const colored = card.variant === 'colored';
    mark.textContent = '🃏';
    mark.className = 'joker-mark';
    label.textContent = colored ? 'جوکر رنگی' : 'جوکر بی‌رنگ';
    d.className = cls + (colored ? ' joker-colored' : ' joker-plain');
    d.append(mark, label);
  }
  return d;
}

// ---------- top bar: team chips + trump badge ----------
let lastTrumpSeen = null;

function teamChip(team, tricks, attempts) {
  const chip = document.createElement('span');
  chip.className = `team-chip team-${team.toLowerCase()}`;
  const dot = document.createElement('span');
  dot.className = 'dot';
  const name = document.createElement('span');
  name.textContent = `تیم ${team}`;
  const score = document.createElement('span');
  score.className = 'score';
  score.textContent = toFa(tricks);
  const tries = document.createElement('span');
  tries.className = 'tries';
  tries.textContent = `(${toFa(attempts)} حدس)`;
  chip.append(dot, name, score, tries);
  return chip;
}

function renderTopBar(state) {
  const bar = document.createElement('div');
  bar.className = 'topbar';
  bar.appendChild(teamChip('A', state.tricksA, state.guessAttemptsA));
  const badge = document.createElement('span');
  badge.className = 'trump-badge' + (state.trump ? ' set' : '');
  if (state.trump) {
    badge.textContent = `حکم: ${SUIT_INFO[state.trump].fa} ${SUIT_INFO[state.trump].symbol}`;
    if (state.trump !== lastTrumpSeen) badge.classList.add('pop'); // animate only when newly set
  } else {
    badge.textContent = 'حکم: مشخص نشده';
  }
  lastTrumpSeen = state.trump;
  bar.appendChild(badge);
  bar.appendChild(teamChip('B', state.tricksB, state.guessAttemptsB));
  return bar;
}

// ---------- table: compass seats + led badge + winner glow ----------
// seat map (fixed layout): 0 = bottom, 1 = inline-start, 2 = top, 3 = inline-end
function renderTrickArea(entries, players, { ledSuit, winnerIdx, animateLast } = {}) {
  const area = document.createElement('div');
  area.className = 'trick-area';
  (entries || []).forEach((entry, i) => {
    const wrapper = document.createElement('div');
    wrapper.className = `played-card seat-${entry.player}`;
    const c = renderCard(entry.card); // throws on invalid card – never prints "undefined"
    c.classList.add('on-table');
    if (animateLast && i === entries.length - 1) c.classList.add('just-played');
    if (ledSuit && entry.card.suit === ledSuit) c.classList.add('led-suit');
    if (winnerIdx !== undefined && entry.player === winnerIdx) c.classList.add('winner');
    wrapper.appendChild(c);
    if (ledSuit && entry.card.suit === ledSuit && !area.querySelector('.led-badge')) {
      const badge = document.createElement('span');
      badge.className = 'led-badge';
      badge.textContent = SUIT_INFO[ledSuit].fa;
      wrapper.appendChild(badge);
    }
    const name = document.createElement('div');
    name.className = `card-player team-${teamOf(entry.player).toLowerCase()}`;
    name.textContent = players[entry.player];
    wrapper.appendChild(name);
    area.appendChild(wrapper);
  });
  return area;
}

// ---------- hand: tap to select, tap again or "بازی کن" to confirm ----------
let selectedHandIdx = null;

function renderHand(state) {
  const zone = document.createElement('div');
  zone.className = 'hand-zone';
  const p = state.currentPlayer;
  const turn = document.createElement('div');
  turn.className = `turn-chip team-${teamOf(p).toLowerCase()}`;
  turn.innerHTML = `<span class="dot"></span>نوبت: <b>${state.players[p]}</b> (تیم ${teamOf(p)})`;
  zone.appendChild(turn);

  const handDiv = document.createElement('div');
  handDiv.className = 'hand-area';
  state.hands[p].forEach((card, idx) => {
    const c = renderCard(card);
    const legal = Game.isLegalPlay(p, card);
    if (!legal) c.classList.add('disabled');
    else c.dataset.legal = '1';
    if (selectedHandIdx === idx) c.classList.add('selected');
    c.dataset.handIdx = String(idx);
    c.onclick = () => {
      if (!Game.isLegalPlay(p, card)) return;
      selectedHandIdx = (selectedHandIdx === idx) ? null : idx; // tap again = deselect
      render();
    };
    handDiv.appendChild(c);
  });
  zone.appendChild(handDiv);

  const row = document.createElement('div');
  row.className = 'actions-row';
  const playBtn = document.createElement('button');
  playBtn.id = 'play-confirm';
  playBtn.className = 'primary';
  playBtn.textContent = 'بازی کن';
  playBtn.disabled = selectedHandIdx === null;
  playBtn.onclick = () => {
    if (selectedHandIdx === null) return;
    const idx = selectedHandIdx;
    selectedHandIdx = null;
    Game.playCard(p, idx);
    render();
  };
  const undo = document.createElement('button');
  undo.className = 'secondary';
  undo.textContent = 'برگشت';
  undo.onclick = () => { selectedHandIdx = null; Game.undoLast(); render(); };
  const rules = document.createElement('button');
  rules.className = 'secondary';
  rules.textContent = 'قوانین';
  rules.onclick = toggleRules;
  row.append(playBtn, undo, rules);
  zone.appendChild(row);
  return zone;
}

function toggleRules() {
  const existing = document.getElementById('rules-panel');
  if (existing) { existing.remove(); return; }
  const panel = document.createElement('div');
  panel.id = 'rules-panel';
  panel.className = 'rules-panel';
  panel.textContent = 'قوانین: هر بازیکن باید خالِ آغازین را ندَهند اگر داشته باشد؛ در غیر این صورت می‌تواند هر کارتی بیندازد. کارت آس‌ها و دو جوکر بیرون از دسته‌اند: بعد از هر دست (تا وقتی حکم تعیین نشده) تیم برنده یک کارت ویژه انتخاب می‌کند. آسِ خالِ آغازین = حکم؛ آسِ خالی که تیم بازنده دور ریخته = حکم بریده؛ جوکر رنگی = انتقال همه دست‌ها؛ جوکر بی‌رنگ = انتقال همین دست.';
  app.appendChild(panel);
}

// ---------- pass screen: dark overlay, lock icon, team chip, gold button ----------
function lockIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('class', 'pass-lock');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1zm2 0h6V7a3 3 0 0 0-6 0v3z');
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

function renderPassScreen(state, targetPlayer, onConfirm) {
  app.innerHTML = '';
  app.appendChild(renderTopBar(state));
  const trickView = state.trick.length
    ? renderTrickArea(state.trick, state.players, { ledSuit: state.ledSuit })
    : (state.recentTrick
        ? renderTrickArea(state.recentTrick.cards, state.players, {
            ledSuit: state.lastTrickInfo ? state.lastTrickInfo.ledSuit : null,
            winnerIdx: state.recentTrick.winnerIdx,
          })
        : null);
  if (trickView) app.appendChild(trickView);
  const wrap = document.createElement('div');
  wrap.className = 'pass-screen';
  const h1 = document.createElement('h1');
  h1.id = 'pass-title';
  h1.textContent = `دستگاه را به ${state.players[targetPlayer]} بدهید`;
  const name = document.createElement('div');
  name.className = 'pass-name';
  name.textContent = state.players[targetPlayer];
  const team = document.createElement('div');
  team.className = `pass-team team-legend-${teamOf(targetPlayer).toLowerCase()}`;
  team.textContent = `تیم ${teamOf(targetPlayer)}`;
  const btn = document.createElement('button');
  btn.id = 'pass-confirm';
  btn.className = 'primary';
  btn.textContent = `من ${state.players[targetPlayer]} هستم`;
  btn.onclick = onConfirm;
  wrap.append(h1, lockIcon(), name, team, btn);
  app.appendChild(wrap);
}

// ---------- trick result: 4 cards + winner glow + collect animation ----------
function renderTrickResult(state) {
  app.innerHTML = '';
  app.appendChild(renderTopBar(state));
  const h2 = document.createElement('h2');
  h2.textContent = `دست را ${state.players[state.recentTrick.winnerIdx]} برد`;
  app.appendChild(h2);
  const area = renderTrickArea(state.recentTrick.cards, state.players, {
    ledSuit: state.lastTrickInfo ? state.lastTrickInfo.ledSuit : null,
    winnerIdx: state.recentTrick.winnerIdx,
  });
  area.dataset.winner = String(state.recentTrick.winnerIdx);
  app.appendChild(area);
  const btn = document.createElement('button');
  btn.id = 'trick-continue';
  btn.className = 'primary';
  btn.textContent = 'ادامه';
  btn.onclick = () => {
    // collect: slide cards toward the winner's score chip, then advance
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { Game.confirmTrickResult(); render(); return; }
    area.classList.add('collecting');
    setTimeout(() => { Game.confirmTrickResult(); render(); }, 320);
  };
  app.appendChild(btn);
}

// ---------- GUESS_PICK: 6 gold-patterned face-down cards in a 3x2 grid ----------
function renderGuessPick(state) {
  app.innerHTML = '';
  app.appendChild(renderTopBar(state));
  const h = document.createElement('h2');
  h.textContent = `${state.players[state.currentPlayer]}، یک کارت را انتخاب کن`;
  app.appendChild(h);
  const container = document.createElement('div');
  container.className = 'guess-cards';
  state.specialDeck.forEach((_, i) => {
    const gc = document.createElement('div');
    gc.className = 'guess-card facedown';
    gc.dataset.guessIdx = String(i);
    gc.setAttribute('role', 'button');
    gc.setAttribute('tabindex', '0');
    gc.onclick = () => {
      container.querySelectorAll('.guess-card').forEach(el => el.classList.remove('selected'));
      gc.classList.add('selected');
      confirmBtn.disabled = false;
    };
    container.appendChild(gc);
  });
  const confirmBtn = document.createElement('button');
  confirmBtn.id = 'guess-confirm';
  confirmBtn.className = 'primary';
  confirmBtn.textContent = 'تایید';
  confirmBtn.disabled = true;
  confirmBtn.onclick = () => {
    const sel = container.querySelector('.guess-card.selected');
    if (!sel) return;
    Game.pickGuess(parseInt(sel.dataset.guessIdx, 10));
    render();
  };
  app.appendChild(container);
  app.appendChild(confirmBtn);
}

// ---------- GUESS_RESULT: 3D flip + outcome-colored banner + missed cards ----------
function bannerIcon(outcome) {
  return outcome === 'ace_led' ? '👑' : (outcome === 'ace_other' ? '🤔' : '⚡');
}

function renderGuessResult(state) {
  app.innerHTML = '';
  app.appendChild(renderTopBar(state));
  const h = document.createElement('h2');
  h.textContent = `حدس ${state.players[state.lastTrickInfo.winnerIdx]}`;
  app.appendChild(h);

  const reveal = document.createElement('div');
  reveal.className = 'guess-reveal';
  reveal.appendChild(specialFace(state.guessResult.card, { cls: 'guess-face' }));
  app.appendChild(reveal);

  const outcome = state.guessResult.outcome;
  const banner = document.createElement('div');
  banner.className = `result-banner ${
    outcome === 'ace_led' ? 'success' : outcome === 'ace_other' ? 'neutral' : 'danger'
  }`;
  const icon = document.createElement('span');
  icon.className = 'banner-icon';
  icon.textContent = bannerIcon(outcome);
  const msg = document.createElement('span');
  msg.id = 'guess-result-message';
  msg.textContent = state.guessResult.message;
  banner.append(icon, msg);
  app.appendChild(banner);

  app.appendChild(missedTitle());
  app.appendChild(missedRow(state.specialDeck, state.guessResult.card));

  const btn = document.createElement('button');
  btn.id = 'guess-continue';
  btn.className = 'primary';
  btn.textContent = 'ادامه';
  btn.onclick = () => { Game.finishGuess(); render(); };
  app.appendChild(btn);
}

function missedTitle() {
  const t = document.createElement('p');
  t.className = 'missed-title';
  t.textContent = 'بقیه کارت‌های ویژه (آنچه از دست دادید):';
  return t;
}

function missedRow(deck, chosen) {
  const row = document.createElement('div');
  row.className = 'missed-row';
  deck.forEach(c => {
    if (c === chosen) return;
    const mini = document.createElement('div');
    mini.className = 'mini-face';
    if (c.kind === 'ace') {
      mini.textContent = `A${SUIT_INFO[c.suit].symbol}`;
      mini.classList.add(SUIT_INFO[c.suit].color);
    } else {
      mini.textContent = '🃏';
      mini.style.fontSize = '0.95rem';
    }
    row.appendChild(mini);
  });
  return row;
}

// ---------- game over: teams, trump story, tie-break ----------
function renderGameOver(state) {
  app.innerHTML = '';
  app.appendChild(renderTopBar(state));
  const div = document.createElement('div');
  div.className = 'pass-screen';

  let winner;
  if (state.tricksA !== state.tricksB) {
    winner = state.tricksA > state.tricksB ? 'A' : 'B';
  } else if (state.guessAttemptsA !== state.guessAttemptsB) {
    winner = state.guessAttemptsA < state.guessAttemptsB ? 'A' : 'B'; // tie-break: fewer guesses
  } else {
    winner = null; // true tie
  }

  const h1 = document.createElement('h1');
  h1.className = 'winner-title';
  h1.textContent = winner ? `بازی تمام شد – برنده: تیم ${winner}` : 'بازی تمام شد – مساوی!';
  app.appendChild(h1);

  const teams = document.createElement('div');
  teams.className = 'game-over-teams';
  [['A', state.tricksA, state.guessAttemptsA], ['B', state.tricksB, state.guessAttemptsB]].forEach(([team, tricks, tries]) => {
    const box = document.createElement('div');
    box.className = `game-over-team ${team.toLowerCase()}`;
    const lbl = document.createElement('div');
    lbl.className = `lbl team-legend-${team.toLowerCase()}`;
    lbl.textContent = `تیم ${team}`;
    const big = document.createElement('div');
    big.className = 'big';
    big.textContent = toFa(tricks);
    const sub = document.createElement('div');
    sub.className = 'game-over-note';
    sub.textContent = `${toFa(tricks)} دست | ${toFa(tries)} حدس`;
    box.append(lbl, big, sub);
    teams.appendChild(box);
  });
  app.appendChild(teams);

  // how trump was determined (display-only, from engine's trumpInfo)
  const trumpNote = document.createElement('p');
  trumpNote.className = 'game-over-note';
  if (state.trump && state.trumpInfo) {
    const via = state.trumpInfo.via === 'led'
      ? `با آسِ همان خالِ دستِ شماره ${toFa(state.trumpInfo.trick)}`
      : `با حکم بریده در دستِ شماره ${toFa(state.trumpInfo.trick)}`;
    trumpNote.textContent = `حکم ${SUIT_INFO[state.trump].fa} ${via} تعیین شد`;
  } else {
    trumpNote.textContent = 'حکم در کل بازی پیدا نشد';
  }
  app.appendChild(trumpNote);

  if (state.tricksA === state.tricksB) {
    const tieNote = document.createElement('p');
    tieNote.className = 'game-over-note';
    tieNote.textContent = `تساوی در دست‌ها – تساوی‌شکنی با حدس‌های کمتر (تیم A: ${toFa(state.guessAttemptsA)}، تیم B: ${toFa(state.guessAttemptsB)})`;
    app.appendChild(tieNote);
  }

  const newBtn = document.createElement('button');
  newBtn.className = 'primary';
  newBtn.textContent = 'بازی جدید (همان بازیکنان)';
  newBtn.onclick = () => { Game.restart(true); render(); };
  const freshBtn = document.createElement('button');
  freshBtn.className = 'secondary';
  freshBtn.textContent = 'بازی جدید (بازیکنان جدید)';
  freshBtn.onclick = () => { Game.restart(false); showSetup(); };
  div.append(h1, teams, trumpNote, newBtn, freshBtn);
  app.appendChild(div);
}

// ---------- render dispatcher ----------
function render() {
  const state = Game.getState();
  if (!state) { showSetup(); return; }
  switch (state.phase) {
    case 'PASS_SCREEN':
      renderPassScreen(state, state.currentPlayer, () => { Game.beginTurn(); render(); });
      break;
    case 'PLAYING':
      app.innerHTML = '';
      app.appendChild(renderTopBar(state));
      app.appendChild(renderTrickArea(state.trick, state.players, { ledSuit: state.ledSuit, animateLast: true }));
      app.appendChild(renderHand(state));
      break;
    case 'TRICK_RESULT':
      renderTrickResult(state);
      break;
    case 'GUESS_PASS_SCREEN':
      renderPassScreen(state, state.lastTrickInfo.winnerIdx, () => { Game.beginGuessPick(); render(); });
      break;
    case 'GUESS_PICK':
      renderGuessPick(state);
      break;
    case 'GUESS_RESULT':
      renderGuessResult(state);
      break;
    case 'GAME_OVER':
      renderGameOver(state);
      break;
    default:
      showSetup();
  }
}

// ---------- start screen: team-grouped inputs + random draw (default) + RPS ----------
function showSetup() {
  app.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'pass-screen';
  const h = document.createElement('h1');
  h.textContent = 'فاطمه احمدی';
  const sub = document.createElement('p');
  sub.className = 'subtitle';
  sub.textContent = 'نام بازیکنان را به ترتیب صندلی وارد کنید';
  div.append(h, sub);

  const boxes = document.createElement('div');
  boxes.className = 'team-boxes';
  const inputs = [];
  // Team A: seats 1 & 3 (indices 0, 2) – Team B: seats 2 & 4 (indices 1, 3)
  [['A', 0, 2], ['B', 1, 3]].forEach(([team, i1, i2]) => {
    const box = document.createElement('div');
    box.className = `team-box team-${team.toLowerCase()}`;
    const title = document.createElement('div');
    title.className = 'team-title';
    title.textContent = `تیم ${team}`;
    box.appendChild(title);
    [i1, i2].forEach(i => {
      const lbl = document.createElement('div');
      lbl.className = 'team-label';
      lbl.textContent = `صندلی ${toFa(i + 1)}`;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = `بازیکن ${toFa(i + 1)}`;
      inp.required = true;
      inputs[i] = inp;
      box.append(lbl, inp);
    });
    boxes.appendChild(box);
  });
  div.appendChild(boxes);

  const names = () => inputs.map((inp, i) => inp.value.trim() || `بازیکن ${toFa(i + 1)}`);

  const btns = document.createElement('div');
  btns.className = 'start-btns';
  const startBtn = document.createElement('button');
  startBtn.type = 'submit';
  startBtn.className = 'primary';
  startBtn.textContent = 'شروع بازی (قرعه‌کشی شروع‌کننده)';
  const rpsBtn = document.createElement('button');
  rpsBtn.className = 'secondary';
  rpsBtn.textContent = 'شروع با سنگ–کاغذ–قیچی';
  rpsBtn.onclick = (e) => { e.preventDefault(); showRps(names()); };
  btns.append(startBtn, rpsBtn);

  const form = document.createElement('form');
  form.append(boxes, btns);
  form.onsubmit = (e) => {
    e.preventDefault();
    Game.init(names(), debugOpts());
    render();
  };
  div.appendChild(form);
  app.appendChild(div);
}

// ---------- rock/paper/scissors starter flow (pure UI, engine untouched) ----------
function showRps(names) {
  const MOVES = [['✊', 'سنگ'], ['✋', 'کاغذ'], ['✌️', 'قیچی']];
  let firstPick = null;
  let seatA = 0, seatB = 1;

  function round() {
    firstPick = null;
    pickScreen(seatA, (m1) => {
      firstPick = m1;
      pickScreen(seatB, (m2) => {
        if (m1 === m2) {
          rpsResult(`مساوی (${MOVES[m1][1]}) – دوباره!`, round);
          return;
        }
        const aWins = (m1 === 0 && m2 === 2) || (m1 === 1 && m2 === 0) || (m1 === 2 && m2 === 1);
        const winSeat = aWins ? seatA : seatB;
        rpsResult(
          `${MOVES[m1][1]} در برابر ${MOVES[m2][1]} – ${names()[winSeat]} شروع می‌کند!`,
          () => { Game.init(names(), debugOpts({ startPlayer: winSeat })); render(); },
        );
      });
    });
  }

  function pickScreen(seat, onPick) {
    app.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'pass-screen';
    const h = document.createElement('h1');
    h.textContent = `سنگ کاغذ قیچی – ${names()[seat]}`;
    const hint = document.createElement('p');
    hint.className = 'pass-hint';
    hint.textContent = 'یک حرکت انتخاب کنید';
    wrap.append(h, hint);
    const row = document.createElement('div');
    row.className = 'actions-row';
    MOVES.forEach(([icon, label], m) => {
      const b = document.createElement('button');
      b.className = 'rps-choice';
      b.textContent = icon;
      b.title = label;
      b.onclick = () => onPick(m);
      row.appendChild(b);
    });
    wrap.appendChild(row);
    app.appendChild(wrap);
  }

  function rpsResult(text, next) {
    app.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'pass-screen';
    const r = document.createElement('p');
    r.className = 'rps-result';
    r.textContent = text;
    const ok = document.createElement('button');
    ok.className = 'primary';
    ok.textContent = 'ادامه';
    ok.onclick = next;
    wrap.append(r, ok);
    app.appendChild(wrap);
  }

  round();
}

// ---------- initial load ----------
if (DEBUG) {
  Game.init(['علی', 'مریم', 'رضا', 'سارا'], debugOpts());
  render();
} else if (Game.hasSaved()) {
  if (confirm('ادامه بازی قبلی؟')) {
    Game.loadSaved();
    render();
  } else {
    Game.clearSaved();
    showSetup();
  }
} else {
  showSetup();
}

// expose for debugging/e2e
window.Game = Game;
