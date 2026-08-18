# Bridge · 跨模式会话迁移

> **这是一份设计文档，记录的是当初怎么想的，不是当前实现的说明书。**
> 现状与本文的两处出入，见 README「已知局限与待办」：
> 1. 「紧跟会话结束发起以命中 provider 侧热缓存」**没有落地**——压缩工人是**另起一个会话**，
>    前缀与原会话无关，拿不到那份热缓存。上游 compaction 是靠原样重放会话前缀才做到的，
>    要做对得在进程内调 `ctx.llm.stream()`。
> 2. 「goal 挂载（持久投影）」需要修正：上游 `dsh-goal` 明确「Goal mutations do not inject
>    model context」——挂目标不等于摘要进上下文。0.2 起默认同时把摘要放进首轮提示。
>
> 实现细节以 `src/` 与 README 为准。

## 背景共识（三轮讨论的结论）

1. **官方锁定是对的**。preset = 系统提示词 + 工具集 + 插件的整套组装；会话历史里的工具调用只在原工具集下合法。中途换组装会留下新组合无法执行的"幽灵调用"，且系统提示词前后不一致。官方在网关层硬锁（`agent-preset-locked`），标注为**产品规则而非机制约束**——硬锁比静默劣化诚实。模型/思考强度可会话内切（换脑子不影响历史合法性），模式不可切（换手脚破坏历史）。
2. **插件的正确形态是"搬家"而非"绕锁"**。三条路径里只有摘要迁移成立：读历史 → 生成结构化交接摘要 → 新 preset 建新会话 → 摘要注入。工具存根层（违反挂载模型）和历史重写（append-only 日志）都不可行。
3. **上下文稳定性 = 迁状态不迁痕迹**。固定 schema 摘要 + 文件路径引用（自愈细节）+ goal 挂载（持久投影）+ 人在回路预览 + 原会话冻结可回退。无损原理上不存在，"有损 + 可预览 + 可验证 + 可回退" = 实用稳定。

## Token 成本设计

- **生成侧**：复用最近 compaction 摘要当底稿（官方已付过费），叠加用户消息全文（意图锚点）与最近 3 轮细节；专用指令去掉本模式特有细节、保留决策理由；输入预算 ~30K tokens；紧跟会话结束发起以命中 provider 侧热缓存。
- **压缩工人**：临时 minimal preset 会话 + 便宜模型生成摘要，用户会话的模型/模式一概不动；工人用完归档。
- **注入侧**：摘要硬预算 ≤1K tokens（固定 schema：目标 ≤2 句 / 状态 ≤5 句 / 决策 ≤5 条 / 文件 ≤10 路径 / 下一步 ≤2 句）；验证手段现成——StatsLine 直接显示新会话首轮 Token 出入与缓存命中率。
- **零静默**：确认弹窗 = 摘要全文（可编辑）+ 目标模式 + 压缩模型档位（flash 省 / 跟随当前 / pro 准）+ 成本预估；不在后台迁移，不替用户切当前会话任何东西。

## 回退设计

- **对话层**：迁移 = 新建会话，原会话是不可变只读事实。回退 = 点回原会话；新会话不满意就归档。branch 而非 rollback。
- **文件层**：迁移时记录 git HEAD SHA 与工作区脏/净状态进摘要；不替用户执行任何 git 写操作，用户自行 diff/reset；新会话可先用只读权限跑首轮"报到"，确认后再放开。

---

## Part A · GUI 参考实现（已完成，见姊妹项目桌面客户端）

**入口**：ModeSelector 锁定态静态徽章旁加「迁移」按钮（仅非空白会话显示）。

**BridgeModal 确认弹窗**：
- 目标模式下拉（presets 排除当前与 broken）
- 压缩模型档位：flash（省，默认）/ 跟随当前会话 / pro（准）
- 摘要区：先「生成摘要预览」→ 生成后可编辑 → 「确认迁移」
- 成本预估行：基于 tokenUsage 显示「本次摘要预计输入 ≤ N tokens」
- 明示：原会话不动；迁移后自动切到新会话

**执行管线**（全部走 apiproxy 现有 RPC，不动 harness）：
1. `session.history` 分页拉取（最近 3 页 + 最新 compaction 块）
2. 压缩工人：`session.create`(minimal) → `session.selectModel`(档位) → `session.prompt`(压缩指令+取材) → 轮询至完成 → 读末条 assistant 文本 → `workspace.archiveSession`(工人)
3. `session.create`(目标 preset) → `goal.create`(摘要) → `session.prompt`(交接指令)
4. 激活新会话

**组件**：`src/components/Conversation/BridgeModal.tsx`；useHarness 加 `bridgeEstimate` / `bridgeSummarize` / `bridgeExecute`；i18n 双语；样式入客户端样式表。

**验收**：WebKit 实测——锁定会话出现迁移入口；弹窗生成摘要可编辑；确认后新会话带 goal 与首轮"报到"；原会话仍在；typecheck/check/responsive 全绿。

## Part B · dsh-plugin 工程（本仓库）

**名字**：`dsh-plugin-bridge`。

**形态**：把 Part A 验证过的摘要 prompt、固定 schema、剪枝管线抽成独立插件，官方 WebUI 用户经 `dsh plugin --profile web add github:<owner>/dsh-plugin-bridge#main` 安装。插件消费同一 RPC 面（history/create/prompt/goal/selectModel/archive），与 GUI 版共用语义、不返工。

**候选能力**：
- slash 命令 `/bridge <preset>`（官方 slash 语义：palette 列表在客户端，执行即把 `/bridge xxx` 当普通 prompt 发出）
- composer dock 入口按钮（挂官方 `conversation.composer.dock` slot）
- 摘要模板可配（settings 命名空间 `bridge`：`maxTokens`、`model` 档位、`schema` 字段开关）

**调研清单（开源前）**：官方插件的打包/加载/删除机制（`dsh plugin add/remove` 到底写什么、cordis.patch.yml 的角色、加载时机与重启要求）、插件如何注册 slash 命令与 UI slot、签名/信任模型。
