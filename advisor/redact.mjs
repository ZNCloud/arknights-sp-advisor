// De-identify match records (matches/*.jsonl = overlay.mjs recordTurn rows) before they leave the owner's machine:
// every nickname → `座位<seat>`, every account id → `seat<seat>`.
//
// The seat is what the parsers key on (team.mjs tracksOf: `seat|name`, m.result matched by seat first), and one seat is
// one person within a match, so team numbers on a redacted file equal the original's — only the names differ.
// Fail-loud: a name/id that cannot be put on a seat, or that survives anywhere in the output, throws; partially redacted
// data is never returned. Error messages carry paths and seats only, never the values.
//
// Pure module (overlay.mjs --redact imports it).

export const PLAYER_ID = /^p_[0-9a-f]{6,}$/;
export const nameLabel = (seat) => `座位${seat}`;
export const idLabel = (seat) => `seat${seat}`;
// a "name" that already looks like a label identifies nobody, and it would trip the survival check on its own label
const LABEL = /^(座位|seat)\d+$/;

/** every object in a row that carries a name / account id: the teammates' public rows and the m.result players */
const peopleOf = (row) => [
  ...(Array.isArray(row.mates) ? row.mates.map((p, i) => [`mates[${i}]`, p]) : []),
  ...(row.result && Array.isArray(row.result.players) ? row.result.players.map((p, i) => [`result.players[${i}]`, p]) : []),
];

/** walk every string value and key: fn(string, path) */
function eachString(v, path, fn) {
  if (typeof v === 'string') { fn(v, path); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => eachString(x, `${path}[${i}]`, fn)); return; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { fn(k, `${path}{key}`); eachString(x, `${path}.${k}`, fn); }
}

/** throw if any original name/id is still in `v` (substring: a name inside a sentence counts too) */
function verify(v, originals, where) {
  const list = [...originals].filter((s) => s && !LABEL.test(s));
  if (!list.length) return;
  eachString(v, '', (s, path) => {
    if (list.some((o) => s.includes(o))) throw new Error(`redact: an original name/id survives at ${where}${path}`);
  });
}

function redactOne(row, seats, where) {
  const out = structuredClone(row);
  const originals = new Set();
  let names = 0, ids = 0;
  const seatOf = (path, p) => {
    if (p.seat != null) return p.seat;
    for (const k of ['playerId', 'name']) {
      const s = seats && p[k] != null ? seats.get(String(p[k])) : undefined;
      if (s != null) return s;
    }
    throw new Error(`redact: ${where}${path} has a name/playerId but no seat, and no row of its match puts it on one`);
  };
  for (const [path, p] of peopleOf(out)) {
    if (!p || typeof p !== 'object' || (p.name == null && p.playerId == null)) continue;
    const seat = seatOf(path, p);
    if (p.name != null) { originals.add(String(p.name)); p.name = nameLabel(seat); names++; }
    if (p.playerId != null) { originals.add(String(p.playerId)); p.playerId = idLabel(seat); ids++; }
  }
  // an account id anywhere else (a field added later): no seat next to it, so only the match's table can place it
  const fix = (v, path) => {
    if (typeof v === 'string') {
      if (!PLAYER_ID.test(v)) return v;
      const s = seats ? seats.get(v) : undefined;
      if (s == null) throw new Error(`redact: ${where}${path} holds an account id no row of its match puts on a seat`);
      originals.add(v); ids++;
      return idLabel(s);
    }
    if (Array.isArray(v)) return v.map((x, i) => fix(x, `${path}[${i}]`));
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[PLAYER_ID.test(k) ? fix(k, `${path}{key}`) : k] = fix(x, `${path}.${k}`);
      return o;
    }
    return v;
  };
  const row2 = fix(out, '');
  verify(row2, originals, where);
  return { row: row2, names, ids, originals };
}

/**
 * One record row, redacted (a new object; `row` is untouched). `seats` = optional Map name/id → seat for objects that
 * carry no seat (redactRows builds it per match); without an entry such an object throws.
 */
export function redactRow(row, seats = null) {
  return redactOne(row, seats, '').row;
}

/** the same boundary as team.mjs splitMatches (a match starts at INFO_CHECK / round 0), without its short-match filter */
function segmentsOf(rows) {
  const out = [[]];
  for (const r of rows) {
    if ((r.phase === 'INFO_CHECK' || (r.round === 0 && r.phase !== 'RESULT')) && out[out.length - 1].length) out.push([]);
    out[out.length - 1].push(r);
  }
  return out.filter((m) => m.length);
}

/** name/id → seat from every row of one match that carries both; a value seen on two seats maps to nothing (ambiguous) */
function seatTable(rows) {
  const t = new Map();
  const put = (k, seat) => {
    if (k == null || seat == null) return;
    k = String(k);
    if (!t.has(k)) t.set(k, seat);
    else if (t.get(k) !== seat) t.set(k, null);
  };
  for (const r of rows) for (const [, p] of peopleOf(r)) if (p && typeof p === 'object') { put(p.name, p.seat); put(p.playerId, p.seat); }
  return t;
}

/**
 * A whole file: every row redacted with its match's seat table, then the whole output checked against every original
 * name/id from every row (a name seen in one match must not survive in another). Returns { rows, names, ids } —
 * counts of replaced values.
 */
export function redactRows(rows) {
  const out = [], all = new Set();
  let names = 0, ids = 0, at = 0;
  for (const match of segmentsOf(rows)) {
    const seats = seatTable(match);
    for (const r of match) {
      const x = redactOne(r, seats, `row ${at++}: `);
      out.push(x.row); names += x.names; ids += x.ids;
      for (const o of x.originals) all.add(o);
    }
  }
  out.forEach((r, i) => verify(r, all, `row ${i}: `));
  return { rows: out, names, ids };
}
