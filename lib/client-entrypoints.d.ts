/** Optional Host entry points. They only open the existing /bridge picker. */
import type { Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client';
import type { CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client';
export interface BridgeEntrySnapshot {
    readonly busy: boolean;
    readonly error: string;
}
export interface BridgeLauncher {
    subscribe(listener: () => void): () => void;
    snapshotFor(sessionId: string): BridgeEntrySnapshot;
    launch(sessionId: string): Promise<boolean>;
    dispose(): void;
}
export interface BridgeSessionMenuAction {
    available(sessionId: string): boolean;
    select(sessionId: string, close: () => void): boolean;
    dispose(): void;
}
/** The Session row owns its menu state; Bridge owns only this current-row action. */
export declare function createBridgeSessionMenuAction(options: {
    currentSession(): string | undefined;
    conversationVisible(): boolean;
    blocked(): boolean;
    launch(sessionId: string): unknown;
}): BridgeSessionMenuAction;
/** A selected Session identity can still belong to the Host's blank Hero. */
export declare function bridgeEntryUnavailable(state: {
    readonly openState?: string;
    readonly blank?: boolean;
} | undefined, lang: 'zh' | 'en'): string | undefined;
/** The command listbox is allowed; a different visible dialog keeps ownership. */
export declare function hasBridgeEntryDialog(document: Pick<Document, 'querySelectorAll'> | undefined): boolean;
/** Enhance only the Host row's bare pick; argued slash commands remain entirely Host-owned. */
export declare function registerBridgeCommandMenu(commandUi: Pick<CommandUiContract, 'decorate'> | undefined, options: {
    currentSession(): string | undefined;
    conversationVisible(): boolean;
    blocked(): boolean;
    launch(sessionId: string): unknown;
}): () => void;
/** One activation owns its requests, status and listeners; no global input handlers. */
export declare function createBridgeLauncher(options: {
    execute(sessionId: string, line: string): Promise<unknown>;
    allowed?(sessionId: string): boolean;
}): BridgeLauncher;
/** Add an unbound command to DSH keyboard settings; never reserve another feature's keys. */
export declare function registerBridgeShortcut(shortcuts: Pick<Shortcuts, 'register'> | undefined, options: {
    chinese(): boolean;
    currentSession(): string | undefined;
    conversationVisible(): boolean;
    launch(sessionId: string): unknown;
}): () => void;
