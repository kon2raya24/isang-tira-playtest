// Preview mode per board for each tester group (counterbalanced).
// FH = first handful only; WS = whole sowing, relays included. Monday is always FH (rule teaching).
// Wednesday picks alternate preview-bot unsolved/solved (W1 u, W2 s, W3 u, W4 s), so each group's
// FH pair and WS pair each hold one of each.
export const MODES = {
  A: { W1: 'FH', W2: 'FH', W3: 'WS', W4: 'WS', S1: 'FH', S2: 'WS', S3: 'FH' },
  B: { W1: 'WS', W2: 'WS', W3: 'FH', W4: 'FH', S1: 'WS', S2: 'FH', S3: 'WS' },
};
export const MODE_NAME = { FH: 'first handful', WS: 'whole sowing' };
export const modeFor = (group, code) => MODES[group][code] || 'FH';
