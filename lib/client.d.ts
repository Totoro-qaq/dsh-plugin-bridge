/** Official WebUI half: one native `/bridge` command card, not a second WebUI. */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client';
import type { CommandRowProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import { type BridgeOutcome } from './client-contract.ts';
interface BridgeInjected {
    readonly execute: (sessionId: SessionId, line: string) => Promise<BridgeOutcome>;
    readonly openSession: (sessionId: SessionId) => Promise<void>;
}
type BridgeCommandCardProps = CommandRowProps & BridgeInjected;
/** Rich renderer for the durable command lifecycle keyed by name and isolated from every other plugin. */
export declare function BridgeCommandCard(props: BridgeCommandCardProps): import("react").JSX.Element;
/** Client services are supplied by the official WebUI module table. */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export {};
