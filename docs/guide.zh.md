# Bridge 使用指南：安装与 WebUI 操作

> 适用对象：使用官方 `dsh web`（WebUI）的用户。无需任何定制 GUI——本插件交付的是一个 **agent 技能**，由 agent 编排、你在关键点确认。

## 1. 安装

前置：已安装 dsh（`dsh --version` 能输出版本，本插件在 0.1.0-rc.6 上实测通过），并有一个可跑的 web profile（跑过一次 `dsh web` 即会自动初始化）。

```bash
dsh plugin --profile web add github:Totoro-qaq/dsh-plugin-bridge#main
```

发生了什么（不用手动干预）：

1. dsh 在 profile 目录（`~/.dsh/profiles/web/`）执行 `pnpm add`，拉取本包（`lib/` 已预构建，不触发 pnpm ≥10 的构建脚本白名单）；
2. dsh 检测到本包 package.json 里的 `dsh.bundle.patch` 声明，自动把 `dsh-plugin-bridge` 追加进 `dsh.profile.bundles` 层栈；
3. **重启 `dsh web`**（插件在启动时挂载）。验证：重启后 `dsh --profile web --dump-config | grep -A3 bridge` 能看到 bridge 行。

卸载：

```bash
dsh plugin --profile web remove dsh-plugin-bridge   # 重启后生效
```

## 2. 什么时候用它

你在「创造」模式聊到一半，发现接下来要写代码（或反过来）——模式切换入口是锁的。**锁是对的**（原因见 README「为什么有这个项目」），Bridge 是那个出口：把当前进展压缩成交接摘要，在目标模式下开新会话继续，原会话原地保留。

不适合的场景：会话刚开始（没什么可带的，直接开新会话更省事）；你只需要换模型或思考强度（那本来就能会话内切，不用迁移）。

## 3. WebUI 里怎么用

### 3.1 发起

在当前会话里直接对 agent 说，例如：

> 把这个会话迁移到 code 模式继续

或更明确的：

> 用 bridge 迁移到 code 模式，压缩档位 pro

agent 读到 `bridge` 技能后会按固定流程执行。

### 3.2 agent 会做的事（你只需看两个确认点）

1. **取材**：拉取当前会话历史（`session.history`），折叠出「用户消息全文 + 最近几轮结论 + 最近一次 compaction 底稿」，总量有字符硬预算；
2. **压缩**：另起一个临时 minimal 会话（压缩工人，默认 pro 档位）生成**固定五段摘要**——目标 / 当前状态 / 关键决策与约定 / 关键文件 / 下一步；
3. **确认点 ①：摘要预览**。agent 会把摘要全文贴给你。**认真扫一眼**：目标对不对、关键约定（端口/路径/禁令这类）在不在、文件路径是不是都来自本会话。有错就让 agent 改，或直接说「加上 xx」；
4. **确认点 ②：目标模式**。确认迁入哪个 preset（standard / code / minimal / cordis）；
5. 你确认后，agent 用目标 preset 建新会话、把摘要挂为会话目标（goal）、发首轮交接指令。**原会话全程不被改动**；
6. 新会话首轮会先**复述它对当前状态的理解**——这是自带的验证手段：复述里丢没丢东西，一眼可见。然后它接着执行下一步。

### 3.3 不满意怎么办（回退）

- 新会话接得不对：直接点回**原会话**继续，它一个字都没动过；新会话归档即可；
- 摘要生成得不好：在确认点 ① 就让 agent 重生成或手动补充，不必迁过去再后悔；
- 习惯性建议：迁移前如果工作区有未提交改动，自己先 `git commit` 或记下状态——Bridge 不动你的工作区，但新会话接下来的动作是在同一工作区里进行的。

## 4. 档位与配置

| 配置 | 默认 | 说明 |
|---|---|---|
| `modelTier` | `pro` | 压缩工人档位。实验结论：pro 探针可用性 95%、成本与 flash 几乎相同（~2K tokens）；**不要用 flash 迁 minimal**（三次两次全灭） |
| `sourceCharBudget` | 60000 | 取材总字符预算（≈30K tokens 输入） |
| `summaryCharBudget` | 2400 | 摘要正文字符预算（≈1K tokens，注入侧成本上限） |

临时覆盖（环境变量）：`DSH_BRIDGE_TIER` / `DSH_BRIDGE_SOURCE_BUDGET` / `DSH_BRIDGE_SUMMARY_BUDGET`。

## 5. 常见问题

**Q：迁移后新会话「记得」多少？**
A：26 组实验的探针可用性（事实可回忆率）：pro 档位 95%+。丢的通常是「数字合理化」一类（端口被补全成常见值）——所以确认点 ① 请重点扫数字。

**Q：为什么不在原会话直接切模式？**
A：官方在网关层硬锁，且锁得对：历史里的工具调用只在原工具集下合法，换了组合会留下「幽灵调用」，不报错但质量静默劣化。Bridge 选择搬家而不是绕锁。

**Q：这和「开个新会话把标题复制过去」有什么区别？**
A：那是裸重开。A/B 对照实测（8 条成对 run）：裸重开进无工具的 preset 探针只剩 1/5（真失忆）；进有工具的 preset 看似能答，实际是 agent 首轮发起 25+ 次工具调用、烧掉 2 倍 tokens 从 host 日志里翻回来的，且执行照样漂。摘要臂 95%、半价、全 preset 稳定。数据见 README「A/B 验证」一节。

**Q：压缩花多少钱？**
A：约 2K tokens/次（输入复用最近一次 compaction 底稿）。token 大头永远是 agentic 会话本身，不是压缩。
