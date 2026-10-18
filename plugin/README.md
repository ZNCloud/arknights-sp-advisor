# 抓取顾问（pick-advisor）

> 人类可执行的策略卡在 `advisor-dev/model/STRATEGY-CARDS.md`；模型的完整测量报告在 `advisor-dev/model/REPORT-FINAL.md`。

只读的抓取决策面板：告诉你在休整期该抓商店里哪一张、路线还缺谁、以及这一局把核心盟约成到 6 人／9 人的估计概率。
不代替你操作，不发任何对局意图（`shared/plugins/ui.js` 会把看起来像 `g.*` / `room.*` 的消息拒掉），只是把你本来就能
看到的东西算一遍再摆出来。

## 它怎么工作

`hostState(pub, priv)` 推给插件的私有视图里已经有：`shop{level, slots[{kind,id,price,sold}]}`、`funds`、`hand[]`、
`board[]`、`bonds[{bondId,count,tier}]`、`lp`，公开视图有 `round`/`phase`/各家的 `lp` 与 `shopLevel`。面板拿这些
算三样东西：

1. **每格评分**（0–100 + 理由）：路线羁绊 +46（未到阈值）／+8（已满或已到人数档顶）；合成进度 差 1 张 +30、
   已有 1–2 张 +14、已精锐 −18；关键干员 +25；飞行波里能打飞的 +18；高费 +3/阶；买不起 −35；不搭路线 −8。
   装备按 16+5×阶 估，再乘路线的 `equipBias`（维多利亚装备=伤害 1.0，阿戈尔吃面板 0.3）；人数档到顶后装备 +bias×12。
2. **一句话动作**：抓某张 / 升调度中心 / 刷一次 / 花钱（**资金在休整期结束清零**，只有带 `coin_carry_over` 的策略坎诺特能带 5 金过夜，所以「攒金」是错的）。飞行波且对空位不够时，「对空 2/3 个（本波 19 只飞行）」会顶在
   动作前面 —— 漏飞行掉的是全额 LP，比多抓一张牌值钱。
3. **成牌估计**：蒙特卡洛 1200 次，用 `data/config.json` 的公开经济（`income = min(3+round,12)`、`upgradePrices`、
   每级 `shopSlots` 3–5 格、`refreshPrice`、`poolCopies` 12/14/18/16/8/5、3 合 1），按 copy-weighted 抽卡
   （`tier ≤ 商店等级` 的剩余份数占比）模拟到第 14 回合，统计达到该核心盟约第 2 个与最后一个阈值的比例。
4. **人数档位**（`routes/_tiers.json`，源头是引擎 `server/sim/content/bonds/core.js` 的 `reached()` 分支）：
   6 人档／9 人档各自解锁什么，以及离下一档还差几个人。只有炎有 9 人档（炎佑 ×2、攻 ×1.5、减伤 90%），
   其余七条 6 人就是顶档 —— 到顶后评分不再给「再抓本家人」+46，只给 +8，资源转喂层。

## 数据从哪来、为什么是估计

ui 插件的 iframe 有 `connect-src 'none'`，跑起来什么都 fetch 不到，所以 `ui/index.html` 里 `#sp-data` 那块 JSON 是
**离线烘进去**的（224 个可见干员、56 件装备、23 条盟约、每级抽卡分母）。它是从本仓库的 `data/chess.json`、
`items.json`、`bonds.json`、`config.json` 生成的，别手改；重生成见下。

概率只是估计，因为下面这些客户端根本看不到：

- 每局随机**禁用的羁绊**（NORMAL：core 3 + addon 4，均匀抽）会改变整张抽卡分布；
- **共享池子**的实时余量（谁手里几张、卖回的、商店里显示但不占库存的）；
- 队友/对手的手牌与 自选（DIY）库存；
- RNG 在服务端（seeded），没法预测下一刷。

面板里那行小字就是这条免责声明。**不要**把它当成"真胡率"去赌资源——它是方向，不是承诺。

## 安装（服主）

```powershell
node tools/plugin.mjs check pick-advisor --strict   # 应该 0 problem 0 warning
node tools/plugin.mjs pack pick-advisor --zip       # → plugins/_dist/pick-advisor-1.0.0.zip
node tools/plugin.mjs install .\plugins\_dist\pick-advisor-1.0.0.zip
```

或者把整个 `plugins/pick-advisor/` 目录放进服务器的 `plugins/`，重启或等 registry 重扫（`/plugins/index.json`
里出现 `"id":"pick-advisor"` 即可）。玩家在自己这边 **设置 → 插件**（个人插件）里打开它，占用 `hud.right` 槽。

> 官方 8443 / icu 服不装第三方插件，这个面板只在你自建或朋友开的服务器上出现。卫区合约是内置模式，
> 是否接受插件由服主决定。

## 改与验证

```powershell
node advisor-dev\build-data.mjs            # 改了上游 data/*.json 之后重烘 #sp-data
node advisor-dev\test-core.mjs             # 25 项：评分、路线、成牌估计、对空闸、人数档位
$env:PORT=3737; node server\index.js       # 另开一个 shell
node advisor-dev\shot.mjs                  # 起 headless Chrome 把面板渲染出来 → advisor-dev\panel.png
```

`test-core.mjs` 和 `shot.mjs` 在仓库外面（`advisor-dev/`），因为它们不属于插件本身：一个把 `// <CORE>` 之间的逻辑
抽出来在 Node 里跑，一个走真实 `/p/<id>/<hash8>/` 路由吃一条假 state。

## 下一步能做的（按价值排序）

1. **节奏表**：现在只有 `policy.levelCap`（如二本叙 8 回合前不升 3 本）；用 `upgradePrices` + 收入曲线算"留多少金过夜"
   的最优解，替代 `+6` 的粗规则。
2. **池子上界估计**：把队友可见盘面（`public.players` 只有 lp/shopLevel，没有盘面，做不到；需要服主放宽 allowlist）
   也算进分母——现在固定用初始份数，偏乐观。
3. **对空精确解**：`airOf` 现在是「飞行占比 ≥35% 就要求 1–3 个对空位」的下限启发式；精确解要引擎按波次试排
   （`tools/matchrun.mjs --rehearsal`），目前只做提示不做定量。
4. **复盘**：把每回合的 state 存进 `storage`（32 KB/插件），打完对照"当时的建议 vs 实际",给评分权重做回归。

## 许可

插件代码 CC0-1.0，跟仓库的 GPL-3.0-or-later 分开；不包含任何官方美术资源，`#sp-data` 只有名字、费用、羁绊、阈值
这类数值事实。
