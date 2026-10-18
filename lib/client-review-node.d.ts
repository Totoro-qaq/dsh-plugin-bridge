/** Bridge-only review projection, outside the Host's collapsed process details. */
import type { ConversationLocation, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { type BridgeOutcome } from './client-contract.ts';
export interface BridgeReviewData {
    readonly outcome: Exclude<BridgeOutcome, null>;
}
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
    interface ChatNodeDataMap {
        'dsh-bridge-review': BridgeReviewData;
    }
}
interface Review {
    readonly owner: 'native' | 'ptc';
    readonly callId: string;
    readonly result?: BridgeReviewData & {
        readonly seq: number;
        readonly location: ConversationLocation;
    };
}
/** Nonexclusive observer: native Tool/PTC records and their original view remain untouched. */
export declare function createBridgeReviewDefinition(): ConversationNodeDefinition<Review>;
export {};
