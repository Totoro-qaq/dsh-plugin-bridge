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
    summary: string;
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
} | {
    phase: 'message';
    text: string;
    lang: 'zh' | 'en';
};
/** Convert one durable `/bridge` outcome into the native card's view model. */
export declare function parseBridgeCard(outcome: BridgeOutcome): BridgeCard;
/** Return a value only when the complete editor document is valid JSON. */
export declare function parseJsonDocument(text: string): object | unknown[] | undefined;
/** Build the hidden-input-safe command used by the native editor confirmation. */
export declare function buildBridgeMigrationCommand(targetPreset: string, summary: string): string;
