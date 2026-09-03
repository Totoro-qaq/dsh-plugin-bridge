# Bridge 使用指南：安装与使用

> 适用对象：使用官方 `dsh web`（WebUI）的用户。装上、重启、在输入框里打 `/bridge`——没有别的步骤。

## 1. 安装

前置：已安装 dsh（`dsh --version` 能输出版本，本插件已核对 0.1.0-rc.6 / rc.7 / rc.8，在 0.1.1-rc.2 完成真实视觉迁移，并用官方 npm `0.1.2-alpha.2` 完成 typed-controller 安装、编辑、迁移与卸载验收），并有一个可跑的 web profile（跑过一次 `dsh web` 即会自动初始化）。

```bash
dsh plugin --profile web add dsh-plugin-bridge
```

需要固定 GitHub tag 或 npm 暂时不可用时：

```bash
dsh plugin --profile web add github:Totoro-qaq/dsh-plugin-bridge#v0.3.2
```

发生了什么（不用手动干预）：

1. dsh 在 profile 目录（`~/.dsh/profiles/web/`）执行 `pnpm add`，拉取本包（`lib/` 已预构建，不触发 pnpm ≥10 的构建脚本白名单）；
2. dsh 检测到本包 package.json 里的 `dsh.bundle.patch` 声明，自动把 `dsh-plugin-bridge` 追加进 `dsh.profile.bundles` 层栈；
3. **重启 `dsh web`**（插件在启动时挂载）。验证：重启后在任意会话里打 `/bridge`，应当列出可迁入的模式。

卸载：

```bash
dsh plugin --profile web remove dsh-plugin-bridge   # 重启后生效
```

命令是通过 cordis 的 effect 作用域注册的，插件卸载时随 fiber 一起消失——不会有残留的 `/bridge`。

## 2. 什么时候用它

你在「创造」模式聊到一半，发现接下来要写代码（或反过来）——模式切换入口是锁的。**锁是对的**（原因见 README「为什么有这个项目」），Bridge 是那个出口：把当前进展压缩成交接摘要，在目标模式下开新会话继续，原会话原地保留。

不适合的场景：会话刚开始（没什么可带的，直接开新会话更省事）；你只需要换模型或思考强度（那本来就能会话内切，不用迁移）。

## 3. 怎么用

三条命令，在任意会话的输入框里直接打：

```
/bridge                    这个会话能迁到哪些模式？
/bridge code               生成交接摘要给你过目——什么都不改
/bridge code --go          建新会话、复述交接，然后等我确认
/bridge code --go --continue  同一轮复述并继续下一步
```

`/bridge` 是一条普通的 dsh slash 命令（和 `/compact`、`/goal`、`/plan` 同一套机制）。host 把它路由给命令注册表，**全程不经过模型**，输出由 UI 渲染、不进对话历史。所以：

- 不需要用你的话去说服模型做什么，也不需要 bash 或环境变量；
- `minimal` 这种没有 skill 工具的模式照样能发起迁移；
- 原会话是真的没被动过——命令结果根本不是一条消息。

### 3.1 预览（唯一需要你动脑子的一步）

`/bridge code` 会：拉取并折叠会话历史 → 按字符预算取材（用户消息全文 + 最近几轮结论 + 最近一次 compaction 底稿）→ 起一个临时的压缩工人生成**固定五段摘要**（目标 / 当前状态 / 关键决策与约定 / 关键文件 / 下一步）→ 工人用完即归档 → 把摘要贴给你。

卡片会立即显示经过秒数；模型耗时取决于取材与路由。本次 `0.1.1-rc.2` 三次固定输入的 worker 用时为 7.4–12.8 秒，超出 `previewTimeoutMs` 仍会被取消。**认真扫一眼**：

- 目标对不对；
- 关键约定在不在——尤其是**数字**，漂移里最主要的一类就是端口被补全成 3000/8080；
- 文件路径是不是都来自本会话；
- 如果输出里有 `⚠ 取材因预算被裁剪`，说明摘要是基于被裁过的历史写的，要更仔细。

### 3.2 要改摘要

rc.7+ 的官方 WebUI 提供三种模式：

- 「预览」：渲染 Markdown；完整 JSON 文档显示为可展开的树；
- 「文本编辑」：把目标、当前状态、关键决策、关键文件、下一步拆成普通字段，列表逐项增删，不需要输入 Markdown 符号；
- 「Markdown」：保留完整源码和附录修改能力，适合开发者或自定义结构。

长内容只在卡片正文内滚动，顶部模式切换、复制和确认按钮不会随内容滚走。非标准五段、JSON 或自定义标题不会被猜测性转换：文本模式会提示改用 Markdown，原稿保持不变。切回「预览」核对，再点「确认迁移」，校对稿会逐字成为目标的唯一事实源并自动打开目标会话。

兼容官方 `conversation.chat.commandview` slot 的第三方 UI 会自动加载这张卡片。完全自研 UI 可以导入 `dsh-plugin-bridge/client-contract` 复用纯解析与编辑 contract；没有实现 slot 时仍走下面的服务端/文件回退，不影响迁移。

旧客户端或 CLI 仍可走文件回退：预览会把摘要写进一个文件并打印路径。改那个文件，然后：

```
/bridge code --go --file /tmp/dsh-bridge-xxxx/summary-....md
```

**文件是唯一事实源**——比让模型「记住你刚才说要改哪里」可靠得多。

### 3.3 执行

`/bridge code --go` 会用目标 preset 建新会话、把摘要挂为会话目标（goal）**并立即暂停该目标**、同时把摘要放进首轮提示。新会话只会先**复述它对当前状态的理解**，然后等你确认——复述里丢没丢东西，一眼可见。确认没问题后在目标会话继续说话即可。

只有明确想让它立刻开工时，才用 `/bridge code --go --continue`。它会在**同一次目标模型请求**里先复述再开始下一步；goal 仍然保持暂停，所以 round driver 不会在空闲后追加第二轮。

### 3.4 不满意怎么办（回退）

- 新会话接得不对：直接点回**原会话**继续，它一个字都没动过；新会话归档即可；
- 摘要生成得不好：在预览那一步就改文件，不必迁过去再后悔；
- 习惯性建议：迁移前如果工作区有未提交改动，自己先 `git commit` 或记下状态——Bridge 不动你的工作区，但新会话接下来的动作是在同一工作区里进行的。

## 4. 命令行（备用路径）

同一套引擎也发布成 `dsh-bridge` 命令行，用于命令面覆盖不到的场景：在终端里驱动、批量脚本、或者评测。它走回环 HTTP，读 `DSH_SESSION_ID` / `DSH_WEB_URL`。

```bash
dsh-bridge doctor                                    # 自检：网关 / 会话身份 / 可用模式
dsh-bridge preview --to code --session <会话 id>
dsh-bridge migrate --to code --summary-file <path>
```

日常用 `/bridge` 就够了，这条路主要是给排查问题和自动化留的。

## 5. 配置

配置写在 profile 的 `cordis.patch.yml`，或用它读取的环境变量临时覆盖。**每个键都真的被消费**（0.1 里它们一个都没有消费者，这是 0.2 修掉的问题之一）。

| 配置 | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `modelTier` | `DSH_BRIDGE_TIER` | `pro` | 压缩工人档位。实验结论：pro 与 flash 几乎同价（~2K tokens），但 flash 在 8 次里出现过 1 次全灭，离散度大一个数量级；**不要用 flash 迁 minimal**（三次两次全灭） |
| `sourceCharBudget` | `DSH_BRIDGE_SOURCE_BUDGET` | `60000` | 取材总字符预算（≈30K tokens 输入） |
| `summaryCharBudget` | `DSH_BRIDGE_SUMMARY_BUDGET` | `2400` | 摘要正文字符预算（≈900 tokens，注入侧成本上限） |
| `goalRounds` | `DSH_BRIDGE_GOAL_ROUNDS` | `1` | 新会话的自主 goal 轮次上限，见下 |
| `inject` | `DSH_BRIDGE_INJECT` | `both` | 摘要注入方式，见下 |
| `lang` | `DSH_BRIDGE_LANG` | `auto` | 摘要语言，auto 跟着会话内容走 |
| `previewTimeoutMs` | `DSH_BRIDGE_PREVIEW_TIMEOUT` | `180000` | `/bridge <preset>` 等压缩工人的上限 |
| `workerProvider` / `workerModel` | `DSH_BRIDGE_PROVIDER` / `_MODEL` | — | 直接指定压缩模型（换了 provider 的部署用） |

### 关于 `goalRounds`：为什么默认是 1

上游 `goal.create` 的部署默认 `maxGoalRounds` 是 **256**，而 `dsh-goal-round-driver` 会在 agent 空闲、目标处于 active 且还有额度时，自动把目标渲染成 `<goal_round>` 提示排一轮进去——一轮跑完还有额度就继续。也就是说：把交接摘要挂成 goal 而不限这个数，等于给新会话开了一个最多 256 轮的自主循环。

普通交接只需要一轮理解校验，所以 Bridge 在创建 goal 后立刻 pause，再发送首轮提示。`--continue` 只让这条提示在复述后同轮继续，并不会解锁 goal。想让它之后自主跑多轮，需要先调大 `goalRounds`，再在新会话里手动 resume 目标。

### 关于 `inject`：为什么默认 `both`

上游 `dsh-goal` 的文档写得很直接：**「Goal mutations do not inject model context」**——挂目标这个动作本身不会把目标放进模型上下文。摘要能被看见，靠的是轮次驱动器把它渲染成提示，或者模型自己调 `get_goal`。Bridge 又会先 pause goal，所以凡是要发 kickoff，就一定把摘要全文放进首轮提示；高级配置即使写 `--inject goal` 也不会让首轮在看不见摘要的情况下运行。

默认 `both` 同时保留 goal（持久、可手动 resume）与 prompt（任何 preset 都能看见）。暂停的 goal 不触发模型请求，因此不会重复烧摘要 token；只有日后手动 resume 时，它才会进入 goal round。部署里没挂 goal 服务时会自动降级成 prompt 并给一条警告，而不是失败。

## 6. 常见问题

**Q：`/bridge` 打了没反应 / 提示未知命令？**
A：确认重启过 `dsh web`（插件在启动时挂载），并且用的是 `web` profile。命令注册依赖 `commands` 服务；执行时优先用 rc.2 的 `apiProxy`，alpha 则使用 typed Session / Workspace / Preset / Goal controllers。必要能力不完整时 `/bridge --doctor` 会逐项报告，不会假装可用。

**Q：升级了 dsh 之后还能用吗？**
A：先打一次 `/bridge --doctor`，它会告诉你这套 host 暴露了十三项能力里的哪几项、当前模式是什么、生效配置是什么。全绿就是好的。缺能力它会点名，把那行连同你的 dsh 版本发到 issues 就行。rc.6 / rc.7 / rc.8 已逐条核对；0.1.1-rc.2 的原图迁移已实测；官方 npm `0.1.2-alpha.2` 的 typed-controller 13/13、三态编辑、PTC 自动跳转、暂停目标与干净卸载也已实测。

**Q：图片迁移需要怎么选模型？**
A：图片已有助手分析时，Bridge 逐字搬这段视觉证据，不需要再次烧视觉 token。图片还没被分析时，源会话应选 `deepseek-v4-flash-vision-exp` 等视觉路由；Bridge 会在 kickoff 前把源 provider/model/reasoning effort 复制到目标，再搬原图。文本模型仍不能识图，Bridge 也不会暗中启动本地视觉模型。

**Q：迁移后新会话「记得」多少？**
A：当前 release gate 的 6 份摘要、12 个目标会话达到摘要 30/30、复述 60/60、首次有效工作 60/60，预定义旧值复活为 0。这是修复驱动的小样本回归门禁，不是总体准确率保证。更早 26 组档位实验里，pro 探针可用性为 95%；两组证据都提示数字与端口需要在预览里重点检查。

**Q：为什么不在原会话直接切模式？**
A：官方在网关层硬锁，且锁得对：历史里的工具调用只在原工具集下合法，换了组合会留下「幽灵调用」，不报错但质量静默劣化。Bridge 选择搬家而不是绕锁。

**Q：这和「开个新会话把标题复制过去」有什么区别？**
A：那是裸重开。A/B 实测（4 条成对 run）：迁进**无工具**的 preset，裸重开探针只剩 1/5（真失忆）；迁进**有工具**的 preset，裸重开看似能答，实际是 agent 首轮发起 25+ 次工具调用、烧掉百万级 tokens 从 host 日志里翻回来的，且执行照样漂。摘要的价值是**在任何 preset 下用一份固定的、可预算的代价记得**。数据与这组对照的已知弱点见 README「A/B 验证」与 benchmark §10。

**Q：迁移花多少钱？**
A：压缩工人实测约 1.6K 输入 + 0.7K 输出；目标请求还会带 ≤900 tokens 的摘要，以及该 preset 本来就有的系统提示。默认模式额外花一个只复述的确认轮；`--continue` 把复述和工作合并在同一目标轮。token 大头通常仍是后续 agentic 工作，不是压缩。

**Q：会不会往我每次请求的提示词里塞东西？**
A：不会。这个插件不注册技能、也不注册工具，对模型的提示词零贡献；不迁移就是零开销。
