# Oh My DSH 投稿声明

简体中文 | [English](omdsh-intake.md)

这是作者的投稿声明草案，不是 OMDSH 审核、安全认证或 Registry 准入。源码仓库、Issue、Release 和 npm 发布继续由 Totoro-qaq 管理；不申请组织角色或仓库迁移。

## 现有制品和安装边界

现有 npm 包通过 `cordis.patch.yml` 提供 `dsh.bundle.patch`。`package.json#dshWorkshop` 申报 `harness-profile` / `profile-bundle`，不新增 SDK、适配器依赖或运行入口。

`transactional`、`generation-rollback` 和 `touchesCurrentBeforeActivation: false` 描述申请使用的 **Workshop 候选 Profile 安装契约**，不是用户在当前 Profile 执行普通 `dsh plugin add` 的保证。没有提供故障注入证据，`failureIsolation` 保持 null；Workshop 必须验证自身的隔离安装和回滚后才能授予安装权限。

激活方式保守声明为 `restart-host`，安装或替换版本可能需要重启。实时启停证据不等于免重启升级。`dispose: supported` 指作用域注册和插件自有待处理记录的释放，不删除用户会话、goal、附件、摘要文件或宿主的包管理元信息。不声明热重载，其证据保持 null。

## 权限与副作用

- 通过官方宿主服务读取源会话上下文、创建目标和压缩工人会话；在用户明确批准计划交接时停止原规划轮次。
- 调用用户选择的模型提供方生成摘要并启动目标首轮，可能消耗付费 API tokens，并把选定的会话内容发给该提供方；不引入 Hub 遥测或翻译服务。
- 按配置创建暂停的 goal；目标的工具和文件权限仍由宿主管理。
- 写入临时 Markdown 摘要，读取用户明确指定的摘要文件；卸载不清除这些文件或用户创建的会话。
- 注册作用域内的原生会话/计划评审卡与导航，不安装替代 WebUI。

## 证据与兼容范围

清单只列 DSH 0.2.0-rc.2 和 0.2.1-alpha.1，原有 `engines.dsh` 范围不变。[rc.2 记录](../compatibility/dsh-0.2.0-rc.2-2026-09-30.md)和 [alpha.1 记录](../compatibility/dsh-0.2.1-alpha.1-2026-10-04.md)分别注明实际模型/UI 流程与限制。`/bridge --doctor` 是具体诊断能力；13/13 本身不能替代迁移验收。

2026-09-25 已用 Bridge 0.3.10 验收原生 macOS Desktop 0.1.7-rc.2。[2026-10-05 的 Desktop 0.2.0-rc.2 验收](../compatibility/desktop-0.2.0-rc.2-2026-10-05.zh-CN.md)另行通过原生控件验证已发布 Bridge 0.4.1 的迁移、批准计划执行、启停、卸载及重启；它与 WebUI 计划卡记录分开。

## 正式申请门禁

1. 作者审阅并将这次元数据改动发布到公开的不可变 commit 后，再生成 v2 投稿。已经发布的 npm 0.4.1 及其 Release commit **不含这份新声明**。
2. 固定准确的制品/版本及完整 40 位 commit，用固定的 Workshop 校验器验证 JSON。不使用浮动 main、短 SHA、虚构 commit 或未推送改动。
3. 展示完整 `[Submission]` Issue，取得作者对这次操作的明确确认后再创建。待审核 PR 由 Workshop 自动化生成，不直接修改其 Catalog 或 Registry。
4. 本次检查的 Workshop 基线仍是 DSH 0.1.0-rc.6，不在本包声明范围内。现代宿主的既有测试不是该平台当前基线的 Harness 证据；审核、验证和安装准入均保持待完成，不为通过旧基线而放宽兼容声明。

依据：[作者投稿流程](https://hub.omdsh.dev/agent-submission-prompt.zh.md)、[清单 schema](https://github.com/omdsh-dev/dsh-hub-workshop/blob/main/package-manifest.schema.json)、[入库门禁](https://github.com/omdsh-dev/dsh-hub-workshop/blob/main/INTAKE.zh.md)。
