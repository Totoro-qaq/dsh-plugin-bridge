/** Pure wire-to-view helpers shared by the native WebUI card and Node tests. */

export const MAX_EDITED_SUMMARY_CHARS = 24_000

export type BridgeOutcome = { kind: 'success' | 'error'; text?: string } | null

export type BridgeCard =
  | { phase: 'running' }
  | {
      phase: 'preview'
      lang: 'zh' | 'en'
      sourcePreset: string
      targetPreset: string
      summary: string
      stats: string
      warnings: string[]
    }
  | {
      phase: 'migrated'
      lang: 'zh' | 'en'
      targetPreset: string
      title: string
      sessionId: string
      details: string[]
      warnings: string[]
    }
  | { phase: 'error'; text: string }
  | { phase: 'message'; text: string; lang: 'zh' | 'en' }

const PREVIEW_HEADER = /^───\s*(Handoff|交接摘要)\s*·\s*(.*?)\s*→\s*([^\s（(]+).*───\s*$/u
const DIVIDER = /^─{10,}\s*$/u
const RUN_COMMAND = /\/bridge\s+([^\s]+)\s+--go(?:\s|$)/u

function languageOf(text: string): 'zh' | 'en' {
  return /[\u3400-\u9fff]/u.test(text) ? 'zh' : 'en'
}

function parsePreview(text: string): BridgeCard | undefined {
  const lines = text.split('\n')
  const header = PREVIEW_HEADER.exec(lines[0] ?? '')
  if (!header) return undefined
  const divider = lines.findIndex((line, index) => index > 0 && DIVIDER.test(line))
  if (divider < 2) return undefined
  const command = RUN_COMMAND.exec(text)
  const targetPreset = command?.[1] ?? header[3]
  if (!targetPreset) return undefined

  const tail = lines.slice(divider + 1)
  const stats = tail.find((line) => line.trim() !== '' && !line.startsWith('⚠') && !RUN_COMMAND.test(line)) ?? ''
  const warnings = tail
    .filter((line) => line.startsWith('⚠'))
    .map((line) => line.replace(/^⚠\s*/u, ''))
  return {
    phase: 'preview',
    lang: header[1] === 'Handoff' ? 'en' : 'zh',
    sourcePreset: (header[2] ?? '').trim(),
    targetPreset,
    summary: lines.slice(1, divider).join('\n').trim(),
    stats,
    warnings,
  }
}

function parseMigrated(text: string): BridgeCard | undefined {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const first = lines[0] ?? ''
  const lang: 'zh' | 'en' = first.startsWith('Created a new session') ? 'en' : 'zh'
  const preset = lang === 'en'
    ? /^Created a new session in the (.+?) preset\b/u.exec(first)?.[1]
    : /^已在 (.+?) 模式下建好新会话/u.exec(first)?.[1]
  if (!preset) return undefined
  const targetIndex = lines.findIndex((line) => /^(?:Target session:|目标会话：)/u.test(line))
  if (targetIndex < 0) return undefined
  const target = /^(?:Target session:|目标会话：)\s*(.+?)\s*·\s*(\S+)\s*$/u.exec(lines[targetIndex] ?? '')
  if (!target?.[1] || !target[2]) return undefined
  const remaining = lines.filter((_, index) => index !== 0 && index !== targetIndex)
  return {
    phase: 'migrated',
    lang,
    targetPreset: preset,
    title: target[1],
    sessionId: target[2],
    details: remaining.filter((line) => !line.startsWith('⚠')),
    warnings: remaining.filter((line) => line.startsWith('⚠')).map((line) => line.replace(/^⚠\s*/u, '')),
  }
}

/** Convert one durable `/bridge` outcome into the native card's view model. */
export function parseBridgeCard(outcome: BridgeOutcome): BridgeCard {
  if (outcome === null) return { phase: 'running' }
  const text = outcome.text?.trim() ?? ''
  if (outcome.kind === 'error') return { phase: 'error', text }
  return parsePreview(text)
    ?? parseMigrated(text)
    ?? { phase: 'message', text, lang: languageOf(text) }
}

/** Return a value only when the complete editor document is valid JSON. */
export function parseJsonDocument(text: string): object | unknown[] | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

function encodeUtf8Base64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

/** Build the hidden-input-safe command used by the native editor confirmation. */
export function buildBridgeMigrationCommand(targetPreset: string, summary: string, lang: 'zh' | 'en'): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(targetPreset)) throw new Error('Unsupported target preset id')
  const edited = summary.trim()
  if (!edited) throw new Error('The handoff summary is empty')
  if (edited.length > MAX_EDITED_SUMMARY_CHARS) {
    throw new Error(`The handoff summary exceeds ${MAX_EDITED_SUMMARY_CHARS} characters`)
  }
  return `/bridge ${targetPreset} --go --lang ${lang} --summary64 ${encodeUtf8Base64Url(edited)}`
}
