// B2 version alignment. Models carry the game-data fingerprint they were trained on (models/meta.json, written by
// advisor/stamp.mjs after train.py). At load time the current engine's fingerprint is compared; on mismatch the
// model is marked stale and the advisor leans on rollouts (exact engine, always current) instead of the model.
import { readFileSync, existsSync } from 'node:fs';
import { dataHash } from '../eval/version.mjs';

let current = null;
export const currentVersion = (engineRoot) => current ||= dataHash(engineRoot);
export function modelStatus(modelDir, engineRoot) {
  const now = currentVersion(engineRoot), p = `${modelDir}/meta.json`;
  if (!existsSync(p)) return { stale: true, reason: '模型无版本元数据(meta.json)', now };
  const meta = JSON.parse(readFileSync(p, 'utf8'));
  const why = [meta.dataHash !== now.dataHash ? '游戏数据已变' : null, meta.engineCommit !== now.engineCommit ? '引擎代码已变' : null].filter(Boolean);
  return { stale: why.length > 0, reason: why.length ? `模型待更新：${why.join('、')}（训练时 ${meta.dataHash.slice(0, 12)}@${meta.engineCommit.slice(0, 8)}，当前 ${now.dataHash.slice(0, 12)}@${now.engineCommit.slice(0, 8)}）` : '模型与当前游戏版本一致', meta, now };
}
// Budget when the model is stale: no model pre-filter, wider and deeper rollouts.
export function staleBudget({ K, N, N2 }) { return { K: Math.max(K, 8) + 4, N: Math.max(N, 6) * 2, N2: Math.max(N2, 6) * 2 }; }
