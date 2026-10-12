/**
 * 预览摘要的临时文件。
 *
 * 只给「改完再执行」用。写失败必须把原因交回去，不能吞掉。
 * 清理只删除本进程 `writeSummaryFile` 登记过的那一份；名字和位置像临时摘要
 * 并不足以授权删除。符号链接一律不动。清理失败不抛出。
 */
import { lstatSync, mkdtempSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
const TEMP_PREFIX = 'dsh-bridge-';
/** 本进程创建过的摘要文件的真实路径。进程退出后自然失效。 */
const createdFiles = new Set();
/**
 * 把两条路径收成同一身份。
 * 文件还在时用真实路径，这样 `/var` 与 `/private/var`、目录符号链接和 `..` 会对上；
 * 文件已经不在时退回规范化后的绝对路径。
 */
export function summaryPathKey(file) {
    try {
        return realpathSync(file);
    }
    catch {
        return resolve(file);
    }
}
/** 两条路径是不是同一份摘要。供 `--file` 和过期预览对账，避免只做字符串全等。 */
export function sameSummaryPath(left, right) {
    return summaryPathKey(left) === summaryPathKey(right);
}
/** 把摘要写进系统临时目录。失败时抛出原始错误，由调用方决定怎么告诉用户。 */
export function writeSummaryFile(sessionId, summary) {
    const safeId = sessionId.replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 12) || 'session';
    const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX));
    const file = join(dir, `summary-${safeId}.md`);
    writeFileSync(file, summary, 'utf8');
    createdFiles.add(realpathSync(file));
    return file;
}
/**
 * 删除本进程创建的那份摘要及其空目录。
 *
 * 路径必须已经由 `writeSummaryFile` 登记，并且仍是临时目录里、名为 `dsh-bridge-*`
 * 的真实目录中的普通 `summary-*.md` 文件。用户传入的 `--file` / `--summary-file`
 * 只要不是这次进程写出来的，就原样留下。
 */
export function removeOwnedSummaryFile(file) {
    try {
        const fileStat = lstatSync(file);
        if (!fileStat.isFile() || fileStat.isSymbolicLink())
            return;
        if (!/^summary-[A-Za-z0-9_-]{1,64}\.md$/u.test(basename(file)))
            return;
        const tempRoot = realpathSync(tmpdir());
        const resolvedFile = realpathSync(file);
        const resolvedDir = dirname(resolvedFile);
        const dirStat = lstatSync(resolvedDir);
        if (!dirStat.isDirectory() || dirStat.isSymbolicLink())
            return;
        if (!createdFiles.has(resolvedFile))
            return;
        const rel = relative(tempRoot, resolvedDir);
        if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
            return;
        if (!basename(resolvedDir).startsWith(TEMP_PREFIX))
            return;
        rmSync(resolvedFile);
        createdFiles.delete(resolvedFile);
        try {
            // rmSync 默认拒绝目录。空目录用 rmdir，非空则留下，不递归删除。
            rmdirSync(resolvedDir);
        }
        catch {
            // 目录里如果还有别的东西，就留下目录。
        }
    }
    catch {
        // 文件已经不在，或临时目录中途变了：清理不能影响迁移结果。
    }
}
