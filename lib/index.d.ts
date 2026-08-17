import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "dsh-plugin-bridge";
export declare const inject: string[];
export interface Config {
    /** 压缩工人模型档位：flash 省 / current 跟随 / pro 准（实验结论：pro 几乎不加价且探针可用性 +15pp）。 */
    modelTier?: 'flash' | 'current' | 'pro';
    /** 压缩取材总字符预算（≈30K tokens）。 */
    sourceCharBudget?: number;
    /** 交接摘要正文字符预算（≈1K tokens）。 */
    summaryCharBudget?: number;
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, _config: Config): void;
declare const _default: {
    name: string;
    inject: string[];
    Config: Schema<Config>;
    apply: typeof apply;
};
export default _default;
