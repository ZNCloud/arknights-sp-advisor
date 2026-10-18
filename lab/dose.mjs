// lab/dose.mjs — treatment-integrity check: did the forced focus bond actually get built by the seats?
// usage: node lab/dose.mjs <bondName> <file...>
// Counts, on the R13 settle row (or the last row a seed has) and among the seats still ALIVE, how many carry the bond
// on their public strip and at which tier (the strip renders "维多利亚" / "维多利亚2").
import { readFileSync } from 'node:fs';

const [bondName, ...files] = process.argv.slice(2);
if (!bondName || !files.length) {
  console.error('usage: node lab/dose.mjs <bondName> <file...>');
  process.exit(2);
}
function load(f) {
  const b = readFileSync(f);
  let t;
  if (b[0] === 0xff && b[1] === 0xfe) t = b.toString('utf16le').slice(1);
  else { t = b.toString('utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); }
  return JSON.parse(t);
}
const re = new RegExp(`${bondName}(\\d*)`);

for (const f of files) {
  const arr = load(f);
  let seats = 0;
  let hit = 0;
  let tier2 = 0;
  const tiers = {};
  for (const r of arr) {
    const row = r.rounds.find((x) => x.round === 13) || r.rounds[r.rounds.length - 1];
    if (!row) continue;
    for (const p of Object.values(row.players)) {
      if (!p.alive) continue;
      seats++;
      const m = re.exec(String(p.bonds || ''));
      if (!m) continue;
      hit++;
      const t = m[1] ? Number(m[1]) : 1;
      tiers[t] = (tiers[t] || 0) + 1;
      if (t >= 2) tier2++;
    }
  }
  const pct = seats ? ((hit / seats) * 100).toFixed(0) : '-';
  console.log(`${f}: alive seats ${seats} · seats with ${bondName} active ${hit} (${pct}%) · tier≥2 ${tier2} · tiers ${JSON.stringify(tiers)}`);
}
