# dsh-plugin-bridge

<p align="center">
  <img src="./assets/cover/cover-zh.png" width="100%" alt="dsh-plugin-bridge 通过可预览的固定五段交接，把锁定会话迁移到新的 preset">
</p>

[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![ci](https://github.com/Totoro-qaq/dsh-plugin-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/Totoro-qaq/dsh-plugin-bridge/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node ≥22](https://img.shields.io/badge/node-%E2%89%A522-339933)](package.json)
[![dsh rc.6 · rc.7 · rc.8](https://img.shields.io/badge/dsh-rc.6%20%C2%B7%20rc.7%20%C2%B7%20rc.8-4c8dff)](https://github.com/deepseek-ai/deepseek-harness)
[![收录于 Awesome DeepSeek Harness](https://img.shields.io/badge/%E5%B7%B2%E6%94%B6%E5%BD%95-Awesome_DeepSeek_Harness-f0b44d)](https://github.com/Dominic789654/awesome-deepseek-harness)

[English](README.md) | 中文

通过可预览、固定 schema 的交接，把已有内容的 DeepSeek Harness 会话迁到另一套工具 preset；原会话始终不动。

[快速开始](#快速开始) · [安全与成本](#安全与成本) · [准确率](#准确率) · [工作原理](#工作原理) · [兼容性](#兼容性与局限)

## 快速开始

```bash
dsh plugin --profile web add github:Totoro-qaq/dsh-plugin-bridge#v0.2.3
# 重启一次 dsh web
```

然后在官方 WebUI 输入：

```text
/bridge                       列出可迁入的 preset
/bridge code                  预览交接摘要，什么都不改
/bridge code --go             迁移、复述，然后等你确认
/bridge code --go --continue  在目标会话同一轮复述并开始工作
```

预览可编辑。数字或路径不对时，修改输出里打印的摘要文件，再执行：

```text
/bridge code --go --file <路径>
```

卸载：`dsh plugin --profile web remove dsh-plugin-bridge`，然后重启 `dsh web`。

> **官方 rc.8 WebUI 实测（2026-08-20）：**干净安装、插件加载、`standard → minimal` 预览与迁移、暂停目标持久化、host 重启均通过。仓库自带预构建 `lib/`，git 安装不需要 pnpm 构建脚本白名单。

## 安全与成本

Bridge 的目标是：**高准确率、成本有界的迁移**。

- **默认模式——准确率优先：**目标会话用一个短轮次复述交接，然后等待；你确认无误后才开工。
- **`--continue`——更低延迟/成本：**目标会话在**同一次模型请求**里完成复述并开始下一步。
- 两种确认模式都会在 kickoff 前暂停已存储的 goal（如有），goal driver 不会静默追加模型轮次。
- pause 失败时 fail closed：取消自动启动，不发送 kickoff。
- 只安装、不迁移时，正常会话增加 **0 prompt token**。`/bridge` 是 host slash command，不是模型工具或 skill。

压缩实测约 **1.6K 输入 + 0.7K 输出 tokens**。交接摘要给目标请求增加最多 **~900 输入 tokens**；目标请求还包含该 preset 正常的系统提示，因此完整成本随 preset 变化。一次 minimal preset 的真实复述轮测得约 1.5K 输入 / 98 输出，这只是示例，不是所有模式的固定账单。

一句话：安全默认值会明确多花一个“只复述”的确认轮；`--continue` 把确认和有效工作合并为一个目标轮，同时不开放后台 goal 轮次。

## 准确率

默认压缩档位为 `pro`。2026 年 8 月 benchmark：

| 指标 | 结果 |
|---|---:|
| 摘要保真 | 测试 97.5% / 验证 96.7% |
| 迁移后事实可用性 | 测试 87.5% / 验证 83.3% |
| `pro` 事实可用性（8 runs） | **95%** |
| `flash` 事实可用性（8 runs） | 80%，含 1 次全灭 |
| 五段 schema 合规 | 100% |

`pro` 与 `flash` 在这里几乎同价；默认 `pro` 是因为失败方差更小，不是因为小样本已经证明均值显著更好。数字与端口仍是主要漂移风险，所以“预览 + 复述”属于产品主链路。

完整方法、token 账单、A/B 对照与已知弱点见 [benchmark](docs/benchmark.md)。

## 工作原理

```text
折叠历史 → 生成五段摘要 → 预览/编辑 → 创建目标会话
         → 暂停存储目标 → 注入摘要 → 复述（可选同轮继续）
```

五段分别是：目标、当前状态、关键决策与约定、关键文件、下一步。旧 preset 的工具痕迹会被主动丢弃：迁的是状态，不是与新工具集不兼容的调用历史。

原会话不会被改写。迁移不满意时，点回原会话并归档新会话即可。

<details>
<summary><strong>为什么不在原会话直接切 preset？</strong></summary>

preset 是系统提示、工具集和插件的完整组装，不是语气档位。历史里的工具调用只在生成它们的组装下合法。DeepSeek Harness 因此只允许空会话执行 `agentPreset.select`；中途切换会留下新 preset 无法执行的“幽灵调用”。

Bridge 尊重这个边界：建立干净的目标会话，只携带一份有界交接。模型与思考强度仍是另一层，可以在会话内正常切换。

</details>

<details>
<summary><strong>官方 preset 工厂、<code>@</code> 会话引用与 TotoroPilot</strong></summary>

- 官方 Agent Preset 工厂用于给空白/未来会话创建和配置 preset；Bridge 用于把已有工作迁进其中一个 preset。
- rc.8 的 `@` 引用把另一会话的有界只读快照加到当前会话；Bridge 新建会话，并去掉旧 preset 的工具痕迹。
- **TotoroPilot** 用 GUI 弹窗承载同一迁移流水线；本插件本身可以直接在官方 WebUI 使用。

<p align="center">
  <img src="https://raw.githubusercontent.com/Totoro-qaq/dsh-plugin-bridge/main/assets/bridge-demo.zh.gif" width="880" alt="TotoroPilot 中的一次真实 Bridge 迁移">
</p>

</details>

## 兼容性与局限

已核对 DeepSeek Harness **0.1.0-rc.6、rc.7、rc.8**，CI 覆盖 Node.js 22/24。升级 Harness 后可先运行 `/bridge --doctor`；缺少哪个网关方法会被直接点名。

- 官方 WebUI 安装后目前需要重启一次，也不允许插件自动跳转到新建会话；Bridge 会打印准确标题与 session ID。
- 预览通常需要 20–60 秒，受 `previewTimeoutMs` 上限保护。
- 长会话裁剪与 compaction 复用已有单测，但已发布的准确率 benchmark 使用的是短、单消息会话。
- 准确率数据早于 prompt+goal 双注入，不应理解为保证值。

完整操作、回退清单、配置表、CLI 路径与 FAQ 见 [中文使用指南](docs/guide.zh.md)。

<details>
<summary><strong>高级 CLI 与配置</strong></summary>

```bash
dsh-bridge doctor
dsh-bridge preview --to code --session <id>
dsh-bridge migrate --to code --summary-file <路径> --continue
```

主要配置：`modelTier`、`sourceCharBudget`、`summaryCharBudget`、`goalRounds`、`inject`、`lang`、`workerProvider`、`workerModel`、`previewTimeoutMs`。写入 profile 的 `cordis.patch.yml`，或使用指南中的 `DSH_BRIDGE_*` 环境变量。

默认注入方式是 `both`：摘要既存为可恢复的 goal，也进入 kickoff prompt。两种确认模式都会先暂停 goal。

</details>

## 开发验证

```bash
npm test          # build + typecheck + 111 tests
npm run pack:check
```

CI 检查 Node 22/24、生成的 `lib/`、数据集、安装包内容与上游 RPC/command 窄契约。测试使用 fake host，不消耗模型 token；评测另行运行并使用本机模型凭据，详见 [benchmark](docs/benchmark.md)。

## License

MIT
