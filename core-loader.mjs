// advisor-dev/core-loader.mjs — the single source of truth for the recommendation logic.
//
// A ui plugin runs in a sandboxed iframe with `connect-src 'none'`, so its page must stay one self-contained file:
// the logic lives inline between the `// <CORE>` markers and the data in the `#sp-data` JSON block. Everything else
// that wants the same answers (the Node tests, the desktop overlay) pulls those two pieces out instead of keeping a
// second copy that drifts.
//
//   import { loadAdvisor } from './core-loader.mjs';
//   const { DATA, api } = await loadAdvisor();

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_PAGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'Stronghold-Protocol', 'plugins', 'pick-advisor', 'ui', 'index.html',
);

const DATA_MARK = '<script id="sp-data" type="application/json">';
const CORE_OPEN = '// <CORE>';
const CORE_CLOSE = '// </CORE>';

/** @param {string} [page] @returns {Promise<{DATA: any, api: any, core: string}>} */
export async function loadAdvisor(page = PLUGIN_PAGE) {
  const html = await fs.readFile(page, 'utf8');

  const dataAt = html.indexOf(DATA_MARK);
  if (dataAt < 0) throw new Error(`no ${DATA_MARK} block in ${page}`);
  const dataStart = dataAt + DATA_MARK.length;
  const dataEnd = html.indexOf('</script>', dataStart);
  const DATA = JSON.parse(html.slice(dataStart, dataEnd));

  const coreAt = html.indexOf(CORE_OPEN);
  const coreEnd = html.indexOf(CORE_CLOSE);
  if (coreAt < 0 || coreEnd < coreAt) throw new Error(`no ${CORE_OPEN} … ${CORE_CLOSE} region in ${page}`);
  const core = html.slice(coreAt, coreEnd);

  // the core starts by reading the data block off a document; give it one
  const stub = { getElementById: (id) => (id === 'sp-data' ? { textContent: html.slice(dataStart, dataEnd) } : null) };
  const api = new Function('document', `${core}
    return { analyseState, estimate, scoreSlot, adviceOf, autoRoute, matchKeyOf, coreBonds, heldCounts, progressOf,
      nextThreshold, nameOf, bondsOf, baseOf, tierOf, isGolden, mergeOf, missingFor, bondName, thresholdsOf,
      layersOf, damageMultiplier, survivalMultiplier, bbOf, coreBondsFor, modeOf, lastRoundOf, upgradePrice, shopSlotsOf,
      placeOf, isKeyOp, keyOpsOf, canHitFlyOf, airOf, tierEffectsOf, tierLineOf, addonStatusOf, addonAdvice, investMult, gainOf, stackPlanOf, stackChannelOf, placementPlanOf, armorCheckOf, reachOdds, terminalOf, carryCapOf, effectiveLayersOf, policyOf, bandUsageOf, scoreBounty,
      axisCtxOf, axisCardOf, axisItemOf, refreshEV, freezeEV };`)(stub);
  return { DATA, api, core };
}
