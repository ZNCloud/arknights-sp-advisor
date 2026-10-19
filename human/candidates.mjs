// Turn-level alternatives for the owner seat at one PREP, all applied through the engine's handlers on a restored
// position (the forced start of the recorded round). Each ends with the seat Ready. `R` is the recorded round.
import { readFileSync } from 'node:fs';
import { botPrep, arrange, itemTarget } from '../eval/engine.mjs';
import { assign, guidePrep } from '../guides/policy.mjs';
import { forceSeat } from './force.mjs';
import { deriveTurn } from './ownerturn.mjs';
import { shadowTurn, layout, planOf } from './shadow.mjs';
import { applyAction, TERMINAL } from '../advisor/actions.mjs';

const freeHand = ps => ps.hand.findIndex(x => !x);
// same convention as eval/advised.mjs: the guide spec lives in the working directory (guides/g06_final.json)
let guideSpec = null;
const loadGuide = () => (guideSpec ||= JSON.parse(readFileSync(process.env.SP_GUIDE || 'guides/g06_final.json', 'utf8')));

function ready(ps) { ps.resolveTemp(); const r = ps.setReady(true); if (!r.ok) throw Error(`ready refused ${JSON.stringify(r)}`); }

// The owner's opening-shop actions only (sells, buys from the opening shop, the recorded upgrades) — no refresh finds.
function ownerShopActions(m, ps, R, { levels = true } = {}) {
  const t = deriveTurn(ps.gd, R.start, R.end);
  if (levels) for (let i = 0; i < t.levelUps; i++) if (!ps.levelUp()?.ok) break;
  for (const s of t.sells) {
    let left = s.copies;
    for (const p of [...ps.hand, ...ps.temp, ...ps.board.values()].filter(p => p?.kind === 'chess' && ps.gd.baseIdOf(p.id) === s.base && !ps.gd.isGolden(p.id))) {
      if (left <= 0) break; if (ps.sell(p.uid)?.ok) left--;
    }
  }
  for (const b of [...t.buys, ...t.itemBuys]) {
    const i = ps.shop.slots.findIndex(x => x && !x.sold && x.id === b.id);
    if (i >= 0 && ps.priceOf(ps.shop.slots[i]) <= ps.funds && freeHand(ps) >= 0) ps.buy(i);
  }
}
function equipPlan(m, ps, plan) {
  for (const b of plan.board) for (const it of b.items || []) {
    const item = [...ps.hand, ...ps.temp].find(x => x?.kind === 'item' && x.id === it.id);
    const base = ps.gd.baseIdOf(b.id.replace('chess_char_4_27', 'chess_char_4_12'));
    const carrier = [...ps.board.values(), ...ps.hand].filter(p => p?.kind === 'chess' && ps.gd.baseIdOf(p.id) === base)[0];
    if (item && carrier && (carrier.items || []).length < 2) ps.equip(item.uid, carrier.uid);
  }
}
function botItems(m, ps) {
  for (const it of [...ps.hand, ...ps.temp].filter(x => x?.kind === 'item')) {
    const t = itemTarget(m, ps, it);
    if (t && (t.items || []).length < 2) ps.equip(it.uid, t.uid);
  }
}

let adviceRows = null;
const adviceOf = (game, round) => {
  adviceRows ||= JSON.parse(readFileSync(process.env.SP_ADVICE || 'results/advice.json', 'utf8')).rows;
  return adviceRows.find(r => r.game === game && r.round === round)?.advisor?.action || null;
};
const installGuideState = (m) => { if (!m.guideSpec) { const g = loadGuide(); m.guideSpec = g; m.guideActions = []; m.guideTrace = []; m.guideDecisionMs = []; m.guideTeam = assign(m, g); } };

export const CANDIDATES = {
  // what the owner actually fielded (refresh finds included: they are the realised luck of that prep)
  owner: { label: 'owner 实际', apply(m, ps, R) { forceSeat(m, ps, R.end, { shop: false, funds: false, lp: false }); ps.funds = 0; ready(ps); } },
  // the owner's own plan for this round, with fresh refresh luck (info-fair counterpart of `owner`)
  shadow: { label: '照 owner 的计划重打一遍（刷新结果重抽）', apply(m, ps, R, ctx) { shadowTurn(m, ps, ctx.plan); ready(ps); } },
  // the opening-shop buys, then every coin into 调度中心 levels instead of refreshes
  levelmax: { label: '开局商店照买，剩下的钱全用来升级', apply(m, ps, R, ctx) {
    ownerShopActions(m, ps, R);
    while (ps.shop.level < m.gd.maxShopLevel && ps.funds >= ps.shop.upgradePrice) if (!ps.levelUp()?.ok) break;
    equipPlan(m, ps, ctx.plan); layout(m, ps, ctx.plan); botItems(m, ps); ready(ps);
  } },
  // the opening-shop buys and the recorded upgrades, then every coin into refreshes toward the owner's lineup
  rollmax: { label: '开局商店照买，剩下的钱全刷新找牌', apply(m, ps, R, ctx) {
    ownerShopActions(m, ps, R);
    shadowTurn(m, ps, { ...ctx.plan, budget: 99 }); ready(ps);
  } },
  // same cards and items as the owner, lineup + tiles by the engine AI (with its battle rehearsal)
  ai_layout: { label: '同一批牌，AI 选人+摆位', apply(m, ps, R) {
    forceSeat(m, ps, R.end, { shop: false, funds: false, lp: false }); ps.funds = 0;
    arrange(m, ps, { final: true }); ready(ps);
  } },
  // same board; the items equipped during THIS prep (equipment is locked once on a carrier) handed out by the engine AI
  ai_items: { label: '同一批牌同站位，本回合新装的装备交给 AI 分', apply(m, ps, R) {
    forceSeat(m, ps, R.end, { shop: false, funds: false, lp: false }); ps.funds = 0;
    const before = {};
    for (const b of R.start.board || []) for (const it of b.items || []) before[it.id] = (before[it.id] || 0) + 1;
    for (const p of [...ps.board.values()]) for (const it of [...(p.items || [])]) {
      if (before[it.id] > 0) { before[it.id]--; continue; }
      const i = freeHand(ps); if (i < 0) continue;
      p.items = p.items.filter(x => x !== it); ps.hand[i] = it;
    }
    ps.recompute(); botItems(m, ps); ready(ps);
  } },
  // the engine's AI player plays this prep from the opening (AI 托管)
  ai_turn: { label: 'AI 托管这一回合（从开局商店起）', apply(m, ps) { botPrep(m, ps); if (!ps.ready) ready(ps); } },
  // the repo advisor's recommended action for this position (eval/human-advice.mjs), then guide g06 for the rest of the
  // prep — exactly what advisor/rollout.mjs finishTurn does for the advisor's own rollouts
  advisor: { label: '顾问建议的那一步 + guide 打完本回合', apply(m, ps, R, ctx) {
    const a = adviceOf(ctx.game, ctx.round);
    if (!a) throw Error(`no advisor action for ${ctx.game} R${ctx.round}`);
    installGuideState(m);
    const r = applyAction(m, ps, a);
    if (!r?.ok) throw Error(`advisor action refused: ${a.label} ${JSON.stringify(r)}`);
    if (a.type !== 'end' && !TERMINAL.has(a.type)) guidePrep(m, ps); 
    if (!ps.ready) ready(ps);
  } },
  // the advisor's current baseline policy (guide g06) plays this prep
  guide: { label: '顾问 guide g06 打这一回合', apply(m, ps) {
    if (!m.guideSpec) { const g = loadGuide(); m.guideSpec = g; m.guideActions = []; m.guideTrace = []; m.guideDecisionMs = []; m.guideTeam = assign(m, g); }
    guidePrep(m, ps); if (!ps.ready) ready(ps);
  } },
};
