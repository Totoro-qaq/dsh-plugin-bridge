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
} | {
    phase: 'message';
    text: string;
    lang: 'zh' | 'en';
};
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
    listStyle?: 'bullet' | 'plain';
    textStyle?: 'plain' | 'bullets';
}
export interface BridgeTextListItem {
    text: string;
    contentStart: number;
    contentEnd: number;
    itemStart: number;
    itemEnd: number;
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
/** Append one item using the section's existing bullet/plain convention. */
export declare function appendBridgeTextListItem(projection: BridgeTextProjection, key: BridgeTextSectionKey, plainText: string): string;
/** Map the official WebUI document language onto Bridge's supported UI copy. */
export declare function uiLanguageOf(documentLang: string | undefined): 'zh' | 'en';
/** Convert one durable `/bridge` outcome into the native card's view model. */
export declare function parseBridgeCard(outcome: BridgeOutcome): BridgeCard;
/** Return a value only when the complete editor document is valid JSON. */
export declare function parseJsonDocument(text: string): object | unknown[] | undefined;
/** Build the hidden-input-safe command used by the native editor confirmation. */
export declare function buildBridgeMigrationCommand(targetPreset: string, summary: string, lang: 'zh' | 'en', previewId: string): string;
