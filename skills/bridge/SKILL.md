---
name: bridge
description: Migrate a session across tool presets (standard / code / minimal / cordis) by handing off a fixed-schema summary instead of rewriting history. Use when the user wants to continue a conversation under a different mode, or asks why mid-session preset switching is locked.
---

# Bridge · 跨模式会话迁移

preset 是系统提示词 + 工具集 + 插件的整套组装；会话历史里的工具调用只在原工具集下合法，所以官方在网关层硬锁会话内切换（`agent-preset-locked`）。正确的迁移方式是「搬家」而非「绕锁」。

## 原则

- **迁状态不迁痕迹**：不写历史、不改原会话。迁移 = 压缩 → 新会话 → 注入。
- **固定 schema 摘要**：目标 ≤2 句 / 当前状态 ≤5 句 / 关键决策 ≤5 条（附理由）/ 关键文件 ≤10 路径 / 下一步 ≤2 句。路径必须来自取材，不得编造。
- **人在回路**：摘要先预览可编辑，用户确认后才执行；不静默迁移。
- **原会话冻结可回退**：回退 = 回到原会话；branch 而非 rollback。

## 流程（客户端 RPC 编排）

1. `session.history` 拉取并折叠消息，`buildBridgeSource` 取材（用户消息全文 + 最近数轮结论 + 最近 compaction 底稿，字符硬预算）。
2. 压缩工人：`session.create`(minimal) → `session.selectModel`(档位) → `session.prompt`(压缩指令 + 取材) → 取末条 assistant 文本 → 归档工人。
3. 目标会话：`session.create`(目标 preset) → `goal.create`(摘要) → `session.prompt`(交接指令)。
4. 激活新会话；原会话保持不动。

## 档位建议

实验（26 组，见 docs/benchmark.md）：pro 压缩探针可用性 95%、摘要保真 100%，成本与 flash 几乎相同（~2K tokens）；flash→minimal 组合出现过全灭。**默认 pro**，flash 只在用户明确省钱时用，且避免迁入 minimal。
