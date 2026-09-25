// Board rows from picks.json ('x' = burnt) -> engine state + burnt mask.
import { makeBoard, burntMask } from './engine.mjs';

export function toState(board) {
  const bY = [], bL = [];
  board.Y.forEach((v, i) => { if (v === 'x') bY.push(i); });
  board.L.forEach((v, i) => { if (v === 'x') bL.push(i); });
  const num = (row) => row.map((v) => (v === 'x' ? 0 : v));
  return { s: makeBoard(num(board.Y), num(board.L)), burnt: burntMask({ Y: bY, L: bL }) };
}
