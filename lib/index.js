/**
 * dsh-plugin-bridge：跨 preset 会话迁移（交接摘要压缩核心 + 使用技能）。
 *
 * v0.1 形态：注册 bridge 技能（向 agent 说明迁移流程与固定摘要 schema），
 * 并通过 config 暴露压缩预算与压缩模型档位；压缩纯函数见 compression.ts
 * （WebUI / 桌面 GUI 等客户端复用同一语义，RPC 编排在客户端侧）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Schema from '@deepseek-ai/schemastery';
export const name = 'dsh-plugin-bridge';
export const inject = ['skills'];
export const Config = Schema.object({
    modelTier: Schema.union(['flash', 'current', 'pro']).default('pro'),
    sourceCharBudget: Schema.number().default(60_000),
    summaryCharBudget: Schema.number().default(2_400),
});
export function apply(ctx, _config) {
    const packageRoot = dirname(fileURLToPath(import.meta.url));
    const skillPath = join(packageRoot, '..', 'skills', 'bridge', 'SKILL.md');
    const source = readFileSync(skillPath, 'utf8');
    ctx.skills.register({
        name: 'bridge',
        description: 'Migrate a session across tool presets by handing off a fixed-schema summary: compress history, open a new session under the target preset, inject the summary as the goal, keep the original session untouched.',
        source: name,
        resourceBase: { kind: 'directory', path: dirname(skillPath) },
        path: skillPath,
        content: source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ''),
    });
}
export default { name, inject, Config, apply };
