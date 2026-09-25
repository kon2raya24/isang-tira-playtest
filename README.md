# Isang Tira: paper playtest

Online copy of the paper-playtest pack for **Isang Tira**, a daily one-turn Sungka puzzle in early design. The game isn't built yet; this pack tests whether the puzzle reads as deduction or guessing, and compares two move-preview designs.

- `index.html`: landing page
- `boards.html`: facilitator sheets and ten boards, printable on A4. **No answer key**; that stays offline with the facilitator.
- `play.html`: the ten boards, playable and animated in a browser; results are copied as text at the end.
- `helper.html`: offline facilitator helper that runs the rules engine and gives the exact preview line to read aloud.

Static files, served as-is. The HTML is generated from `src/`:

```sh
node src/build-boards.mjs --public   # boards.html (no answer key)
node src/build-boards.mjs            # private/boards-full.html (answer key, never committed or deployed)
node src/build-helper.mjs            # helper.html
node src/build-play.mjs              # play.html (the digital playtest)
node --test test/*.test.mjs          # rules engine, solver and preview tests
```

`src/data/playtest-boards.json` holds the ten boards, including their perfect lines.
