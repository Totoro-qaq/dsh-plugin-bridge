# dsh-plugin-bridge

[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![ci](https://github.com/Totoro-qaq/dsh-plugin-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/Totoro-qaq/dsh-plugin-bridge/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node ≥22](https://img.shields.io/badge/node-%E2%89%A522-339933)](package.json)
[![dsh 0.1.0-rc.6 · rc.7](https://img.shields.io/badge/dsh-0.1.0--rc.6%20%C2%B7%20rc.7-4c8dff)](https://github.com/deepseek-ai/deepseek-harness)
[![presets](https://img.shields.io/badge/presets-standard%20%C2%B7%20code%20%C2%B7%20minimal%20%C2%B7%20cordis-4c8dff)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | 中文

> **想在会话中途换个模式继续，却发现切换入口是锁的？** 锁得对（原因见下）——但锁完不该是死路。本插件就是那个出口：用**固定 schema 的交接摘要**把会话从一种工具模式「搬家」到另一种，而不是绕开官方的模式锁。

<p align="center">
  <img src="https://raw.githubusercontent.com/Totoro-qaq/dsh-plugin-bridge/main/assets/bridge-flow.zh.svg" width="880" alt="Bridge 迁移流程：原会话（模式锁定）→ 压缩工人 → 固定五段摘要 → 你预览确认 → 新 preset 会话；原会话原封不动，随时点回 = 回退">
</p>

## 为什么有这个项目

### 规则本身是对的：锁是保护，不是缺陷

preset 不是「语气档位」，它是一整套组装：系统提示词 + 工具集 + 插件。会话历史里的每一条工具调用（bash、读文件、改代码）都只在当时那套工具集下合法。中途换掉组装，新组合可能没有旧工具——历史里就留下了无法执行的「幽灵调用」。模型续跑时看到自己没有的工具的调用记录，轻则行为错乱，重则调用不存在的东西。

官方在网关层硬锁（`agent-preset-locked`），而且上游写得很明白：

> The restriction to a produced-nothing agent is **a product rule, not a mechanical one**: swapping tools mid-conversation would leave logged tool calls the new composition cannot make.
>
>（限制只对「还没产出过任何东西」的 agent 开放，这是**产品规则，不是机制约束**：中途换工具会在日志里留下新组装做不到的工具调用。）
>
> —— [`packages/preset/agent-presets/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/preset/agent-presets/README.md)

`recompose()` 技术上完全能换（先卸载再挂载），是想清楚之后选择禁止。因为换完不会报错，而是**静默劣化**：会话还能跑，质量悄悄变差，用户根本不知道为什么。硬锁比静默劣化诚实得多。网关自己在 `agentPreset.select` 上的注释把边界写得更死：*"Allowed only while the session is blank — no turn has run."*

分层也因此清晰：**模型和思考强度可以会话内切**（换「脑子」不影响历史合法性，官方 `session.selectModel` 就是这么设计的），**模式不能切**（换「手脚」会破坏历史）。本插件完全按这个分层接，和官方一致。

### 但「死路式」呈现让它体感像缺陷

用户的不适不是来自锁本身，而是**发现得太晚、锁了之后没有出口**：静态徽章只告诉你「此路不通」，不告诉你接下来怎么办。规则不该动，该补的是出口。

### Bridge 就是那个出口：搬家，不绕锁

压缩历史 → 新 preset 建新会话 → 把固定 schema 的摘要交接过去 → 新会话先复述理解再继续。**原会话全程不动，回退 = 点回原会话**（branch 而非 rollback）。

无损原理上不存在，所以目标定为实用稳定：有损，但可预览、可验证、可回退。摘要全文在迁移前展示，可编辑，你确认之前什么都不执行。摘要固定五段 schema（目标 / 当前状态 / 关键决策与约定 / 关键文件 / 下一步），新会话首轮先复述理解，事实在不在一问便知。原会话是不可变的只读事实，不满意随时点回去。

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

## 用法：`/bridge`

装上、重启、在输入框里打 `/bridge code`。就这些。

```
/bridge                    这个会话能迁到哪些模式？
/bridge code               生成交接摘要给你过目——什么都不改
/bridge code --go          确认，建新会话并交接
```

`/bridge` 就是一条普通的 dsh slash 命令，注册方式和 `/compact`、`/goal`、`/plan` 完全一样。host 把它路由给命令注册表，[全程不经过模型](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/host/apiproxy/src/api/sessions.ts)，输出由 UI 渲染、不进对话历史。这带来三个值得直说的结果：

- **不靠自然语言，也不靠运气。** 迁移不取决于模型愿不愿意帮忙，它是代码，由你派发。
- **任何 preset 下都能用**，包括 `minimal`——命令派发和某个模式组装了哪些工具没有关系。
- **原会话是真的没被动过。** 不是「我们尽量不写」：命令结果根本不是一条消息。

引擎在进程内。`@deepseek-ai/dsh-host-apiproxy` 把整套网关作为 `ctx.apiProxy` 提供出来，所以插件是通过直接的服务调用去建工人、读历史、挂目标——不需要端口，不需要 `DSH_WEB_URL`，不需要 shell。

预览会把摘要写进一个文件并打印路径。哪里不对——端口被凑成了整数、路径根本不存在——就改那个文件，然后 `/bridge code --go --file <路径>`。**文件是唯一事实源**，比模型对它的记忆可靠。

可选参数：`--tier flash|current|pro` · `--lang zh|en|auto` · `--goal-rounds N` · `--file <改过的摘要>`

### CLI（手动 / 脚本路径）

同一套引擎也作为 `dsh-bridge` 命令行发布，用于命令面覆盖不到的场景——在终端里驱动一次迁移、批量脚本、或者让评测 harness 复用同一套编排。它走回环 HTTP，读 `DSH_SESSION_ID` / `DSH_WEB_URL`。

```bash
dsh-bridge doctor
dsh-bridge preview --to code --session <id>
dsh-bridge migrate --to code --summary-file <path>
```

**TotoroPilot（GUI）**：同一条流水线由 BridgeModal 弹窗承载——目标模式下拉、压缩档位选择、摘要预览可编辑、成本预估行，确认后一键迁移。下面是在 TotoroPilot 里的一次真实迁移实录（隔离演示工作区）：

<p align="center">
  <img src="https://raw.githubusercontent.com/Totoro-qaq/dsh-plugin-bridge/main/assets/bridge-demo.zh.gif" width="880" alt="实测：锁定会话打开迁移弹窗，pro 档位生成五段交接摘要，预览确认后新会话在 PTC 模式下接力">
</p>

逐步操作手册（含确认点清单、回退、FAQ）：[docs/guide.zh.md](docs/guide.zh.md)。

## 模型侧开销（Model Experience）

**这个插件不往模型的提示词里加任何东西。** 没有技能目录条目、没有工具 schema、没有系统提示段。`/bridge` 由 UI 派发给命令注册表，模型看不到这条命令、它的参数、也看不到它的输出。

**Token 开销**：不迁移就是零。迁移一次的开销是一个用完即弃的工人会话约 2K tokens，加上注入新会话的摘要（≤900 tokens）。你**迁出**的那个会话不产生任何新费用。

**KV 缓存影响**：没有。装了这个插件不会改变任何会话的提示词前缀，所以它不可能让热缓存失效。（反过来，压缩工人跑在另一个会话里，也就**用不上**原会话的热前缀——见「已知局限」。）

面向模型的工具是**故意不注册**的。迁移是人的决定——这个插件自己的原则就是「不静默迁移」——而一个工具 schema 会在每个 agent 的每次请求里都占提示词，不管有没有人真的迁过。

## Token 消耗（实测数据，2026-08-17）

迁移一次只多了两笔账：压缩工人 ~1.6K 输入 / ~0.7K 输出，加上注入新会话的摘要 ≤1K tokens，合计约 2.4K tokens，相当于多发一轮消息；原会话不产生任何新费用。

评测（开发者视角）烧的是你自己的 token，不进 CI。实测账单：

| 批次 | 规模 | 未缓存输入 | 缓存命中输入 | 输出 | 合计 |
|---|---|---|---|---|---|
| 全量 benchmark | 26 run | 68.6 万 | 1,288 万 | 41.5 万 | ≈ 14.0M |
| A/B 对照 | 8 run | 26.6 万 | 514 万 | 11.2 万 | ≈ 5.5M |

93% 的输入走 provider 缓存命中（埋点与压缩指令重复度高），实际计费远低于表面数字；缓存命中价通常约为未命中的 1/10，自行按 provider 单价折算。

## 准确率（2026-08，26 组真实 run，全文见 [docs/benchmark.md](docs/benchmark.md)）

| 指标 | 测试集 T16 | 验证集 V6 |
|---|---|---|
| 摘要保真（工人摘要含多少事实） | 97.5% | 96.7% |
| **探针可用性（迁移后事实可回忆）** | **87.5%**（95% CI 78.5–93.1） | **83.3%**（66.4–92.7） |
| 摘要结构合规（五段标题） | 100% | 100% |

按压缩档位拆（测试集，各 8 run）：

| 档位 | 探针可用性 | run 级分布 | 工人成本 |
|---|---|---|---|
| **pro（默认）** | **95%** | 均值 0.95，**标准差 0.09** | ~2K tokens/run |
| flash | 80% | 均值 0.80，**标准差 0.32** —— 8 次里有 1 次全灭 | 几乎同价 |

**这是一个方差结论，不是均值结论。** 那 15pp 的差距**全部**来自 flash 的一次 0/5；把那一条去掉，flash 是 0.91。在这个样本量下均值差异并不显著（事实级 Fisher 精确检验 p = 0.087，而且事实级计数本身高估了精度——一个 run 里的 5 个事实并不独立）。数据真正支持的是：同样的价格下 flash 的离散度大一个数量级，而且它的失败是**整条全灭**而不是少一两个事实（`flash → minimal` 三次里两次全灭）。这才是「默认 pro」的理由：不是均值更好，是没有那条尾巴。

其他结论：源 preset 对保真度零影响（对照组 4/4 全 5/5），迁移质量只取决于摘要质量与目标注入。执行偏移集中在「数字合理化」——端口被补全成常见值，路径基本不漂。失败模式已枚举并有缓解（见 benchmark §7），剩下的残差风险由「预览确认 + 原会话可回退」兜住。

## A/B 验证：摘要迁移 vs 裸重开（2026-08，4 条成对 run）

对照设计：同一埋点（5 个硬约定事实）、同一探针与漂移模板；**对照臂**新会话只带任务标题（等价「换个模式重开此题」），**实验臂**走完整 bridge 流水线。pro 档位，code / minimal 两种目标 × 2 题材 × 2 臂（`reports/ab-2026-08-17.raw.json`）。

结果按「目标 preset 有没有工具」干净地分成两半，把两半平均掉恰好会盖住机制：

| 目标 | 臂 | 探针可用性 | 执行携带约定 |
|---|---|---|---|
| **code**（有工具） | bridge 摘要 | 10/10 | 4/10 |
| **code**（有工具） | 裸重开 | 9/10 | 4/10 |
| **minimal**（无工具） | bridge 摘要 | **9/10** | 6/10 |
| **minimal**（无工具） | 裸重开 | **2/10** | 0/10 |

- 迁进**无工具**的目标时，裸重开是真失忆——每 run 只剩 1/5。这是裸重开的真实水平。
- 迁进**有工具**的目标时，裸重开的探针分和摘要臂差不多，但机制并不体面：agent 在首轮发起 25+ 次工具调用翻遍磁盘，从 host 会话日志里把约定找回来（复现诊断：`node eval/inspect-bare.mjs`）。这样的单 run 烧了 220 万输入 tokens、必触 240s 限速，执行照样漂。这条路依赖工具存在、磁盘日志和模型主动性，能成立是侥幸。
- 所以摘要的价值不是「记得更准」，而是**在任何 preset 下都用一份固定的、可预算的代价记得**，而不是用目标模式恰好要花的那份代价。

⚠️ **这组 A/B 有两个已知弱点，都已修复但尚未重测。** 2026-08-17 那批 run 共用一个工作区——这正是对照臂能从磁盘上翻出事实的原因；现在每个 run 都用一个空的临时工作区。另外 n = 4 对只够给方向，不够给结论。见 [docs/benchmark.md](docs/benchmark.md) §10。

## 测试与验证

- `npm test` 跑 **95 条测试**：压缩取材行为（含**语义**断言——「取材被裁时，最新的那条还在吗」）、会话事件折叠器、摘要五段 schema 契约、**`/bridge` 命令端到端**、进程内 `ctx.apiProxy` 适配器、对着假 dsh host 的完整迁移流水线、以及 CLI 端到端（真进程、真 HTTP 网关、真线协议信封）。全部不需要真的 host，也不烧一个 token。
- `npm test` 同时对 `src/` **和** `eval/` 做类型检查——评测脚本 import 的就是命令用的那些模块，不可能再和产品路径漂开。
- CI 额外校验 `lib/` 与 `src/` 同步、数据集可解析、`npm pack` 内容完整，Node 22 与 24 各跑一遍。
- ⚠️ **尚未在真实 host 上验过。** 每一条 RPC 签名、命令派发的契约、`ctx.apiProxy` 的服务形状都对着上游源码核过，假 host 实现的就是那份契约——但还没有人在跑着的 `dsh web` 里真的敲过一次 `/bridge`。请先做这件事；CLI 那侧的同名假设可以用 `dsh-bridge doctor` 覆盖。

## 配置

通过 profile 的 `cordis.patch.yml` 配置，或用它读取的 `DSH_BRIDGE_*` 环境变量。**每个键都真的被消费**——0.1 里它们一个都没有消费者。

| 键 | 环境变量 | 默认 | 含义 |
|---|---|---|---|
| `modelTier` | `DSH_BRIDGE_TIER` | `pro` | 压缩工人档位：`flash` / `current` / `pro` |
| `sourceCharBudget` | `DSH_BRIDGE_SOURCE_BUDGET` | `60000` | 取材字符预算（≈30K tokens） |
| `summaryCharBudget` | `DSH_BRIDGE_SUMMARY_BUDGET` | `2400` | 摘要字符预算（≈900 tokens） |
| `goalRounds` | `DSH_BRIDGE_GOAL_ROUNDS` | `1` | 给新会话的自主 goal 轮次上限 |
| `inject` | `DSH_BRIDGE_INJECT` | `both` | `goal` / `prompt` / `both` |
| `lang` | `DSH_BRIDGE_LANG` | `auto` | 摘要语言 |
| `workerProvider` / `workerModel` | `DSH_BRIDGE_PROVIDER` / `_MODEL` | — | 直接指定压缩模型，跳过档位推断 |
| `previewTimeoutMs` | `DSH_BRIDGE_PREVIEW_TIMEOUT` | `180000` | `/bridge <preset>` 等压缩工人的上限 |

`goalRounds` 值得单说：上游 `goal.create` 的部署默认是 **256** 轮，而 `dsh-goal-round-driver` 会在 agent 空闲时把目标渲染成 `<goal_round>` 提示反复跑。把交接摘要挂成 goal 而不限这个数，等于给新会话开了一个自主循环。交接只需要一轮。

## 已知局限与待办

- **`/bridge <preset>` 会阻塞到压缩工人跑完**（通常 20–60 秒，上限由 `previewTimeoutMs` 控制）。命令结果是同步返回的，所以工人特别慢时可能拖过客户端的 RPC 超时——迁移引擎本身不受影响，CLI 那条路也没有这个天花板。
- **依赖 `commands` 与 `apiProxy`。** 两者在官方 `web` profile 里都在（base 挂命令注册表，web bundle 挂 API 网关）。缺其一时插件会挂起等待而不是半挂——是响的，不是哑的。
- **压缩工人用不上原会话的 KV 缓存。** 上游自己的 compaction 后端会把会话前缀原样重放，正是为了让这次辅助调用成为上次路由请求的真前缀；本插件是另起一个工人会话，前缀毫无关系。实测到的缓存命中是跨 run 的指令重复，不是热前缀复用。要做对得在进程内调 `ctx.llm.stream()`——待办。
- **取材里 compaction 摘要和它压掉的用户消息仍然重复计费。** `session.history` 读的是日志，检查点和被它替换的消息都还在。
- **结构化输出会比 markdown 契约更好。** `ctx.subagents` 支持给子会话指定 JSON schema（以及模型、persona、工具限制），那会让「固定五段」从一个需要测量的性质变成类型保证。这一版为了能对着已发布的 rc 核验而没有做。
- **准确率数字早于 0.2 的注入改动。** 它们是在「只挂 goal、不限轮次」下测的。现在的默认（摘要同时进首轮提示与 goal）只会让事实更够得着，但没有重测。
- **benchmark 从未跑过长会话。** 26 个 run 都是一条消息埋点、立刻迁移：`truncated` 全为 false，没有一个 run 复用过 compaction 检查点。预算与裁剪路径目前只有单元测试覆盖。

## 自己跑评测（消耗你自己的 token，不进 CI）

```bash
# 前置：本地跑着 dsh web 且已配模型凭据
npm run eval                             # 全量 26 run（约 40-60 分钟）
BRIDGE_ONLY='电商' npm run eval           # 按 id 子串筛
BRIDGE_ARM=guess node eval/run.mjs       # 猜测基线：不埋点，直接问探针
BRIDGE_ARM=all BRIDGE_TO='^(code|minimal)$' node eval/run.mjs 2
```

先看猜测基线那一臂。打分是子串匹配，一个不看历史也能蒙对的事实会同等地抬高所有臂——读任何命中率之前先把这个下限减掉。

数据集在 `datasets/`，欢迎 PR 新题材，请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 工程注意（实测坑）

- cordis preset 的会话在开放式提示下会进入长时间工具循环（单轮 >10 分钟），eval 里所有轮次都有超时即 `session.cancel` 的看门狗；杀客户端进程**不会**终止 host 侧轮次。
- host 的 RPC 只有归档（`workspace.archiveSession`）没有删除；物理删除需停 host 后清理 `~/.dsh/sessions/`。
- `goal.create` 不会把目标放进模型上下文。上游写得很明确：*"Goal mutations do not inject model context."* 让目标可见的是轮次驱动器把它渲染出来，或者模型自己调 `get_goal`。任何依赖「目标被读到」的设计，都不能假设它「被看到」。

## License

MIT
