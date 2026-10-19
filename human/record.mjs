// Parse one recorded human match segment (matches/<date>.jsonl, overlay recordTurn rows) into rounds.
// A round: start = the first PREP row (after 机变), end = the battle row (COMBAT / FINAL_ASSAULT / HIDDEN_CORE: the board
// that fought), lpAfter = LP on the SETTLE row, else the next round's first row. Gaps are reported, never filled silently.
import { readFileSync } from 'node:fs';

const BATTLE = new Set(['COMBAT', 'FINAL_ASSAULT', 'HIDDEN_CORE']);

export function loadSegment(file, firstLine, lastLine) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const rows = [];
  for (let i = firstLine - 1; i < lastLine; i++) {
    if (!lines[i]?.trim()) continue;
    rows.push({ line: i + 1, ...JSON.parse(lines[i]) });
  }
  return rows;
}

export function roundsOf(rows) {
  const byRound = new Map();
  for (const r of rows) if (r.round >= 1) (byRound.get(r.round) || byRound.set(r.round, []).get(r.round)).push(r);
  const out = [];
  const nums = [...byRound.keys()].sort((a, b) => a - b);
  for (const n of nums) {
    const rs = byRound.get(n), gaps = [];
    const preps = rs.filter(r => r.phase === 'PREP');
    let start = preps[0] || null;
    if (!start) { start = rs.find(r => r.phase === 'ROUND_START') || null; gaps.push('no PREP row'); }
    const rsStart = rs.find(r => r.phase === 'ROUND_START') || null;
    if (!rsStart) gaps.push('no ROUND_START row (start row is mid-prep)');
    const end = rs.find(r => BATTLE.has(r.phase)) || null;
    if (!end) gaps.push('no battle row');
    const settle = rs.find(r => r.phase === 'SETTLE') || null;
    out.push({ round: n, rows: rs, start, roundStart: rsStart, preps, end, settle, unite: rs.some(r => r.phase === 'UNITE'),
      sp: rs.some(r => r.phase === 'SP_DRAFT'), battlePhase: end?.phase || null, gaps });
  }
  for (let i = 0; i < out.length; i++) {
    const R = out[i], next = out[i + 1];
    R.lpBefore = R.start?.lp ?? null;
    R.lpAfter = R.settle ? R.settle.lp : next ? (next.rows[0].lp) : (R.rows[R.rows.length - 1].lp);
    if (!R.settle && R.battlePhase === 'COMBAT') R.gaps.push('no SETTLE row (LP after from next round)');
    if (!R.end && next) { R.end = { ...next.rows[0], inferred: true }; R.gaps.push(`battle board inferred from line ${next.rows[0].line}`); }
  }
  return out;
}

// "bonds":["preciShip:3/177", …] → { preciShip: { count: 3, layers: 177 } }
export function bondsOf(row) {
  const o = {};
  for (const s of row?.bonds || []) { const [id, rest] = s.split(':'); const [c, l] = rest.split('/').map(Number); o[id] = { count: c, layers: l }; }
  return o;
}

export const GAMES = {
  game1: { file: 'matches/2026-10-18.jsonl', first: 65, last: 140, label: '第一局 10-18 第 65–140 行' },
  game2: { file: 'matches/2026-10-19.jsonl', first: 72, last: 144, label: '第二局 10-19 第 72–144 行' },
};
