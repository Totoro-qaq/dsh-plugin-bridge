/** Official WebUI half: one native `/bridge` command card, not a second WebUI. */

import { useEffect, useMemo, useState } from 'react'
import { JsonTree, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

import {
  buildBridgeMigrationCommand,
  parseBridgeCard,
  parseJsonDocument,
  type BridgeCard,
  type BridgeOutcome,
} from './client-contract.ts'

const STYLE_ID = 'dsh-plugin-bridge/native-card'
const STYLE = `
.dsh-bridge-card{border:1px solid var(--dsw-alias-border-subtle,#dedede);border-radius:12px;background:var(--dsw-alias-background-primary,#fff);color:var(--dsw-alias-label-primary,#171717);overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.dsh-bridge-head{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 14px;border-bottom:1px solid var(--dsw-alias-border-subtle,#e6e6e6);background:var(--dsw-alias-background-secondary,#fafafa)}
.dsh-bridge-mark{display:grid;place-items:center;width:22px;height:22px;border-radius:7px;background:var(--dsw-alias-state-business-secondary,#e8f1ff);color:var(--dsw-alias-state-business-primary,#2869d8);font:700 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace}
.dsh-bridge-title{min-width:0;flex:1;font-size:13px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dsh-bridge-route{font:500 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary,#666)}
.dsh-bridge-body{padding:14px}.dsh-bridge-copy{font-size:13px;line-height:1.55;color:var(--dsw-alias-label-secondary,#5f6368)}
.dsh-bridge-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.dsh-bridge-tabs{display:inline-flex;padding:2px;border-radius:8px;background:var(--dsw-alias-background-tertiary,#f1f2f4)}
.dsh-bridge-button,.dsh-bridge-tab{border:0;border-radius:7px;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;transition:background-color .15s ease,color .15s ease,transform .1s ease}
.dsh-bridge-tab{padding:7px 10px;background:transparent;color:var(--dsw-alias-label-secondary,#666)}.dsh-bridge-tab[aria-selected=true]{background:var(--dsw-alias-background-primary,#fff);color:var(--dsw-alias-label-primary,#171717);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.dsh-bridge-button{padding:8px 11px;background:var(--dsw-alias-background-tertiary,#f1f2f4);color:var(--dsw-alias-label-primary,#171717)}.dsh-bridge-button[data-primary=true]{background:var(--dsw-alias-state-business-primary,#2869d8);color:#fff}.dsh-bridge-button:disabled{cursor:not-allowed;opacity:.55}.dsh-bridge-button:not(:disabled):active{transform:translateY(1px)}
.dsh-bridge-actions{display:flex;gap:8px;flex-wrap:wrap}.dsh-bridge-preview{max-height:420px;overflow:auto;padding:14px;border:1px solid var(--dsw-alias-border-subtle,#e3e5e8);border-radius:9px;background:var(--dsw-alias-background-primary,#fff)}
.dsh-bridge-editor{box-sizing:border-box;width:100%;min-height:310px;resize:vertical;padding:13px 14px;border:1px solid var(--dsw-alias-border-strong,#c8ccd2);border-radius:9px;outline:none;background:var(--dsw-alias-background-primary,#fff);color:var(--dsw-alias-label-primary,#171717);font:12px/1.65 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;tab-size:2}.dsh-bridge-editor:focus{border-color:var(--dsw-alias-state-business-primary,#2869d8);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#2869d8) 18%,transparent)}
.dsh-bridge-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;color:var(--dsw-alias-label-tertiary,#85898f);font-size:11px}.dsh-bridge-chip{padding:4px 7px;border-radius:999px;background:var(--dsw-alias-background-tertiary,#f2f3f5)}
.dsh-bridge-warning,.dsh-bridge-error{margin-top:10px;padding:9px 10px;border-radius:8px;font-size:12px;line-height:1.45}.dsh-bridge-warning{background:var(--dsw-alias-state-warn-secondary,#fff5d8);color:var(--dsw-alias-state-warn-primary,#785a00)}.dsh-bridge-error{background:var(--dsw-alias-state-error-secondary,#ffe9e7);color:var(--dsw-alias-state-error-primary,#b3261e);white-space:pre-wrap}
.dsh-bridge-progress{height:3px;margin-top:12px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-background-tertiary,#eceef1)}.dsh-bridge-progress::after{content:"";display:block;width:42%;height:100%;border-radius:inherit;background:var(--dsw-alias-state-business-primary,#2869d8);animation:dsh-bridge-scan 1.35s ease-in-out infinite}
.dsh-bridge-success{display:grid;gap:10px}.dsh-bridge-session{padding:10px;border-radius:8px;background:var(--dsw-alias-state-success-secondary,#e8f7ed);font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.dsh-bridge-status{min-height:18px;font-size:11px;color:var(--dsw-alias-label-tertiary,#85898f)}
.dsh-bridge-button:focus-visible,.dsh-bridge-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#2869d8);outline-offset:2px}@keyframes dsh-bridge-scan{0%{transform:translateX(-110%)}100%{transform:translateX(340%)}}
@media(max-width:640px){.dsh-bridge-head{align-items:flex-start;flex-wrap:wrap;padding-block:10px}.dsh-bridge-route{width:100%;padding-left:32px}.dsh-bridge-toolbar{align-items:flex-start;flex-direction:column}.dsh-bridge-preview{max-height:52vh}.dsh-bridge-actions{width:100%}.dsh-bridge-actions .dsh-bridge-button{flex:1}}
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

type BridgeCommandCardProps = PropsRuntime<'conversation.chat.commandview'> & BridgeInjected

const COPY = {
  zh: {
    title: '会话迁移', preparing: '正在生成可编辑的交接摘要', safe: '原会话不会被修改',
    preview: '预览', edit: '编辑', copy: '复制摘要', copied: '已复制', confirm: '确认迁移',
    confirming: '正在创建目标会话…', open: '打开目标会话', opening: '正在打开目标会话…',
    json: 'JSON 结构', markdown: 'Markdown 预览', editor: '交接摘要 Markdown 编辑器', chars: '字符',
  },
  en: {
    title: 'Session handoff', preparing: 'Generating an editable handoff preview', safe: 'The source session stays untouched',
    preview: 'Preview', edit: 'Edit', copy: 'Copy summary', copied: 'Copied', confirm: 'Confirm migration',
    confirming: 'Creating the target session…', open: 'Open target session', opening: 'Opening target session…',
    json: 'JSON structure', markdown: 'Markdown preview', editor: 'Handoff summary Markdown editor', chars: 'chars',
  },
} as const

function Header({ lang, route }: { lang: 'zh' | 'en'; route?: string }) {
  return <div className="dsh-bridge-head">
    <span className="dsh-bridge-mark" aria-hidden>B</span>
    <span className="dsh-bridge-title">{COPY[lang].title}</span>
    {route ? <span className="dsh-bridge-route">{route}</span> : null}
  </div>
}

function RunningCard() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(() => { setSeconds(Math.floor((Date.now() - started) / 1000)) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [])
  return <div className="dsh-bridge-card" aria-live="polite">
    <div className="dsh-bridge-head">
      <span className="dsh-bridge-mark" aria-hidden>B</span>
      <span className="dsh-bridge-title">Bridge · 会话迁移</span>
    </div>
    <div className="dsh-bridge-body">
      <div className="dsh-bridge-copy">Preparing editable handoff · 正在生成可编辑交接 · {seconds}s</div>
      <div className="dsh-bridge-status">Source stays untouched · 原会话保持不动</div>
      <div className="dsh-bridge-progress" aria-hidden />
    </div>
  </div>
}

function SummaryView({ summary, lang }: { summary: string; lang: 'zh' | 'en' }) {
  const json = useMemo(() => parseJsonDocument(summary), [summary])
  return <div className="dsh-bridge-preview" aria-label={json === undefined ? COPY[lang].markdown : COPY[lang].json}>
    {json === undefined ? <MarkdownText text={summary} /> : <JsonTree data={json} label={COPY[lang].json} />}
  </div>
}

function PreviewCard({ card, execute, openSession, sessionId }: {
  card: Extract<BridgeCard, { phase: 'preview' }>
  execute: BridgeInjected['execute']
  openSession: BridgeInjected['openSession']
  sessionId: SessionId
}) {
  const copy = COPY[card.lang]
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [summary, setSummary] = useState(card.summary)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [created, setCreated] = useState<Extract<BridgeCard, { phase: 'migrated' }> | null>(null)

  useEffect(() => { setSummary(card.summary) }, [card.summary])

  const copySummary = async () => {
    await navigator.clipboard.writeText(summary)
    setStatus(copy.copied)
  }

  const confirm = async () => {
    setBusy(true)
    setError('')
    setStatus(copy.confirming)
    try {
      const outcome = await execute(sessionId, buildBridgeMigrationCommand(card.targetPreset, summary))
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
      setBusy(false)
    }
  }

  if (created) return <MigratedCard card={created} openSession={openSession} status={status} error={error} />

  return <div className="dsh-bridge-card">
    <Header lang={card.lang} route={`${card.sourcePreset} → ${card.targetPreset}`} />
    <div className="dsh-bridge-body">
      <div className="dsh-bridge-toolbar">
        <div className="dsh-bridge-tabs" role="tablist" aria-label={copy.title}>
          <button className="dsh-bridge-tab" type="button" role="tab" aria-selected={mode === 'preview'} onClick={() => { setMode('preview') }}>{copy.preview}</button>
          <button className="dsh-bridge-tab" type="button" role="tab" aria-selected={mode === 'edit'} onClick={() => { setMode('edit') }}>{copy.edit}</button>
        </div>
        <div className="dsh-bridge-actions">
          <button className="dsh-bridge-button" type="button" onClick={() => { void copySummary() }}>{copy.copy}</button>
          <button className="dsh-bridge-button" data-primary type="button" disabled={busy || summary.trim() === ''} onClick={() => { void confirm() }}>{busy ? copy.confirming : copy.confirm}</button>
        </div>
      </div>
      {mode === 'preview'
        ? <SummaryView summary={summary} lang={card.lang} />
        : <textarea className="dsh-bridge-editor" aria-label={copy.editor} value={summary} onChange={(event) => { setSummary(event.currentTarget.value) }} spellCheck={false} />}
      <div className="dsh-bridge-meta">
        {card.stats ? <span className="dsh-bridge-chip">{card.stats}</span> : null}
        <span className="dsh-bridge-chip">{summary.length.toLocaleString()} {copy.chars}</span>
      </div>
      {card.warnings.map((warning) => <div className="dsh-bridge-warning" key={warning}>⚠ {warning}</div>)}
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
    {card.phase === 'error' ? <div className="dsh-bridge-error" role="alert">{card.text}</div> : <SummaryView summary={card.text} lang={card.lang} />}
  </div></div>
}

/** Rich renderer for the durable command lifecycle keyed by command name. */
export function BridgeCommandCard({ node, execute, openSession, sessionId }: BridgeCommandCardProps) {
  const card = useMemo(() => parseBridgeCard(node.outcome), [node.outcome])
  if (card.phase === 'running') return <RunningCard />
  if (card.phase === 'preview') return <PreviewCard card={card} execute={execute} openSession={openSession} sessionId={sessionId} />
  if (card.phase === 'migrated') return <MigratedCard card={card} openSession={openSession} />
  return <MessageCard card={card} />
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
