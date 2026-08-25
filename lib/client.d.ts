/** Official WebUI half: one native `/bridge` command card, not a second WebUI. */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client';
import { type BridgeOutcome } from './client-contract.ts';
interface BridgeInjected {
    readonly execute: (sessionId: SessionId, line: string) => Promise<BridgeOutcome>;
    readonly openSession: (sessionId: SessionId) => Promise<void>;
}
type BridgeCommandCardProps = PropsRuntime<'conversation.chat.commandview'> & BridgeInjected;
/** Rich renderer for the durable command lifecycle keyed by name and isolated from every other plugin. */
export declare function BridgeCommandCard(props: BridgeCommandCardProps): import("react").JSX.Element;
/** Client services are supplied by the official WebUI module table. */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export {};
