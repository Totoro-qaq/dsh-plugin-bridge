# dsh-plugin-bridge

跨 preset 会话迁移插件（DeepSeek Harness / Cordis bundle）：用**固定 schema 的交接摘要**把会话从一种工具模式「搬家」到另一种，而不是绕开官方的模式锁。

## 为什么不是会话内切模式

preset = 系统提示词 + 工具集 + 插件的整套组装。会话历史里的工具调用只在原工具集下合法，中途换组装会留下新组合无法执行的「幽灵调用」。官方因此在网关层硬锁（`agent-preset-locked`）——硬锁比静默劣化诚实。Bridge 选择搬家：压缩历史 → 新 preset 建新会话 → 摘要注入为 goal。原会话全程不动，回退 = 点回原会话。

## 安装

```bash
dsh plugin --profile web add github:<owner>/dsh-plugin-bridge#main
# 重启 dsh web 生效
```

`dsh plugin add` 本质是 `pnpm add`：git 依赖靠本包的 `prepare` 脚本现场构建 `lib/`。**pnpm ≥10 默认拦截依赖的构建脚本**，首次安装若失败，按 dsh 的提示把输出的 key 加进 profile 目录 `pnpm-workspace.yaml` 的 `allowBuilds` 后重跑即可。安装后 dsh 依 package.json 的 `dsh.bundle.patch` 声明把本插件挂进层栈（本包已声明）。

## 组成

- `src/compression.ts` — 压缩核心（纯函数）：`buildBridgeSource` 取材（compaction 底稿 + 用户消息全文 + 最近轮结论，字符硬预算）、`buildBridgeInstruction` 固定五段摘要 schema、`buildBridgeKickoff` 首轮交接指令。**已在 26 组真实实验里验证**（见下）。
- `src/index.ts` — Cordis bundle：注册 `bridge` skill + 配置命名空间（`modelTier` / `sourceCharBudget` / `summaryCharBudget`，可用 `DSH_BRIDGE_*` 环境变量覆盖）。
- `eval/` + `datasets/` — 评测 harness 与测试集/验证集（见下文）。
- `docs/plan.md` — 完整设计文档（Token 成本设计、回退设计）。

## 评测结论（2026-08，26 组 run，全文见 docs/benchmark.md）

- **探针可用性（迁移后事实可回忆）：测试集 87.5%，验证集 83.3%**
- **压缩用 pro 不用 flash**：pro 探针 95% / 摘要保真 100%，成本与 flash 几乎相同（~2K tokens/run）；flash→minimal 组合出现过整轮全灭
- **源 preset 对保真度零影响**（对照组 4/4 全 5/5）——迁移质量只取决于摘要质量与目标注入
- 执行偏移集中在「数字合理化」（端口被补全成常见值），路径基本不漂

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
