/** 超过这个时间的旧临时摘要，才允许跨进程按所有权标记清掉。 */
export declare const SUMMARY_FILE_MAX_AGE_MS: number;
/** 已送达标记的有效期，和待确认预览的保留时间一致。 */
export declare const DELIVERED_MARKER_TTL_MS: number;
/** 迁移占位和读取租约超过这个时间，别的进程可以接手或清扫。 */
export declare const SUMMARY_CLAIM_STALE_MS: number;
/**
 * 把两条路径收成同一身份。
 * 文件还在时用真实路径，这样 `/var` 与 `/private/var`、目录符号链接和 `..` 会对上；
 * 文件已经不在时退回规范化后的绝对路径。Windows 上大小写和分隔符都收成同一把钥匙。
 */
export declare function summaryPathKey(file: string): string;
/** 两条路径是不是同一份摘要。供 `--file` 和过期预览对账，避免只做字符串全等。 */
export declare function sameSummaryPath(left: string, right: string): boolean;
/** 这次调用还拿着摘要。7 天清扫会跳过它，直到配平的 `noteSummaryIdle`。 */
export declare function noteSummaryInUse(file: string): void;
/** 放开一次 `noteSummaryInUse`。传入当时占住的路径；文件后来被删掉也按同一把钥匙减。 */
export declare function noteSummaryIdle(file: string): void;
/** 把摘要写进系统临时目录。失败时抛出原始错误，由调用方决定怎么告诉用户。 */
export declare function writeSummaryFile(sessionId: string, summary: string): string;
/**
 * 删除本进程创建的那份摘要及其空目录。
 *
 * 路径必须已经由 `writeSummaryFile` 登记，并且仍是临时目录里、名为 `dsh-bridge-*`
 * 的真实目录中的普通 `summary-*.md` 文件。用户传入的 `--file` / `--summary-file`
 * 只要不是这次进程写出来的，就原样留下。
 */
export declare function removeOwnedSummaryFile(file: string): void;
/**
 * 清掉系统临时目录里、超过 maxAgeMs、并且是本工具写过的临时摘要。
 *
 * 只进入名字以 `dsh-bridge-` 开头的真实目录，只删除其中带所有权标记（或本进程登记）
 * 的普通 `summary-*.md`。用户自己放进去的同名文件留下。本进程正在读取的、
 * 磁盘上还有未过期租约或交接占位的、以及 `preserveFile`，即使超龄也跳过。
 * 不跟随符号链接，不递归。只有这次清扫刚删过摘要、
 * 目录因此变空时才删目录。
 */
export declare function sweepAgedSummaryFiles(maxAgeMs?: number, now?: number, preserveFile?: string): void;
/**
 * 记下这份摘要已经交接成功。标记放在临时目录的固定位置，不跟摘要文件一起删，
 * 这样另一个进程（例如先 CLI 再 WebUI）在保留期内还能认出它。
 * 文件还在时同时记下真实路径和规范化路径，删掉之后仍能对上。
 */
export declare function markSummaryDelivered(file: string, now?: number): void;
/** 保留期内，这份摘要是不是已经交接过。时钟由调用方传入，便于和预览有效期对齐。 */
export declare function summaryAlreadyDelivered(file: string, now?: number): boolean;
/** 迁移开始前占住的摘要。成功后变成已送达标记，失败则放开，会话建好但没送达则改成保留。 */
export interface SummaryClaim {
    release(): void;
    complete(at?: number): void;
    seal(at?: number): void;
}
/**
 * 在迁移开始前独占这份摘要。两个进程不能同时越过「还没送达」的检查。
 * 返回的句柄在送达时改成数字标记，在会话已创建但没送达时改成保留标记，失败则删掉自己的占位。
 * 新鲜的保留标记对别的进程来说和已经送达一样。锁不上目录时失败关闭，不开始迁移。
 */
export declare function claimSummaryFile(file: string, now?: number): SummaryClaim | 'delivered' | 'busy' | 'unavailable';
