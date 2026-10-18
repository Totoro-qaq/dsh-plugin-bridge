/** The Session row owns its menu state; Bridge owns only this current-row action. */
export function createBridgeSessionMenuAction(options) {
    let active = true;
    const available = (sessionId) => active && sessionId !== '' && options.currentSession() === sessionId
        && options.conversationVisible() && !options.blocked();
    return {
        available,
        select(sessionId, close) {
            if (!available(sessionId))
                return false;
            close();
            // Dismissal/focus return can synchronously navigate in a custom Host.
            if (!available(sessionId))
                return false;
            options.launch(sessionId);
            return true;
        },
        dispose() { active = false; },
    };
}
const IDLE = Object.freeze({ busy: false, error: '' });
/** A selected Session identity can still belong to the Host's blank Hero. */
export function bridgeEntryUnavailable(state, lang) {
    if (state?.openState !== undefined && state.openState !== 'open')
        return lang === 'zh'
            ? '会话尚未就绪，请等待加载完成，或重新打开会话后再试。'
            : 'This conversation is not ready yet. Wait for it to load, or reopen it, then try Bridge again.';
    if (state?.blank === true)
        return lang === 'zh'
            ? '这是新会话，还没有可交接内容。请先打开一个已有内容的会话。'
            : 'This new session has no conversation content to hand off yet. Open an existing conversation first.';
    return undefined;
}
/** The command listbox is allowed; a different visible dialog keeps ownership. */
export function hasBridgeEntryDialog(document) {
    return document !== undefined && [...document.querySelectorAll('[role="dialog"][aria-modal="true"],dialog[open]')]
        .some(dialog => !dialog.closest('[hidden],[inert],[aria-hidden="true"]') && dialog.getClientRects().length > 0);
}
/** Enhance only the Host row's bare pick; argued slash commands remain entirely Host-owned. */
export function registerBridgeCommandMenu(commandUi, options) {
    if (!commandUi?.decorate)
        return () => { };
    let active = true;
    const available = session => active
        && options.currentSession() === session.sessionId && options.conversationVisible() && !options.blocked();
    const off = commandUi.decorate({
        name: 'bridge',
        available,
        ui: { kind: 'action', run(session) {
                if (available(session))
                    options.launch(session.sessionId);
            } },
    });
    return () => {
        if (!active)
            return;
        active = false;
        off();
    };
}
/** One activation owns its requests, status and listeners; no global input handlers. */
export function createBridgeLauncher(options) {
    const listeners = new Set();
    const snapshots = new Map();
    const pending = new Set();
    let active = true;
    const publish = (sessionId, snapshot) => {
        if (!active)
            return;
        if (snapshot === IDLE)
            snapshots.delete(sessionId);
        else
            snapshots.set(sessionId, snapshot);
        for (const listener of listeners)
            listener();
    };
    return {
        subscribe(listener) {
            if (!active)
                return () => { };
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        snapshotFor: sessionId => snapshots.get(sessionId) ?? IDLE,
        async launch(sessionId) {
            if (!active || !sessionId || pending.has(sessionId) || options.allowed?.(sessionId) === false)
                return false;
            pending.add(sessionId);
            publish(sessionId, { busy: true, error: '' });
            try {
                // Deliberately no target, --go or --continue: a human still picks and confirms.
                await options.execute(sessionId, '/bridge');
                publish(sessionId, IDLE);
                return true;
            }
            catch (cause) {
                publish(sessionId, { busy: false, error: (cause instanceof Error ? cause.message : String(cause)).slice(0, 1_000) });
                return false;
            }
            finally {
                pending.delete(sessionId);
            }
        },
        dispose() {
            active = false;
            listeners.clear();
            snapshots.clear();
            pending.clear();
        },
    };
}
/** The Host normally arbitrates composition before resolve; retained targets remain defensive. */
function composing(context) {
    const target = context.target;
    return target?.isComposing === true || target?.ownerDocument?.activeElement?.isComposing === true;
}
/** Add an unbound command to DSH keyboard settings; never reserve another feature's keys. */
export function registerBridgeShortcut(shortcuts, options) {
    if (!shortcuts?.register)
        return () => { };
    let active = true;
    const command = {
        id: 'dsh-plugin-bridge.open',
        label: () => options.chinese() ? 'Bridge：迁移会话' : 'Bridge: Hand off current session',
        aliases: ['bridge', 'handoff', '迁移', '交接'],
        defaults: {},
        regions: ['page', 'editable', 'terminal'],
        modals: [],
        resolve(context) {
            if (!active)
                return { status: 'pass' };
            // Native Desktop dispatch intentionally precedes the modal filter in DSH.
            if (context.modal !== null)
                return { status: 'blocked', reason: 'modal' };
            if (context.source === 'iframe' || context.source === 'webview' || composing(context))
                return { status: 'pass' };
            const sessionId = options.currentSession();
            if (!sessionId || !options.conversationVisible())
                return { status: 'pass' };
            return { status: 'handled', run() {
                    if (active && options.currentSession() === sessionId && options.conversationVisible())
                        options.launch(sessionId);
                } };
        },
    };
    const off = shortcuts.register(command);
    return () => {
        if (!active)
            return;
        active = false;
        off();
    };
}
