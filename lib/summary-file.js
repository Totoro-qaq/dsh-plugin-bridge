/**
 * 预览摘要的临时文件，以及「这份摘要正在交接 / 已经交接」的跨进程记录。
 *
 * 写失败必须把原因交回去，不能吞掉。删除只认本进程写出来、inode 也没变的那一份，清理失败不抛出。
 * 跨进程只做检测：别的进程正在交接、已经送达或建好会话但没送达时，认领会给出明确的拒绝原因。
 * 两个进程同时接手同一份过期记录这种少见的竞争不在这里彻底排除，
 * 交接结束时 `complete` / `seal` 会发现自己的记录被换掉，由调用方报告给用户。
 */
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const TEMP_PREFIX = 'dsh-bridge-';
/** 共享的 /tmp 里每个用户各用一个目录，另一个用户也在用 Bridge 时互不挡路。 */
const CLAIM_DIR_NAME = `dsh-bridge-claims${typeof process.getuid === 'function' ? `-${process.getuid()}` : ''}`;
/** 交接中的记录超过这个时间，或者同一台机器上的持有进程已经退出，就可以接手。 */
export const SUMMARY_CLAIM_STALE_MS = 10 * 60 * 1000;
/** 已送达、以及建好会话但没送达的记录挡住再迁的时间，和待确认预览的保留时间一致。 */
export const SUMMARY_RECORD_TTL_MS = 30 * 60 * 1000;
/** 早已失效的记录和中途留下的临时文件，超过这个时间就在下一次认领时清掉。 */
const RECORD_PRUNE_MS = 24 * 60 * 60 * 1000;
const RECORD_NAME = /^[0-9a-f]{64}(\.[0-9a-f]{16}\.tmp)?$/u;
const HOST_ID = createHash('sha256').update(hostname()).digest('hex').slice(0, 12);
/**
 * 本进程写出来的摘要：路径身份 → 创建时的 dev:ino 和正文摘要。
 * 被删后在同一路径重建、或者用户改过内容的文件都对不上，不会被删。
 */
const created = new Map();
function inodeKey(st) {
    return `${st.dev}:${st.ino}`;
}
function digestOf(text) {
    return createHash('sha256').update(text).digest('hex');
}
/**
 * 把两条路径收成同一身份。
 * 文件还在时用真实路径，这样 `/var` 与 `/private/var`、目录符号链接和 `..` 会对上；
 * 文件已经不在时退回规范化后的绝对路径。Windows 上大小写和分隔符都收成同一把钥匙。
 */
export function summaryPathKey(file) {
    let key;
    try {
        key = realpathSync(file);
    }
    catch {
        key = resolve(file);
    }
    return process.platform === 'win32' ? key.toLowerCase() : key;
}
/** 两条路径是不是同一份摘要。供 `--file` 和待确认预览对账，避免只做字符串全等。 */
export function sameSummaryPath(left, right) {
    return summaryPathKey(left) === summaryPathKey(right);
}
/** 把摘要写进系统临时目录。失败时抛出原始错误，由调用方决定怎么告诉用户。 */
export function writeSummaryFile(sessionId, summary) {
    const safeId = sessionId.replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 12) || 'session';
    const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX));
    const file = join(dir, `summary-${safeId}.md`);
    writeFileSync(file, summary, 'utf8');
    try {
        created.set(summaryPathKey(file), { inode: inodeKey(lstatSync(file)), digest: digestOf(summary) });
    }
    catch {
        // 正文已经写好。登记不上只是事后不自动删除，不能让调用方以为摘要没有保存。
    }
    return file;
}
/**
 * 删除本进程写出来的那份摘要，以及随之变空的临时目录。
 * 没有登记的路径（用户自己的 `--file`、另一个进程写的预览）原样留下；
 * 登记过但现在已经不是当初那个普通文件，或者正文被改过时，文件归用户，留下并忘掉登记。
 */
export function removeOwnedSummaryFile(file) {
    const key = summaryPathKey(file);
    const entry = created.get(key);
    if (entry === undefined)
        return;
    try {
        const st = lstatSync(key);
        if (!st.isFile() || inodeKey(st) !== entry.inode || digestOf(readFileSync(key, 'utf8')) !== entry.digest) {
            created.delete(key);
            return;
        }
        unlinkSync(key);
        created.delete(key);
    }
    catch (error) {
        // 暂时没有权限时保留登记，权限恢复后还能删。
        if (error.code === 'ENOENT')
            created.delete(key);
        return;
    }
    try {
        rmdirSync(dirname(key));
    }
    catch { /* 目录里还有别的东西 */ }
}
function recordText(state, token, at = Date.now()) {
    return `${state} ${at} ${token} ${process.pid} ${HOST_ID}\n`;
}
function parseRecord(text) {
    const match = /^(claim|held|delivered) (\d+) ([0-9a-f]{16}) (\d+) ([0-9a-f]{12})\n?$/u.exec(text);
    if (!match)
        return undefined;
    return { state: match[1], at: Number(match[2]), token: match[3], pid: Number(match[4]), host: match[5] };
}
function readRecord(path) {
    try {
        return parseRecord(readFileSync(path, 'utf8'));
    }
    catch {
        return undefined;
    }
}
/** 只认同一台机器上确定已经退出的进程。别的机器、没有权限探测的进程都按还活着算。 */
function holderExited(record) {
    if (record.host !== HOST_ID)
        return false;
    try {
        process.kill(record.pid, 0);
        return false;
    }
    catch (error) {
        return error.code === 'ESRCH';
    }
}
function inspectRecord(path, now) {
    let st;
    try {
        st = lstatSync(path);
    }
    catch (error) {
        return error.code === 'ENOENT' ? 'absent' : 'busy';
    }
    // 符号链接和目录不是本工具写的记录，不接手也不删。
    if (!st.isFile())
        return 'busy';
    const record = readRecord(path);
    if (!record) {
        // 刚用 O_EXCL 建好、还没写进内容的记录也是空的，按正在交接算；放久了才是崩溃留下的。
        return Math.abs(now - st.mtimeMs) < SUMMARY_CLAIM_STALE_MS ? 'busy' : 'stale';
    }
    const age = Math.abs(now - record.at);
    if (record.state === 'claim')
        return age < SUMMARY_CLAIM_STALE_MS && !holderExited(record) ? 'busy' : 'stale';
    return age < SUMMARY_RECORD_TTL_MS ? record.state : 'stale';
}
/** 先写完整的临时文件再整份换上去，读的一方要么看到旧记录，要么看到新记录。 */
function replaceRecord(path, text) {
    const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
    try {
        writeFileSync(temp, text, { flag: 'wx', mode: 0o600 });
        renameSync(temp, path);
        return true;
    }
    catch {
        try {
            unlinkSync(temp);
        }
        catch { /* 临时文件没有建成 */ }
        return false;
    }
}
function claimDirectory() {
    try {
        const dir = join(realpathSync(tmpdir()), CLAIM_DIR_NAME);
        try {
            mkdirSync(dir, { mode: 0o700 });
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                return undefined;
        }
        const st = lstatSync(dir);
        if (!st.isDirectory())
            return undefined;
        // 共享的 /tmp 里，别的用户预先建好的同名目录不能拿来放记录。
        if (typeof process.getuid === 'function' && st.uid !== process.getuid())
            return undefined;
        return dir;
    }
    catch {
        return undefined;
    }
}
function pruneRecords(dir) {
    const cutoff = Date.now() - RECORD_PRUNE_MS;
    let names;
    try {
        names = readdirSync(dir);
    }
    catch {
        return;
    }
    for (const name of names) {
        if (!RECORD_NAME.test(name))
            continue;
        const path = join(dir, name);
        try {
            const st = lstatSync(path);
            if (!st.isDirectory() && st.mtimeMs < cutoff)
                unlinkSync(path);
        }
        catch { /* 别的进程已经清过 */ }
    }
}
function holdClaim(path, token, interrupted = false) {
    let settled = false;
    const settle = (next) => {
        if (settled)
            return true;
        settled = true;
        if (readRecord(path)?.token !== token)
            return false;
        if (next)
            replaceRecord(path, recordText(next, token));
        // 中断过的交接还没有人确认结果，放开时留下一条已过期的 claim，下一次认领照样提醒。
        else if (interrupted)
            replaceRecord(path, recordText('claim', token, 0));
        else
            try {
                unlinkSync(path);
            }
            catch { /* 记录已经不在 */ }
        return true;
    };
    return {
        interrupted,
        release: () => { settle(); },
        complete: () => settle('delivered'),
        seal: () => settle('held'),
    };
}
/**
 * 迁移开始前认领这份摘要。另一个进程正在交接、已经送达或建好会话但没送达时返回拒绝原因；
 * 记录目录不可用时也拒绝，不在没有记录的情况下开始迁移。
 * 过期记录只用整份替换接手，不会先删掉。
 */
export function claimSummaryFile(file) {
    const dir = claimDirectory();
    if (!dir)
        return 'unavailable';
    pruneRecords(dir);
    const path = join(dir, createHash('sha256').update(summaryPathKey(file)).digest('hex'));
    const token = randomBytes(8).toString('hex');
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            writeFileSync(path, recordText('claim', token), { flag: 'wx', mode: 0o600 });
            return holdClaim(path, token);
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                return 'unavailable';
        }
        const kind = inspectRecord(path, Date.now());
        if (kind === 'absent')
            continue;
        if (kind !== 'stale')
            return kind;
        // 过期的 claim 说明那次交接没有走到送达或保留，可能已经建好目标会话；照常接手，但要告诉用户。
        const interrupted = readRecord(path)?.state === 'claim';
        if (!replaceRecord(path, recordText('claim', token)))
            return 'unavailable';
        // 同时接手的另一方如果后换上，这里读回就能看到；更晚的换上由 complete / seal 发现。
        return readRecord(path)?.token === token ? holdClaim(path, token, interrupted) : 'busy';
    }
    return 'busy';
}
/**
 * 认领出过意外时附在结果里的提醒。`lost`：交接期间记录被别的进程换掉；
 * `interrupted`：接手的是一次没有正常结束的交接。
 */
export function claimWarning(kind, lang) {
    if (kind === 'interrupted') {
        return lang === 'en'
            ? 'An earlier handoff of this summary file did not finish normally and may already have created a target session. Check whether there is now a second one.'
            : '之前用这份摘要的一次交接没有正常结束，可能已经建好过目标会话。请检查是否多出了一个目标会话。';
    }
    return lang === 'en'
        ? 'Another Bridge process took over this summary file while this handoff was running. Check whether a second target session was created.'
        : '这次交接进行时，另一个 Bridge 进程也接手了同一份摘要。请检查是否多出了一个目标会话。';
}
