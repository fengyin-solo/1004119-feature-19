import type { EmergencyBookmark, PackagedFile } from './types'

// 处置书签单独持久化：和台账数据分开存，清台账不会误删书签。
const BOOKMARK_STORAGE_KEY = 'airport-ground-handling:emergency-bookmarks'

// 当前书签结构版本。既有书签（v1）没有现场确认、断点这些字段，读取时补齐，不丢数据。
export const BOOKMARK_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeFile(raw: unknown): PackagedFile {
  // v1 的文件只是文件名字符串，统一补成 { name, kind, loaded }。
  if (typeof raw === 'string') {
    return { name: raw, kind: '现场文件', loaded: true }
  }
  const item = (raw ?? {}) as Partial<PackagedFile>
  return {
    name: String(item.name ?? ''),
    kind: String(item.kind ?? '现场文件'),
    loaded: Boolean(item.loaded ?? true),
  }
}

function normalizeBookmark(raw: unknown): EmergencyBookmark | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const item = raw as Partial<EmergencyBookmark>
  const emergencyNo = String(item.emergencyNo ?? '').trim()
  if (!emergencyNo) {
    return null
  }
  const files = (Array.isArray(item.files) ? item.files : []).map(normalizeFile)
  const checkpoint = item.checkpoint && typeof item.checkpoint === 'object'
    ? {
        done: Number(item.checkpoint.done ?? files.length),
        total: Number(item.checkpoint.total ?? files.length),
        ...(item.checkpoint.failedAt ? { failedAt: String(item.checkpoint.failedAt) } : {}),
        ...(item.checkpoint.message ? { message: String(item.checkpoint.message) } : {}),
      }
    : { done: files.length, total: files.length }
  const state = item.state === 'failed' || item.state === 'loading' ? item.state : 'ready'
  return {
    version: BOOKMARK_VERSION,
    emergencyNo,
    entryId: Number(item.entryId ?? 0),
    title: String(item.title ?? `${emergencyNo} 处置记录书签`),
    operator: String(item.operator ?? '值班管理员'),
    createdAt: String(item.createdAt ?? ''),
    updatedAt: String(item.updatedAt ?? item.createdAt ?? ''),
    files,
    ...(item.fieldStatus ? { fieldStatus: String(item.fieldStatus) } : {}),
    ...(item.conflict
      ? {
          conflict: {
            entryStatus: String(item.conflict.entryStatus ?? ''),
            fieldStatus: String(item.conflict.fieldStatus ?? ''),
          },
        }
      : {}),
    state,
    checkpoint,
  }
}

function readStorage(): EmergencyBookmark[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(BOOKMARK_STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    // 兼容两种旧形态：数组，或按应急编号索引的对象。
    const list = Array.isArray(parsed) ? parsed : Object.values(parsed as Record<string, unknown>)
    const byNo = new Map<string, EmergencyBookmark>()
    for (const item of list) {
      const bookmark = normalizeBookmark(item)
      if (!bookmark) {
        continue
      }
      // 同一事件只留一个版本：撞号时保留更新时间新的那份。
      const existing = byNo.get(bookmark.emergencyNo)
      if (!existing || bookmark.updatedAt >= existing.updatedAt) {
        byNo.set(bookmark.emergencyNo, bookmark)
      }
    }
    return [...byNo.values()]
  } catch {
    return []
  }
}

let cache: EmergencyBookmark[] | null = null

export function listBookmarks(): EmergencyBookmark[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function getBookmark(emergencyNo: string): EmergencyBookmark | undefined {
  return listBookmarks().find((item) => item.emergencyNo === emergencyNo)
}

export function saveBookmark(bookmark: EmergencyBookmark): void {
  // 按应急编号覆盖写：同一事件多次装载只留一个版本。
  const next = listBookmarks().filter((item) => item.emergencyNo !== bookmark.emergencyNo)
  next.push(clone(bookmark))
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(next))
  }
}

export function bookmarkStorageKey(): string {
  return BOOKMARK_STORAGE_KEY
}
