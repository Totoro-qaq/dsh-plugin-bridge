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

const RUN_COMMAND = /\/bridge\s+([^\s]+)\s+--go(?:\s|$)/u

interface PreviewHeader {
  lang: 'zh' | 'en'
  sourcePreset: string
  targetPreset: string
}

function previewHeaderOf(line: string): PreviewHeader | undefined {
  const prefix = line.startsWith('─── Handoff · ')
    ? { text: '─── Handoff · ', lang: 'en' as const }
    : line.startsWith('─── 交接摘要 · ')
      ? { text: '─── 交接摘要 · ', lang: 'zh' as const }
      : undefined
  if (!prefix) return undefined
  const route = line.slice(prefix.text.length)
  const arrow = route.indexOf('→')
  if (arrow < 1) return undefined
  const sourcePreset = route.slice(0, arrow).trim()
  const targetTail = route.slice(arrow + 1).trimStart()
  let targetEnd = 0
  while (targetEnd < targetTail.length) {
    const char = targetTail[targetEnd]
    if (char === undefined || /\s/u.test(char) || char === '(' || char === '（' || char === '─') break
    targetEnd += 1
  }
  const targetPreset = targetTail.slice(0, targetEnd)
  if (!sourcePreset || !targetPreset) return undefined
  return { lang: prefix.lang, sourcePreset, targetPreset }
}

function isDivider(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.length >= 10 && [...trimmed].every((char) => char === '─')
}

function languageOf(text: string): 'zh' | 'en' {
  return /[\u3400-\u9fff]/u.test(text) ? 'zh' : 'en'
}

function parsePreview(text: string): BridgeCard | undefined {
  const lines = text.split('\n')
  const header = previewHeaderOf(lines[0] ?? '')
  if (!header) return undefined
  const divider = lines.findIndex((line, index) => index > 0 && isDivider(line))
  if (divider < 2) return undefined
  const command = RUN_COMMAND.exec(text)
  const targetPreset = command?.[1] ?? header.targetPreset
  if (!targetPreset) return undefined

  const tail = lines.slice(divider + 1)
  const stats = tail.find((line) => line.trim() !== '' && !line.startsWith('⚠') && !RUN_COMMAND.test(line)) ?? ''
  const warnings = tail
    .filter((line) => line.startsWith('⚠'))
    .map((line) => line.replace(/^⚠\s*/u, ''))
  return {
    phase: 'preview',
    lang: header.lang,
    sourcePreset: header.sourcePreset,
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
  const presetPrefix = lang === 'en' ? 'Created a new session in the ' : '已在 '
  const presetSuffix = lang === 'en' ? ' preset' : ' 模式下建好新会话'
  const presetEnd = first.indexOf(presetSuffix, presetPrefix.length)
  const preset = presetEnd < 0 ? undefined : first.slice(presetPrefix.length, presetEnd).trim()
  if (!preset) return undefined
  const targetIndex = lines.findIndex((line) => line.startsWith('Target session:') || line.startsWith('目标会话：'))
  if (targetIndex < 0) return undefined
  const targetLine = lines[targetIndex] ?? ''
  const targetPrefix = targetLine.startsWith('Target session:') ? 'Target session:' : '目标会话：'
  const targetPayload = targetLine.slice(targetPrefix.length).trim()
  const targetSeparator = targetPayload.lastIndexOf(' · ')
  if (targetSeparator < 1) return undefined
  const title = targetPayload.slice(0, targetSeparator).trim()
  const sessionId = targetPayload.slice(targetSeparator + 3).trim()
  if (!title || !sessionId || /\s/u.test(sessionId)) return undefined
  const remaining = lines.filter((_, index) => index !== 0 && index !== targetIndex)
  return {
    phase: 'migrated',
    lang,
    targetPreset: preset,
    title,
    sessionId,
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
