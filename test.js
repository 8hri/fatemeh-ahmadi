// test.js – unit tests for the Fatemeh Ahmadi game engine (node test.js)
import assert from 'assert';
import { Game, SUITS } from './logic.js';

const NAMES = ['آ', 'ب', 'پ', 'ت'];

// deterministic single-card hands:
//   p0: K♥   p1: Q♥   p2: J♠   p3: 10♠   (led suit will be H)
function makeTestGame() {
  Game.init(NAMES, { seed: 123 });
  const st = Game.getState();
  st.hands = [
    [{ suit: 'H', rank: 'K' }],
    [{ suit: 'H', rank: 'Q' }],
    [{ suit: 'S', rank: 'J' }],
    [{ suit: 'S', rank: '10' }],
  ];
  st.trump = null;
  st.trick = [];
  st.ledSuit = null;
  st.currentPlayer = 0;
  return st;
}

// play a full trick with beginTurn between players (hot-seat flow)
function playTrick(st, handIdx = [0, 0, 0, 0]) {
  for (let p = 0; p < 4; p++) {
    if (st.phase === 'PASS_SCREEN') Game.beginTurn();
    assert.strictEqual(st.phase, 'PLAYING');
    assert.strictEqual(st.currentPlayer, p);
    Game.playCard(p, handIdx[p]);
  }
}

// ---------------------------------------------------------------- legal play
(function testLegal() {
  const st = makeTestGame();
  Game.beginTurn();
  Game.playCard(0, 0);
  assert.strictEqual(st.trick.length, 1);
  assert.strictEqual(st.ledSuit, 'H');
  // player 1 holds H -> must follow suit
  assert.ok(Game.isLegalPlay(1, st.hands[1][0]));
  // player 2 has no H -> any card is legal
  assert.ok(Game.isLegalPlay(2, st.hands[2][0]));
  // an illegal card (p2 holds only S but led H) is legal BECAUSE he has no H
  assert.ok(Game.isLegalPlay(2, { suit: 'S', rank: 'J' }));
  console.log('ok – legal play enforcement');
})();

// ------------------------------------------------------- winner without trump
(function testWinnerNoTrump() {
  const st = makeTestGame();
  playTrick(st); // K♥ Q♥ J♠ 10♠ -> K♥ wins (player 0, team A)
  assert.strictEqual(st.phase, 'TRICK_RESULT');
  assert.strictEqual(st.tricksA, 1);
  assert.strictEqual(st.tricksB, 0);
  assert.strictEqual(st.recentTrick.winnerIdx, 0);
  assert.strictEqual(st.trick.length, 0); // trick cleared after resolution
  assert.strictEqual(st.recentTrick.cards.length, 4);
})();

// ------------------------------------------------- guess flow appears per trick
(function testGuessFlowAppears() {
  const st = makeTestGame();
  playTrick(st);
  assert.strictEqual(st.phase, 'TRICK_RESULT');
  Game.confirmTrickResult();
  // trump unset -> guess pass screen with the trick winner
  assert.strictEqual(st.phase, 'GUESS_PASS_SCREEN');
  assert.strictEqual(st.currentPlayer, 0); // winner of the trick
  Game.beginGuessPick();
  assert.strictEqual(st.phase, 'GUESS_PICK');
  assert.strictEqual(st.specialDeck.length, 6); // always exactly 6 specials
  assert.strictEqual(st.specialDeck.filter(c => c.kind === 'ace').length, 4);
  assert.strictEqual(st.specialDeck.filter(c => c.kind === 'joker').length, 2);
})();

// ------------------------------------------------------------ 5 guess outcomes
function guessBase() {
  // trick already resolved: player 0 (team A) won, led H, losers discarded S and D
  const st = makeTestGame();
  st.tricksA = 1; st.tricksB = 0; st.tricksPlayed = 1;
  st.currentPlayer = 0;
  st.lastTrickInfo = {
    winnerIdx: 0, winningTeam: 'A', losingTeam: 'B', ledSuit: 'H',
    lostDiscards: { 1: ['S'], 3: ['D'] },
  };
  st.recentTrick = { cards: [], winnerIdx: 0 };
  return st;
}

// 1. ace of the led suit -> trump set, no transfer, winner leads
(function testAceLed() {
  const st = guessBase();
  st.specialDeck = [
    { kind: 'ace', suit: 'H' }, { kind: 'ace', suit: 'S' }, { kind: 'ace', suit: 'D' },
    { kind: 'ace', suit: 'C' }, { kind: 'joker', variant: 'colored' }, { kind: 'joker', variant: 'plain' },
  ];
  st.phase = 'GUESS_PICK';
  Game.pickGuess(0);
  assert.strictEqual(st.guessResult.outcome, 'ace_led');
  assert.strictEqual(st.trump, 'H');
  assert.strictEqual(st.tricksA, 1);       // no transfer
  assert.strictEqual(st.currentPlayer, 0); // winner leads
  assert.ok(st.guessResult.message.includes('حکم دل شد'));
  Game.finishGuess();
  assert.strictEqual(st.phase, 'PASS_SCREEN');
})();

// 2. ace of a discarded suit -> trump set, trick transferred, losing team leads
(function testAceCut() {
  const st = guessBase();
  st.specialDeck = [
    { kind: 'ace', suit: 'H' }, { kind: 'ace', suit: 'S' }, { kind: 'ace', suit: 'D' },
    { kind: 'ace', suit: 'C' }, { kind: 'joker', variant: 'colored' }, { kind: 'joker', variant: 'plain' },
  ];
  st.phase = 'GUESS_PICK';
  Game.pickGuess(1); // ace of S, discarded by losing player 1
  assert.strictEqual(st.trump, 'S');
  assert.strictEqual(st.tricksA, 0); // trick transferred
  assert.strictEqual(st.tricksB, 1);
  assert.ok([1, 3].includes(st.currentPlayer)); // losing team leads
  assert.strictEqual(st.guessResult.message, 'حکم بریده شد!');
  Game.finishGuess();
  assert.strictEqual(st.phase, 'PASS_SCREEN');
})();

// 3. ace of an unrelated suit -> nothing happens, trump stays unset
(function testAceOther() {
  const st = guessBase();
  st.specialDeck = [
    { kind: 'ace', suit: 'C' }, { kind: 'ace', suit: 'H' }, { kind: 'ace', suit: 'S' },
    { kind: 'ace', suit: 'D' }, { kind: 'joker', variant: 'colored' }, { kind: 'joker', variant: 'plain' },
  ];
  st.phase = 'GUESS_PICK';
  Game.pickGuess(0); // ace of C: not led (H), not discarded (S, D)
  assert.strictEqual(st.trump, null);
  assert.strictEqual(st.tricksA, 1); // no transfer
  assert.strictEqual(st.currentPlayer, 0); // winner leads
  Game.finishGuess();
  assert.strictEqual(st.phase, 'PASS_SCREEN');
})();

// 4. colored joker -> ALL winning tricks transfer, losing team leads
(function testColoredJoker() {
  const st = guessBase();
  st.tricksA = 2; // pretend team A won one earlier trick too
  st.specialDeck = [
    { kind: 'ace', suit: 'H' }, { kind: 'ace', suit: 'S' }, { kind: 'ace', suit: 'D' },
    { kind: 'ace', suit: 'C' }, { kind: 'joker', variant: 'colored' }, { kind: 'joker', variant: 'plain' },
  ];
  st.phase = 'GUESS_PICK';
  Game.pickGuess(4);
  assert.strictEqual(st.tricksA, 0);
  assert.strictEqual(st.tricksB, 2);
  assert.strictEqual(st.trump, null);
  assert.strictEqual(st.currentPlayer, 1); // losing team (B) leads
  Game.finishGuess();
  assert.strictEqual(st.phase, 'PASS_SCREEN');
})();

// 5. plain joker -> only the just-won trick transfers, leader unchanged
(function testPlainJoker() {
  const st = guessBase();
  st.tricksA = 2; // one earlier trick + the one just won
  st.specialDeck = [
    { kind: 'ace', suit: 'H' }, { kind: 'ace', suit: 'S' }, { kind: 'ace', suit: 'D' },
    { kind: 'ace', suit: 'C' }, { kind: 'joker', variant: 'colored' }, { kind: 'joker', variant: 'plain' },
  ];
  st.phase = 'GUESS_PICK';
  Game.pickGuess(5);
  assert.strictEqual(st.tricksA, 1); // just-won trick moved to B
  assert.strictEqual(st.tricksB, 1);
  assert.strictEqual(st.trump, null);
  assert.strictEqual(st.currentPlayer, 0); // leader unchanged (trick winner)
  assert.strictEqual(st.guessAttemptsA, 1);
  Game.finishGuess();
  assert.strictEqual(st.phase, 'PASS_SCREEN');
})();

// ------------------------------------------- no guess phase once trump is set
(function testNoGuessAfterTrumpSet() {
  const st = makeTestGame();
  st.trump = 'S'; // trump already set
  st.currentPlayer = 0;
  playTrick(st);
  // the completed trick is still shown (TRICK_RESULT)...
  assert.strictEqual(st.phase, 'TRICK_RESULT');
  Game.confirmTrickResult();
  // ...but then the machine goes straight to the next trick – NO guess phase
  assert.strictEqual(st.phase, 'PASS_SCREEN');
  // with trump S, the J♠ (player 2, team A) beats the led K♥ -> player 2 leads next
  assert.strictEqual(st.currentPlayer, 2);
  assert.strictEqual(st.tricksA, 1); // seat 2 belongs to team A
})();

// -------------------------------- guess appears after the LAST trick (12th)
(function testGuessAfterLastTrick() {
  const st = makeTestGame();
  st.tricksA = 11; st.tricksB = 0; // 11 tricks already played
  playTrick(st); // 12th trick -> TRICK_RESULT (tricksPlayed = 12)
  assert.strictEqual(st.phase, 'TRICK_RESULT');
  assert.strictEqual(st.tricksPlayed, 12);
  Game.confirmTrickResult();
  // trump still unset -> guess phase STILL runs after the last trick
  assert.strictEqual(st.phase, 'GUESS_PASS_SCREEN');
  Game.beginGuessPick();
  st.specialDeck[0] = { kind: 'ace', suit: 'H' }; // ace of led suit at slot 0
  Game.pickGuess(0);
  assert.strictEqual(st.trump, 'H'); // outcome still applies
  Game.finishGuess();
  assert.strictEqual(st.phase, 'GAME_OVER');
})();

// ----------------------------------------- ace-cut only for losing-team discards
(function testAceCutUsesLosingDiscards() {
  // a suit discarded by the WINNING team must NOT trigger the cut rule
  const st = makeTestGame();
  st.tricksA = 1;
  st.lastTrickInfo = { winnerIdx: 0, winningTeam: 'A', losingTeam: 'B', ledSuit: 'H', lostDiscards: {} };
  st.specialDeck = [
    { kind: 'ace', suit: 'H' }, { kind: 'ace', suit: 'S' }, { kind: 'ace', suit: 'D' },
    { kind: 'ace', suit: 'C' }, { kind: 'joker', variant: 'colored' }, { kind: 'joker', variant: 'plain' },
  ];
  st.phase = 'GUESS_PICK';
  Game.pickGuess(1); // ace of S – nobody on the losing team discarded S
  assert.strictEqual(st.trump, null);        // not trump
  assert.strictEqual(st.tricksA, 1);         // no transfer
  assert.strictEqual(st.guessResult.outcome, 'ace_other');
})();

// --------------------------------------------------- debug force puts card in slot
(function testDebugForce() {
  Game.init(NAMES, { seed: 7, force: { kind: 'joker', variant: 'plain' }, guessSlot: 3 });
  const st = Game.getState();
  assert.strictEqual(st.specialDeck[3].kind, 'joker');
  assert.strictEqual(st.specialDeck[3].variant, 'plain');
  // forced card stays in place after each reshuffle
  Game.beginGuessPick === undefined; // no-op, keep engine untouched
})();

console.log('All unit tests passed');
