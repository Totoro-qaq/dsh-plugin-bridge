/** Optional model entry: prepare a human-reviewed handoff, never execute one. */
import type { BridgeInvocation, BridgeResult } from './command.ts';
interface ToolExecution {
    readonly agent?: {
        readonly id?: string;
        readonly session?: {
            readonly id?: string;
            readonly header?: {
                readonly id?: string;
            };
        };
    };
    readonly callId: string;
    readonly signal: AbortSignal;
    /** A Host-owned marker for this successful tool result, not a global pause. */
    concludeTurn?(): void;
}
type Outcome = {
    kind: 'success' | 'error';
    text: string;
};
type Content = Array<{
    type: 'text';
    text: string;
}>;
/** Public ToolDefinition shape, deliberately without a runtime SDK import. */
export interface BridgePrepareTool {
    readonly name: 'bridge_prepare';
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    readonly output: {
        readonly schema: Record<string, unknown>;
        render(args: unknown, value: Outcome): Content;
        presentationMeta(args: unknown, value: Outcome): {
            bridge: {
                version: 1;
                outcome: Outcome;
            };
        };
    };
    execute(args: unknown, exec: ToolExecution): Promise<Outcome>;
}
export interface BridgeNaturalLanguage {
    readonly tool: BridgePrepareTool;
    /** Abort new work, then wait for all owned preparation calls to settle. */
    dispose(): Promise<void>;
}
/** Share the command's pending-preview table instead of creating another migration engine. */
export declare function createBridgeNaturalLanguage(deps: {
    handler: (invocation: BridgeInvocation) => Promise<BridgeResult>;
    workerSessionIds: ReadonlySet<string>;
    now?: () => number;
}): BridgeNaturalLanguage;
export {};
