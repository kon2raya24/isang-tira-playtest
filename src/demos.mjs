// Start-screen demo positions: one sowing and one rule each. None is a playtest board, and none
// shows the relay-into-your-ulo line the playtest measures.
export const DEMOS = [
  { house: 5, Y: [0, 0, 0, 0, 0, 2, 0], L: [0, 0, 0, 0, 0, 0, 0], outcome: 'extra', relays: 0,
    caption: 'Y5 has 2 shells: one into Y6, the last into your ulo. Extra turn.' },
  { house: 2, Y: [0, 0, 2, 0, 1, 0, 0], L: [2, 0, 0, 0, 0, 0, 0], outcome: 'capture', relays: 1,
    caption: 'Y2\'s last shell lands in Y4, which has a shell: pick both up and keep sowing (relay). It ends in your empty Y6, so you capture Lola\'s 2 opposite, plus that shell.' },
  { house: 6, Y: [0, 0, 0, 0, 0, 0, 3], L: [0, 0, 0, 0, 0, 0, 0], outcome: 'end', relays: 0,
    caption: 'Y6\'s 3 shells: one into your ulo on the way, then into Lola\'s row. The last lands in her empty L1: the turn ends.' },
  { house: 4, Y: [0, 0, 0, 0, 1, 0, 0], L: [0, 0, 0, 0, 0, 0, 0], outcome: 'dud', relays: 0,
    caption: 'Y4\'s shell lands in your empty Y5, but Lola\'s L1 opposite is empty: a dud, and the turn ends.' },
];
