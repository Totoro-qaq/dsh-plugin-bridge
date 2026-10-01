import type { BridgeCommandConfig, BridgeResult } from './command.ts';
import type { BridgeHost } from './host.ts';
export interface PlanReviewRequest {
    agent?: {
        session?: {
            id?: string;
            header?: {
                id?: string;
            };
        };
    };
    questions?: readonly unknown[];
    signal?: AbortSignal;
}
export interface PlanApprovalInvocation {
    sessionId: string;
    approvePlan64?: string;
    approvedPlanId?: string;
    preset?: string;
    lang: 'zh' | 'en';
    signal?: AbortSignal;
}
export interface PlanApprovalBridge {
    observe(request: PlanReviewRequest, next: () => Promise<unknown>): Promise<unknown>;
    execute(input: PlanApprovalInvocation): Promise<BridgeResult>;
    dispose(): void;
}
/** Observe the public question waterfall without answering ordinary reviews or changing their options. */
export declare function createPlanApprovalBridge(deps: {
    hostFor: (signal?: AbortSignal) => BridgeHost;
    config: BridgeCommandConfig;
    now?: () => number;
}): PlanApprovalBridge;
