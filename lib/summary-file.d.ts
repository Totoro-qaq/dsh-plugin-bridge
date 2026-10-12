/** 把摘要写进系统临时目录。失败时抛出原始错误，由调用方决定怎么告诉用户。 */
export declare function writeSummaryFile(sessionId: string, summary: string): string;
/**
 * 删除 Bridge 自己创建的摘要文件及其空目录。
 *
 * 路径必须是临时目录里、名为 `dsh-bridge-*` 的真实目录中的普通 `summary-*.md` 文件。
 * 符号链接、越界路径和用户另行保存的文件一律不动。清理失败不抛出。
 */
export declare function removeOwnedSummaryFile(file: string): void;
