/**
 * dsh-plugin-bridge：跨 preset 会话迁移（交接摘要压缩核心 + 使用技能）。
 *
 * v0.1 形态：注册 bridge 技能（向 agent 说明迁移流程与固定摘要 schema），
 * 并通过 config 暴露压缩预算与压缩模型档位；压缩纯函数见 compression.ts
 * （WebUI / 桌面 GUI 等客户端复用同一语义，RPC 编排在客户端侧）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-skill'

export const name = 'dsh-plugin-bridge'
export const inject = ['skills']

export interface Config {
  /** 压缩工人模型档位：flash 省 / current 跟随 / pro 准（实验结论：pro 几乎不加价且探针可用性 +15pp）。 */
  modelTier?: 'flash' | 'current' | 'pro'
  /** 压缩取材总字符预算（≈30K tokens）。 */
  sourceCharBudget?: number
  /** 交接摘要正文字符预算（≈1K tokens）。 */
  summaryCharBudget?: number
}

export const Config: Schema<Config> = Schema.object({
  modelTier: Schema.union(['flash', 'current', 'pro']).default('pro'),
  sourceCharBudget: Schema.number().default(60_000),
  summaryCharBudget: Schema.number().default(2_400),
})

export function apply(ctx: Context, _config: Config): void {
  const packageRoot = dirname(fileURLToPath(import.meta.url))
  const skillPath = join(packageRoot, '..', 'skills', 'bridge', 'SKILL.md')
  const source = readFileSync(skillPath, 'utf8')
  ctx.skills.register({
    name: 'bridge',
    description:
      'Migrate a session across tool presets by handing off a fixed-schema summary: compress history, open a new session under the target preset, inject the summary as the goal, keep the original session untouched.',
    source: name,
    resourceBase: { kind: 'directory', path: dirname(skillPath) },
    path: skillPath,
    content: source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ''),
  })
}

export default { name, inject, Config, apply }
