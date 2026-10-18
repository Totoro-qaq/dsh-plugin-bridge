/**
 * dsh-plugin-bridge：跨 preset 会话迁移。
 *
 * 形态是一个**普通的 dsh 插件**——`dsh plugin add` 装上、重启，输入框里就有
 * `/bridge`；`dsh plugin remove` 卸掉，命令随 fiber 一起消失。不注册技能，
 * 命令不依赖模型；可选的 bridge_prepare 工具只生成预览，不授予迁移批准。
 *
 * 命令入口对齐上游 `dsh-plan-mode`（`/plan` 命令 + 工具）：命令由 UI 直接派发，
 * 不经过模型，结果也不进模型历史。执行引擎是进程内的 `ctx.apiProxy`
 * （web bundle 的 `api-gateway` 行提供），所以整条链路不出进程。
 */
import { readFileSync } from 'node:fs'

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

import { createBridgeCommand } from './command.ts'
import { SOURCE_CHAR_BUDGET, SUMMARY_CHAR_BUDGET } from './compression.ts'
import { probeDshHost, resolveDshHost } from './dsh-alpha-host.ts'
import { createPlanApprovalBridge, type PlanReviewRequest } from './approved-plan.ts'
import { removeOwnedSummaryFile, writeSummaryFile } from './summary-file.ts'
import { createBridgeNaturalLanguage } from './natural-language.ts'
export { createPlanApprovalBridge } from './approved-plan.ts'
export { createBridgeNaturalLanguage } from './natural-language.ts'

export const name = 'dsh-plugin-bridge'

/**
 * `commands` 是跨版本入口，唯一硬依赖。执行时优先使用 rc.2 的 `apiProxy`，
 * alpha 则改走 typed controllers；doctor 探测实际选中的那一面并 fail closed。
 */
export const inject = ['commands']

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
  /** Offer a preview-only model tool when the Host has an optional tools service. */
  naturalLanguage?: boolean
}

export const Config: Schema<Config> = Schema.object({
  modelTier: Schema.union(['flash', 'current', 'pro']).default('current'),
  sourceCharBudget: Schema.number().default(SOURCE_CHAR_BUDGET),
  summaryCharBudget: Schema.number().default(SUMMARY_CHAR_BUDGET),
  goalRounds: Schema.number().default(1),
  inject: Schema.union(['goal', 'prompt', 'both']).default('both'),
  lang: Schema.union(['zh', 'en', 'auto']).default('auto'),
  workerProvider: Schema.string(),
  workerModel: Schema.string(),
  previewTimeoutMs: Schema.number().default(DEFAULT_PREVIEW_TIMEOUT_MS),
  naturalLanguage: Schema.boolean().default(true),
})

/** 把 Config 解析成命令层要的形状（Schema 已经填过默认值，这里只兜底）。 */
export function commandConfigOf(config: Config = {}) {
  return {
    modelTier: config.modelTier ?? 'current',
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
  const workerSessionIds = new Set<string>()
  const plans = createPlanApprovalBridge({
    hostFor: signal => resolveDshHost(ctx as unknown as Parameters<typeof resolveDshHost>[0],signal),
    config: commandConfigOf(config),
  })
  // The public scoped waterfall carries the exact native document. Observation delegates
  // ordinary answers unchanged; only an explicit Bridge command takes ownership.
  const events = ctx as unknown as {on(name:string,callback:(request:PlanReviewRequest,next:()=>Promise<unknown>)=>Promise<unknown>,options:{global:boolean;prepend:boolean}):unknown}
  events.on('user-questions/request',(request,next)=>plans.observe(request,next),{global:true,prepend:true})
  ctx.effect(()=>()=>plans.dispose(),'bridge: plan approval records')
  const command = createBridgeCommand({
    workerSessionIds,
    planApprovals: plans,
    hostFor: (signal) => resolveDshHost(ctx as unknown as Parameters<typeof resolveDshHost>[0], signal),
    probe: () => probeDshHost(ctx as unknown as Parameters<typeof probeDshHost>[0]),
    config: commandConfigOf(config),
    writeSummary: writeSummaryFile,
    readSummary: (path) => readFileSync(path, 'utf8'),
    removeSummary: removeOwnedSummaryFile,
    // 宿主命令协议只在结束时返回结果。没有原生卡片时，阶段进度写进宿主日志，
    // 长等待里命令还会每 15 秒补一条带耗时的进度。
    onProgress: (message) => {
      try { ctx.logger.info('%s', message) } catch { /* 进度日志不能让迁移失败 */ }
    },
  })
  // 注册返回的是 cordis 的 effect disposer：插件卸载时命令自动消失。
  ;(ctx as unknown as { commands: { register: (definition: unknown) => () => void } }).commands.register(command)
  if (config.naturalLanguage !== false) {
    const natural = createBridgeNaturalLanguage({ handler: command.handler, workerSessionIds })
    ctx.effect(() => () => natural.dispose(), 'bridge: natural-language preparation lifetime')
    // A missing optional tool registry must not hold the command or client half hostage.
    ctx.inject(['tools'], toolCtx => {
      const tools = (toolCtx as unknown as { tools: { register(definition: unknown): unknown } }).tools
      tools.register(natural.tool)
    })
  }
}

export default { name, inject, Config, apply }
