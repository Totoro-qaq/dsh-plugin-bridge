/** Official WebUI half: one native `/bridge` command card, not a second WebUI. */

import { Component, useEffect, useId, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { JsonTree, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { JsonTreeLabels, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { CommandRowProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

import {
  appendBridgeTextListItem,
  buildBridgeMigrationCommand,
  MAX_EDITED_SUMMARY_CHARS,
  parseBridgeCard,
  parseBridgeTextProjection,
  parseJsonDocument,
  removeBridgeTextListItem,
  replaceBridgeTextListItem,
  replaceBridgeTextSection,
  uiLanguageOf,
  type BridgeCard,
  type BridgeOutcome,
  type BridgeTextProjection,
  type BridgeTextSection,
} from './client-contract.ts'

const STYLE_ID = 'dsh-plugin-bridge/native-card'
const STYLE = `
.dsh-bridge-card{border:1px solid var(--dsw-alias-border-subtle,light-dark(#dedede,#3f3f46));border-radius:12px;background:var(--dsw-alias-background-primary,light-dark(#fff,#18181b));color:var(--dsw-alias-label-primary,light-dark(#171717,#f4f4f5));overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.dsh-bridge-head{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 14px;border-bottom:1px solid var(--dsw-alias-border-subtle,light-dark(#e6e6e6,#3f3f46));background:var(--dsw-alias-background-secondary,light-dark(#fafafa,#202024))}
.dsh-bridge-mark{display:grid;place-items:center;width:22px;height:22px;border-radius:7px;background:var(--dsw-alias-state-business-secondary,light-dark(#e8f1ff,#22325c));color:var(--dsw-alias-state-business-primary,light-dark(#2869d8,#8eaeff));font:700 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace}
.dsh-bridge-title{min-width:0;flex:1;font-size:13px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dsh-bridge-route{font:500 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary,light-dark(#666,#a1a1aa))}
.dsh-bridge-body{padding:14px}.dsh-bridge-copy{font-size:13px;line-height:1.55;color:var(--dsw-alias-label-secondary,light-dark(#5f6368,#b4b4bd))}
.dsh-bridge-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}.dsh-bridge-tabs{display:inline-flex;flex-shrink:0;padding:2px;border-radius:8px;background:var(--dsw-alias-background-tertiary,light-dark(#f1f2f4,#29292e))}
.dsh-bridge-button,.dsh-bridge-tab{border:0;border-radius:7px;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;transition:background-color .15s ease,color .15s ease,transform .1s ease}
.dsh-bridge-tab{padding:7px 10px;background:transparent;color:var(--dsw-alias-label-secondary,light-dark(#666,#a1a1aa))}.dsh-bridge-tab[aria-selected=true]{background:var(--dsw-alias-background-primary,light-dark(#fff,#3a3a40));color:var(--dsw-alias-label-primary,light-dark(#171717,#f4f4f5));box-shadow:0 1px 2px rgba(0,0,0,.18)}
.dsh-bridge-button{padding:8px 11px;background:var(--dsw-alias-background-tertiary,light-dark(#f1f2f4,#303036));color:var(--dsw-alias-label-primary,light-dark(#171717,#f4f4f5))}.dsh-bridge-button[data-primary=true]{background:var(--dsw-alias-state-business-primary,light-dark(#2869d8,#4f7ee8));color:#fff}.dsh-bridge-button:disabled{cursor:not-allowed;opacity:.55}.dsh-bridge-button:not(:disabled):active{transform:translateY(1px)}
.dsh-bridge-actions{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}.dsh-bridge-panel{box-sizing:border-box;max-height:min(56vh,520px);overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:14px;border:1px solid var(--dsw-alias-border-subtle,light-dark(#e3e5e8,#3f3f46));border-radius:9px;background:var(--dsw-alias-background-primary,light-dark(#fff,#18181b))}
.dsh-bridge-preview{min-width:0}.dsh-bridge-markdown-editor,.dsh-bridge-text-editor,.dsh-bridge-list-input{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-strong,light-dark(#c8ccd2,#52525b));border-radius:8px;outline:none;background:var(--dsw-alias-background-primary,light-dark(#fff,#202024));color:var(--dsw-alias-label-primary,light-dark(#171717,#f4f4f5))}
.dsh-bridge-markdown-editor{min-height:360px;resize:vertical;padding:13px 14px;font:12px/1.65 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;tab-size:2}.dsh-bridge-text-editor{min-height:92px;resize:vertical;padding:10px 11px;font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.dsh-bridge-list-input{min-width:0;min-height:34px;resize:vertical;padding:9px 10px;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.dsh-bridge-markdown-editor:focus,.dsh-bridge-text-editor:focus,.dsh-bridge-list-input:focus{border-color:var(--dsw-alias-state-business-primary,#2869d8);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#2869d8) 18%,transparent)}
.dsh-bridge-form{display:grid;gap:14px}.dsh-bridge-field{display:grid;gap:7px}.dsh-bridge-field-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.dsh-bridge-field-label{font-size:12px;font-weight:700;color:var(--dsw-alias-label-primary,light-dark(#171717,#f4f4f5))}.dsh-bridge-field-help{font-size:11px;color:var(--dsw-alias-label-tertiary,light-dark(#85898f,#a1a1aa))}
.dsh-bridge-list{display:grid;gap:7px}.dsh-bridge-list-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:center}.dsh-bridge-list-button{align-self:center;padding:8px 9px}.dsh-bridge-add-button{justify-self:start}.dsh-bridge-appendix{display:grid;gap:7px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-subtle,light-dark(#e3e5e8,#3f3f46))}.dsh-bridge-appendix-copy{font-size:11px;color:var(--dsw-alias-label-tertiary,light-dark(#85898f,#a1a1aa))}
.dsh-bridge-notice{padding:12px;border-radius:8px;background:var(--dsw-alias-background-secondary,light-dark(#f7f8fa,#29292e));font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary,light-dark(#5f6368,#b4b4bd))}.dsh-bridge-notice-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.dsh-bridge-draft-notice{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;padding:9px 10px;border-radius:8px;background:var(--dsw-alias-state-warn-secondary,light-dark(#fff5d8,#443814));color:var(--dsw-alias-state-warn-primary,light-dark(#785a00,#f3d36b));font-size:12px}.dsh-bridge-draft-notice .dsh-bridge-actions{margin-left:0}
.dsh-bridge-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;color:var(--dsw-alias-label-tertiary,light-dark(#85898f,#a1a1aa));font-size:11px}.dsh-bridge-chip{padding:4px 7px;border-radius:999px;background:var(--dsw-alias-background-tertiary,light-dark(#f2f3f5,#29292e))}
.dsh-bridge-warning,.dsh-bridge-error{margin-top:10px;padding:9px 10px;border-radius:8px;font-size:12px;line-height:1.45}.dsh-bridge-warning{background:var(--dsw-alias-state-warn-secondary,light-dark(#fff5d8,#443814));color:var(--dsw-alias-state-warn-primary,light-dark(#785a00,#f3d36b))}.dsh-bridge-error{background:var(--dsw-alias-state-error-secondary,light-dark(#ffe9e7,#4a2325));color:var(--dsw-alias-state-error-primary,light-dark(#b3261e,#ffaaa4));white-space:pre-wrap}
.dsh-bridge-progress{height:3px;margin-top:12px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-background-tertiary,light-dark(#eceef1,#303036))}.dsh-bridge-progress::after{content:"";display:block;width:42%;height:100%;border-radius:inherit;background:var(--dsw-alias-state-business-primary,light-dark(#2869d8,#6d92ff));animation:dsh-bridge-scan 1.35s ease-in-out infinite}
.dsh-bridge-success{display:grid;gap:10px}.dsh-bridge-session{padding:10px;border-radius:8px;background:var(--dsw-alias-state-success-secondary,light-dark(#e8f7ed,#183a26));font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.dsh-bridge-status{min-height:18px;font-size:11px;color:var(--dsw-alias-label-tertiary,light-dark(#85898f,#a1a1aa))}
.dsh-bridge-button:focus-visible,.dsh-bridge-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#2869d8);outline-offset:2px}@keyframes dsh-bridge-scan{0%{transform:translateX(-110%)}100%{transform:translateX(340%)}}
@media(max-width:640px){.dsh-bridge-head{align-items:flex-start;flex-wrap:wrap;padding-block:10px}.dsh-bridge-route{width:100%;padding-left:32px}.dsh-bridge-toolbar{align-items:stretch;flex-direction:column}.dsh-bridge-tabs{align-self:flex-start;max-width:100%;overflow-x:auto}.dsh-bridge-panel{max-height:52vh;padding:11px}.dsh-bridge-actions{width:100%;margin-left:0}.dsh-bridge-toolbar>.dsh-bridge-actions .dsh-bridge-button{flex:1}.dsh-bridge-draft-notice{align-items:flex-start;flex-direction:column}.dsh-bridge-list-row{grid-template-columns:minmax(0,1fr)}}
@media(prefers-reduced-motion:reduce){.dsh-bridge-progress::after{animation:none;width:65%}.dsh-bridge-button,.dsh-bridge-tab{transition:none}}
`

interface BridgeInjected {
  readonly execute: (sessionId: SessionId, line: string) => Promise<BridgeOutcome>
  readonly openSession: (sessionId: SessionId) => Promise<void>
}

interface CommandRemote {
  execute(sessionId: SessionId, line: string, images: readonly unknown[]): Promise<{
    ok: boolean
    value?: { result: BridgeOutcome }
    error?: { code: string; message: string }
  }>
}

type BridgeCommandCardProps = CommandRowProps & BridgeInjected

const COPY = {
  zh: {
    title: '会话迁移', preparing: '正在生成可编辑的交接摘要', safe: '原会话不会被修改',
    preview: '预览', text: '文本编辑', markdownSource: 'Markdown', copy: '复制摘要', copied: '已复制', confirm: '确认迁移',
    confirming: '正在创建目标会话…', open: '打开目标会话', opening: '正在打开目标会话…',
    json: 'JSON 结构', markdownPreview: 'Markdown 预览', markdownEditor: '交接摘要 Markdown 编辑器', chars: '字符',
    listHelp: '每行一项，无需输入 Markdown 符号', addItem: '添加一项', removeItem: '删除此项',
    appendix: '附录（只读）', appendixHelp: '视觉证据与未解析图片会原样保留；需要修改请切换到 Markdown。',
    textUnavailable: '这份摘要不是可无损转换的标准五段格式。内容没有被修改，请使用 Markdown 编辑。',
    editMarkdown: '使用 Markdown', newPreview: '检测到新的预览；当前编辑稿不会被自动覆盖。',
    keepDraft: '保留编辑稿', loadPreview: '加载新预览', renderFailure: 'Bridge 卡片渲染失败；其他插件和会话不受影响。',
    tooLong: `摘要超过 WebUI 的 ${MAX_EDITED_SUMMARY_CHARS.toLocaleString()} 字符安全上限，请使用摘要文件回退。`,
    fileFallback: '摘要文件', stalePreview: '这张旧预览没有安全确认标识。请重新运行 /bridge 生成预览，或使用摘要文件流程。',
  },
  en: {
    title: 'Session handoff', preparing: 'Generating an editable handoff preview', safe: 'The source session stays untouched',
    preview: 'Preview', text: 'Text', markdownSource: 'Markdown', copy: 'Copy summary', copied: 'Copied', confirm: 'Confirm migration',
    confirming: 'Creating the target session…', open: 'Open target session', opening: 'Opening target session…',
    json: 'JSON structure', markdownPreview: 'Markdown preview', markdownEditor: 'Handoff summary Markdown editor', chars: 'chars',
    listHelp: 'One item per line; no Markdown markers needed', addItem: 'Add item', removeItem: 'Remove item',
    appendix: 'Appendix (read only)', appendixHelp: 'Visual evidence and unresolved images stay exact; use Markdown to edit them.',
    textUnavailable: 'This handoff is not a losslessly editable five-section document. Nothing changed; use Markdown instead.',
    editMarkdown: 'Use Markdown', newPreview: 'A newer preview arrived. Your draft was not overwritten.',
    keepDraft: 'Keep draft', loadPreview: 'Load new preview', renderFailure: 'The Bridge card failed to render. Other plugins and sessions are unaffected.',
    tooLong: `The handoff exceeds the ${MAX_EDITED_SUMMARY_CHARS.toLocaleString()}-character WebUI safety limit. Use the summary-file fallback.`,
    fileFallback: 'Summary file', stalePreview: 'This older preview has no secure confirmation ID. Run /bridge again or use the summary-file workflow.',
  },
} as const

const PRIMITIVE_LABELS = {
  zh: {
    markdown: {
      code: { copyLabel: '复制', copiedLabel: '已复制' },
      footnotes: '脚注',
    },
    json: {
      copyValue: '复制值', copyJson: '复制 JSON', copyPath: '复制属性路径',
      copyPrettyJson: '复制格式化 JSON', copyCompactJson: '复制紧凑 JSON',
      copied: '已复制', copyFailed: '复制失败',
      collapseNode: '折叠 JSON 节点', expandNode: '展开 JSON 节点',
      copyButtonTitle: (action: string) => `${action}；右键查看更多复制选项`,
    },
  },
  en: {
    markdown: {
      code: { copyLabel: 'Copy', copiedLabel: 'Copied' },
      footnotes: 'Footnotes',
    },
    json: {
      copyValue: 'Copy value', copyJson: 'Copy JSON', copyPath: 'Copy property path',
      copyPrettyJson: 'Copy pretty JSON', copyCompactJson: 'Copy compact JSON',
      copied: 'Copied', copyFailed: 'Copy failed',
      collapseNode: 'Collapse JSON node', expandNode: 'Expand JSON node',
      copyButtonTitle: (action: string) => `${action}; right-click for copy options`,
    },
  },
} satisfies Record<'zh' | 'en', { markdown: MarkdownLabels; json: JsonTreeLabels }>

function Header({ lang, route }: { lang: 'zh' | 'en'; route?: string }) {
  return <div className="dsh-bridge-head">
    <span className="dsh-bridge-mark" aria-hidden>B</span>
    <span className="dsh-bridge-title">{COPY[lang].title}</span>
    {route ? <span className="dsh-bridge-route">{route}</span> : null}
  </div>
}

function RunningCard() {
  const lang = uiLanguageOf(typeof document === 'undefined' ? undefined : document.documentElement.lang)
  const copy = COPY[lang]
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(() => { setSeconds(Math.floor((Date.now() - started) / 1000)) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [])
  return <div className="dsh-bridge-card" aria-live="polite">
    <Header lang={lang} />
    <div className="dsh-bridge-body">
      <div className="dsh-bridge-copy">{copy.preparing} · {seconds}s</div>
      <div className="dsh-bridge-status">{copy.safe}</div>
      <div className="dsh-bridge-progress" aria-hidden />
    </div>
  </div>
}

function SummaryView({ summary, lang }: { summary: string; lang: 'zh' | 'en' }) {
  const json = useMemo(() => parseJsonDocument(summary), [summary])
  return <div className="dsh-bridge-preview" aria-label={json === undefined ? COPY[lang].markdownPreview : COPY[lang].json}>
    {json === undefined
      ? <MarkdownText text={summary} labels={PRIMITIVE_LABELS[lang].markdown} />
      : <JsonTree data={json} label={COPY[lang].json} labels={PRIMITIVE_LABELS[lang].json} />}
  </div>
}

function TextListEditor({ lang, onAppend, onChange, onRemove, section }: {
  lang: 'zh' | 'en'
  onAppend: (value: string) => boolean
  onChange: (index: number, value: string) => void
  onRemove: (index: number) => void
  section: BridgeTextSection
}) {
  const copy = COPY[lang]
  const items = section.items ?? []
  const [draftRows, setDraftRows] = useState<string[]>([])
  const [itemDrafts, setItemDrafts] = useState<Record<number, string>>({})
  const removeDraft = (index: number) => { setDraftRows((current) => current.filter((_, itemIndex) => itemIndex !== index)) }
  return <div className="dsh-bridge-list">
    {items.map((item, index) => <div className="dsh-bridge-list-row" key={`${section.key}-${item.itemStart}`}>
      <textarea
        aria-label={`${section.label} ${index + 1}`}
        className="dsh-bridge-list-input"
        maxLength={MAX_EDITED_SUMMARY_CHARS}
        rows={Math.min(4, item.text.split(/\r\n|\n|\r/gu).length)}
        value={itemDrafts[index] ?? item.text}
        onChange={(event) => {
          const value = event.currentTarget.value
          setItemDrafts((current) => ({ ...current, [index]: value }))
          if (value) onChange(index, value)
        }}
        onBlur={() => {
          if (itemDrafts[index] === '') onRemove(index)
          setItemDrafts((current) => {
            const next = { ...current }
            delete next[index]
            return next
          })
        }}
        spellCheck
      />
      <button
        aria-label={`${copy.removeItem}: ${section.label} ${index + 1}`}
        className="dsh-bridge-button dsh-bridge-list-button"
        type="button"
        onPointerDown={(event) => { event.preventDefault() }}
        onClick={() => {
          onRemove(index)
        }}
      >−</button>
    </div>)}
    {draftRows.map((item, index) => <div className="dsh-bridge-list-row" key={`${section.key}-draft-${index}`}>
      <textarea
        aria-label={`${section.label} ${items.length + index + 1}`}
        autoFocus={index === draftRows.length - 1}
        className="dsh-bridge-list-input"
        maxLength={MAX_EDITED_SUMMARY_CHARS}
        rows={1}
        value={item}
        onChange={(event) => {
          const value = event.currentTarget.value
          setDraftRows((current) => current.map((row, rowIndex) => rowIndex === index ? value : row))
        }}
        onBlur={() => {
          if (!item.trim() || onAppend(item)) removeDraft(index)
        }}
        spellCheck
      />
      <button
        aria-label={`${copy.removeItem}: ${section.label} ${items.length + index + 1}`}
        className="dsh-bridge-button dsh-bridge-list-button"
        type="button"
        onPointerDown={(event) => { event.preventDefault() }}
        onClick={() => { removeDraft(index) }}
      >−</button>
    </div>)}
    <button
      className="dsh-bridge-button dsh-bridge-add-button"
      type="button"
      onClick={() => { setDraftRows((current) => [...current, '']) }}
      aria-label={`${copy.addItem}: ${section.label}`}
    >＋ {copy.addItem}</button>
  </div>
}

function TextHandoffEditor({ idPrefix, lang, onChange, onError, projection }: {
  idPrefix: string
  lang: 'zh' | 'en'
  onChange: (summary: string) => boolean
  onError: (message: string) => void
  projection: BridgeTextProjection
}) {
  const copy = COPY[lang]
  const safelyApply = (operation: () => string): boolean => {
    try {
      onError('')
      return onChange(operation())
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }
  const updateSection = (section: BridgeTextSection, value: string) => {
    safelyApply(() => replaceBridgeTextSection(projection, section.key, value))
  }
  return <div className="dsh-bridge-form">
    {projection.sections.map((section) => <div
      aria-labelledby={section.kind === 'list' ? `${idPrefix}-${section.key}-label` : undefined}
      className="dsh-bridge-field"
      key={section.key}
      role={section.kind === 'list' ? 'group' : undefined}
    >
      <div className="dsh-bridge-field-head">
        {section.kind === 'text'
          ? <label className="dsh-bridge-field-label" htmlFor={`${idPrefix}-${section.key}`}>{section.label}</label>
          : <div className="dsh-bridge-field-label" id={`${idPrefix}-${section.key}-label`}>{section.label}</div>}
        {section.kind === 'list' ? <span className="dsh-bridge-field-help">{copy.listHelp}</span> : null}
      </div>
      {section.kind === 'text'
        ? <textarea
            className="dsh-bridge-text-editor"
            id={`${idPrefix}-${section.key}`}
            maxLength={MAX_EDITED_SUMMARY_CHARS}
            value={section.text}
            onChange={(event) => { updateSection(section, event.currentTarget.value) }}
            spellCheck
          />
        : <TextListEditor
            lang={lang}
            section={section}
            onAppend={(value) => safelyApply(() => appendBridgeTextListItem(projection, section.key, value))}
            onChange={(index, value) => { safelyApply(() => replaceBridgeTextListItem(projection, section.key, index, value)) }}
            onRemove={(index) => { safelyApply(() => removeBridgeTextListItem(projection, section.key, index)) }}
          />}
    </div>)}
    {projection.opaqueSuffix
      ? <div className="dsh-bridge-appendix">
          <div><div className="dsh-bridge-field-label">{copy.appendix}</div><div className="dsh-bridge-appendix-copy">{copy.appendixHelp}</div></div>
          <SummaryView summary={projection.opaqueSuffix} lang={lang} />
        </div>
      : null}
  </div>
}

type EditorMode = 'preview' | 'text' | 'markdown'
const EDITOR_MODES: readonly EditorMode[] = ['preview', 'text', 'markdown']

function PreviewCard({ card, execute, openSession, sessionId }: {
  card: Extract<BridgeCard, { phase: 'preview' }>
  execute: BridgeInjected['execute']
  openSession: BridgeInjected['openSession']
  sessionId: SessionId
}) {
  const copy = COPY[card.lang]
  const panelId = useId()
  const [mode, setMode] = useState<EditorMode>('preview')
  const [summary, setSummary] = useState(card.summary)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [pendingSummary, setPendingSummary] = useState<string | null>(null)
  const [created, setCreated] = useState<Extract<BridgeCard, { phase: 'migrated' }> | null>(null)
  const lastCardSummary = useRef(card.summary)
  const confirming = useRef(false)
  const tooLong = summary.length > MAX_EDITED_SUMMARY_CHARS
  const textProjection = useMemo(() => tooLong ? undefined : parseBridgeTextProjection(summary), [summary, tooLong])
  const updateSummary = (next: string) => {
    if (next.length > MAX_EDITED_SUMMARY_CHARS) {
      setError(copy.tooLong)
      return false
    }
    setError('')
    setSummary(next)
    return true
  }

  useEffect(() => {
    const prior = lastCardSummary.current
    if (card.summary === prior) return
    lastCardSummary.current = card.summary
    if (summary === prior) {
      setSummary(card.summary)
      setPendingSummary(null)
    } else {
      setPendingSummary(card.summary)
    }
  }, [card.summary, summary])

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summary)
      setError('')
      setStatus(copy.copied)
    } catch (cause) {
      setStatus('')
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const confirm = async () => {
    if (confirming.current) return
    confirming.current = true
    setBusy(true)
    setError('')
    setStatus(copy.confirming)
    try {
      const outcome = await execute(sessionId, buildBridgeMigrationCommand(card.targetPreset, summary, card.lang, card.previewId ?? ''))
      const result = parseBridgeCard(outcome)
      if (result.phase === 'error') throw new Error(result.text)
      if (result.phase !== 'migrated') throw new Error(card.lang === 'en' ? 'The host returned no target session.' : '宿主没有返回目标会话。')
      setCreated(result)
      setStatus(copy.opening)
      await openSession(result.sessionId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('')
    } finally {
      confirming.current = false
      setBusy(false)
    }
  }

  if (created) return <MigratedCard card={created} openSession={openSession} status={status} error={error} />

  return <div className="dsh-bridge-card">
    <Header lang={card.lang} route={`${card.sourcePreset} → ${card.targetPreset}`} />
    <div className="dsh-bridge-body">
      <div className="dsh-bridge-toolbar">
        <div
          className="dsh-bridge-tabs"
          role="tablist"
          aria-label={copy.title}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const current = EDITOR_MODES.indexOf(mode)
            const next = event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? EDITOR_MODES.length - 1
                : (current + (event.key === 'ArrowRight' ? 1 : -1) + EDITOR_MODES.length) % EDITOR_MODES.length
            const nextMode = EDITOR_MODES[next] ?? 'preview'
            setMode(nextMode)
            window.requestAnimationFrame(() => { document.getElementById(`${panelId}-${nextMode}`)?.focus() })
          }}
        >
          {([
            ['preview', copy.preview],
            ['text', copy.text],
            ['markdown', copy.markdownSource],
          ] as const).map(([value, label]) => <button
            aria-controls={panelId}
            aria-selected={mode === value}
            className="dsh-bridge-tab"
            id={`${panelId}-${value}`}
            key={value}
            role="tab"
            tabIndex={mode === value ? 0 : -1}
            type="button"
            onClick={() => { setMode(value) }}
          >{label}</button>)}
        </div>
        <div className="dsh-bridge-actions">
          <button className="dsh-bridge-button" type="button" onClick={() => { void copySummary() }}>{copy.copy}</button>
          <button className="dsh-bridge-button" data-primary type="button" disabled={busy || !card.previewId || summary.trim() === '' || tooLong} onClick={() => { void confirm() }}>{busy ? copy.confirming : copy.confirm}</button>
        </div>
      </div>
      {pendingSummary !== null
        ? <div className="dsh-bridge-draft-notice" role="status">
            <span>{copy.newPreview}</span>
            <div className="dsh-bridge-actions">
              <button className="dsh-bridge-button" type="button" onClick={() => { setPendingSummary(null) }}>{copy.keepDraft}</button>
              <button className="dsh-bridge-button" type="button" onClick={() => { setSummary(pendingSummary); setPendingSummary(null) }}>{copy.loadPreview}</button>
            </div>
          </div>
        : null}
      <div aria-labelledby={`${panelId}-${mode}`} className="dsh-bridge-panel" id={panelId} role="tabpanel">
        {tooLong
          ? <div className="dsh-bridge-notice" role="alert">{copy.tooLong}{card.summaryFile ? <><br /><strong>{copy.fileFallback}:</strong> <code>{card.summaryFile}</code></> : null}</div>
          : mode === 'preview'
          ? <SummaryView summary={summary} lang={card.lang} />
          : mode === 'text'
            ? textProjection
              ? <TextHandoffEditor
                  idPrefix={panelId}
                  lang={card.lang}
                  projection={textProjection}
                  onChange={updateSummary}
                  onError={setError}
                />
              : <div className="dsh-bridge-notice" role="status">
                  {copy.textUnavailable}
                  <div className="dsh-bridge-notice-actions"><button className="dsh-bridge-button" type="button" onClick={() => { setMode('markdown') }}>{copy.editMarkdown}</button></div>
                </div>
            : <textarea className="dsh-bridge-markdown-editor" aria-label={copy.markdownEditor} maxLength={MAX_EDITED_SUMMARY_CHARS} value={summary} onChange={(event) => { updateSummary(event.currentTarget.value) }} spellCheck={false} />}
      </div>
      <div className="dsh-bridge-meta">
        {card.stats ? <span className="dsh-bridge-chip">{card.stats}</span> : null}
        <span className="dsh-bridge-chip">{summary.length.toLocaleString()} {copy.chars}</span>
      </div>
      {card.warnings.map((warning) => <div className="dsh-bridge-warning" key={warning}>⚠ {warning}</div>)}
      {!card.previewId ? <div className="dsh-bridge-warning">⚠ {copy.stalePreview}</div> : null}
      {status ? <div className="dsh-bridge-status" aria-live="polite">{status}</div> : null}
      {error ? <div className="dsh-bridge-error" role="alert">{error}</div> : null}
    </div>
  </div>
}

function MigratedCard({ card, error = '', openSession, status = '' }: {
  card: Extract<BridgeCard, { phase: 'migrated' }>
  error?: string
  openSession: BridgeInjected['openSession']
  status?: string
}) {
  const copy = COPY[card.lang]
  const [opening, setOpening] = useState(false)
  const [localError, setLocalError] = useState(error)
  const open = async () => {
    setOpening(true)
    setLocalError('')
    try { await openSession(card.sessionId) } catch (cause) { setLocalError(cause instanceof Error ? cause.message : String(cause)) } finally { setOpening(false) }
  }
  return <div className="dsh-bridge-card">
    <Header lang={card.lang} route={`→ ${card.targetPreset}`} />
    <div className="dsh-bridge-body dsh-bridge-success">
      <div className="dsh-bridge-session"><strong>{card.title}</strong><br />{card.sessionId}</div>
      {card.details.map((detail) => <div className="dsh-bridge-copy" key={detail}>{detail}</div>)}
      <div className="dsh-bridge-actions"><button className="dsh-bridge-button" data-primary type="button" disabled={opening} onClick={() => { void open() }}>{opening ? copy.opening : copy.open}</button></div>
      {status ? <div className="dsh-bridge-status" aria-live="polite">{status}</div> : null}
      {card.warnings.map((warning) => <div className="dsh-bridge-warning" key={warning}>⚠ {warning}</div>)}
      {localError ? <div className="dsh-bridge-error" role="alert">{localError}</div> : null}
    </div>
  </div>
}

function MessageCard({ card }: { card: Extract<BridgeCard, { phase: 'message' | 'error' }> }) {
  const lang = card.phase === 'message' ? card.lang : (/[㐀-鿿]/u.test(card.text) ? 'zh' : 'en')
  return <div className="dsh-bridge-card"><Header lang={lang} /><div className="dsh-bridge-body">
    <div className="dsh-bridge-panel">{card.phase === 'error' ? <div className="dsh-bridge-error" role="alert">{card.text}</div> : <SummaryView summary={card.text} lang={card.lang} />}</div>
  </div></div>
}

class BridgeCardBoundary extends Component<{ children: ReactNode; lang: 'zh' | 'en' }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('dsh-plugin-bridge card render failed', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return <div className="dsh-bridge-card"><Header lang={this.props.lang} /><div className="dsh-bridge-body">
      <div className="dsh-bridge-error" role="alert">{COPY[this.props.lang].renderFailure}</div>
    </div></div>
  }
}

function BridgeCommandCardContent({ node, execute, openSession, sessionId }: BridgeCommandCardProps) {
  const card = useMemo(() => parseBridgeCard(node.outcome), [node.outcome])
  if (card.phase === 'running') return <RunningCard />
  if (card.phase === 'preview') return <PreviewCard card={card} execute={execute} openSession={openSession} sessionId={sessionId} />
  if (card.phase === 'migrated') return <MigratedCard card={card} openSession={openSession} />
  return <MessageCard card={card} />
}

/** Rich renderer for the durable command lifecycle keyed by name and isolated from every other plugin. */
export function BridgeCommandCard(props: BridgeCommandCardProps) {
  const lang = uiLanguageOf(typeof document === 'undefined' ? undefined : document.documentElement.lang)
  const outcomeKey = props.node.outcome === null ? 'running' : `${props.node.outcome.kind}:${props.node.outcome.text ?? ''}`
  return <BridgeCardBoundary key={outcomeKey} lang={lang}><BridgeCommandCardContent {...props} /></BridgeCardBoundary>
}

async function openWhenVisible(ctx: ClientContext, sessionId: SessionId): Promise<void> {
  if (ctx.sessions.list.getSnapshot().byId[sessionId] !== undefined) {
    ctx.sessions.open(sessionId)
    return
  }
  await new Promise<void>((resolve, reject) => {
    let dispose = () => {}
    const timeout = window.setTimeout(() => {
      dispose()
      reject(new Error(`Target session ${sessionId} has not reached this browser yet.`))
    }, 5_000)
    dispose = ctx.sessions.list.subscribe(() => {
      if (ctx.sessions.list.getSnapshot().byId[sessionId] === undefined) return
      window.clearTimeout(timeout)
      dispose()
      resolve()
    })
  })
  ctx.sessions.open(sessionId)
}

/** Client services are supplied by the official WebUI module table. */
// rc.2 guards the parent `remote` face separately from its `remote.commands`
// capability; older compatible builds tolerate the redundant parent seat.
export const inject = ['slots', 'sessions', 'remote', 'remote.commands']

export function apply(ctx: ClientContext): void {
  const commands = (ctx as unknown as { remote: { commands: CommandRemote } }).remote.commands
  ctx.effect(() => {
    const prior = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
    if (prior !== null) return () => {}
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-plugin-bridge'
    style.dataset.pluginCss = STYLE_ID
    style.textContent = STYLE
    document.head.append(style)
    return () => { style.remove() }
  }, 'bridge: native card styles')
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: 'bridge',
    inject: (): BridgeInjected => ({
      execute: async (sessionId, line) => {
        const result = await commands.execute(sessionId, line, [])
        if (!result.ok) throw new Error(`${result.error?.code ?? 'command-failed'}: ${result.error?.message ?? 'The host rejected the command.'}`)
        if (result.value === undefined) throw new Error('The /bridge command was not admitted by the host.')
        return result.value.result
      },
      openSession: (sessionId) => openWhenVisible(ctx, sessionId),
    }),
  }, BridgeCommandCard))
}
