# dsh-plugin-bridge

[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![ci](https://github.com/Totoro-qaq/dsh-plugin-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/Totoro-qaq/dsh-plugin-bridge/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node ≥22](https://img.shields.io/badge/node-%E2%89%A522-339933)](package.json)
[![dsh 0.1.0-rc.6 tested](https://img.shields.io/badge/dsh-0.1.0--rc.6%20tested-4c8dff)](https://github.com/deepseek-ai/deepseek-harness)
[![presets](https://img.shields.io/badge/presets-standard%20%C2%B7%20code%20%C2%B7%20minimal%20%C2%B7%20cordis-4c8dff)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | 中文

> **想在会话中途换个模式继续，却发现切换入口是锁的？** 锁得对（原因见下）——但锁完不该是死路。本插件就是那个出口：用**固定 schema 的交接摘要**把会话从一种工具模式「搬家」到另一种，而不是绕开官方的模式锁。

<p align="center">
  <img src="https://raw.githubusercontent.com/Totoro-qaq/dsh-plugin-bridge/main/assets/bridge-flow.zh.svg" width="880" alt="Bridge 迁移流程：原会话（模式锁定）→ 压缩工人 → 固定五段摘要 → 你预览确认 → 新 preset 会话；原会话原封不动，随时点回 = 回退">
</p>

## 为什么有这个项目

### 规则本身是对的：锁是保护，不是缺陷

preset 不是「语气档位」，它是一整套组装：系统提示词 + 工具集 + 插件。会话历史里的每一条工具调用（bash、读文件、改代码）都只在当时那套工具集下合法。中途换掉组装，新组合可能没有旧工具——历史里就留下了无法执行的「幽灵调用」。模型续跑时看到自己没有的工具的调用记录，轻则行为错乱，重则调用不存在的东西。

官方在网关层硬锁（`agent-preset-locked`），并在源码里写明「这是产品规则，不是机制约束」——`recompose()` 技术上完全能换（先卸载再挂载），是想清楚之后选择禁止。因为换完不会报错，而是**静默劣化**：会话还能跑，质量悄悄变差，用户根本不知道为什么。硬锁比静默劣化诚实得多。

分层也因此清晰：**模型和思考强度可以会话内切**（换「脑子」不影响历史合法性，官方 `session.selectModel` 就是这么设计的），**模式不能切**（换「手脚」会破坏历史）。本插件完全按这个分层接，和官方一致。

### 但「死路式」呈现让它体感像缺陷

用户的不适不是来自锁本身，而是**发现得太晚、锁了之后没有出口**：静态徽章只告诉你「此路不通」，不告诉你接下来怎么办。规则不该动，该补的是出口。

### Bridge 就是那个出口：搬家，不绕锁

压缩历史 → 新 preset 建新会话 → 固定 schema 摘要注入为新会话的 goal → 首轮交接指令。**原会话全程不动，回退 = 点回原会话**（branch 而非 rollback）。

无损原理上不存在，「**有损 + 可预览 + 可验证 + 可回退**」= 实用稳定：

- **可预览**：摘要全文在迁移前展示，可编辑，不确认不执行（零静默）
- **可验证**：固定五段 schema（目标 / 当前状态 / 关键决策与约定 / 关键文件 / 下一步），新会话首轮先复述理解，事实在不在一问便知
- **可回退**：原会话是不可变只读事实，随时点回去

## 安装

```bash
dsh plugin --profile web add github:Totoro-qaq/dsh-plugin-bridge#main
# 重启 dsh web 生效
```

`dsh plugin add` 会把本包加入 profile 的 `dsh.profile.bundles` 层栈（本包已在 package.json 声明 `dsh.bundle.patch`）。`lib/` 随仓库预构建发布，git 直装**不需要** pnpm ≥10 的 `allowBuilds` 白名单。

> ⚠️ **会有额外 token 消耗**：每次迁移 ≈ 压缩 ~2K tokens + 注入 ≤1K tokens（约等于多发一轮消息）。实测数据见下文「Token 消耗」一节。

不想要了随时可卸：

```bash
dsh plugin --profile web remove dsh-plugin-bridge   # 重启 dsh web 后生效
```

## 用法：没有 GUI 也能用

本插件注册的是一个 **agent 技能**（`bridge`），不是 UI 组件——它把迁移流程和固定摘要 schema 教给 agent，由 agent 编排，人只在关键点确认。

**官方 WebUI（无定制 GUI）**：直接对 agent 说「把这个会话迁到 code 模式」（或按你的习惯表述）。agent 按技能流程执行：

1. 拉取并折叠当前会话历史（`session.history`），按字符硬预算取材（用户消息全文 + 最近轮结论 + 最近一次 compaction 底稿）
2. 起一个**压缩工人**（临时 minimal 会话，默认 pro 档位）生成固定五段摘要，工人用完归档
3. **把摘要全文给你预览**——你确认（或编辑）后才继续，这一步之前什么都不改
4. 用目标 preset 建新会话，摘要注入为 goal，发首轮交接指令，切过去

**TotoroPilot（GUI）**：同一条流水线由 BridgeModal 弹窗承载——目标模式下拉、压缩档位选择、摘要预览可编辑、成本预估行，确认后一键迁移。

逐步操作手册（含确认点清单、回退、FAQ）：[docs/guide.zh.md](docs/guide.zh.md)。

## Token 消耗（实测数据，2026-08-17）

**迁移一次（用户视角）**：压缩工人 ~1.6K 输入 / ~0.7K 输出，注入侧摘要 ≤1K tokens——**每次迁移约 2K tokens，相当于多发一轮消息**。这是唯一的额外消耗；原会话不产生任何新费用。

**对照组（为什么值得花这 2K）**：裸重开让 agent 自己翻找找回约定，A/B 实测单 run 最高烧 **220 万**输入 tokens——差三个数量级，且照样漂移。

**自己跑评测（开发者视角）**：评测消耗的是你自己的 token，不进 CI。实测账单：

| 批次 | 规模 | 未缓存输入 | 缓存命中输入 | 输出 | 合计 |
|---|---|---|---|---|---|
| 全量 benchmark | 26 run | 68.6 万 | 1,288 万 | 41.5 万 | ≈ 14.0M |
| A/B 对照 | 8 run | 26.6 万 | 514 万 | 11.2 万 | ≈ 5.5M |

93% 的输入走 provider 缓存命中（埋点与压缩指令重复度高），实际计费远低于表面数字；缓存命中价通常约为未命中的 1/10，自行按 provider 单价折算。

## 组成

- `src/compression.ts` — 压缩核心（纯函数）：`buildBridgeSource` 取材、`buildBridgeInstruction` 固定五段摘要 schema、`buildBridgeKickoff` 首轮交接指令。已在 26 组真实实验里验证（见下）。
- `src/index.ts` — Cordis bundle：注册 `bridge` skill + 配置命名空间（`modelTier` / `sourceCharBudget` / `summaryCharBudget`，可用 `DSH_BRIDGE_*` 环境变量覆盖）。
- `skills/bridge/SKILL.md` — 给 agent 的迁移说明书（原则、RPC 流程、档位建议）。
- `eval/` + `datasets/` — 评测 harness 与测试集/验证集。
- `docs/plan.md` — 完整设计文档（Token 成本设计、回退设计）。

## 准确率（2026-08，26 组真实 run，全文见 docs/benchmark.md）

| 指标 | 测试集 T16 | 验证集 V6 |
|---|---|---|
| 摘要保真（工人摘要含多少事实） | 97.5% | 96.7% |
| **探针可用性（迁移后事实可回忆）** | **87.5%** | **83.3%** |
| 摘要结构合规（五段标题） | 100% | 100% |

按配置拆（测试集）：

| 压缩档位 | 探针可用性 | 工人成本 |
|---|---|---|
| **pro（默认）** | **95%**，迁 cordis 目标 100% | ~2K tokens/run |
| flash | 80%，且 flash→minimal 三次两次全灭 | 几乎同价 |

其他结论：**源 preset 对保真度零影响**（对照组 4/4 全 5/5）——迁移质量只取决于摘要质量与目标注入；执行偏移集中在「数字合理化」（端口被补全成常见值），路径基本不漂。失败模式已枚举并有缓解（见 benchmark §7），残差风险由「预览确认 + 原会话可回退」兜住。

## A/B 验证：摘要迁移 vs 裸重开（2026-08，8 条成对 run）

对照设计：同一埋点（5 个硬约定事实）、同一探针与漂移模板；**对照臂**新会话只带任务标题（等价「换个模式重开此题」），**实验臂**走完整 bridge 流水线。pro 档位，code / minimal 两种目标 × 2 题材 × 2 臂（`reports/ab-2026-08-17.raw.json`）。

| 臂 | 探针可用性 | 执行携带约定 | 总输入 tokens |
|---|---|---|---|
| **bridge 摘要** | **19/20（95%）** | 10/20 | **1.8M** |
| 裸重开 | 11/20（55%） | 4/20 | 3.6M |

关键发现：

- 裸重开进 **minimal**（无工具）：探针 1/5——真正的「失忆」，约定全丢；
- 裸重开进 **code**（有工具）：探针 4-5/5，但机制是 agent 在首轮发起 **25+ 次工具调用的翻找循环**（单 run 烧 220 万输入 tokens、必触 240s 限速），从 host 会话日志里把约定翻回来（复现诊断：`node eval/inspect-bare.mjs`）。**更贵、更慢、仍然漂**（漂移 2/5），且依赖工具存在、磁盘日志与模型主动性——是偶然，不是方案；
- 结论：摘要的价值不只是「记得」，而是**以约一半的 token 代价、在任何 preset 下稳定地记得**。README 第一章的「为什么有」由此从论述变成证据。

复现：`BRIDGE_ARM=ab BRIDGE_TIER=pro BRIDGE_TO='^(code|minimal)$' BRIDGE_ONLY='^T1[1-4](-|$)' node eval/run.mjs 2`

## 测试与验证

- **27 条单元测试**（`npm test`）：压缩核心行为、摘要五段 schema 契约（标题顺序/条数上限/反编造规则/预算同源）、加载冒烟（真实 cordis Context 中 `ctx.plugin()` 完成注册，缺 inject 正确挂起）。
- **真实 dsh 环境端到端**（dsh 0.1.0-rc.6 实测）：`dsh plugin add` 安装 → reconcile 自动加入 `dsh.profile.bundles` → `--dump-config` 层栈含 bridge 行 → 运行中 host 的 `pluginInventory/list` 显示 `fiberPhase: active`。
- CI 额外校验：`lib/` 与 `src/` 同步、数据集可解析、`npm pack` 内容完整。

## 自己跑评测（消耗你自己的 token，不进 CI）

```bash
# 前置：本地跑着 dsh web 且已配模型凭据
npm run eval            # 全量 26 run（约 40-60 分钟、千万级输入 tokens）
BRIDGE_ONLY='^T0[13]$' npm run eval   # 只跑子集
DSH_API=http://127.0.0.1:3080/api npm run eval 3
```

数据集在 `datasets/`（test / validation 两个 split，含题材、事实点期望、探针与漂移模板），欢迎 PR 新题材。

## 工程注意（实测坑）

- cordis preset 的会话在开放式提示下会进入长时间工具循环（单轮 >10 分钟），eval 里所有轮次都有超时即 `session.cancel` 的看门狗；杀客户端进程**不会**终止 host 侧轮次。
- host 的 RPC 只有归档（`workspace.archiveSession`）没有删除；物理删除需停 host 后清理 `~/.dsh/sessions/`。

## License

MIT
