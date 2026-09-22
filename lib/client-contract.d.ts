/** Pure wire-to-view helpers shared by the native WebUI card and Node tests. */
export declare const MAX_EDITED_SUMMARY_CHARS = 24000;
export type BridgeOutcome = {
    kind: 'success' | 'error';
    text?: string;
} | null;
export type BridgeCard = {
    phase: 'running';
} | {
    phase: 'preview';
    lang: 'zh' | 'en';
    sourcePreset: string;
    targetPreset: string;
    previewId?: string;
    summary: string;
    summaryFile?: string;
    stats: string;
    warnings: string[];
} | {
    phase: 'migrated';
    lang: 'zh' | 'en';
    targetPreset: string;
    title: string;
    sessionId: string;
    details: string[];
    warnings: string[];
} | {
    phase: 'error';
    text: string;
    picker?: BridgeTargetPicker;
} | {
    phase: 'message';
    text: string;
    lang: 'zh' | 'en';
    picker?: BridgeTargetPicker;
};
/** Target presets a `/bridge` usage block offers, rendered as one-click preview buttons. */
export interface BridgeTargetPicker {
    lang: 'zh' | 'en';
    targets: string[];
    current?: string;
}
export type BridgeTextSectionKey = 'goal' | 'currentState' | 'keyDecisions' | 'keyFiles' | 'nextStep';
export interface BridgeTextSection {
    key: BridgeTextSectionKey;
    label: string;
    kind: 'text' | 'list';
    /** Plain-text editor value. List markers are intentionally omitted. */
    text: string;
    /** Exact source span replaced when this field is edited. */
    bodyStart: number;
    bodyEnd: number;
    items?: BridgeTextListItem[];
    listStyle?: BridgeListStyle;
    textStyle?: 'plain' | 'bullets';
}
type BridgeListStyle = 'bullet' | 'ordered' | 'plain';
export interface BridgeTextListItem {
    text: string;
    contentStart: number;
    contentEnd: number;
    itemStart: number;
    itemEnd: number;
    /** Exact Markdown marker retained when this item is edited. */
    marker?: string;
    /** Original indentation for wrapped lines, kept when that item is edited. */
    continuationPrefixes?: string[];
}
export interface BridgeTextProjection {
    lang: 'zh' | 'en';
    /** The untouched Markdown document used to enter text mode. */
    markdown: string;
    lineEnding: '\n' | '\r\n';
    sections: BridgeTextSection[];
    /** Known appendices are visible but read-only in plain-text mode. */
    opaqueSuffix: string;
}
/**
 * Project only Bridge's exact bilingual five-section schema into plain fields.
 * Unknown structure fails closed; known visual appendices remain opaque Markdown.
 */
export declare function parseBridgeTextProjection(markdown: string): BridgeTextProjection | undefined;
/** Replace one editable body while preserving every byte outside that section. */
export declare function replaceBridgeTextSection(projection: BridgeTextProjection, key: BridgeTextSectionKey, plainText: string): string;
/** Replace one list item without rewriting siblings and while retaining wrapped-line indentation. */
export declare function replaceBridgeTextListItem(projection: BridgeTextProjection, key: BridgeTextSectionKey, index: number, plainText: string): string;
/** Remove exactly one original list-item span. */
export declare function removeBridgeTextListItem(projection: BridgeTextProjection, key: BridgeTextSectionKey, index: number): string;
/** Append one item using the section's existing Markdown list convention. */
export declare function appendBridgeTextListItem(projection: BridgeTextProjection, key: BridgeTextSectionKey, plainText: string): string;
/** Map the official WebUI document language onto Bridge's supported UI copy. */
export declare function uiLanguageOf(documentLang: string | undefined): 'zh' | 'en';
/**
 * Read the target list of a `/bridge` usage block. Anything unexpected returns
 * undefined so the card shows plain text instead: after an in-place upgrade
 * this client can face an older server half whose wording differs.
 */
export declare function parseBridgeTargets(text: string): BridgeTargetPicker | undefined;
/** Convert one durable `/bridge` outcome into the native card's view model. */
export declare function parseBridgeCard(outcome: BridgeOutcome): BridgeCard;
/** Return a value only when the complete editor document is valid JSON. */
export declare function parseJsonDocument(text: string): object | unknown[] | undefined;
/** Client service that owns main-view navigation in the official WebUI (`openSession` since DSH 0.1.5-alpha.2). */
export declare const BRIDGE_NAVIGATION_SERVICE = "uiWorkspace";
/** How long the card waits for a created target to reach this browser's session list. */
export declare const BRIDGE_SESSION_VISIBLE_TIMEOUT_MS = 5000;
/** The `uiWorkspace.openSession` face; DSH 0.1.6-alpha.2 widened its parameter to `SessionTarget`. */
export interface BridgeSessionNavigator {
    openSession(target: string): void;
}
/** The session-list face every supported WebUI exposes as `ctx.sessions.list`. */
export interface BridgeSessionList {
    getSnapshot(): {
        readonly byId: object;
    };
    subscribe(listener: () => void): () => void;
}
/**
 * The parts of a WebUI client Cordis context that session navigation reads.
 * The client module injects only `sessions`; the navigation service is read
 * through `get()` so hosts without it still activate the module.
 */
export interface BridgeNavigationContext {
    /** Cordis `ctx.get()`: reads a service without the inject requirement, or undefined when none is active. */
    get?(name: string): unknown;
    readonly sessions: {
        readonly list: BridgeSessionList;
        /** Present from DSH 0.1.0 through 0.1.6-alpha.1; removed in 0.1.6-alpha.2. */
        open?(id: string): void;
    };
}
/** Which host path opened the target session. */
export type BridgeSessionRoute = 'uiWorkspace.openSession' | 'sessions.open';
export interface BridgeSessionOpenOptions {
    lang: 'zh' | 'en';
    /** Stops the visibility wait, for example when the plugin fiber disposes. */
    signal?: AbortSignal;
    timeoutMs?: number;
}
/** Resolve the host navigation service when it is active; never throws for an absent service. */
export declare function bridgeSessionNavigator(ctx: BridgeNavigationContext): BridgeSessionNavigator | undefined;
/** The routes this host offers, in the order Bridge tries them. */
export declare function bridgeSessionRoutes(ctx: BridgeNavigationContext): BridgeSessionRoute[];
/**
 * Show one session that is already in the session list. DSH 0.1.6-alpha.2
 * navigates through `uiWorkspace.openSession`; older hosts use `sessions.open`,
 * which also remains the fallback when the navigation service throws.
 * @returns the route that opened the session.
 * @throws {Error} a localized error when no route exists or every route failed.
 */
export declare function openBridgeSession(ctx: BridgeNavigationContext, sessionId: string, lang: 'zh' | 'en'): BridgeSessionRoute;
/** Resolve once `sessionId` is listed; reject on timeout or abort, always releasing the subscription and timer. */
export declare function waitForBridgeSession(list: BridgeSessionList, sessionId: string, { lang, signal, timeoutMs }: BridgeSessionOpenOptions): Promise<void>;
/**
 * Wait until a created target reaches this browser's session list, then open it.
 * Fails fast with a localized error when the host offers no navigation route.
 */
export declare function openBridgeSessionWhenVisible(ctx: BridgeNavigationContext, sessionId: string, options: BridgeSessionOpenOptions): Promise<BridgeSessionRoute>;
/**
 * Build the preview command a picker button submits, equal to typing it.
 * Only English adds `--lang`: a Chinese usage block is also what the default
 * `auto` language prints, and auto must keep detecting the summary language.
 */
export declare function buildBridgePreviewCommand(targetPreset: string, lang: 'zh' | 'en'): string;
/** Build the hidden-input-safe command used by the native editor confirmation. */
export declare function buildBridgeMigrationCommand(targetPreset: string, summary: string, lang: 'zh' | 'en', previewId: string, options?: {
    autoContinue?: boolean;
}): string;
export {};
