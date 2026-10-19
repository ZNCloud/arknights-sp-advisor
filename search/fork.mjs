import { capture, restore } from '../advisor/state.mjs';

// Vanilla, no DIY/plugin adapter. Delegates to the single snapshot/restore implementation (advisor/state.mjs).
// Never clone or consume the live RNG. Each branch uses an independent search stream.
// (The previous inline copy dropped the non-enumerable m.factions.schedule, so every forked wave was re-rolled.)
export function forkPrep(source, sampleSeed) {
  const m = restore(capture(source), { rngMode: 'resample', sampleSeed, revealHiddenBoss: true });
  return m;
}
