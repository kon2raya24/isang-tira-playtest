# Digital playtest (`play.html`): design

Status: approved 2026-09-25. It is a throwaway playtest prototype, not the real game.

## Purpose

Let testers play the ten paper-playtest boards in a browser, animated and interactive. The playtest questions stay the same:

- **G3:** Wednesday first-try par rate in first-handful mode.
- **G4:** the share of relay-day tries described as guessing.
- The first-handful and whole-sowing previews are compared.

Remote testers can take part, and the paper version stays available.

**Success criteria**

- A first-time tester on a phone finishes all ten boards without help.
- Every try is recorded, and the tester can send the results as text.
- Nothing about any board's answer is shown before all ten boards are done.
- The screen can never disagree with the rules engine (`src/engine.mjs`).

## Scope

**In scope**

- `play.html`: start screen, ten boards, results screen, and a replay of the perfect lines at the end.
- A third card on `index.html`.
- Tests and headless checks.

**Out of scope**

- Any server or results upload.
- Real-game features: daily rotation, streaks, share grid, the Lola persona, art beyond the pack's paper and wood style.
- Changes to `boards.html` or `helper.html`.

## Rules

Everything comes from `src/engine.mjs` (rules R1–R8, as tested in `test/engine.test.mjs`):

- **Capture:** when the house opposite is empty or burnt, it's a dud.
- **R6 sweep:** cannot occur on these boards. The engine still applies it and the animator supports it, but the rules card doesn't teach it.

## Flow

1. **Start**
   - Title and a one-line purpose.
   - An optional initials field (at most 12 characters).
   - Five rule cards, next to a small looping demo board. The demo runs `sowEvents` on four fixed positions, one rule each: a direct extra turn, a relay that ends in a capture, a sowing that passes the ulo and ends on Lola's side, and a dud. It deliberately never shows a relay into the ulo: every Wednesday perfect line opens with one, so demoing it would teach the answers the playtest measures (G3). Amended 2026-09-25.
   - A **Start** button.
2. **Group**
   - `?group=A` or `?group=B` forces the group.
   - Otherwise the group is chosen 50/50 on first start.
   - It is stored with the session and never changes mid-session.
3. **Boards**
   - Order: M1 M2 M3 W1 W2 W3 W4 S1 S2 S3.
   - The mode for each board comes from `src/modes.mjs`. Monday is always first-handful.
4. **Guided M1**
   - Coach bubbles walk the perfect line one step at a time. Only the suggested house is enabled.
   - M1 is recorded as `guided` and excluded from every metric.
   - After it: "That's par. M2 and M3 are yours."
5. **Each board**
   - Header: board code, day, par, try n of 3, and a mode label: "Preview: first handful only" or "Preview: whole sowing".
   - Up to three tries. The board ends as soon as a try reaches par, and after the third try.
   - Between tries, the board resets to the start.
6. **After each try**
   - A required choice: **Worked it out / Partly guessed / Guessed**.
   - Then the "Try again (k left)" or "Next board" buttons appear.
7. **Results** (after S3)
   - A summary table.
   - "Which preview felt more fun?" (First handful / Whole sowing / No difference) and an optional "Why?" (at most 280 characters).
   - **Copy my results**, plus `navigator.share` when available.
   - **Watch the perfect lines**, available only on this screen.
8. **Replay**
   - Per board, animate perfect line 1 from the start position, with its move list.
   - Note "N perfect lines" when there is more than one.

## Playing a turn

- **Tapping or clicking a legal house** selects it and shows its preview:
  - **First handful**
    - The `firstHandfulText` line.
    - A ghost ring on the slot where the first handful's last shell lands.
    - Nothing past a relay.
  - **Whole sowing**
    - The `wholeSowingText` line.
    - Numbered ghost rings on each relay stop and on the final landing slot.
- **Tapping the selected house again, or the Sow button,** commits the move.
- **Illegal houses** (your empty or burnt houses) are shown disabled and skipped by the keyboard. Tapping one shows why: "Y3 is empty" or "Y3 is burnt". Lola's houses are never selectable.
- **After an extra turn**, the caption says "Isa pa! Choose again."
- **Each preview opened is counted:** a selection that shows a preview line. Re-selecting the same house without an intervening sow is not counted again.

## Animation (consumes `sowEvents`)

**Event list.** `src/events.mjs` exports `sowEvents(state, burnt, house)`. It returns `{ events, result }`:

- `result` is exactly `sow()`'s return value.
- `events` is an ordered list:
  - `{t:'lift', slot, n}`
  - `{t:'drop', slot}` (one per shell)
  - `{t:'relay', slot, n}`
  - one terminal event: `{t:'extra'}`, `{t:'capture', slot, opp, n}` (n includes the capturing shell), `{t:'dud', slot}` or `{t:'end', slot}`

`turnEndEvents(state, burnt)` returns `{events:[{t:'sweep', n}] or [], result}` from `turnEnd()`.

**Invariant, tested:** applying the events one at a time to a copy of the state gives `result.state` exactly.

**Timings (normal motion)**

- **Lift:** 180 ms. The shells gather into a hand chip above the house.
- **Drops:** each drop is an arc hop to the next slot. 140 ms each for drops 1–12, 70 ms for drops 13–30, then 35 ms.
- **Counters:** a house's count and the ulo counter update when the shell lands.
- **Relay:** the house pulses (220 ms), then lifts.
- **Extra turn:** an "ISA PA!" stamp scales in at the ulo (650 ms).
- **Capture:** the opposite house's shells and the capturing shell fly to the ulo (450 ms), and the ulo counter counts up.
- **Dud:** the house shakes (300 ms).
- **End on Lola's side:** the landing house dims briefly (300 ms).
- **Speed-up:** tapping anywhere during an animation plays the rest at 4×.

**Reduced motion** (`prefers-reduced-motion: reduce`): no hops. Each event applies instantly with a 120 ms highlight fade, and stamps show as static text.

**Sound**

- Synthesized with WebAudio after the first user gesture:
  - a short click per drop, pitched by slot
  - a lower "clack" into the ulo
  - a soft chord on reaching par
- A mute toggle, remembered on the device.

## Visual and layout

- **Palette:** the pack's paper and wood tokens (ink `#231c14`, muted `#6b5e4f`, line `#3b2f22`, paper `#fffdf8`, ground `#efe9df`, wood `#f6ecda`), with mode accents first handful `#2f5d8a` and whole sowing `#8a4b2f`. Light only.
- **Board orientation:** as on paper. Lola's row is on top (L6→L0, left to right), your row is below (Y0→Y6), your ulo is on the right, and Lola's ulo is a thin strip on the left marked "never sown".
- **Houses:**
  - A small shell cluster (up to 10 drawn) plus the numeral.
  - Burnt houses are hatched with an ✕.
- **Size:**
  - The board fits a 360 px-wide viewport with no horizontal scroll.
  - Your-row tap targets are at least 34 × 34 px at 360 px (WCAG 2.2 AA asks for 24 px; 40 px would not fit seven houses and both ulos at 360 px).
  - The page is at most 760 px wide, and the board at most 620 px.

## Accessibility

- **Houses are buttons.** Your-row houses are real `<button>`s with labels like "Your house Y3, 2 shells, 4 slots from your ulo". Lola's houses and the ulos are labelled but not focusable.
- **Keyboard:**
  - Tab and Shift+Tab, or ←/→, move between legal houses.
  - Enter or Space previews, and pressing it again sows.
  - The keys 1–7 select Y0–Y6.
- **Announcements:** an `aria-live="polite"` region reads each preview line, each finished sowing's outcome and the try result.
- **Focus:**
  - Focus moves to the tick buttons after a try.
  - It moves to the first legal house on a new board.
- **Contrast:** text contrast is at least 4.5:1.

## Persistence

- **Storage:** `localStorage` key `isangtira.playtest.v1` holds the full session (group, tries, answers, current position) as JSON. Every access is wrapped in try/catch, so the page still works without storage.
- **Reloads:**
  - A reload resumes at the current board.
  - A try interrupted mid-turn restarts that try. The tries already recorded are kept.
- **Restart:** a "Start over" link on the start and results screens, with a confirmation, clears the session. A double-click does not confirm: the second tap must come at least 0.6 s after the first.
- **Runs:** `isangtira.playtest.runs` (kept by Start over) holds `{count, group}`. A new run keeps the stored group unless `?group=` overrides, so boards already seen never switch preview mode, and a repeat run is marked in the results header.

## Results text (exact format)

```
ISANG TIRA PLAYTEST v1
tester: AB | group: A | started: 2026-09-27 19:02 | device: phone
M1 FH par 6 | guided
M2 FH par 6 | 1: Y5 Y6 Y1 = 6 PAR worked 3pv 41s
W1 FH par 7 | 1: Y5 = 5 guessed 2pv 30s | 2: Y2 Y6 Y3 = 7 PAR partly 5pv 88s
...
preferred: whole sowing
why: <text, newlines collapsed>
```

- **Fields per try:** `n: <houses> = <score> [PAR] <worked|partly|guessed> <k>pv <s>s`.
- **Timing:** seconds run from the try's start to its last sowing.
- **Repeat runs:** when this device has run the playtest before, the header line ends with ` | run: N` (N ≥ 2).
- **Device:** `phone` when `matchMedia('(pointer: coarse)')` matches, otherwise `desktop`.
- **Time:** the viewer's local time.

## Files

- `src/events.mjs`: `sowEvents`, `turnEndEvents`, `applyEvent`. Pure functions.
- `src/session.mjs`: the pure session reducer and helpers:
  - `newSession`, `startTry`, `recordSowing`, `finishTry`, `setTick`, `nextBoard`
  - `resultsText`
  - `groupFor(query, rand)`
  - serialize and deserialize
- `src/play/app.js` (DOM, animation, sound) and `src/play/style.css`.
- `src/build-play.mjs` writes `play.html`. It inlines the engine, preview, modes, events, session and `src/play/*`, plus the board data (code, day, board, par, perfectLines, and the perfect-line moves for the replay). It follows the same inline approach as `build-helper.mjs`, and the page gets `noindex`.
- `test/events.test.mjs` and `test/session.test.mjs`.
- `index.html` gets a third card, "Play in your browser".

## Verification

1. **Unit tests** (`node --test test/*.test.mjs`)
   - The events invariant at every reachable decision of all ten boards, and on 3,000 random boards (burnt houses, lapping handfuls).
   - The terminal event matches `sow().outcome`.
   - The reducer: tries stop at par or at three, a tick is required, the preview count, and the M1 guided flag.
   - `resultsText` matches the exact format above.
   - Group assignment respects the query.
   - Serialize/deserialize round-trips.
2. **Build check:** `play.html` contains no external requests.
3. **Headless Chrome**
   - Screenshots at 360×780 and 1280×800 on the start screen, a mid-sowing frame, a try result and the results screen.
   - A scripted playthrough via the test hook `?test=1&script=...` (compiled into the page, inert without `test=1`) that finishes all ten boards and checks the results text in the DOM.
   - Reduced-motion emulation.
4. **Independent reviews**
   - Rules fidelity.
   - Usability and accessibility.
   - Playtest validity: no spoilers before S3, counterbalancing intact, every try recorded.
5. **Deploy:** Vercel (`npx vercel deploy --prod`) and a push to GitHub Pages. Verify both live URLs.
