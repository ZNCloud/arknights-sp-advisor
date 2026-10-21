// "看队友 / 学队友" for recorded matches: which teammate data a record has, every seat's rating, and the rounds where a
// teammate out-played the owner (public value gain, advisor/team.mjs) with what was different on public data.
import { readFileSync } from 'node:fs';
import { splitMatches, tracksOf, rateMatch } from './team.mjs';

// the record fields a teammate rating can use (matches/README.md); `stats` / `result` / `self` were added for it
const FIELDS = ['mates', 'teamLp', 'bossHp', 'stats', 'result', 'self'];
const present = (rows, f) => rows.filter((r) => r[f] != null && !(Array.isArray(r[f]) && !r[f].length)).length;
const f3 = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(3));

export function teamReport(files, profile = null) {
  const model = profile ? profile.valueModel : null, matches = [], lines = [];
  for (const file of files) {
    const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    splitMatches(rows).forEach((m, mi) => {
      const t = tracksOf(m.rows), rated = rateMatch(t, model);
      const fields = Object.fromEntries(FIELDS.map((f) => [f, present(m.rows, f)]));
      const me = rated.find((r) => r.self), mates = rated.filter((r) => !r.self);
      // rounds where some teammate gained more public value than the owner (largest gap first)
      const behind = [];
      if (me) for (const [round, g] of me.gains) {
        if (g.terminal) continue;
        const best = mates.map((x) => ({ x, g: x.gains.get(round) })).filter((y) => y.g && !y.g.terminal).sort((a, b) => b.g.gain - a.g.gain)[0];
        if (best && best.g.gain > g.gain) {
          const seatT = t.seats.find((s) => s.key === best.x.key), meT = t.seats.find((s) => s.self);
          const a = meT.rounds.find((q) => q.round === round)?.prep, b = seatT.rounds.find((q) => q.round === round)?.prep;
          behind.push({ round, mate: best.x.name, gap: best.g.gain - g.gain,
            me: a && { level: a.level, board: a.board, lp: a.lp, line: a.core?.id ?? null, layers: a.layers },
            them: b && { level: b.level, board: b.board, lp: b.lp, line: b.core?.id ?? null, layers: b.layers } });
        }
      }
      behind.sort((a, b) => b.gap - a.gap);
      const entry = { file: file.split('/').pop(), index: mi, rows: m.rows.length, lastRound: t.lastRound, hasMates: t.hasMates, hasResult: !!t.result, fields,
        seats: rated.map((r) => ({ name: r.name, seat: r.seat, self: r.self, O: r.O, dO: r.dO })), behind: behind.slice(0, 5) };
      matches.push(entry);
      lines.push(`${entry.file} 第${mi + 1}局：${entry.rows} 行，打到 R${entry.lastRound}；字段（有值的行数）${FIELDS.map((f) => `${f}=${fields[f]}`).join(' ')}`);
      if (!t.hasMates) { lines.push('   记录里没有队友（mates 字段为空）：这一局只能评你自己，学不到队友。'); return; }
      lines.push(`   座位：${rated.map((r) => `${r.self ? '我' : r.name}${r.O != null ? ` O=${r.O.toFixed(3)}(${f3(r.dO)})` : ''}`).join('，')}${t.result ? '' : '（没有终局结算 result，只有过程评分）'}`);
      for (const b of entry.behind) lines.push(`   R${b.round}：${b.mate} 这一回合公开估值多涨 ${b.gap.toFixed(3)}；你 ${b.me ? `${b.me.level}级 上阵${b.me.board} ${b.me.lp}血 ${b.me.layers}层` : '—'} / 他 ${b.them ? `${b.them.level}级 上阵${b.them.board} ${b.them.lp}血 ${b.them.layers}层 主叠${b.them.line}` : '—'}`);
    });
  }
  return { matches, text: lines.join('\n') };
}

/** the advise output's team block in plain words */
export function describeTeam(v) {
  const out = [`队友（R${v.round}，公开信息）：`];
  for (const x of v.mates) out.push(`  ${x.name}：${x.alive ? `${x.level}级 上阵${x.board} ${x.lp}血 主叠 ${x.line || '—'} ${x.layers}层${x.ahead != null ? `，比你${x.ahead > 0 ? '领先' : '落后'} ${Math.abs(x.ahead).toFixed(3)}` : ''}` : '已出局'}`);
  if (v.contested.length) out.push(`  抢同一条线：${v.contested.map((c) => `${c.bondId}（${c.who.join('、')}）`).join('；')}`);
  out.push(`  你：${v.me.level}级 ${v.me.lp}血 ${v.me.layers}层；推演里你走 ${v.me.line || '—'}${v.tempo ? `，节奏按打得好的人学到的：本回合 ${v.tempo.learnedNow} 级（guide ${v.tempo.base} 级）${v.me.level > v.tempo.learnedNow ? '，你已经更高（等级不会退）' : ''}` : ''}`);
  if (v.best) out.push(`  打得最好的队友：${v.best.name}（领先 ${v.best.ahead.toFixed(3)}，${v.best.level}级，主叠 ${v.best.line || '—'}）`);
  return out.join('\n');
}
