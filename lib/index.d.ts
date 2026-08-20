import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "dsh-plugin-bridge";
/**
 * `commands` 是入口，`apiProxy` 是引擎——两个都是硬依赖：
 * 缺哪个这个插件都无事可做，与其静默半挂，不如让 cordis 挂起等待。
 * 两者在官方 `web` profile 里都在（base 挂 commands，web-app 挂 api-gateway）。
 */
export declare const inject: string[];
export interface Config {
    /** 压缩工人模型档位：flash 省 / current 跟随 / pro 准（实验：pro 几乎不加价，且没有全灭尾部风险）。 */
    modelTier?: 'flash' | 'current' | 'pro';
    /** 压缩取材总字符预算（≈30K tokens）。 */
    sourceCharBudget?: number;
    /** 交接摘要正文字符预算（≈900 tokens）。 */
    summaryCharBudget?: number;
    /**
     * 迁移后目标会话的 goal 自主轮次上限。
     *
     * 上游 `goal.create` 的部署默认是 256，且 `dsh-goal-round-driver` 会在 agent
     * 空闲时把目标渲染成 `<goal_round>` 提示反复跑——不显式设值，一次迁移等于给新
     * 会话开了最多 256 轮自主循环。交接只需要一轮，之后交回用户。
     */
    goalRounds?: number;
    /** 摘要注入方式：goal 只挂目标 / prompt 只走首轮提示 / both 两者都做（默认，任何组装下都成立）。 */
    inject?: 'goal' | 'prompt' | 'both';
    /** 摘要语言，auto 表示跟着会话内容走。 */
    lang?: 'zh' | 'en' | 'auto';
    /** 直接指定压缩模型，跳过档位推断（换 provider 的部署用）。 */
    workerProvider?: string;
    workerModel?: string;
    /** `/bridge <preset>` 等压缩工人的上限（毫秒）。 */
    previewTimeoutMs?: number;
}
export declare const Config: Schema<Config>;
/** 把 Config 解析成命令层要的形状（Schema 已经填过默认值，这里只兜底）。 */
export declare function commandConfigOf(config?: Config): {
    readonly workerModel?: string | undefined;
    readonly workerProvider?: string | undefined;
    readonly modelTier: "flash" | "current" | "pro";
    readonly sourceCharBudget: number;
    readonly summaryCharBudget: number;
    readonly goalRounds: number;
    readonly inject: "prompt" | "goal" | "both";
    readonly lang: "zh" | "en" | "auto";
    readonly previewTimeoutMs: number;
};
export declare function apply(ctx: Context, config?: Config): void;
declare const _default: {
    name: string;
    inject: string[];
    Config: Schema<Config>;
    apply: typeof apply;
};
export default _default;
