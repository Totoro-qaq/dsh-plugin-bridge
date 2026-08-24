/**
 * dsh-plugin-bridge：跨 preset 会话迁移。
 *
 * 形态是一个**普通的 dsh 插件**——`dsh plugin add` 装上、重启，输入框里就有
 * `/bridge`；`dsh plugin remove` 卸掉，命令随 fiber 一起消失。不注册技能、
 * 不依赖模型主动做什么、不需要 bash 或环境变量。
 *
 * 入口形状对齐上游 `dsh-plan-mode`（`/plan` 命令 + 工具）：命令由 UI 直接派发，
 * 不经过模型，结果也不进模型历史。执行引擎是进程内的 `ctx.apiProxy`
 * （web bundle 的 `api-gateway` 行提供），所以整条链路不出进程。
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

import { createApiProxyHost, probeApiProxy, type ApiProxyLike } from './api-rpc.ts'
import { createBridgeCommand } from './command.ts'
import { SOURCE_CHAR_BUDGET, SUMMARY_CHAR_BUDGET } from './compression.ts'

export const name = 'dsh-plugin-bridge'

/**
 * `commands` 是入口，`apiProxy` 是引擎——两个都是硬依赖：
 * 缺哪个这个插件都无事可做，与其静默半挂，不如让 cordis 挂起等待。
 * 两者在官方 `web` profile 里都在（base 挂 commands，web-app 挂 api-gateway）。
 */
export const inject = ['commands', 'apiProxy']

/** 命令是同步返回的，等压缩工人不能等太久。 */
const DEFAULT_PREVIEW_TIMEOUT_MS = 180_000

export interface Config {
  /** 压缩工人模型档位：flash 省 / current 跟随 / pro 准（实验：pro 几乎不加价，且没有全灭尾部风险）。 */
  modelTier?: 'flash' | 'current' | 'pro'
  /** 压缩取材总字符预算（≈30K tokens）。 */
  sourceCharBudget?: number
  /** 交接摘要正文字符预算（≈900 tokens）。 */
  summaryCharBudget?: number
  /**
   * 迁移后目标会话的 goal 自主轮次上限。
   *
   * 上游 `goal.create` 的部署默认是 256，且 `dsh-goal-round-driver` 会在 agent
   * 空闲时把目标渲染成 `<goal_round>` 提示反复跑——不显式设值，一次迁移等于给新
   * 会话开了最多 256 轮自主循环。交接只需要一轮，之后交回用户。
   */
  goalRounds?: number
  /** 摘要注入方式：prompt 不挂目标；goal / both 会挂目标。只要发 kickoff，摘要始终随 prompt 注入以防失忆。 */
  inject?: 'goal' | 'prompt' | 'both'
  /** 摘要语言，auto 表示跟着会话内容走。 */
  lang?: 'zh' | 'en' | 'auto'
  /** 直接指定压缩模型，跳过档位推断（换 provider 的部署用）。 */
  workerProvider?: string
  workerModel?: string
  /** `/bridge <preset>` 等压缩工人的上限（毫秒）。 */
  previewTimeoutMs?: number
}

export const Config: Schema<Config> = Schema.object({
  modelTier: Schema.union(['flash', 'current', 'pro']).default('pro'),
  sourceCharBudget: Schema.number().default(SOURCE_CHAR_BUDGET),
  summaryCharBudget: Schema.number().default(SUMMARY_CHAR_BUDGET),
  goalRounds: Schema.number().default(1),
  inject: Schema.union(['goal', 'prompt', 'both']).default('both'),
  lang: Schema.union(['zh', 'en', 'auto']).default('auto'),
  workerProvider: Schema.string(),
  workerModel: Schema.string(),
  previewTimeoutMs: Schema.number().default(DEFAULT_PREVIEW_TIMEOUT_MS),
})

/** 摘要落盘，供「改完再执行」那条路用。失败不该让迁移失败，所以吞掉异常。 */
function writeSummaryFile(sessionId: string, summary: string): string | undefined {
  try {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-bridge-'))
    const file = join(dir, `summary-${sessionId.slice(0, 12)}.md`)
    writeFileSync(file, summary, 'utf8')
    return file
  } catch {
    return undefined
  }
}

/** 把 Config 解析成命令层要的形状（Schema 已经填过默认值，这里只兜底）。 */
export function commandConfigOf(config: Config = {}) {
  return {
    modelTier: config.modelTier ?? 'pro',
    sourceCharBudget: config.sourceCharBudget ?? SOURCE_CHAR_BUDGET,
    summaryCharBudget: config.summaryCharBudget ?? SUMMARY_CHAR_BUDGET,
    goalRounds: config.goalRounds ?? 1,
    inject: config.inject ?? 'both',
    lang: config.lang ?? 'auto',
    previewTimeoutMs: config.previewTimeoutMs ?? DEFAULT_PREVIEW_TIMEOUT_MS,
    ...(config.workerProvider ? { workerProvider: config.workerProvider } : {}),
    ...(config.workerModel ? { workerModel: config.workerModel } : {}),
  } as const
}

export function apply(ctx: Context, config: Config = {}): void {
  const apiProxyOf = (): ApiProxyLike => (ctx as unknown as { apiProxy: ApiProxyLike }).apiProxy
  const command = createBridgeCommand({
    hostFor: (signal) => createApiProxyHost(apiProxyOf(), signal),
    probe: () => probeApiProxy(apiProxyOf()),
    config: commandConfigOf(config),
    writeSummary: writeSummaryFile,
    readSummary: (path) => readFileSync(path, 'utf8'),
  })
  // 注册返回的是 cordis 的 effect disposer：插件卸载时命令自动消失。
  ;(ctx as unknown as { commands: { register: (definition: unknown) => () => void } }).commands.register(command)
}

export default { name, inject, Config, apply }
