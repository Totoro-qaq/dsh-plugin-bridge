# Changelog

本文件记录对使用者可见的变化。版本遵循语义化版本。

## 0.2.0 — 2026-08-18

这一版的主题是：**让它成为一个正常的 dsh 插件**——`dsh plugin add` 装上、重启，
输入框里就有 `/bridge`；`dsh plugin remove` 卸掉，命令随 fiber 一起消失。

0.1 交付的是一份 `SKILL.md`，指望模型读到它、然后自己去编排一串 RPC。这既不可靠，
也不是 dsh 插件的形态：上游 30 个包用 `ctx.tools.register` 暴露能力、7 个包用
`ctx.commands.register` 注册 slash 命令，**用 `ctx.skills.register` 的包是 0 个**——
skill 在 dsh 里是给用户和项目写东西的创作面，不是插件的调用面。

### 新增

- **`/bridge` 命令**（形状对齐上游 `dsh-plan-mode` 的 `/plan`）：
  - `/bridge` 列出可迁入的模式，`/bridge <preset>` 出摘要给你过目，`/bridge <preset> --go` 执行；
  - 由 UI 直接派发给命令注册表，**全程不经过模型**，输出也不进对话历史；
  - 因此不需要 bash、不需要环境变量、不依赖模型主动配合，`minimal` 这种没有 skill
    工具的 preset 也能发起迁移。
- **进程内执行**：`@deepseek-ai/dsh-host-apiproxy` 把整套网关作为 `ctx.apiProxy` 提供，
  插件直接调服务完成迁移——不出进程、不用端口、不读 `DSH_WEB_URL`。
- **对模型提示词零贡献**：不注册技能、也不注册工具。不迁移就是零 token 开销，
  也不会让任何会话的 KV 缓存失效。（面向模型的工具是故意不做的：迁移是人的决定。）
- **预览与执行分离**：`/bridge <preset>` 不改动任何会话，把摘要打印出来并落盘；
  改完那个文件再 `--go --file <path>`。摘要文件是唯一事实源。
- **`dsh-bridge` CLI** 作为手动 / 脚本路径保留（走回环 HTTP），评测 harness 复用同一套编排。
- **对着假 host 的端到端测试**：`/bridge` 命令、`ctx.apiProxy` 适配器、迁移全链路、
  CLI 进程都在 CI 里跑完整流程，不需要真的 dsh host，也不烧 token
  （`test/fake-host.mjs`）。测试从 27 条增至 95 条。
- 评测新增 **`guess` 猜测基线臂**（`BRIDGE_ARM=guess`）：不埋点直接问探针，
  测出打分口径的下限。所有命中率都应减去它再读。
- 子路径导出（`dsh-plugin-bridge/compression`、`/fold`、`/migrate`、`/command`、`/rpc`）。

### 移除

- `skills/bridge/SKILL.md` 与 `ctx.skills.register` 调用。理由见上；
  `ctx.tools.register` 也没有加，见「新增」里那条。

### 修复

- **取材预算超限时砍错了地方。** 旧实现按顺序装、装不下就从当前分区头部切一刀然后
  中断，于是活下来的是**最老**的用户消息，而承载「刚完成什么 / 卡在哪」的最近助手
  结论段会整段消失；`userMessagesUsed` 还恒等于总条数，调用方看不出发生过丢弃。
  现在按分区配额分配、未用尽的额度按优先级回流、超限时从最老的开始丢，
  并新增 `dropped` 字段把裁剪如实报出来。
- **配置项此前完全没有消费者。** `apply()` 从不读 config，`SUMMARY_CHAR_BUDGET`
  导出后零引用，而 `docs/guide.zh.md` 把它们连同 `DSH_BRIDGE_*` 环境变量当功能写进了
  文档——设了不报错也不生效。现在每个键都真的进入命令的行为。
- **迁移会让新会话进入最多 256 轮的自主循环。** 上游 `goal.create` 的部署默认
  `maxGoalRounds` 是 256，`dsh-goal-round-driver` 会在 agent 空闲时把目标渲染成
  `<goal_round>` 提示反复跑。现在默认只给 1 轮，跑完交回用户（`goalRounds` 可配）。
- **摘要不一定进得了上下文。** 上游 `dsh-goal` 明确「Goal mutations do not inject
  model context」——摘要能被模型看见依赖 goal-round-driver 或模型主动调 `get_goal`。
  默认注入方式改为 `both`：挂 goal 的同时，首轮提示里也带摘要全文，任何组装下都成立；
  没挂 goal 服务的部署会降级而不是失败。
- **skill 的 description 曾经有两份，生效的是没有路由触发词的那份**（frontmatter 里带
  "Use when …" 的版本被 `apply()` 整块剥掉了）。随技能一起移除，问题不复存在。
- **compaction 底稿带着上游的面向模型指令一起被喂给压缩工人。** 上游检查点的正文是
  `CHECKPOINT_PREAMBLE + <compacted-summary>…</compacted-summary>`，旧实现只去标签，
  于是「别提这个 checkpoint，直接继续」也进了取材。现在只取标签之间的内容。
- **压缩模型写死了 deepseek 的 provider/model id。** 现在读 `session.models` 的目录，
  按档位在同一 provider 里挑，挑不到就退回会话当前模型；也可用
  `workerProvider`/`workerModel` 直接指定。
- **`waitIdle` 存在竞态。** 旧实现先睡 2 秒再看 `running`，host 排队慢一点就会把
  「还没开始」误判成「已经跑完」，取到上一轮的回答。现在先等它真的跑起来。
- `session.list` 改为按 cursor 取完。上游 v1 一次返回全部、`cursor` 只是预留位，
  所以今天行为不变；这是为了上游真分页之后不会悄悄只看第一页。
- 环境变量被设成空串（`DSH_API=`）时不再覆盖掉后续的回退顺序。

### 评测

- **每个 run 一个空的临时工作区**（`workspace.create` / `workspace.delete`）。
  0.1 的所有 run 共用同一个工作区，对照臂的 agent 因此能从磁盘上的 host 会话日志
  甚至本仓库的 `datasets/*.json` 里把埋点事实翻出来——这正是 bare→code 拿到 9/10 的原因。
- **run id 改为由配置派生**，加一个题材不再让历史 id 全部重编号。
- 评测脚本改为直接 import `src/`：跑的就是用户跑的那条代码路径。
- `eval/fold.ts` 与 `eval/types.ts` 删除（前者是 GUI 折叠器的副本，30+ 条类型错误、
  零测试覆盖，且 `eval/` 从不进类型检查；后者与 `src/types.ts` 逐字节重复）。
  折叠器移到 `src/fold.ts`，有了测试，也进了类型检查。

### 工程

- CI 增加 `tsc --noEmit`（覆盖 `src` 与 `eval`）与 Node 22/24 矩阵。
- 补 `repository` / `bugs` / `homepage` / `bin` / `exports`；补 dependabot 与 issue 模板。

## 0.1.0 — 2026-08-17

首个版本：压缩核心、bridge 技能、评测 harness、26 组准确率实验与 8 条 A/B 对照。
