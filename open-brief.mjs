// advisor-dev/open-brief.mjs — 开局决策：进游戏那一刻就告诉你「这局打谁、被禁了什么、玩哪套、选哪个策略」。
//
//   node advisor-dev/open-brief.mjs                                  # 用内置的三个演示局面跑一遍
//   node advisor-dev/open-brief.mjs --json '{"modeId":"mode_multi_normal","bossId":"boss_5","drawnDisabledBonds":["kjeragShip"]}'
//
// 输入形状 = `m.public`（服务端在 INFO_CHECK 阶段就发下来了，见 server/match/match/views.js publicView）：
//   modeId / difficulty / bossId / hiddenBossId / disabledBonds / drawnDisabledBonds / bannedChess / factions
// 输出 = 一条可执行的决策：推荐哪条核心盟约（附理由与风险）、选哪个策略、要预警什么。
//
// 所有数字都能追到来源：敌人血防抗来自 data/enemies.json，路线强度/命门来自 routes/_matchup.json，
// 策略归属来自 data/bands.json 的 bondIds（游戏自己标的），可用盟约来自 data/config.json 的 modes。

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const routesDir = path.join(here, 'routes');
const dataDir = path.join(here, '..', 'Stronghold-Protocol', 'data');
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));

const [modes, bosses, bands, matchup, loadout, chess, bonds, waves, enemies, config, items] = await Promise.all([
  readJson(path.join(routesDir, '_modes.json')),
  readJson(path.join(routesDir, '_bosses.json')),
  readJson(path.join(routesDir, '_bands.json')),
  readJson(path.join(routesDir, '_matchup.json')),
  readJson(path.join(routesDir, '_loadout.json')).catch(() => ({})),
  readJson(path.join(dataDir, 'chess.json')),
  readJson(path.join(dataDir, 'bonds.json')),
  readJson(path.join(dataDir, 'waves.json')),
  readJson(path.join(dataDir, 'enemies.json')),
  readJson(path.join(dataDir, 'config.json')),
  readJson(path.join(dataDir, 'items.json')),
]);

const bondName = (id) => (bonds[id] ? bonds[id].name : id);
const bandName = (id) => (bands[id] ? bands[id].name : id);

// ── 数值：伤害类型对一具体护甲/抗性的有效率 ──────────────────────────────────────────────────
const REF_ATK = 718;  // T5-T6 精锐的攻击力均值（NUMBERS.md §1 用的同一个口径）
const effPhysical = (def) => Math.max(REF_ATK - def, REF_ATK * 0.05) / REF_ATK;
const effArts = (res) => Math.max(0.05, 1 - res / 100);
const effOf = (damage, def, res) => {
  const phys = effPhysical(def), arts = effArts(res);
  if (damage === 'physical') return phys;
  if (damage === 'arts') return arts;
  if (damage === 'true') return 1;
  return (phys + arts) / 2;   // mixed
};

/** 全程压力（非 BOSS 回合的中后期均值），用来衡量「这套在道中够不够」 */
function roadPressure(modeId) {
  const mode = config.modes[modeId];
  if (!mode) return { def: 350, res: 32, flyShare: 0.48 };
  let def = 0, res = 0, fly = 0, n = 0;
  for (const r of Object.keys(mode.rounds || {})) {
    const round = mode.rounds[r];
    if (round.isBoss) continue;
    const ids = round.template ? [round.template] : [];
    for (const tid of ids) {
      const w = waves[tid];
      if (!w) continue;
      for (const s of w.spawns || []) {
        const e = enemies[s.key];
        if (!e) continue;
        const c = s.count || 1;
        def += c * (e.stats?.def || 0);
        res += c * (e.stats?.res || 0);
        const route = (w.routes || [])[s.routeIndex ?? 0];
        if (route && route.motion === 'FLY') fly += c;
        n += c;
      }
    }
  }
  return n ? { def: def / n, res: res / n, flyShare: fly / n } : { def: 350, res: 32, flyShare: 0.48 };
}

/** 每个盟约的可抓人数与被禁人数（bannedChess 是服务端下发的实际被禁干员） */
function rosterOf(bondId, bannedChess) {
  const all = Object.values(chess).filter((c) => c.visible === true && c.isGolden !== true && c.isDiy !== true
    && c.isHidden !== true && Array.isArray(c.bonds) && c.bonds.includes(bondId));
  const bannedSet = new Set(bannedChess || []);
  const banned = all.filter((c) => bannedSet.has(c.chessId) || bannedSet.has(c.baseId));
  return { total: all.length, banned: banned.length, left: all.length - banned.length, bannedNames: banned.map((c) => c.name) };
}

// ── 核心：读一份 m.public，出一份决策 ────────────────────────────────────────────────────────
export function readBrief(pub = {}) {
  const modeId = pub.modeId || 'mode_multi_normal';
  const mode = modes.modes[modeId] || null;
  const boss = bosses[pub.bossId] || null;
  const hiddenBoss = pub.hiddenBossId ? bosses[pub.hiddenBossId] || null : null;
  const drawn = Array.isArray(pub.drawnDisabledBonds) ? pub.drawnDisabledBonds.slice() : [];
  const allOff = Array.isArray(pub.disabledBonds) ? pub.disabledBonds.slice() : [];
  const bannedChess = Array.isArray(pub.bannedChess) ? pub.bannedChess.slice() : [];
  const road = roadPressure(modeId);

  const coreAvailable = (mode?.coreAvailable || []).filter((b) => !allOff.includes(b) && !drawn.includes(b));
  const coresKilledByBans = (mode?.coreAvailable || []).filter((b) => {
    const r = rosterOf(b, bannedChess);
    const need = Math.max(...(bonds[b]?.thresholds || [6]));
    return r.left < Math.min(need, 6);   // 连激活/成型都凑不齐
  });
  const addonsOn = (mode?.addonsAvailable || []).filter((b) => !allOff.includes(b) && !drawn.includes(b));
  const addonsOff = (mode?.addonsAvailable || []).filter((b) => allOff.includes(b) || drawn.includes(b));

  return {
    modeId, difficulty: mode?.difficulty || pub.difficulty || null, rounds: mode?.lastRound || null,
    boss, hiddenBoss, road,
    drawn, allOff, bannedChess,
    coreAvailable, coresKilledByBans,
    addonsOn, addonsOff,
    teammates: (pub.players || []).map((p) => ({ name: p.name, bandId: p.bandId || null })),
  };
}

/** 一条路线在这个局面下的分数与理由 */
export function scoreRoute(bondId, brief) {
  const meta = matchup.routes[bondId];
  if (!meta) return null;
  const why = [], risk = [];
  const boss = brief.boss;

  // 前半段：道中强度（BOSS 之外的所有回合都要打，占大头）
  let road = (9 - meta.rank) * 7;                        // 强度位次 0-49
  why.push(`强度位次 ${meta.rank}/8`);

  const roadEff = effOf(meta.damage, brief.road.def, brief.road.res);
  road += roadEff * 18;
  why.push(`道中有效输出 ${(roadEff * 100).toFixed(0)}%（DEF≈${Math.round(brief.road.def)} / RES≈${Math.round(brief.road.res)}）`);

  const needAA = brief.road.flyShare;
  road += (meta.antiAir / 10) * 10 - needAA * 6;
  if (meta.antiAir <= 3 && needAA > 0.45) risk.push(`飞行占 ${(needAA * 100).toFixed(0)}%，这套对空弱`);

  // BOSS 是一道**门**：打不动就整局输，所以按有效率做乘算，而不是简单加几分
  let bossEff = null, gate = 1;
  if (boss) {
    bossEff = effOf(meta.damage, boss.def, boss.res);
    why.push(`对 ${boss.name} 的有效输出 ${(bossEff * 100).toFixed(0)}%（DEF ${boss.def} / RES ${boss.res}）`);
    let fit = bossEff;
    if (meta.trueChannel && boss.def >= 700) {
      fit = Math.max(0.45, bossEff) + 0.25;
      why.push(`真伤通道不吃防御：${meta.trueWhy}`);
      risk.push(`普通伤害只剩 ${(bossEff * 100).toFixed(0)}%，只能靠真伤通道打`);
    } else if (bossEff < 0.2) {
      risk.push(`物理被 ${boss.def} 防御压到 ${(bossEff * 100).toFixed(0)}%，必须靠精准/真伤/法伤补`);
    }
    gate = 0.45 + 0.55 * Math.min(1, fit);
    why.push(`BOSS 门禁系数 ×${gate.toFixed(2)}`);

    for (const tag of boss.tags) {
      if (tag === '穿阻挡' && meta.control >= 7) { road += 8; why.push('控场强 → 克「穿阻挡」'); }
      if (tag === '穿阻挡' && meta.control <= 3) { road -= 10; risk.push('BOSS 穿过阻挡，你这套缺控场'); }
      if (tag === '点名' && meta.survival >= 7) { road += 5; why.push('血厚/减伤 → 抗点名'); }
      if (tag === '点名' && meta.survival <= 3) { road -= 8; risk.push('BOSS 会点名，你这套太脆'); }
      if (tag === '多目标' && meta.control >= 5) { road += 3; why.push('群攻/控场能应付多目标'); }
      if (tag === '隐匿' && bondId === 'lateranoShip') { road -= 10; risk.push('隐匿 BOSS 会让弹药循环断掉'); }
    }
    if (boss.melee && boss.atk >= 1200) risk.push(`近战 ATK ${boss.atk}，前排会瞬间融化，需要冻结/眩晕/复活兜`);
    // 专门追召唤物的 BOSS（假想敌：管 优先攻击「断弦之音」）——有召唤物的路线等于替全队吃仇恨
    if (meta.summons && /召唤|断弦/.test(boss.desc || '')) {
      road += 8;
      why.push(`召唤物能吃 BOSS 的仇恨：${meta.summonsWhy}`);
    }
  }

  let score = road * gate;

  // 命门附加盟约被禁 → 掉档
  for (const addon of meta.keyAddons || []) {
    if (!brief.allOff.includes(addon.bond)) continue;
    if (addon.weight === 'strong') { score -= 16; risk.push(`【${bondName(addon.bond)}】被禁：${addon.why}`); }
    else { score -= 7; risk.push(`【${bondName(addon.bond)}】被禁：${addon.why}`); }
  }

  // 干员被禁到凑不齐
  const roster = rosterOf(bondId, brief.bannedChess);
  const need = Math.min(...(bonds[bondId]?.thresholds?.slice(1) || [6]));
  if (roster.left < need) {
    score -= 40;
    risk.push(`本家只剩 ${roster.left} 人（被禁 ${roster.bannedNames.join('/') || '—'}），凑不齐 ${need} 人`);
  } else if (roster.banned >= 3) {
    score -= 8;
    risk.push(`本家被禁 ${roster.banned} 人（${roster.bannedNames.join('/')}）`);
  }

  return {
    bondId, name: bondName(bondId), score: Math.max(0, Math.round(score)), why, risk,
    roster, damage: meta.damage, bossEff, gate: +gate.toFixed(2), rank: meta.rank, trueChannel: !!meta.trueChannel,
    entryRisk: meta.entryRisk, bossNote: meta.bossNote, strategyNote: meta.strategyNote,
    keyOps: meta.keyOps || [],
  };
}

/**
 * 策略的效果向量：把 bands.json 的 key + params 翻译成「它到底给什么」。
 * 这是 ARCHITECTURE.md §D 的极简版（还不是完整事件核），但已经足够把「专属=好」这种错误排序换掉：
 * 克莱门莎给 layer 且阿戈尔 needs.layer=0.1 → 自动沉底；凯瑟琳给 equip 且维多利亚 needs.equip=1.0 → 自动上浮。
 */
const CHANNEL_OF_KEY = {
  give_coin_in_round: 'coin',
  coin_carry_over: 'coin',
  round_start_gain_coin_by_bond_char_chess_buy: 'coin',
  // 「特殊刷新偏向本家干员」= 拿牌通道，不只是刷新次数
  refresh_shop_count_gain_coin_bond_char_chess: 'unit+draw',
  band_coin_cost_gain_random_char_by_shop_level: 'coin+unit',
  band_cost_coin_reach_cnt_gain_chess_from_pool: 'coin+unit',
  first_buy_in_round_char_price_change: 'coin',
  preparation_start_gain_chess_from_round: 'unit',
  preparation_start_gain_chess_every_n_round: 'unit',
  prep_start_gain_chess_from_pool_in_round: 'unit',
  round_start_gain_char_chess_in_shop_every_n_round: 'unit',
  gain_bond_char_per_round: 'unit',
  band_shop_refresh_copy_max_lv_char: 'unit',
  preparation_start_add_special_goods_every_n_round: 'equip',
  up_shop_add_special_goods: 'equip',
  band_first_self_refresh_present_char: 'draw+unit',
  up_shop_next_refresh_must_present_bond_char: 'draw+unit',
  first_sell_char_chess_exchange_char_chess_in_shop: 'draw',
  prep_finish_char_bond_add_layer: 'layer',
  round_start_bond_check_gain_layer: 'layer',
  round_start_activate_char_chess_effect_in_board: 'count',
  auto_chess_change_map: 'atk',
  round_start_all_player_change_enemy_2: 'coin+risk',
};

/**
 * 赠送物 → 通道。策略常常「送一件装备/一张牌」，但那件东西本身才是效果
 * （信标 = 换 2 名干员、同构体 = 转职人数、储蓄罐 = 钱）。不解开这一层，
 * 「维多利亚吃装备」就会被误判成「芬送 4 件装备」。
 */
const GIFT_CHANNEL = {
  骑士储蓄罐: 'coin',
  寻呼模块: 'draw+unit',
  信标: 'unit+draw',
  变形同构体: 'count',
  突变细胞: 'unit',
  画卷: 'draw',
  教鞭: 'risk',
  商业包装方案: 'unit',
  奥术法阵: 'equip',
};
const itemName = (id) => (items[id] ? items[id].name : null);
const giftChannel = (id) => GIFT_CHANNEL[itemName(id) || ''] || null;

export function bandChannels(band, bondId = null) {
  const out = { coin: 0, unit: 0, equip: 0, layer: 0, atk: 0, hp: 0, redeploy: 0, sp: 0, draw: 0, count: 0, risk: 0 };
  const bump = (ch, w = 0.5) => {
    for (const part of ch.split('+')) if (part in out) out[part] = Math.min(1, out[part] + w);
  };
  const keys = band.keys || [];
  keys.forEach((key, i) => {
    const bb = (band.bb && band.bb[i]) || {};
    const params = (band.params && band.params[i]) || {};
    // 绑定某条盟约的效果（克莱门莎只给阿戈尔层、休露丝只减谢拉格价、玛恩纳只按卡西米尔购买给钱）
    // 对别的路线不供资源 —— 这一条不加，克莱门莎会在谢拉格那里冒充"给层数"
    const scope = params.bond_id || params.bond || null;
    if (scope && bondId && scope !== bondId) return;
    if (key === 'preparation_start_gain_chess_from_round' || key === 'preparation_start_gain_chess_every_n_round') {
      // 送的是装备还是干员？如果是装备，再解开那件装备本身的效果
      const gifted = params.type === 'equip' ? giftChannel(params.chess) : null;
      if (gifted) bump(gifted, 1);
      else if (params.type === 'equip') bump('equip', 1);
      else bump('unit', 1);
      return;
    }
    if (key === 'env_gbuff_new_with_verify') {
      // 复合效果：靠 bb 里的键判断到底是攻击 / 生命 / 再部署 / 护盾 / 按等阶给层
      if (typeof bb.atk === 'number') out.atk = Math.max(out.atk, 0.6);
      if (typeof bb.max_hp === 'number') out.hp = Math.max(out.hp, 0.6);
      if (typeof bb.respawn_time === 'number') out.redeploy = Math.max(out.redeploy, 1);
      if (typeof bb.prob === 'number') out.hp = Math.max(out.hp, 0.3);
      if (params.bond_add_type || params.bond_id) out.layer = Math.max(out.layer, 0.8);
      return;
    }
    if (key === 'up_shop_add_special_goods') { bump('equip', 1); return; }   // 凯瑟琳：每次升本 3 选 1
    const ch = CHANNEL_OF_KEY[key];
    if (!ch) return;
    // 「定向给本家干员」类效果（杜遥夜/佩佩/哈洛德/贾维）是硬通道，权重给满
    const hard = key === 'band_first_self_refresh_present_char' || key === 'up_shop_next_refresh_must_present_bond_char'
      || key === 'gain_bond_char_per_round' || key === 'refresh_shop_count_gain_coin_bond_char_chess'
      || key === 'round_start_gain_coin_by_bond_char_chess_buy';
    bump(ch, hard ? 1 : 0.5);
  });
  return out;
}

/** 路线需要 × 策略供给 的匹配度（0-1 归一），只用于排序与解释，不是胜率 */
export function effectFit(bondId, band) {
  const needs = (matchup.routes[bondId] || {}).needs || {};
  const ch = bandChannels(band, bondId);
  let score = 0, total = 0, hits = [];
  for (const [k, w] of Object.entries(needs)) {
    total += w;
    const supply = ch[k] || 0;
    score += w * supply;
    if (supply > 0 && w >= 0.4) hits.push(k);
  }
  return { fit: total ? score / total : 0, channels: ch, hits };
}

/** 策略建议：按「效果 × 路线需求」排序，专属只是一个标签不再是首选理由 */
export function suggestBands(bondId, brief, limit = 4) {
  const ownedByMate = new Set(brief.teammates.map((t) => t.bandId).filter(Boolean));
  const rows = [];
  for (const [id, b] of Object.entries(bands)) {
    const { fit, hits } = effectFit(bondId, b);
    const exclusive = b.bonds.includes(bondId);
    const conflict = ownedByMate.has(id) ? '队友已选，会抢牌' : null;
    // 专属只给一点点加分（同分时靠前），绝不压过效果匹配
    const score = fit * 100 + (exclusive ? 4 : 0) - (conflict ? 25 : 0);
    rows.push({
      bandId: id, name: b.name, lp: b.lp, kind: exclusive ? '专属' : '通用',
      fit: Math.round(fit * 100), score: Math.round(score), hits, channels: bandChannels(b), conflict,
      why: (hits.length ? `对口：${hits.join('/')}` : '效果与这套路线不匹配') + (exclusive ? ` · 本家专属（${b.desc.slice(0, 40)}…）` : ` · ${b.desc.slice(0, 50)}`),
    });
  }
  rows.sort((a, b) => b.score - a.score || (b.lp || 0) - (a.lp || 0));
  return rows.slice(0, limit);
}

/** 整局决策 */
export function decide(pub) {
  const brief = readBrief(pub);
  const ranked = brief.coreAvailable
    .map((b) => scoreRoute(b, brief))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  // 相对推荐度：把最高分当 100%，只用于排序比较，不是绝对胜率
  const best = ranked.length ? ranked[0].score : 0;
  for (const r of ranked) r.relative = best > 0 ? Math.round((r.score / best) * 100) : 0;
  const out = {
    brief,
    ranked,
    top: ranked[0] || null,
    dead: brief.coresKilledByBans.map((b) => ({ bondId: b, name: bondName(b), roster: rosterOf(b, brief.bannedChess) })),
    bans: {
      drawn: brief.drawn.map((b) => bondName(b)),
      all: brief.allOff.map((b) => bondName(b)),
      addonsOff: brief.addonsOff.map((b) => bondName(b)),
      chess: brief.bannedChess.length,
    },
    bands: ranked[0] ? suggestBands(ranked[0].bondId, brief) : [],
    // 干员调配（开局锁定）：自选 4 槽 + 关键干员的技能/模组
    loadout: ranked[0] && loadout[ranked[0].bondId] ? loadout[ranked[0].bondId] : null,
    modeName: (modes.modes[brief.modeId] || {}).name || brief.modeId,
  };
  return out;
}

// ── CLI：打印一份决策 ───────────────────────────────────────────────────────────────────────
function print(d) {
  const b = d.brief;
  console.log(`\n═══ ${d.modeName}（${b.difficulty}，${b.rounds} 回合） ═══`);
  console.log(`BOSS：${b.boss ? `${b.boss.name}${b.boss.hidden ? '（隐藏）' : ''} · HP ${b.boss.hp} · ATK ${b.boss.atk} · DEF ${b.boss.def} · RES ${b.boss.res} · ${b.boss.melee ? '近战' : '远程'} · ${b.boss.tags.join('/') || '无标签'}` : '未知（本局没抽到？）'}`);
  if (b.hiddenBoss) console.log(`隐藏 BOSS：${b.hiddenBoss.name}（HP ${b.hiddenBoss.hp}，DEF ${b.hiddenBoss.def}）`);
  console.log(`道中压力：DEF≈${Math.round(b.road.def)} / RES≈${Math.round(b.road.res)} / 飞行 ${(b.road.flyShare * 100).toFixed(0)}%`);
  console.log(`本局随机禁用：${d.bans.drawn.join('、') || '无'}`);
  const extraOff = d.bans.addonsOff.filter((n) => !d.bans.drawn.includes(n));
  if (extraOff.length) console.log(`          附加盟约被禁：${extraOff.join('、')}`);
  console.log(`可用核心盟约：${b.coreAvailable.map(bondName).join('、') || '无'}`);
  if (d.dead.length) console.log(`已被干员禁用打残：${d.dead.map((x) => `${x.name}(剩 ${x.roster.left} 人)`).join('、')}`);
  console.log('\n推荐顺序（相对推荐度 = 最高分当 100%，只用于排序，不是绝对胜率）：');
  d.ranked.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.name}  ${r.score} 分 · 相对 ${r.relative}%（${r.damage}${r.trueChannel ? '+真伤' : ''}，本家 ${r.roster.left} 人）`);
    console.log(`     理由：${r.why.join('；')}`);
    if (r.risk.length) console.log(`     风险：${r.risk.join('；')}`);
  });
  if (d.top) {
    console.log(`\n结论：玩【${d.top.name}】`);
    if (d.top.entryRisk) console.log(`  开局注意：${d.top.entryRisk}`);
    if (d.top.bossNote) console.log(`  BOSS 对策：${d.top.bossNote}`);
    console.log('  策略建议：');
    for (const s of d.bands) console.log(`    · ${s.name}（${s.kind}${s.lp ? `，起始 LP ${s.lp}` : ''}）${s.conflict ? ' ⚠ ' + s.conflict : ''}\n      ${s.why}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const jsonArg = process.argv.indexOf('--json');
  if (jsonArg >= 0) {
    print(decide(JSON.parse(process.argv[jsonArg + 1])));
  } else {
    const demos = [
      { label: '标准多人 · 谢拉格被禁 · BOSS 假想敌：管', pub: { modeId: 'mode_multi_funny', difficulty: 'FUNNY', bossId: 'boss_3', drawnDisabledBonds: ['kjeragShip'], disabledBonds: ['kjeragShip'], bannedChess: [], players: [{ name: 'me', bandId: null }] } },
      { label: '险境多人 · 精细被杀 · BOSS 卢西恩（近战穿阻挡）', pub: { modeId: 'mode_multi_normal', difficulty: 'NORMAL', bossId: 'boss_5', drawnDisabledBonds: ['preciShip', 'arcaneShip'], disabledBonds: ['preciShip', 'arcaneShip'], bannedChess: [], players: [{ name: 'me' }, { name: 'mate', bandId: 'band_dldeng' }] } },
      { label: '绝境多人 · BOSS 假想敌：铳（DEF1100/RES60）+ 谢拉格被禁', pub: { modeId: 'mode_multi_hard', difficulty: 'HARD', bossId: 'boss_2', drawnDisabledBonds: ['kjeragShip', 'steadShip'], disabledBonds: ['kjeragShip', 'steadShip'], bannedChess: [], players: [{ name: 'me' }] } },
    ];
    for (const d of demos) { console.log(`\n\n████ ${d.label}`); print(decide(d.pub)); }
  }
}
