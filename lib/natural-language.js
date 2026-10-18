const TTL_MS = 30 * 60_000;
const MAX_COMPLETED = 128;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function argumentsOf(value) {
    if (!object(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        throw new Error('Invalid Bridge parameters: expected an object.');
    }
    if (Reflect.ownKeys(value).some(key => key !== 'targetPreset' && key !== 'lang')
        || Object.values(Object.getOwnPropertyDescriptors(value)).some(item => !('value' in item))) {
        throw new Error('Invalid Bridge parameter: only targetPreset and lang are accepted.');
    }
    const target = value.targetPreset;
    if (Object.hasOwn(value, 'targetPreset')
        && (typeof target !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(target))) {
        throw new Error('Invalid Bridge target preset. Use a preset identifier, not a command.');
    }
    const lang = value.lang;
    if (Object.hasOwn(value, 'lang') && lang !== 'zh' && lang !== 'en' && lang !== 'auto') {
        throw new Error('Invalid Bridge language: use zh, en, or auto.');
    }
    return value;
}
function sessionIdOf(exec) {
    const agent = exec?.agent;
    const identities = [agent?.id, agent?.session?.id, agent?.session?.header?.id]
        .filter(value => value !== undefined);
    if (identities.length === 0 || identities.some(value => typeof value !== 'string' || !/^[^\s]{1,512}$/u.test(value))
        || new Set(identities).size !== 1) {
        throw new Error('Bridge needs one consistent, Host-owned current session identity.');
    }
    return identities[0];
}
/** Share the command's pending-preview table instead of creating another migration engine. */
export function createBridgeNaturalLanguage(deps) {
    const lifecycle = new AbortController();
    const records = new Map();
    const preparingSessions = new Set();
    const active = new Set();
    const now = deps.now ?? Date.now;
    let disposed = false;
    let disposal;
    const prune = () => {
        for (const [key, record] of records) {
            if (record.settled && now() - record.at >= TTL_MS)
                records.delete(key);
        }
        let completed = [...records.values()].filter(record => record.settled).length;
        for (const [key, record] of records) {
            if (completed <= MAX_COMPLETED)
                break;
            if (record.settled) {
                records.delete(key);
                completed--;
            }
        }
    };
    const tool = {
        name: 'bridge_prepare',
        description: 'When the user asks to move this conversation/task to another DSH preset or mode, prepare an editable handoff preview. '
            + 'This NEVER migrates a session, authorizes continuation, or confirms a handoff. The user must review/edit the Bridge card and click Confirm migration. '
            + 'Use targetPreset for the requested preset ID (for example ptc); omit it to offer the target picker. Do not call from summary workers. '
            + 'No session ID, command, file, summary, go, or continue parameter is accepted.',
        parameters: {
            type: 'object', additionalProperties: false,
            properties: {
                targetPreset: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,127}$', description: 'Requested DSH preset ID, not a command.' },
                lang: { type: 'string', enum: ['zh', 'en', 'auto'], description: 'Handoff display language; omit to follow Bridge settings.' },
            },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false, required: ['kind', 'text'],
                properties: { kind: { type: 'string', enum: ['success', 'error'] }, text: { type: 'string' } },
            },
            render: (_args, value) => [{ type: 'text', text: value.kind === 'success'
                        ? 'Bridge prepared a handoff review or target picker. No migration has happened. The user must review/edit the Bridge card and explicitly confirm migration. If this client has no Bridge card, use /bridge to open the same review flow.'
                        : `Bridge could not prepare the handoff: ${value.text}` }],
            presentationMeta: (_args, value) => ({ bridge: { version: 1, outcome: value } }),
        },
        async execute(input, exec) {
            if (disposed)
                throw new Error('Bridge was unloaded; the preview entry is disposed.');
            const args = argumentsOf(input);
            const sessionId = sessionIdOf(exec);
            if (deps.workerSessionIds.has(sessionId))
                throw new Error('Bridge summary workers cannot recursively prepare a handoff.');
            if (typeof exec.callId !== 'string' || !exec.callId || exec.callId.length > 1024)
                throw new Error('Invalid Bridge tool call identity.');
            exec.signal.throwIfAborted();
            prune();
            const key = JSON.stringify([sessionId, exec.callId]);
            const fingerprint = JSON.stringify([args.targetPreset ?? null, args.lang ?? null]);
            const recorded = records.get(key);
            if (recorded) {
                if (recorded.fingerprint !== fingerprint)
                    throw new Error('The same Bridge call cannot be replayed with different parameters.');
                return recorded.promise;
            }
            if (preparingSessions.has(sessionId))
                throw new Error('A Bridge preview is already in progress for this session. Wait for it to finish.');
            const signal = AbortSignal.any([exec.signal, lifecycle.signal]);
            preparingSessions.add(sessionId);
            // Install the identity/lock before entering any user-supplied asynchronous handler.
            const record = { fingerprint, at: now(), settled: false, promise: undefined };
            records.set(key, record);
            const operation = Promise.resolve().then(async () => {
                signal.throwIfAborted();
                const rawInput = [args.targetPreset, args.lang ? `--lang ${args.lang}` : undefined].filter(Boolean).join(' ');
                const result = await deps.handler({ agent: { session: { id: sessionId } }, rawInput, signal });
                // A handler may finish despite cancellation. Such a preview must never become actionable.
                signal.throwIfAborted();
                if (disposed)
                    throw new Error('Bridge was unloaded before preparation finished.');
                const outcome = { kind: result.kind, text: result.text ?? '' };
                if (outcome.kind === 'success')
                    exec.concludeTurn?.();
                return outcome;
            }).finally(() => {
                preparingSessions.delete(sessionId);
                record.settled = true;
                active.delete(operation);
                prune();
            });
            record.promise = operation;
            active.add(operation);
            return operation;
        },
    };
    return {
        tool,
        dispose() {
            if (disposal)
                return disposal;
            disposed = true;
            lifecycle.abort(new Error('Bridge was unloaded; preparation aborted.'));
            disposal = Promise.allSettled([...active]).then(() => { records.clear(); preparingSessions.clear(); });
            return disposal;
        },
    };
}
