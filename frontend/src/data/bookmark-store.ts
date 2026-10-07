import { BOOKMARK_VERSION } from './bookmarks'
import type { BookmarkFileEntry, DisposalBookmark } from './bookmarks'

// 处置书签单独存一份 localStorage，和业务台账互不影响。
const STORAGE_KEY = 'airport-ground-handling:disposal-bookmarks'

function isFileEntry(value: unknown): value is BookmarkFileEntry {
  if (!value || typeof value !== 'object') {
    return false
  }
  const entry = value as Record<string, unknown>
  return typeof entry.name === 'string' && typeof entry.content === 'string'
}

/**
 * 把任意来源的书签数据归一成当前版本：
 * - v2：缺字段补默认值，不认识的字段忽略；
 * - v1 既有书签：只有「应急编号 / 应急状态 / 打包时间」三个中文键，照样能装载。
 * 认不出来的返回 null，由调用方跳过，不让一条脏数据毁掉整批。
 */
export function normalizeBookmark(raw: unknown): DisposalBookmark | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const source = raw as Record<string, unknown>
  if (typeof source.emergencyNo === 'string' && source.emergencyNo.trim() !== '') {
    const files = Array.isArray(source.files) ? source.files.filter(isFileEntry) : []
    const rawProgress = (source.progress ?? {}) as Record<string, unknown>
    const total =
      typeof rawProgress.total === 'number' && rawProgress.total >= 0
        ? rawProgress.total
        : files.length
    const done =
      typeof rawProgress.done === 'number'
        ? Math.min(Math.max(rawProgress.done, 0), total)
        : files.length
    return {
      version: BOOKMARK_VERSION,
      emergencyNo: source.emergencyNo.trim(),
      snapshotStatus: typeof source.snapshotStatus === 'string' ? source.snapshotStatus : '',
      operator: typeof source.operator === 'string' ? source.operator : '未知操作员',
      state: source.state === 'packaging' && done < total ? 'packaging' : 'ready',
      progress: { done, total },
      files,
      packagedAt: typeof source.packagedAt === 'string' ? source.packagedAt : '',
    }
  }
  if (typeof source['应急编号'] === 'string' && String(source['应急编号']).trim() !== '') {
    return {
      version: BOOKMARK_VERSION,
      emergencyNo: String(source['应急编号']).trim(),
      snapshotStatus: String(source['应急状态'] ?? ''),
      operator: String(source['操作员'] ?? '历史书签'),
      state: 'ready',
      progress: { done: 0, total: 0 },
      files: [],
      packagedAt: String(source['打包时间'] ?? ''),
    }
  }
  return null
}

function readStorage(): DisposalBookmark[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .map(normalizeBookmark)
      .filter((item): item is DisposalBookmark => item !== null)
  } catch {
    return []
  }
}

let cache: DisposalBookmark[] | null = null

function persist(rows: DisposalBookmark[]): void {
  cache = rows
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  }
}

export function listBookmarks(): DisposalBookmark[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function getBookmark(emergencyNo: string): DisposalBookmark | null {
  return listBookmarks().find((item) => item.emergencyNo === emergencyNo) ?? null
}

/** 同一应急编号只留一个版本：新书签覆盖旧的，返回是否发生了覆盖。 */
export function upsertBookmark(bookmark: DisposalBookmark): boolean {
  const rows = listBookmarks()
  const index = rows.findIndex((item) => item.emergencyNo === bookmark.emergencyNo)
  const replaced = index >= 0
  const next = replaced
    ? rows.map((item, i) => (i === index ? bookmark : item))
    : [...rows, bookmark]
  persist(next)
  return replaced
}
