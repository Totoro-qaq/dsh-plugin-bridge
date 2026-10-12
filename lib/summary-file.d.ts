/**
 * 把两条路径收成同一身份。
 * 文件还在时用真实路径，这样 `/var` 与 `/private/var`、目录符号链接和 `..` 会对上；
 * 文件已经不在时退回规范化后的绝对路径。
 */
export declare function summaryPathKey(file: string): string;
/** 两条路径是不是同一份摘要。供 `--file` 和过期预览对账，避免只做字符串全等。 */
export declare function sameSummaryPath(left: string, right: string): boolean;
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
