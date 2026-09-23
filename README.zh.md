# dsh-plugin-bridge

<p align="center">
  <img src="./assets/cover/cover-zh.png" width="100%" alt="dsh-plugin-bridge 通过可预览的固定五段交接，把锁定会话迁移到新的 preset">
</p>

[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![npm](https://img.shields.io/npm/v/dsh-plugin-bridge?color=cb3837)](https://www.npmjs.com/package/dsh-plugin-bridge)
[![ci](https://github.com/Totoro-qaq/dsh-plugin-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/Totoro-qaq/dsh-plugin-bridge/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node ≥22](https://img.shields.io/badge/node-%E2%89%A522-339933)](package.json)
[![DSH 实测 0.1.7-alpha.1](https://img.shields.io/badge/DSH_tested-0.1.7--alpha.1-4c8dff)](reports/dsh-0.1.7-alpha.1-compat-2026-09-22.md)
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
```

在 **DSH 0.1.5-rc.2** 上，添加或移除插件后需要重启 `dsh web`。在 **DSH 0.1.6-alpha.2** 上，从 WebUI「插件」页首次安装可以直接生效；CLI 安装或升级已有插件仍可能需要一次重启。**DSH 0.1.7-alpha.1** 已验收 CLI 安装、实时停用/启用及卸载后重启；未验证免重启安装或升级。

GitHub 固定版本备用路径：

```bash
dsh plugin --profile web add github:Totoro-qaq/dsh-plugin-bridge#v0.3.9
```

然后在官方 WebUI 输入：

```text
/bridge                       列出目标 preset
/bridge --doctor              DSH 升级后检查 host 契约
/bridge code                  只预览交接，什么都不改
/bridge code --go             迁移、复述，然后等待
/bridge code --go --continue  在同一次目标请求里复述并开始工作
```

DSH rc.7 及以上会在官方 WebUI 原生卡片中渲染 `/bridge`。「文本编辑」把固定五段变成普通文本框，并无损支持平坦的项目符号或编号列表；「Markdown」保留完整源码自由；「预览」渲染 Markdown 或完整 JSON 树。长内容只在卡片正文内滚动；点「确认迁移」后自动打开目标会话。DSH 0.1.7-alpha.2 上验收的后续源码版本，为窄窗口的固定输入栏留出了确认按钮的可点击空间；这项修复**尚未进入**已发布的 npm 0.3.9 或其同名 tag。

实现官方 `conversation.chat.commandview` slot 的第三方 UI 会自动得到同一张卡片。其他自定义 UI 仍保留完整服务端结果、摘要文件流程和目标标题/session ID 回退；UI 作者还可以复用无 React 的 `dsh-plugin-bridge/client-contract` 导出，而无需重写协议。旧客户端可修改输出里打印的摘要文件，再执行：

```text
/bridge code --go --file <路径>
```

预览中的修改在确认迁移前只是临时草稿。重启客户端或系统可能使其丢失；源会话始终不受影响，重新运行预览即可生成新的草稿。

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
| 原生 WebUI 重复门禁（预览 / 目标事实） | **3/3 · 3/3**，每次五项 |
| DSH 0.1.2 alpha.2 / alpha.3 / alpha.5 官方 WebUI 实装 | **13/13 · 编号列表编辑 · PTC 已暂停 · 图片转文本降级** |
| DSH 0.1.5-rc.1 官方 WebUI 实装，npm Bridge 0.3.4 | **13/13 · 3/3 次迁移 · 编辑逐字送达 · PTC 已暂停 · 原图直达视觉目标** |

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
| `--go --continue` | 确认既定下一步，同一次目标请求里复述并开工 | 单独审批和安全限制仍生效，没有后台 goal 轮次 |
| 图片已有助手分析 | 逐字搬运对应回答 | 默认不重发原图 |
| 图片未解析，目标可接图 | 搬原附件并保留源 VLM | 视觉费用由所选 provider 计算 |
| 图片未解析，目标是纯文本模型 | prompt 准入拒图，Bridge 显式发送文字降级 | 不暗启本地 VLM，也不假装看懂图片 |

## 兼容性

| DSH 基线 | 服务端交接 | 原生卡片 | 验证边界 |
|---|---:|---:|---|
| 0.1.0-rc.6 | 支持 | 不支持 | 窄 RPC 契约与文本兼容测试 |
| 0.1.0-rc.7 / rc.8 | 支持 | 契约核对 | client module / command slot 契约与服务端回退 |
| 0.1.1-rc.2 | 支持 | 支持 | 官方 WebUI 实装：doctor 13/13、编辑/确认/自动跳转、三次重复门禁 |
| 0.1.2-alpha.2 / alpha.3 / alpha.5 | 支持 | 支持 | 官方 DSH npm 宿主：typed controllers 13/13 与 PTC 自动跳转；alpha.5 门禁安装分支 tarball，保留 alpha.3 标题，编号列表可编辑，未解析图片降级为文本，卸载干净 |
| 0.1.2-rc.1 → 0.1.3-alpha.2 | 支持（Bridge 0.3.3+） | 支持（Bridge 0.3.3+） | 官方 npm 宿主真实升级、v2 历史与标题保留、编辑内容逐字交接、PTC goal 暂停、图片回退及卸载；见[验收记录](reports/dsh-0.1.3-alpha.2-compat-2026-09-08.md) |
| 0.1.5-alpha.1 | 支持（Bridge 0.3.4+） | 支持（Bridge 0.3.4+） | 官方 npm 宿主（会话格式 V3）：tarball 安装、原生卡片 bundle 已下发、V3 会话上 doctor 13/13 与预设列表；SDK 类型 diff 与 V3 折叠 fixture。未重跑需要模型的预览、迁移与图片回退；见[smoke 记录](reports/dsh-0.1.5-alpha.1-compat-2026-09-09.md) |
| 0.1.5-rc.1 | 支持（Bridge 0.3.4+） | 支持（Bridge 0.3.4+） | 官方 npm 宿主，已发布的 0.3.4 未改动：doctor 13/13，原生卡片实际渲染，三次真实模型迁移到 PTC，编辑内容逐字交接且 goal 保持暂停，未解析图片以原图交给支持图片的默认模型；见[验收记录](reports/dsh-0.1.5-rc.1-compat-2026-09-10.md) |
| 0.1.6-alpha.1 | 支持（Bridge 0.3.6+） | 支持（Bridge 0.3.6+） | 官方 npm 宿主：doctor 13/13，原生卡片实际渲染，PTC 运行时改名后 `ptc` 仍可迁入，未配置 key 时预览按设计失败退出；SDK 变化只有新增，`lib/` 与 0.3.5 逐字节相同。未重跑真实模型迁移；见[smoke 记录](reports/dsh-0.1.6-alpha.1-compat-2026-09-15.md) |
| 0.1.6-alpha.2 | 支持（Bridge 0.3.7+） | 支持（Bridge 0.3.7+） | 官方 npm 宿主：Bridge 0.3.6 能完成迁移，但「打开目标会话」按钮报 `ctx.sessions.open is not a function`；Bridge 0.3.7 在 alpha.2 和 alpha.1 上都通过 `uiWorkspace.openSession` 打开目标，goal 保持暂停，在插件页实时停用和启用也正常；见[验收记录](reports/dsh-0.1.6-alpha.2-compat-2026-09-18.md) |
| 0.1.7-alpha.1 | 支持（实测 Bridge 0.3.9） | 支持（实测 Bridge 0.3.9） | 已发布包未改动：13 个 V3 会话恢复为 V4、12 个标题保留、doctor 13/13、真实模型编辑与两种迁移模式、自动跳转、暂停 goal、worker 清理、图片转文本回退及实时启停。卸载清除包/命令/CSS，但留下失效 CLI 链接；见[验收记录](reports/dsh-0.1.7-alpha.1-compat-2026-09-22.md)。 |
| 0.1.7-alpha.2 | 支持（0.3.9 之后的源码包） | 支持（0.3.9 之后的源码包） | 官方 npm 宿主 + 本地打包的 Bridge 源码候选版：doctor 13/13、真实模型预览、文本/Markdown 往返、640/800 像素宽窗口确认按钮可达、编辑稿逐字交接、目标无工具调用、自动跳转且 goal 暂停。**不代表已发布的 0.3.9 含有修复**；见[限定范围验收](reports/dsh-0.1.7-alpha.2-compat-2026-09-23.md)。 |

DSH 0.1.5-alpha.1 请使用 Bridge 0.3.4 或更高版本：DSH 没有发布 0.1.4，而 `^0.1.3-alpha.2` 这类 caret 预发布范围不会匹配下一个预发布 minor，所以 0.3.4 追加 `^0.1.5-alpha.1` 并基于该 SDK 构建，`lib/` 产物逐字节相同。会话格式 V3 把系统提示词记成 `system/message` surface node；Bridge 只折叠用户、助手和工具事件，提示词文本不会进入交接。DSH 0.1.3-alpha.2 请使用 Bridge 0.3.3 或更高版本；Bridge 0.3.2 不包含那些兼容改动。typed adapter 只调用一次 `inspect`，就能读取默认 240 条消息的历史窗口，原来需要四次；不会缓存运行状态。`doctor` 检查方法是否存在，不能代替完整迁移验收。 同一个 `^0.1.5-alpha.1` 范围也覆盖 0.1.5-rc.1 和之后的 0.1.5 正式版，所以 rc.1 不需要新发 Bridge。

0.3.5 起压缩工人默认跟随会话当前模型（`modelTier: current`）。在 DSH 0.1.5-rc.1 上这就是 V4.1-Flash，它在[档位对比](reports/worker-tier-rc1-2026-09-10.md)里与 V4-Pro 打平，摘要用时约减半。DSH 0.1.5-rc.1 之前的版本没有 V4.1-Flash，请设 `DSH_BRIDGE_TIER=pro` 或用 `--tier pro`。

DSH 0.1.6-alpha.1 请使用 Bridge 0.3.6 或更高版本（只改了依赖范围，发布代码与 0.3.5 相同）。

0.3.8 起五个 DSH 可选 peer 范围改为 `"*"`，用新增的 `engines.dsh`（`>=0.1.0-rc.7 <0.2.0-0`）统一约束宿主版本。dshmarket 以 `includePrerelease: true` 评估此字段，所有当前预发布宿主均匹配，无需再为每个新预发布 minor 逐条追加 `||` peer 范围。

DSH 0.1.6-alpha.2 删除了客户端的 `sessions.open`。Bridge 0.3.6 在上面仍能完成迁移，但「打开目标会话」按钮会报 `ctx.sessions.open is not a function`。请使用 Bridge 0.3.7 或更高版本，它改为通过 WebUI 导航服务 `uiWorkspace.openSession` 打开目标，旧宿主上回退到 `sessions.open`。

CI 覆盖 Node.js 22/24。每次升级 Harness 后先跑 `/bridge --doctor`；缺哪个必要网关方法会被直接点名。

DSH 0.1.7-alpha.1 使用已发布的 Bridge 0.3.9，在 macOS / Node 22.23.1 上完成验收，没有改运行时代码或依赖。V3→V4 测试使用已有测试 home 的副本；升级前请备份 `DSH_HOME`，包括会话和 profiles，不要只备份插件目录。旧自定义目录 preset 的迁移、其他 UI/插件组合及 Windows 不在本轮范围内。本次兼容验收不需要另发 Bridge npm。

DSH 0.1.7-alpha.2 上的后续源码版本修复两处实测边界：压缩工人漏写时，将窄范围内识别出的、仍然生效的用户“禁用工具／禁止读写文件”明文约束补进可编辑交接稿；小窗口中确认按钮不再被固定输入栏遮挡。用户后来明确放开限制时，旧限制不再补入。这不是“所有用户约束都能自动保真”的承诺，确认前仍应过目并编辑；最终按编辑稿逐字交接。npm 0.3.9 与 `v0.3.9` tag 尚未改变，发版需另行处理。

当前边界：

- 用 CLI（`dsh plugin --profile web add`）安装后可能需要重启一次 WebUI；DSH 0.1.6-alpha.2 在 WebUI「插件」页首次添加包名 `dsh-plugin-bridge` 可以直接生效，在那里升级已安装的版本仍需重启；
- DSH 0.1.7-alpha.1 / pnpm 11.22.0 的 CLI 卸载，在升级和干净 profile 中都留下了失效的 `node_modules/.bin/dsh-bridge` 链接及包管理元信息；插件包、命令和 CSS 已清除，但不能称为磁盘完全零痕迹，详见上方验收记录；
- 原生卡片通过 WebUI 导航服务（`uiWorkspace.openSession`，旧宿主回退到 `sessions.open`）打开目标；旧客户端仍回退为标题和 ID；
- worker 运行时立即显示进度；早期原生卡片三次固定样本的 worker 用时为 7.4–12.8 秒，用时会随宿主、模型和输入变化，`previewTimeoutMs` 仍是硬上限；
- 纯文本模型无法读取未解析原图；
- 原生卡片重复门禁也只有三次固定输入，是发布证据，不是统计保证。

服务端命令仍是兼容核心。同一个包现在附带可选的官方 WebUI client half，负责渲染、编辑和跳转；即使 prerelease 客户端契约加载失败，`/bridge` 的完整服务端结果仍在。详见[实现边界](docs/native-webui-feasibility.md)。

## 文档

- [设计、安全、图片策略、成本与证据](docs/design.md)
- [中文安装、配置、回退与 FAQ](docs/guide.zh.md)
- [完整 release acceptance](reports/v0.2.3-e2e-report.md)
- [视觉迁移报告](reports/v0.2.6-rc11-vision-report.md)
- [原生 WebUI 重复验收](reports/native-workbench-2026-08-25.md)
- [DSH 0.1.2-alpha.2 兼容性验收](reports/dsh-0.1.2-alpha.2-compat-2026-08-31.md)
- [DSH 0.1.5-rc.1 兼容性验收](reports/dsh-0.1.5-rc.1-compat-2026-09-10.md)
- [DSH 0.1.5-rc.1 压缩档位对比](reports/worker-tier-rc1-2026-09-10.md)
- [DSH 0.1.6-alpha.1 兼容性 smoke](reports/dsh-0.1.6-alpha.1-compat-2026-09-15.md)
- [DSH 0.1.6-alpha.2 兼容性验收](reports/dsh-0.1.6-alpha.2-compat-2026-09-18.md)
- [DSH 0.1.7-alpha.1 兼容性验收](reports/dsh-0.1.7-alpha.1-compat-2026-09-22.md)
- [DSH 0.1.7-alpha.2 源码候选版验收](reports/dsh-0.1.7-alpha.2-compat-2026-09-23.md)
- [历史压缩档位 benchmark](docs/benchmark.md)

## 开发验证

```bash
npm ci
npm run verify
```

`verify` 会构建并类型检查插件两端、运行 203 项测试、核对 `lib/` 与数据集，再把真实 npm tarball 打包、安装并导入。测试不消耗模型 token。`prepublishOnly` 使用同一个 gate；GitHub Release 还会先检查 tag 与 `package.json` 版本一致，再走可信 npm 发布。

社区收录：[Awesome DSH Plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) · [Awesome DeepSeek Harness](https://github.com/Dominic789654/awesome-deepseek-harness)

生态发现入口：[dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)。Bridge 仍按标准 DSH 插件安装；TUI/std 一致性适配另行跟踪。

## License

MIT
