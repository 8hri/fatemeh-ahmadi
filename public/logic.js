// logic.js – pure game engine for Fatemeh Ahmadi hot-seat game
//
// CARD SHAPE (single source of truth):
//   number card: { suit: 'H'|'S'|'D'|'C', rank: 'K'|'Q'|'J'|'10'..'2' }
//   ace:         { kind: 'ace', suit: 'H'|'S'|'D'|'C' }
//   joker:       { kind: 'joker', variant: 'colored'|'plain' }
//
// TRICK SHAPE:
//   state.trick = [{ player: <seatIndex 0..3>, card: <card> }, ...]  (in play order)
//
// PHASE MACHINE:
//   PASS_SCREEN -> PLAYING -> (next PASS_SCREEN | TRICK_RESULT)
//   TRICK_RESULT -> (trump set ?  PASS_SCREEN | GAME_OVER : GUESS_PASS_SCREEN)
//   GUESS_PASS_SCREEN -> GUESS_PICK -> GUESS_RESULT -> (PASS_SCREEN | GAME_OVER)

// ---------- RNG (mulberry32, seedable for tests/debug) ----------
function createRNG(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let m = Math.imul(t ^ (t >>> 15), 1 | t);
    m = (m + Math.imul(m ^ (m >>> 7), 61 | m)) ^ m;
    return ((m ^ (m >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- card definitions ----------
export const SUITS = ['H', 'S', 'D', 'C'];
export const SUIT_INFO = {
  H: { fa: 'دل', symbol: '♥', color: 'red' },
  S: { fa: 'پیک', symbol: '♠', color: 'black' },
  D: { fa: 'خشت', symbol: '♦', color: 'red' },
  C: { fa: 'گیش', symbol: '♣', color: 'black' },
};

// ---------- storage (browser localStorage, Node-safe fallback) ----------
const STORAGE_KEY = 'fatemeh-ahmadi-game-state';
const _storage = (() => {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      localStorage.setItem('__probe__', '1'); // node may expose a non-working localStorage
      localStorage.removeItem('__probe__');
      return localStorage;
    }
  } catch (e) { /* node without --localstorage-file */ }
  const data = {};
  return {
    setItem: (k, v) => { data[k] = String(v); },
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    removeItem: (k) => { delete data[k]; },
  };
})();

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

export const Game = (function () {
  const TOTAL_TRICKS = 12;
  const RANKS = ['K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

  let state = null;
  let history = [];
  let rng = createRNG(123456);
  let seedCounter = 123456;
  // debug: force a specific special card into a specific slot on every guess shuffle
  let debugForce = null; // { card: <specialCard>, slot: <0..5> }

  function makeDeck() {
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ suit: s, rank: r });
    return deck;
  }

  function makeSpecialCards() {
    const specials = [];
    for (const s of SUITS) specials.push({ kind: 'ace', suit: s });
    specials.push({ kind: 'joker', variant: 'colored' });
    specials.push({ kind: 'joker', variant: 'plain' });
    return specials;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function specialKey(c) {
    return c.kind === 'ace' ? `ace:${c.suit}` : `joker:${c.variant}`;
  }

  function shuffleSpecials() {
    const a = shuffle(makeSpecialCards());
    if (debugForce) {
      const from = a.findIndex(c => specialKey(c) === specialKey(debugForce.card));
      if (from >= 0) {
        const to = Math.max(0, Math.min(5, debugForce.slot));
        [a[from], a[to]] = [a[to], a[from]];
      }
    }
    return a;
  }

  function save() {
    if (state) _storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  function pushHistory() {
    history.push(clone(state));
    if (history.length > 30) history.shift();
  }

  // opts: { seed, force, guessSlot, startPlayer }
  function init(playerNames, opts = {}) {
    if (opts.seed !== undefined) seedCounter = opts.seed;
    rng = createRNG(seedCounter);
    debugForce = opts.force ? { card: opts.force, slot: opts.guessSlot ?? 0 } : null;
    const deck = shuffle(makeDeck());
    const hands = [[], [], [], []];
    for (let i = 0; i < 48; i++) hands[i % 4].push(deck[i]);
    history = [];
    state = {
      players: playerNames,
      hands,
      specialDeck: shuffleSpecials(),
      trick: [],            // [{player, card}] – ONE trick shape
      ledSuit: null,
      trump: null,
      tricksA: 0,
      tricksB: 0,
      tricksPlayed: 0,
      guessAttemptsA: 0,
      guessAttemptsB: 0,
      phase: 'PASS_SCREEN',
      // starter: explicit opt (e.g. RPS winner) or random draw (قرعه) – default unchanged
      currentPlayer: opts.startPlayer ?? Math.floor(rng() * 4),
      discardSuits: { 0: [], 1: [], 2: [], 3: [] },
      recentTrick: null,    // {cards:[{player,card}], winnerIdx} after resolution
      lastTrickInfo: null,  // guess context
      guessResult: null,    // {card, outcome, message}
      trumpInfo: null,      // display-only: how trump was set {suit, via:'led'|'cut', trick}
    };
    save();
  }

  function getState() { return state; }
  function hasSaved() { return !!_storage.getItem(STORAGE_KEY); }
  function loadSaved() { const s = _storage.getItem(STORAGE_KEY); if (s) state = JSON.parse(s); }
  function clearSaved() { _storage.removeItem(STORAGE_KEY); state = null; }

  function isLegalPlay(st, playerIdx, card) {
    if (!st || st.trick.length === 0) return true;
    const led = st.ledSuit;
    const hasLed = st.hands[playerIdx].some(c => c.suit === led);
    if (!hasLed) return true;
    return card.suit === led;
  }

  function playCard(st, playerIdx, handIdx) {
    if (st.phase !== 'PLAYING') throw new Error(`playCard called in phase ${st.phase}`);
    if (playerIdx !== st.currentPlayer) throw new Error(`not player ${playerIdx}'s turn`);
    pushHistory();
    const card = st.hands[playerIdx].splice(handIdx, 1)[0];
    st.trick.push({ player: playerIdx, card });
    if (st.trick.length === 1) {
      st.ledSuit = card.suit;
    } else if (!st.hands[playerIdx].some(c => c.suit === st.ledSuit)) {
      // could not follow suit – record the discarded suit
      st.discardSuits[playerIdx].push(card.suit);
    }
    if (st.trick.length === 4) {
      resolveTrick(st);
    } else {
      st.currentPlayer = (playerIdx + 1) % 4;
      st.phase = 'PASS_SCREEN';
    }
    save();
  }

  function resolveTrick(st) {
    const led = st.ledSuit;
    const strength = (c) => RANKS.length - RANKS.indexOf(c.rank); // higher = stronger
    const cards = st.trick;
    let winner;
    if (st.trump) {
      const trumpCards = cards.filter(e => e.card.suit === st.trump);
      const pool = trumpCards.length ? trumpCards : cards.filter(e => e.card.suit === led);
      winner = pool.reduce((best, cur) => strength(cur.card) > strength(best.card) ? cur : best);
    } else {
      const ledCards = cards.filter(e => e.card.suit === led);
      winner = ledCards.reduce((best, cur) => strength(cur.card) > strength(best.card) ? cur : best);
    }
    const winnerIdx = winner.player;
    const winningTeam = (winnerIdx % 2 === 0) ? 'A' : 'B';
    const losingTeam = winningTeam === 'A' ? 'B' : 'A';
    if (winningTeam === 'A') st.tricksA++; else st.tricksB++;
    st.tricksPlayed = st.tricksA + st.tricksB;

    // discard suits of losing-team players in this trick (for the ace-cut rule)
    const losingSeats = winningTeam === 'A' ? [1, 3] : [0, 2];
    const lostDiscards = {};
    for (const p of losingSeats) {
      if (st.discardSuits[p].length) lostDiscards[p] = st.discardSuits[p].slice();
    }

    st.recentTrick = { cards: st.trick.map(e => ({ player: e.player, card: { ...e.card } })), winnerIdx };
    st.lastTrickInfo = { winnerIdx, winningTeam, losingTeam, ledSuit: led, lostDiscards };
    st.trick = [];
    st.ledSuit = null;
    st.discardSuits = { 0: [], 1: [], 2: [], 3: [] };
    st.currentPlayer = winnerIdx; // default leader until a guess says otherwise
    st.phase = 'TRICK_RESULT';   // ALWAYS show the completed trick first
    save();
  }

  // "ادامه" on the trick-result screen
  function confirmTrickResult(st) {
    if (st.phase !== 'TRICK_RESULT') throw new Error(`confirmTrickResult called in phase ${st.phase}`);
    if (!st.trump) {
      st.phase = 'GUESS_PASS_SCREEN'; // guessing player = trick winner (already in currentPlayer)
    } else if (st.tricksPlayed >= TOTAL_TRICKS) {
      st.phase = 'GAME_OVER';
    } else {
      st.phase = 'PASS_SCREEN';
    }
    save();
  }

  // "من هستم" on the normal pass screen -> show the player's hand
  function beginTurn(st) {
    if (st.phase !== 'PASS_SCREEN') throw new Error(`beginTurn called in phase ${st.phase}`);
    st.phase = 'PLAYING';
    save();
  }

  // "من هستم" on the guess pass screen -> reshuffle the 6 specials, show face-down
  function beginGuessPick(st) {
    if (st.phase !== 'GUESS_PASS_SCREEN') throw new Error(`beginGuessPick called in phase ${st.phase}`);
    st.specialDeck = shuffleSpecials();
    st.phase = 'GUESS_PICK';
    save();
  }

  function losingSeatsFor(st, losingTeam) {
    return losingTeam === 'A' ? [0, 2] : [1, 3];
  }

  // confirm "تایید" in GUESS_PICK: reveal + apply the outcome
  function pickGuess(st, index) {
    if (st.phase !== 'GUESS_PICK') throw new Error(`pickGuess called in phase ${st.phase}`);
    pushHistory();
    const card = st.specialDeck[index];
    const info = st.lastTrickInfo;
    const { winningTeam, losingTeam, ledSuit, lostDiscards } = info;
    if (winningTeam === 'A') st.guessAttemptsA++; else st.guessAttemptsB++;

    let outcome = '';
    if (card.kind === 'ace' && card.suit === ledSuit) {
      st.trump = ledSuit;
      st.currentPlayer = info.winnerIdx; // normal winner leads
      outcome = 'ace_led';
      st.trumpInfo = { suit: st.trump, via: 'led', trick: st.tricksPlayed };
    } else if (card.kind === 'ace' && Object.values(lostDiscards).some(arr => arr.includes(card.suit))) {
      st.trump = card.suit;
      st.trumpInfo = { suit: st.trump, via: 'cut', trick: st.tricksPlayed };
      // the trick just won goes to the losing team
      if (winningTeam === 'A') { st.tricksA--; st.tricksB++; }
      else { st.tricksB--; st.tricksA++; }
      st.currentPlayer = losingSeatsFor(st, losingTeam)[0]; // losing team leads next
      outcome = 'ace_cut';
    } else if (card.kind === 'ace') {
      outcome = 'ace_other'; // nothing happens
      st.currentPlayer = info.winnerIdx; // normal winner leads
    } else if (card.kind === 'joker' && card.variant === 'colored') {
      // ALL winning-team tricks transfer
      if (winningTeam === 'A') { st.tricksB += st.tricksA; st.tricksA = 0; }
      else { st.tricksA += st.tricksB; st.tricksB = 0; }
      st.currentPlayer = losingSeatsFor(st, losingTeam)[0]; // losing team leads next
      outcome = 'joker_colored';
    } else {
      // plain joker: only the trick just won transfers, leader unchanged
      if (winningTeam === 'A') { st.tricksA--; st.tricksB++; }
      else { st.tricksB--; st.tricksA++; }
      outcome = 'joker_plain';
    }

    const messages = {
      ace_led: `حکم ${st.trump ? SUIT_INFO[st.trump].fa : ''} شد!`,
      ace_cut: `حکم بریده شد!`,
      ace_other: `حکم پیدا نشد – بازی ادامه دارد`,
      joker_colored: `همه دست‌های تیم برنده به تیم بازنده رفت!`,
      joker_plain: `فقط این دست به تیم بازنده رفت`,
    };
    st.guessResult = { card, outcome, message: messages[outcome] };
    st.phase = 'GUESS_RESULT';
    save();
  }

  // "ادامه" on the guess-result screen
  function finishGuess(st) {
    if (st.phase !== 'GUESS_RESULT') throw new Error(`finishGuess called in phase ${st.phase}`);
    st.lastTrickInfo = null;
    st.guessResult = null;
    if (st.tricksPlayed >= TOTAL_TRICKS) {
      st.phase = 'GAME_OVER';
    } else {
      st.phase = 'PASS_SCREEN';
    }
    save();
  }

  function undoLast(st) {
    if (history.length) {
      state = clone(history.pop());
      save();
    }
  }

  function restart(useSamePlayers) {
    if (useSamePlayers && state) {
      init(state.players);
    } else {
      clearSaved();
    }
  }

  return {
    init,
    getState,
    hasSaved,
    loadSaved,
    clearSaved,
    isLegalPlay: (pIdx, card) => isLegalPlay(state, pIdx, card),
    playCard: (pIdx, handIdx) => playCard(state, pIdx, handIdx),
    beginTurn: () => beginTurn(state),
    confirmTrickResult: () => confirmTrickResult(state),
    beginGuessPick: () => beginGuessPick(state),
    pickGuess: (idx) => pickGuess(state, idx),
    finishGuess: () => finishGuess(state),
    undoLast: () => undoLast(state),
    restart,
  };
})();
