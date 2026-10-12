/**
 * 预览摘要的临时文件。
 *
 * 只给「改完再执行」用。写失败必须把原因交回去，不能吞掉。
 * 当场删除只认本进程登记过的那一份。跨进程的 7 天清扫只认旁边的所有权标记
 * （或本进程登记表）并且会跳过正在读取的文件。符号链接一律不动。清理失败不抛出。
 */
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeFileSync, writeSync, type Stats } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const TEMP_PREFIX = 'dsh-bridge-'
const SUMMARY_FILE_NAME = /^summary-[A-Za-z0-9_-]{1,64}\.md$/u
const OWNERSHIP_SUFFIX = '.dsh-owned'
const DELIVERED_DIR_NAME = 'dsh-bridge-delivered'
/** 超过这个时间的旧临时摘要，才允许跨进程按所有权标记清掉。 */
export const SUMMARY_FILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** 已送达标记的有效期，和待确认预览的保留时间一致。 */
export const DELIVERED_MARKER_TTL_MS = 30 * 60 * 1000
/**
 * 本进程创建过的摘要。路径对应创建时的设备号和 inode：
 * 写完后如果真实路径暂时取不到，规范化路径仍在，文件不会变成孤儿。
 * 父目录后来被换成符号链接时，inode 对不上，不能删到链接对面的文件。
 */
const createdByPath = new Map<string, string>()
/** 本进程正在读取的摘要。清扫不能删这些路径，哪怕它们已经超龄。 */
const inUseCounts = new Map<string, number>()
const DIR_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0)
const WRITE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0)

function inodeKey(st: Stats): string {
  return `${st.dev}:${st.ino}`
}

function sameFilePath(left: string, right: string): boolean {
  if (process.platform === 'win32') return left.toLowerCase() === right.toLowerCase()
  return left === right
}

function rememberCreated(file: string): void {
  const st = lstatSync(file)
  if (!st.isFile() || st.isSymbolicLink()) return
  const inode = inodeKey(st)
  createdByPath.set(resolve(file), inode)
  try { createdByPath.set(realpathSync(file), inode) } catch { /* 写已经成功，规范化路径够用来事后删除 */ }
  writeOwnershipSidecar(file, inode)
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

function ownershipSidecar(file: string): string {
  return `${file}${OWNERSHIP_SUFFIX}`
}

/** 不跟随符号链接地写一段短文本。写不进去就放弃，调用方还有别的依据。 */
function writeRegularFile(file: string, text: string): boolean {
  let fd: number | undefined
  try {
    try {
      const existing = lstatSync(file)
      if (existing.isSymbolicLink() || !existing.isFile()) return false
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false
    }
    fd = openSync(file, WRITE_FLAGS, 0o600)
    const opened = fstatSync(fd)
    if (!opened.isFile()) return false
    writeSync(fd, text)
    return true
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function writeOwnershipSidecar(file: string, inode: string): void {
  writeRegularFile(ownershipSidecar(file), inode)
}

function sidecarMatches(file: string, st: Stats): boolean {
  const side = ownershipSidecar(file)
  try {
    const sideStat = lstatSync(side)
    if (!sideStat.isFile() || sideStat.isSymbolicLink()) return false
    return readFileSync(side, 'utf8').trim() === inodeKey(st)
  } catch {
    return false
  }
}

function ownedByUs(file: string, st: Stats): boolean {
  return inodeMatches(file, st) || sidecarMatches(file, st)
}

function removeOwnershipSidecar(file: string): void {
  const side = ownershipSidecar(file)
  try {
    const st = lstatSync(side)
    if (st.isSymbolicLink() || st.isFile()) unlinkSync(side)
  } catch { /* 标记已经不在 */ }
}

/** Linux 上优先从已打开的目录 fd 删除；没有 procfs 时由调用方改走路径。 */
function unlinkViaDirFd(dirFd: number, name: string): boolean {
  if (process.platform !== 'linux') return false
  try {
    unlinkSync(`/proc/self/fd/${dirFd}/${name}`)
    return true
  } catch {
    return false
  }
}

/**
 * 删除目录里的一个普通文件。
 *
 * 能打开目录 fd 时先核对它和路径上的目录是不是同一个 inode。
 * Linux 上删除走这个 fd，父目录随后被换成符号链接也不会跟着走。
 * 没有 `/proc`（macOS、Windows，或 procfs 不可用）时，在 unlink 前再核对一次
 * 父目录和文件自己的 dev:ino，然后按路径删除。两条路都失败才返回 false。
 */
function unlinkRegularInDir(
  dir: string,
  name: string,
  accept: (st: Stats, realFile: string) => boolean,
): boolean {
  if (!SUMMARY_FILE_NAME.test(name) || name.includes('/') || name.includes('\\') || name.includes('\0')) return false
  const child = join(dir, name)
  let dirFd: number | undefined
  try {
    let opened: Stats | undefined
    try {
      dirFd = openSync(dir, DIR_FLAGS)
      opened = fstatSync(dirFd)
    } catch {
      dirFd = undefined
    }
    const parentStat = lstatSync(dir)
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) return false
    if (opened && (!opened.isDirectory() || opened.dev !== parentStat.dev || opened.ino !== parentStat.ino)) return false
    const fileStat = lstatSync(child)
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) return false
    const realFile = realpathSync(child)
    const realDir = realpathSync(dir)
    if (!sameFilePath(dirname(realFile), realDir)) return false
    if (!accept(fileStat, realFile)) return false
    const parentAgain = lstatSync(dir)
    const childAgain = lstatSync(child)
    if (parentAgain.isSymbolicLink() || !parentAgain.isDirectory()) return false
    if (parentAgain.dev !== parentStat.dev || parentAgain.ino !== parentStat.ino) return false
    if (childAgain.isSymbolicLink() || !childAgain.isFile()) return false
    if (childAgain.dev !== fileStat.dev || childAgain.ino !== fileStat.ino) return false
    if (!sameFilePath(realpathSync(child), realFile)) return false
    if (dirFd !== undefined && unlinkViaDirFd(dirFd, name)) return true
    const parentFinal = lstatSync(dir)
    const childFinal = lstatSync(child)
    if (parentFinal.isSymbolicLink() || childFinal.isSymbolicLink()) return false
    if (parentFinal.dev !== parentStat.dev || parentFinal.ino !== parentStat.ino) return false
    if (childFinal.dev !== fileStat.dev || childFinal.ino !== fileStat.ino) return false
    unlinkSync(child)
    return true
  } catch {
    return false
  } finally {
    if (dirFd !== undefined) closeSync(dirFd)
  }
}

/**
 * 把两条路径收成同一身份。
 * 文件还在时用真实路径，这样 `/var` 与 `/private/var`、目录符号链接和 `..` 会对上；
 * 文件已经不在时退回规范化后的绝对路径。Windows 上大小写和分隔符都收成同一把钥匙。
 */
export function summaryPathKey(file: string): string {
  let key: string
  try {
    key = realpathSync(file)
  } catch {
    key = resolve(file)
  }
  return process.platform === 'win32' ? key.toLowerCase() : key
}

/** 两条路径是不是同一份摘要。供 `--file` 和过期预览对账，避免只做字符串全等。 */
export function sameSummaryPath(left: string, right: string): boolean {
  return summaryPathKey(left) === summaryPathKey(right)
}

/** 这次调用还拿着摘要。7 天清扫会跳过它，直到配平的 `noteSummaryIdle`。 */
export function noteSummaryInUse(file: string): void {
  const key = summaryPathKey(file)
  inUseCounts.set(key, (inUseCounts.get(key) ?? 0) + 1)
}

/** 放开一次 `noteSummaryInUse`。传入当时占住的路径；文件后来被删掉也按同一把钥匙减。 */
export function noteSummaryIdle(file: string): void {
  const keys = new Set([file, summaryPathKey(file)])
  if (process.platform === 'win32') keys.add(file.toLowerCase())
  for (const key of keys) {
    if (!inUseCounts.has(key)) continue
    const left = (inUseCounts.get(key) ?? 1) - 1
    if (left > 0) inUseCounts.set(key, left)
    else inUseCounts.delete(key)
    return
  }
}

function summaryBusy(file: string): boolean {
  return (inUseCounts.get(summaryPathKey(file)) ?? 0) > 0
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
    removeOwnershipSidecar(resolvedFile)
    removeOwnershipSidecar(file)
    try {
      const again = lstatSync(resolvedDir)
      if (again.isSymbolicLink() || again.dev !== dirStat.dev || again.ino !== dirStat.ino) return
      // 空目录用 rmdir，非空则留下，不递归删除。rmdir 不跟随符号链接。
      rmdirSync(resolvedDir)
    } catch {
      // 目录里如果还有别的东西，就留下目录。
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      forgetCreated(file)
      removeOwnershipSidecar(file)
    }
    // 文件已经不在，或临时目录中途变了：清理不能影响迁移结果。
  }
}

/**
 * 清掉系统临时目录里、超过 maxAgeMs、并且是本工具写过的临时摘要。
 *
 * 只进入名字以 `dsh-bridge-` 开头的真实目录，只删除其中带所有权标记（或本进程登记）
 * 的普通 `summary-*.md`。用户自己放进去的同名文件留下。正在被读取的、以及
 * `preserveFile`，即使超龄也跳过。不跟随符号链接，不递归。只有这次清扫刚删过摘要、
 * 目录因此变空时才删目录。
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
    let dirStat: Stats
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
        if (summaryBusy(file)) continue
        const fileStat = lstatSync(file)
        if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue
        if (fileStat.mtimeMs > cutoff) continue
        if (!ownedByUs(file, fileStat)) continue
        const removed = unlinkRegularInDir(resolvedDir, entry, (st, realFile) => {
          if (inodeKey(st) !== inodeKey(fileStat)) return false
          if (!sameFilePath(dirname(realFile), resolvedDir)) return false
          if (preserveKey && summaryPathKey(realFile) === preserveKey) return false
          if (summaryBusy(realFile)) return false
          if (!ownedByUs(realFile, st) && !ownedByUs(file, st)) return false
          return st.mtimeMs <= cutoff
        })
        if (!removed) continue
        forgetCreated(file)
        removeOwnershipSidecar(file)
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

function deliveredDirectory(): string | undefined {
  try {
    const root = realpathSync(tmpdir())
    const dir = join(root, DELIVERED_DIR_NAME)
    try {
      mkdirSync(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return undefined
    }
    const st = lstatSync(dir)
    if (st.isSymbolicLink() || !st.isDirectory()) return undefined
    const real = realpathSync(dir)
    if (!isInsideTemp(real, root)) return undefined
    return real
  } catch {
    return undefined
  }
}

function markerNames(file: string): string[] {
  const keys = new Set<string>([resolve(file), summaryPathKey(file)])
  if (process.platform === 'win32') keys.add(resolve(file).toLowerCase())
  return [...keys].map((key) => createHash('sha256').update(key).digest('hex'))
}

function readMarkerAt(marker: string): number | undefined {
  try {
    const st = lstatSync(marker)
    if (!st.isFile() || st.isSymbolicLink()) return undefined
    const at = Number(readFileSync(marker, 'utf8').trim())
    return Number.isFinite(at) ? at : undefined
  } catch {
    return undefined
  }
}

function pruneDeliveredMarkers(dir: string, now: number): void {
  let names: string[]
  try { names = readdirSync(dir) } catch { return }
  for (const name of names) {
    if (!/^[a-f0-9]{64}$/u.test(name)) continue
    const marker = join(dir, name)
    const at = readMarkerAt(marker)
    if (at === undefined || now - at >= DELIVERED_MARKER_TTL_MS) {
      try {
        const st = lstatSync(marker)
        if (st.isSymbolicLink() || st.isFile()) unlinkSync(marker)
      } catch { /* 别的进程已经清过 */ }
    }
  }
}

/**
 * 记下这份摘要已经交接成功。标记放在临时目录的固定位置，不跟摘要文件一起删，
 * 这样另一个进程（例如先 CLI 再 WebUI）在保留期内还能认出它。
 * 文件还在时同时记下真实路径和规范化路径，删掉之后仍能对上。
 */
export function markSummaryDelivered(file: string, now = Date.now()): void {
  const dir = deliveredDirectory()
  if (!dir) return
  pruneDeliveredMarkers(dir, now)
  for (const name of markerNames(file)) writeRegularFile(join(dir, name), String(now))
}

/** 保留期内，这份摘要是不是已经交接过。时钟由调用方传入，便于和预览有效期对齐。 */
export function summaryAlreadyDelivered(file: string, now = Date.now()): boolean {
  const dir = deliveredDirectory()
  if (!dir) return false
  for (const name of markerNames(file)) {
    const at = readMarkerAt(join(dir, name))
    if (at !== undefined && at <= now && now - at < DELIVERED_MARKER_TTL_MS) return true
  }
  return false
}
