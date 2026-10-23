# Fatemeh Ahmadi Hot-Seat Card Game

## Overview
A 4-player, 2-team, pass-and-play Persian card game that runs entirely in the browser.
No backend, no accounts – open `index.html` (via a local server) on any device and play.

- **RTL UI** with the Vazirmatn font, touch-friendly, mobile-first.
- **Hot-seat privacy** – every turn starts with a full-screen pass screen; hands are private.
- **Public table** – cards played to the current trick are ALWAYS visible (with player-name
  labels and the led suit highlighted), including on pass screens.
- Game logic is pure JavaScript (`logic.js`), unit-tested with `node test.js`.
- Full browser end-to-end test with `node e2e.mjs` (headless Edge via playwright-core).
- State persists in `localStorage`, including mid-guess phases.

## Files
```
fatemeh-ahmadi/
├─ index.html       # entry point
├─ style.css        # Persian UI styling
├─ script.js        # UI glue (DOM only) – single renderCard() helper
├─ logic.js         # pure game engine (state machine)
├─ test.js          # unit tests: npm test
├─ e2e.mjs          # headless-browser e2e: npm run test:e2e
├─ ui-shots.mjs     # visual checks + screenshots at 360x640 & 1280x800: node ui-shots.mjs
├─ e2e-shots/       # screenshots produced by the test runs
└─ package.json
```

## Card & trick shapes (single source of truth)
- Number card: `{ suit: 'H'|'S'|'D'|'C', rank: 'K'|'Q'|'J'|'10'..'2' }`
- Special cards: `{ kind:'ace', suit }` and `{ kind:'joker', variant:'colored'|'plain' }`
- Trick: `state.trick = [{ player: seatIndex, card }]` (play order)
- `renderCard()` in script.js throws on an invalid card instead of printing "undefined".

## Phase machine
```
PASS_SCREEN -> PLAYING -> PASS_SCREEN (next card) | TRICK_RESULT (4th card)
TRICK_RESULT -> trump set ? (PASS_SCREEN | GAME_OVER) : GUESS_PASS_SCREEN
GUESS_PASS_SCREEN -> GUESS_PICK -> GUESS_RESULT -> PASS_SCREEN | GAME_OVER
```
The guess runs after EVERY trick while trump is unset (including the 12th/last trick).
The guessing player is the trick winner. Each guess counts as one attempt for the
winning team (tiebreaker).

## Running / testing
```bash
python -m http.server 8123     # serve the folder (ES modules need http, not file://)
node test.js                   # engine unit tests (11 tests, incl. all 5 guess outcomes)
node e2e.mjs                   # headless-browser end-to-end test (Edge)
```

### Debug mode (deterministic, for testing every outcome)
`?debug=1&seed=123&force=X&slot=N`
- `seed` – fixed shuffle seed (same deal every time)
- `force` – `H|S|D|C` (ace of that suit) or `joker_colored` / `joker_plain`
- `slot` – which face-down position (0–5) the forced card sits at

Example: `?debug=1&seed=123&force=H&slot=2` → ace of hearts at slot 2.

## Guess outcomes (authoritative)
1. **Ace of the led suit** → that suit becomes trump ("حکم <suit> شد!"). No more guesses.
2. **Ace of a suit a losing-team player discarded** → that suit becomes trump, the
   trick just won goes to the losing team, losing team leads ("حکم بریده شد!"). No more guesses.
3. **Ace of any other suit** → nothing happens; trump stays unset; winner leads; guess repeats.
4. **Colored joker** → ALL tricks won by the winning team transfer to the losing team;
   losing team leads; trump stays unset.
5. **Plain joker** → only the trick just won transfers; leader unchanged; trump stays unset.

## Deploying
Static files only – GitHub Pages / Netlify / Vercel all work with no build step.
