/** Official WebUI half: one native `/bridge` command card, not a second WebUI. */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client';
import type { ChatNodeViewProps, CommandRowProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client';
import { type BridgeLauncher, type BridgeSessionMenuAction } from './client-entrypoints.ts';
import { type BridgeOutcome } from './client-contract.ts';
interface BridgeInjected {
    readonly execute: (sessionId: SessionId, line: string) => Promise<BridgeOutcome>;
    readonly openSession: (sessionId: SessionId, lang: 'zh' | 'en') => Promise<void>;
}
type BridgeCommandCardProps = CommandRowProps & BridgeInjected;
/** 礼貌播报区先空着挂上，文案在挂载后写入，这样第一次变化也会被读屏读到。 */
export declare function PoliteStatus({ text }: {
    text: string;
}): import("react").JSX.Element;
/** No resident chrome: only a failed menu/shortcut launch contributes an inline retry. */
export declare function BridgeEntryNotice({ launcher, sessionId, language }: {
    launcher: BridgeLauncher;
    sessionId: SessionId;
    language?: 'zh' | 'en';
}): import("react").JSX.Element | null;
type BridgeToolCardProps = ToolCallViewProps & BridgeInjected;
interface BridgeSessionMenuInjected {
    readonly launcher: BridgeLauncher;
    readonly menu: BridgeSessionMenuAction;
    readonly subscribe: (listener: () => void) => () => void;
}
/** The public row menu stays useful when the Host's + menu filters argument-taking commands. */
export declare function BridgeSessionMenuItem({ launcher, menu, subscribe, sessionId, useMenuOpenState, language }: PropsRuntime<'sidebar.workspaces.session.menu.item'> & BridgeSessionMenuInjected & {
    language?: 'zh' | 'en';
}): import("react").JSX.Element | null;
/** Natural-language invocation only prepares; the same trusted preview still needs a human click. */
export declare function BridgeToolCard(props: BridgeToolCardProps): import("react").JSX.Element;
/** Same pending review, projected outside collapsed Tool/process rows. */
export declare function BridgeReviewNode(props: ChatNodeViewProps<'dsh-bridge-review'> & BridgeInjected): import("react").JSX.Element;
/** Rich renderer for the durable command lifecycle keyed by name and isolated from every other plugin. */
export declare function BridgeCommandCard(props: BridgeCommandCardProps): import("react").JSX.Element;
/** Client services are supplied by the official WebUI module table. */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export {};
