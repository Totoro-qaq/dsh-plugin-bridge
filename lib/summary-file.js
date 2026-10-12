/**
 * 预览摘要的临时文件。
 *
 * 只给「改完再执行」用。写失败必须把原因交回去，不能吞掉；
 * 清理只允许删除本模块创建的临时文件，避免误删用户自己的 `--file`。
 */
import { lstatSync, mkdtempSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
const TEMP_PREFIX = 'dsh-bridge-';
/** 把摘要写进系统临时目录。失败时抛出原始错误，由调用方决定怎么告诉用户。 */
export function writeSummaryFile(sessionId, summary) {
    const safeId = sessionId.replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 12) || 'session';
    const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX));
    const file = join(dir, `summary-${safeId}.md`);
    writeFileSync(file, summary, 'utf8');
    return file;
}
/**
 * 删除 Bridge 自己创建的摘要文件及其空目录。
 *
 * 路径必须是临时目录里、名为 `dsh-bridge-*` 的真实目录中的普通 `summary-*.md` 文件。
 * 符号链接、越界路径和用户另行保存的文件一律不动。清理失败不抛出。
 */
export function removeOwnedSummaryFile(file) {
    try {
        const fileStat = lstatSync(file);
        if (!fileStat.isFile() || fileStat.isSymbolicLink())
            return;
        const dir = dirname(file);
        const dirStat = lstatSync(dir);
        if (!dirStat.isDirectory() || dirStat.isSymbolicLink())
            return;
        if (!/^summary-[A-Za-z0-9_-]{1,64}\.md$/u.test(basename(file)))
            return;
        const tempRoot = realpathSync(tmpdir());
        const resolvedDir = realpathSync(dir);
        const rel = relative(tempRoot, resolvedDir);
        if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
            return;
        if (!basename(resolvedDir).startsWith(TEMP_PREFIX))
            return;
        rmSync(file);
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
