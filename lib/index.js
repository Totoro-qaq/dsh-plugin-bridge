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
import { readFileSync } from 'node:fs';
import Schema from '@deepseek-ai/schemastery';
import { createBridgeCommand } from './command.js';
import { SOURCE_CHAR_BUDGET, SUMMARY_CHAR_BUDGET } from './compression.js';
import { probeDshHost, resolveDshHost } from './dsh-alpha-host.js';
import { createPlanApprovalBridge } from './approved-plan.js';
import { removeOwnedSummaryFile, writeSummaryFile } from './summary-file.js';
import { createBridgeNaturalLanguage } from './natural-language.js';
export { createPlanApprovalBridge } from './approved-plan.js';
export { createBridgeNaturalLanguage } from './natural-language.js';
export const name = 'dsh-plugin-bridge';
/**
 * `commands` 是跨版本入口，唯一硬依赖。执行时优先使用 rc.2 的 `apiProxy`，
 * alpha 则改走 typed controllers；doctor 探测实际选中的那一面并 fail closed。
 */
export const inject = ['commands'];
/** 命令是同步返回的，等压缩工人不能等太久。 */
const DEFAULT_PREVIEW_TIMEOUT_MS = 180_000;
export const Config = Schema.object({
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
});
/** 把 Config 解析成命令层要的形状（Schema 已经填过默认值，这里只兜底）。 */
export function commandConfigOf(config = {}) {
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
    };
}
export function apply(ctx, config = {}) {
    const workerSessionIds = new Set();
    const plans = createPlanApprovalBridge({
        hostFor: signal => resolveDshHost(ctx, signal),
        config: commandConfigOf(config),
    });
    // The public scoped waterfall carries the exact native document. Observation delegates
    // ordinary answers unchanged; only an explicit Bridge command takes ownership.
    const events = ctx;
    events.on('user-questions/request', (request, next) => plans.observe(request, next), { global: true, prepend: true });
    ctx.effect(() => () => plans.dispose(), 'bridge: plan approval records');
    const command = createBridgeCommand({
        workerSessionIds,
        planApprovals: plans,
        hostFor: (signal) => resolveDshHost(ctx, signal),
        probe: () => probeDshHost(ctx),
        config: commandConfigOf(config),
        writeSummary: writeSummaryFile,
        readSummary: (path) => readFileSync(path, 'utf8'),
        removeSummary: removeOwnedSummaryFile,
        // 宿主命令协议只在结束时返回结果。没有原生卡片时，阶段进度写进宿主日志，
        // 长等待里命令还会每 15 秒补一条带耗时的进度。
        onProgress: (message) => {
            try {
                ctx.logger.info('%s', message);
            }
            catch { /* 进度日志不能让迁移失败 */ }
        },
    });
    ctx.commands.register(command);
    if (config.naturalLanguage !== false) {
        const natural = createBridgeNaturalLanguage({ handler: command.handler, workerSessionIds });
        ctx.effect(() => () => natural.dispose(), 'bridge: natural-language preparation lifetime');
        // A missing optional tool registry must not hold the command or client half hostage.
        ctx.inject(['tools'], toolCtx => {
            const tools = toolCtx.tools;
            tools.register(natural.tool);
        });
    }
}
export default { name, inject, Config, apply };
