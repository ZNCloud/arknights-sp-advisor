// The student's fixed action vocabulary: each legal advisor action (advisor/actions.mjs listActions) maps to one slot.
// Sell / equip / layout actions are outside the vocabulary (index -1): the guide does them for the student, and the
// teacher's soft labels for them are dropped (counted in the data stats, not hidden).
export const BUY_SLOTS = 8, REWARD_SLOTS = 4;
export const VOCAB = ['guide', 'end', 'macro:roll', 'macro:level', 'level', 'refresh', 'freeze',
  ...Array.from({ length: BUY_SLOTS }, (_, i) => `buy:${i}`), ...Array.from({ length: REWARD_SLOTS }, (_, i) => `reward:${i}`)];
const AT = new Map(VOCAB.map((k, i) => [k, i]));
export const GUIDE = 0;
export function vocabIndex(a) {
  const key = a.type === 'macro' ? `macro:${a.name}` : a.type === 'buy' ? `buy:${a.slot}` : a.type === 'reward' ? `reward:${a.idx}` : a.type;
  return AT.get(key) ?? -1;
}
// vocab index → the first legal action with that index (buy / reward slots are unique, so "first" is "the").
export function legalByIndex(actions) {
  const out = new Map();
  for (const a of actions) { const i = vocabIndex(a); if (i >= 0 && !out.has(i)) out.set(i, a); }
  return out;
}
