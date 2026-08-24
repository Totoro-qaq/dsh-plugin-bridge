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
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Schema from '@deepseek-ai/schemastery';
import { createApiProxyHost, probeApiProxy } from './api-rpc.js';
import { createBridgeCommand } from './command.js';
import { SOURCE_CHAR_BUDGET, SUMMARY_CHAR_BUDGET } from './compression.js';
export const name = 'dsh-plugin-bridge';
/**
 * `commands` 是入口，`apiProxy` 是引擎——两个都是硬依赖：
 * 缺哪个这个插件都无事可做，与其静默半挂，不如让 cordis 挂起等待。
 * 两者在官方 `web` profile 里都在（base 挂 commands，web-app 挂 api-gateway）。
 */
export const inject = ['commands', 'apiProxy'];
/** 命令是同步返回的，等压缩工人不能等太久。 */
const DEFAULT_PREVIEW_TIMEOUT_MS = 180_000;
export const Config = Schema.object({
    modelTier: Schema.union(['flash', 'current', 'pro']).default('pro'),
    sourceCharBudget: Schema.number().default(SOURCE_CHAR_BUDGET),
    summaryCharBudget: Schema.number().default(SUMMARY_CHAR_BUDGET),
    goalRounds: Schema.number().default(1),
    inject: Schema.union(['goal', 'prompt', 'both']).default('both'),
    lang: Schema.union(['zh', 'en', 'auto']).default('auto'),
    workerProvider: Schema.string(),
    workerModel: Schema.string(),
    previewTimeoutMs: Schema.number().default(DEFAULT_PREVIEW_TIMEOUT_MS),
});
/** 摘要落盘，供「改完再执行」那条路用。失败不该让迁移失败，所以吞掉异常。 */
function writeSummaryFile(sessionId, summary) {
    try {
        const dir = mkdtempSync(join(tmpdir(), 'dsh-bridge-'));
        const file = join(dir, `summary-${sessionId.slice(0, 12)}.md`);
        writeFileSync(file, summary, 'utf8');
        return file;
    }
    catch {
        return undefined;
    }
}
/** 把 Config 解析成命令层要的形状（Schema 已经填过默认值，这里只兜底）。 */
export function commandConfigOf(config = {}) {
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
    };
}
export function apply(ctx, config = {}) {
    const apiProxyOf = () => ctx.apiProxy;
    const command = createBridgeCommand({
        hostFor: (signal) => createApiProxyHost(apiProxyOf(), signal),
        probe: () => probeApiProxy(apiProxyOf()),
        config: commandConfigOf(config),
        writeSummary: writeSummaryFile,
        readSummary: (path) => readFileSync(path, 'utf8'),
    });
    ctx.commands.register(command);
}
export default { name, inject, Config, apply };
