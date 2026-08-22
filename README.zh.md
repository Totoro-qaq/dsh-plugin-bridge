# dsh-plugin-bridge

<p align="center">
  <img src="./assets/cover/cover-zh.png" width="100%" alt="dsh-plugin-bridge 通过可预览的固定五段交接，把锁定会话迁移到新的 preset">
</p>

[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![ci](https://github.com/Totoro-qaq/dsh-plugin-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/Totoro-qaq/dsh-plugin-bridge/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node ≥22](https://img.shields.io/badge/node-%E2%89%A522-339933)](package.json)
[![dsh rc.6 → 0.1.1-rc.2](https://img.shields.io/badge/dsh-rc.6%20%E2%86%92%200.1.1--rc.2-4c8dff)](https://github.com/deepseek-ai/deepseek-harness)
[![收录于 Awesome DSH Plugin](https://img.shields.io/badge/%E5%B7%B2%E6%94%B6%E5%BD%95-Awesome_DSH_Plugin-2ea44f)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

[English](README.md) | 中文

在 Web preset 做到一半，想换 Code preset 继续？直接切换会让旧工具组的调用历史留在新组合里。Bridge 先生成一份有界、可编辑的五段交接，再建立干净目标会话；原会话始终不动。

<p align="center">
  <img src="https://raw.githubusercontent.com/Totoro-qaq/dsh-plugin-bridge/main/assets/bridge-demo.zh.gif" width="880" alt="Bridge 在 DeepSeek Harness 官方 WebUI 中完成一次真实会话迁移">
</p>

[快速开始](#快速开始) · [为什么是-bridge](#为什么是-bridge) · [实测证据](#实测证据) · [迁移决策](#迁移决策) · [兼容性](#兼容性)

## 快速开始

从 npm 安装：

```bash
dsh plugin --profile web add dsh-plugin-bridge
# 重启一次 dsh web
```

GitHub 固定版本备用路径：

```bash
dsh plugin --profile web add github:Totoro-qaq/dsh-plugin-bridge#v0.2.10
```

然后在官方 WebUI 输入：

```text
/bridge                       列出目标 preset
/bridge --doctor              DSH 升级后检查 host 契约
/bridge code                  只预览交接，什么都不改
/bridge code --go             迁移、复述，然后等待
/bridge code --go --continue  在同一次目标请求里复述并开始工作
```

预览可以编辑。数字或路径不对时，修改输出里打印的摘要文件，再执行：

```text
/bridge code --go --file <路径>
```

卸载：`dsh plugin --profile web remove dsh-plugin-bridge`，然后重启 `dsh web`。

## 为什么是 Bridge

| 承诺 | 具体含义 |
|---|---|
| **执行前预览** | `/bridge <preset>` 不创建目标、不改源会话；先检查或修改固定五段交接。 |
| **迁状态，不迁工具痕迹** | 决策、路径、当前状态和下一步进入干净 preset；旧工具组的不兼容调用不会跟过去。 |
| **失败时关闭迁移** | kickoff 前暂停目标；无法保证时清除/取消目标，不发送模型请求。 |

只安装、不调用时，普通会话增加 **0 Bridge prompt token**。它是 host slash command，不是模型工具或 skill。

## 实测证据

这是小样本、可复现的回归门禁，不是总体准确率保证。

| Gate | 结果 |
|---|---:|
| 五段摘要事实 | **30/30** |
| 目标复述 / 首次有效工作事实 | **60/60 · 60/60** |
| 关键事实 / 旧值复活 | **90/90 · 0** |
| 已有图片证据 / 未解析原图路径 | **5/5 · 5/5** |
| Confirm / `--continue` 到首次有效工作的目标请求数 | **2 · 1** |
| Confirm 相对 `--continue` 的 nominal 配对中位额外成本 | **+8.1%** |
| 摘要 worker 在干净验收组件中的 nominal 占比 | **20.74%** |

token 百分比会随 preset、回复长度和缓存状态大幅波动；worker 占比是组成，不是相对“无 Bridge”的因果开销。稳定结论是默认确认多一个请求。边界和原始证据见[设计与证据说明](docs/design.md)、[完整 release report](reports/v0.2.3-e2e-report.md)和[视觉迁移报告](reports/v0.2.6-rc11-vision-report.md)。

## 工作原理

```text
折叠历史 -> 五段交接 -> 预览/编辑 -> 干净目标会话
         -> 暂停存储目标 -> 注入 -> 复述 -> 等待或同轮继续
图片历史 -> 原样搬运助手证据；未解析原图走附件网关
```

五段分别是：目标、当前状态、关键决策与约定、关键文件、下一步。原会话不会被改写；接得不好时归档目标，直接回源会话。

## 迁移决策

| 场景 | Bridge 行为 | 成本 / 保真影响 |
|---|---|---|
| 只安装，不调用 `/bridge` | 不注入提示，不注册模型工具 | **0 Bridge prompt token** |
| `/bridge code` | 起一个有界摘要 worker，只输出预览 | 不创建目标会话 |
| 默认 `--go` | 目标先复述再等待 | 首次有效工作前多一个显式确认请求 |
| `--go --continue` | 同一次目标请求里复述并开工 | 请求数更低，没有后台 goal 轮次 |
| 图片已有助手分析 | 逐字搬运对应回答 | 默认不重发原图 |
| 图片未解析，目标可接图 | 搬原附件并保留源 VLM | 视觉费用由所选 provider 计算 |
| 图片未解析，目标是纯文本模型 | prompt 准入拒图，Bridge 显式发送文字降级 | 不暗启本地 VLM，也不假装看懂图片 |

## 兼容性

| DSH 基线 | 文本交接 | 未解析原图 | 验证边界 |
|---|---:|---:|---|
| 0.1.0-rc.6 / rc.7 | 支持 | 无可选附件网关 | 窄 RPC 契约与文本兼容测试 |
| 0.1.0-rc.8 | 支持 | 取决于 host | 真实安装、重启、命令生命周期和迁移基线 |
| 0.1.1-rc.2 | 支持 | 支持 | 官方 WebUI + `deepseek-v4-flash-vision-exp`，doctor 13/13，视觉 gate 5/5 |

CI 覆盖 Node.js 22/24。每次升级 Harness 后先跑 `/bridge --doctor`；缺哪个必要网关方法会被直接点名。

当前边界：

- 安装后需要重启一次 WebUI；
- 官方尚无稳定的插件跳转目标会话接口，Bridge 会打印新会话标题和 ID；
- 预览通常 20–60 秒，并受 `previewTimeoutMs` 限制；
- 纯文本模型无法读取未解析原图；
- release acceptance 每个 cell 目前只有一次运行，表格是发布证据，不是统计保证。

服务端命令仍是兼容核心。官方 client module 与 slot 已证明原生迁移卡片可行，但其 prerelease 契约还不稳定，因此暂不把它塞进 v0.2.10；详见[可行性记录](docs/native-webui-feasibility.md)。

## 文档

- [设计、安全、图片策略、成本与证据](docs/design.md)
- [中文安装、配置、回退与 FAQ](docs/guide.zh.md)
- [完整 release acceptance](reports/v0.2.3-e2e-report.md)
- [视觉迁移报告](reports/v0.2.6-rc11-vision-report.md)
- [历史压缩档位 benchmark](docs/benchmark.md)

## 开发验证

```bash
npm ci
npm run verify
```

`verify` 会构建、类型检查、运行 125 项 fake-host 测试、核对 `lib/` 与数据集，再把真实 npm tarball 打包、安装并导入。测试不消耗模型 token。`prepublishOnly` 使用同一个 gate；GitHub Release 还会先检查 tag 与 `package.json` 版本一致，再走可信 npm 发布。

社区收录：[Awesome DSH Plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) · [Awesome DeepSeek Harness](https://github.com/Dominic789654/awesome-deepseek-harness)

## License

MIT
