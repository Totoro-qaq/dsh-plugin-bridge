/**
 * 预览摘要的临时文件。
 *
 * 只给「改完再执行」用。写失败必须把原因交回去，不能吞掉。
 * 清理只删除本进程 `writeSummaryFile` 登记过的那一份；名字和位置像临时摘要
 * 并不足以授权删除。符号链接一律不动。清理失败不抛出。
 */
import { closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync, type Stats } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const TEMP_PREFIX = 'dsh-bridge-'
const SUMMARY_FILE_NAME = /^summary-[A-Za-z0-9_-]{1,64}\.md$/u
/** 超过这个时间的旧临时摘要，才允许跨进程按目录名清掉。 */
export const SUMMARY_FILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/**
 * 本进程创建过的摘要。路径对应创建时的设备号和 inode：
 * 写完后如果真实路径暂时取不到，规范化路径仍在，文件不会变成孤儿。
 * 父目录后来被换成符号链接时，inode 对不上，不能删到链接对面的文件。
 */
const createdByPath = new Map<string, string>()
const DIR_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0)

function inodeKey(st: Stats): string {
  return `${st.dev}:${st.ino}`
}

function rememberCreated(file: string): void {
  const st = lstatSync(file)
  if (!st.isFile() || st.isSymbolicLink()) return
  const inode = inodeKey(st)
  createdByPath.set(resolve(file), inode)
  try { createdByPath.set(realpathSync(file), inode) } catch { /* 写已经成功，规范化路径够用来事后删除 */ }
}

function createdKeysFor(file: string): string[] {
  const keys = [resolve(file)]
  try { keys.push(realpathSync(file)) } catch { /* 文件可能已经不在 */ }
  return keys
}

/** 路径还登记着，并且现在摸到的 inode 就是创建时的那一个。 */
function inodeMatches(file: string, st: Stats): boolean {
  const actual = inodeKey(st)
  let saw = false
  for (const key of createdKeysFor(file)) {
    const expected = createdByPath.get(key)
    if (expected === undefined) continue
    saw = true
    if (expected !== actual) return false
  }
  return saw
}

function forgetCreated(file: string): void {
  for (const key of createdKeysFor(file)) createdByPath.delete(key)
  createdByPath.delete(resolve(file))
}

/** 外部已经删掉的文件不再占着登记表。权限暂时不够时保留登记。 */
function pruneMissingCreated(): void {
  for (const key of [...createdByPath.keys()]) {
    try {
      lstatSync(key)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') createdByPath.delete(key)
    }
  }
}

function isInsideTemp(dir: string, tempRoot: string): boolean {
  const rel = relative(tempRoot, dir)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) && basename(dir).startsWith(TEMP_PREFIX)
}

/**
 * 在已经打开的真实目录里删除一个普通文件。
 * 目录用 `O_NOFOLLOW` 打开，删除走这个 fd，父目录在检查之后被换成符号链接也不会跟着走。
 */
function unlinkRegularInDir(
  dir: string,
  name: string,
  accept: (st: Stats, realFile: string) => boolean,
): boolean {
  if (!SUMMARY_FILE_NAME.test(name) || name.includes('/') || name.includes('\\')) return false
  let dirFd: number
  try { dirFd = openSync(dir, DIR_FLAGS) } catch { return false }
  try {
    const opened = fstatSync(dirFd)
    const linked = lstatSync(dir)
    if (!opened.isDirectory() || linked.isSymbolicLink()) return false
    if (opened.dev !== linked.dev || opened.ino !== linked.ino) return false
    const fdDir = realpathSync(`/proc/self/fd/${dirFd}`)
    if (fdDir !== dir && fdDir !== realpathSync(dir)) return false
    const viaFd = `/proc/self/fd/${dirFd}/${name}`
    let fileStat: ReturnType<typeof lstatSync>
    try { fileStat = lstatSync(viaFd) } catch { return false }
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) return false
    const realFile = realpathSync(viaFd)
    if (dirname(realFile) !== fdDir) return false
    if (!accept(fileStat, realFile)) return false
    unlinkSync(viaFd)
    return true
  } catch {
    return false
  } finally {
    closeSync(dirFd)
  }
}

/**
 * 把两条路径收成同一身份。
 * 文件还在时用真实路径，这样 `/var` 与 `/private/var`、目录符号链接和 `..` 会对上；
 * 文件已经不在时退回规范化后的绝对路径。
 */
export function summaryPathKey(file: string): string {
  try {
    return realpathSync(file)
  } catch {
    return resolve(file)
  }
}

/** 两条路径是不是同一份摘要。供 `--file` 和过期预览对账，避免只做字符串全等。 */
export function sameSummaryPath(left: string, right: string): boolean {
  return summaryPathKey(left) === summaryPathKey(right)
}

/** 把摘要写进系统临时目录。失败时抛出原始错误，由调用方决定怎么告诉用户。 */
export function writeSummaryFile(sessionId: string, summary: string): string {
  const safeId = sessionId.replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 12) || 'session'
  const dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
  const file = join(dir, `summary-${safeId}.md`)
  writeFileSync(file, summary, 'utf8')
  rememberCreated(file)
  return file
}

/**
 * 删除本进程创建的那份摘要及其空目录。
 *
 * 路径必须已经由 `writeSummaryFile` 登记，并且仍是临时目录里、名为 `dsh-bridge-*`
 * 的真实目录中的普通 `summary-*.md` 文件。用户传入的 `--file` / `--summary-file`
 * 只要不是这次进程写出来的，就原样留下。
 */
export function removeOwnedSummaryFile(file: string): void {
  pruneMissingCreated()
  try {
    const fileStat = lstatSync(file)
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) return
    if (!SUMMARY_FILE_NAME.test(basename(file))) return
    if (!inodeMatches(file, fileStat)) return
    const tempRoot = realpathSync(tmpdir())
    const resolvedFile = realpathSync(file)
    const resolvedDir = dirname(resolvedFile)
    if (!isInsideTemp(resolvedDir, tempRoot)) return
    const dirStat = lstatSync(resolvedDir)
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return
    const removed = unlinkRegularInDir(resolvedDir, basename(resolvedFile), (st) => inodeKey(st) === inodeKey(fileStat))
    if (!removed) return
    forgetCreated(file)
    forgetCreated(resolvedFile)
    try {
      const again = lstatSync(resolvedDir)
      if (again.isSymbolicLink() || again.dev !== dirStat.dev || again.ino !== dirStat.ino) return
      // 空目录用 rmdir，非空则留下，不递归删除。rmdir 不跟随符号链接。
      rmdirSync(resolvedDir)
    } catch {
      // 目录里如果还有别的东西，就留下目录。
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') forgetCreated(file)
    // 文件已经不在，或临时目录中途变了：清理不能影响迁移结果。
  }
}

/**
 * 清掉系统临时目录里、超过 maxAgeMs 的 Bridge 临时摘要。
 *
 * 只进入名字以 `dsh-bridge-` 开头的真实目录，只删除其中的普通 `summary-*.md`。
 * 不跟随符号链接，不递归。只有这次清扫刚删过摘要、目录因此变空时才删目录；
 * 刚创建的空目录留下。`preserveFile` 是这次命令正在读的摘要，即使超龄也跳过。
 * 给跨进程的 CLI「先预览、再迁移」兜底：那两次进程互不认识对方刚写的文件，但一周前的残留可以收。
 */
export function sweepAgedSummaryFiles(maxAgeMs = SUMMARY_FILE_MAX_AGE_MS, now = Date.now(), preserveFile?: string): void {
  pruneMissingCreated()
  let tempRoot: string
  try { tempRoot = realpathSync(tmpdir()) } catch { return }
  let names: string[]
  try { names = readdirSync(tempRoot) } catch { return }
  const cutoff = now - maxAgeMs
  const preserveKey = preserveFile ? summaryPathKey(preserveFile) : undefined
  for (const name of names) {
    if (!name.startsWith(TEMP_PREFIX)) continue
    const dir = join(tempRoot, name)
    let dirStat: ReturnType<typeof lstatSync>
    try { dirStat = lstatSync(dir) } catch { continue }
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) continue
    let resolvedDir: string
    try { resolvedDir = realpathSync(dir) } catch { continue }
    if (!isInsideTemp(resolvedDir, tempRoot)) continue
    let entries: string[]
    try { entries = readdirSync(resolvedDir) } catch { continue }
    let removedAny = false
    for (const entry of entries) {
      if (!SUMMARY_FILE_NAME.test(entry)) continue
      const file = join(resolvedDir, entry)
      try {
        if (preserveKey && summaryPathKey(file) === preserveKey) continue
        const fileStat = lstatSync(file)
        if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue
        if (fileStat.mtimeMs > cutoff) continue
        const removed = unlinkRegularInDir(resolvedDir, entry, (st, realFile) => {
          if (inodeKey(st) !== inodeKey(fileStat)) return false
          if (dirname(realFile) !== resolvedDir) return false
          if (preserveKey && summaryPathKey(realFile) === preserveKey) return false
          return st.mtimeMs <= cutoff
        })
        if (!removed) continue
        forgetCreated(file)
        removedAny = true
      } catch { /* 这一份清不掉就跳过，不影响其余的 */ }
    }
    // 只收掉这次确实清过摘要的目录。刚建好、还是空的 dsh-bridge-* 可能正要写入，不能删。
    if (!removedAny) continue
    try {
      const again = lstatSync(resolvedDir)
      if (again.isSymbolicLink() || again.dev !== dirStat.dev || again.ino !== dirStat.ino) continue
      rmdirSync(resolvedDir)
    } catch { /* 目录里还有别的东西 */ }
  }
}
