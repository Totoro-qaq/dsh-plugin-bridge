/** 交接中的记录超过这个时间，或者同一台机器上的持有进程已经退出，就可以接手。 */
export declare const SUMMARY_CLAIM_STALE_MS: number;
/** 已送达、以及建好会话但没送达的记录挡住再迁的时间，和待确认预览的保留时间一致。 */
export declare const SUMMARY_RECORD_TTL_MS: number;
/**
 * 把两条路径收成同一身份。
 * 文件还在时用真实路径，这样 `/var` 与 `/private/var`、目录符号链接和 `..` 会对上；
 * 文件已经不在时退回规范化后的绝对路径。Windows 上大小写和分隔符都收成同一把钥匙。
 */
export declare function summaryPathKey(file: string): string;
/** 两条路径是不是同一份摘要。供 `--file` 和待确认预览对账，避免只做字符串全等。 */
export declare function sameSummaryPath(left: string, right: string): boolean;
/** 把摘要写进系统临时目录。失败时抛出原始错误，由调用方决定怎么告诉用户。 */
export declare function writeSummaryFile(sessionId: string, summary: string): string;
/**
 * 删除本进程写出来的那份摘要，以及随之变空的临时目录。
 * 没有登记的路径（用户自己的 `--file`、另一个进程写的预览）原样留下；
 * 登记过但现在已经不是当初那个普通文件，或者正文被改过时，文件归用户，留下并忘掉登记。
 */
export declare function removeOwnedSummaryFile(file: string): void;
/** 认领被拒绝的原因。`held` 表示目标会话已经建好，但 kickoff 没有送达。 */
export type SummaryClaimDenied = 'delivered' | 'held' | 'busy' | 'unavailable';
/** 迁移开始前拿到的认领。三个方法只有第一次调用生效。 */
export interface SummaryClaim {
    /** 接手的是一次没有正常结束的交接（例如进程中途被中断），那次可能已经建好了目标会话。 */
    readonly interrupted: boolean;
    /** 交接在建出目标会话之前失败：删掉自己的记录，之后可以再迁。 */
    release(): void;
    /** 已送达。返回 false 表示记录在交接期间被别的进程换掉了，可能多出一个目标会话。 */
    complete(): boolean;
    /** 目标会话已建好但没送达：保留记录，挡住再迁。返回值同 `complete`。 */
    seal(): boolean;
}
/**
 * 迁移开始前认领这份摘要。另一个进程正在交接、已经送达或建好会话但没送达时返回拒绝原因；
 * 记录目录不可用时也拒绝，不在没有记录的情况下开始迁移。
 * 过期记录只用整份替换接手，不会先删掉。
 */
export declare function claimSummaryFile(file: string): SummaryClaim | SummaryClaimDenied;
/**
 * 认领出过意外时附在结果里的提醒。`lost`：交接期间记录被别的进程换掉；
 * `interrupted`：接手的是一次没有正常结束的交接。
 */
export declare function claimWarning(kind: 'lost' | 'interrupted', lang: 'zh' | 'en'): string;
