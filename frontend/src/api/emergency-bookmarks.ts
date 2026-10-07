import { BOOKMARK_VERSION, PACKAGE_STEPS } from '@/data/bookmarks'
import type { DisposalBookmark } from '@/data/bookmarks'
import { getBookmark, listBookmarks, normalizeBookmark, upsertBookmark } from '@/data/bookmark-store'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const MODULE_KEY = 'air_emergency'
/** 台账里「已解除」才算办结，其它任何状态都不能展示成已完成 */
const RELEASED_STATUS = '已解除'

export type PackageResult = {
  ok: boolean
  message: string
  /** true 表示留下了断点，可以续做 */
  resumable: boolean
}

export type BookmarkMarker = {
  emergencyNo: string
  /** 现场确认状态（书签快照） */
  siteStatus: string
  /** 台账里的应急状态，没有台账记录时为 null */
  ledgerStatus: string | null
  /** 台账与现场确认不一致 */
  conflict: boolean
  /** 冲突时以现场确认优先，所以对外生效的状态就是现场确认状态 */
  effectiveStatus: string
  /** 只有打包完成且现场确认已解除，才允许算办结 */
  settled: boolean
  state: DisposalBookmark['state']
  progress: DisposalBookmark['progress']
  fileCount: number
  packagedAt: string
  operator: string
}

function findRow(emergencyNo: string): EntryRow | null {
  return (
    listRows(MODULE_KEY).find((row) => String(row['应急编号'] ?? '').trim() === emergencyNo) ??
    null
  )
}

function persistCheckpoint(bookmark: DisposalBookmark): void {
  upsertBookmark({ ...bookmark, files: [...bookmark.files] })
}

/**
 * 从断点位置继续跑剩余步骤：每打完一个文件就落一次 checkpoint，
 * 任何一步失败都停在原地，下次从 progress.done 续做而不是从头再来。
 */
function runSteps(bookmark: DisposalBookmark, row: EntryRow): PackageResult {
  persistCheckpoint(bookmark)
  for (let i = bookmark.progress.done; i < PACKAGE_STEPS.length; i += 1) {
    const step = PACKAGE_STEPS[i]
    const missing = step.require.filter(
      (field) => String(row[field] ?? '').trim() === '',
    )
    if (missing.length > 0) {
      persistCheckpoint(bookmark)
      return {
        ok: false,
        resumable: true,
        message: `现场文件「${step.name}」缺少来源数据（${missing.join('、')}为空），断点已保存（${bookmark.progress.done}/${bookmark.progress.total}），补齐后可续做`,
      }
    }
    bookmark.files[i] = { name: step.name, content: step.build(row) }
    bookmark.progress.done = i + 1
    persistCheckpoint(bookmark)
  }
  bookmark.state = 'ready'
  bookmark.packagedAt = new Date().toISOString()
  persistCheckpoint(bookmark)
  return {
    ok: true,
    resumable: false,
    message: `已按应急编号 ${bookmark.emergencyNo} 打包 ${bookmark.files.length} 份现场文件，同一事件只保留这一版`,
  }
}

/** 操作员按应急编号打包现场文件：同一事件重复打包会覆盖旧版本。 */
export function startPackaging(row: EntryRow, operator: string): PackageResult {
  const emergencyNo = String(row['应急编号'] ?? '').trim()
  if (!emergencyNo) {
    return { ok: false, resumable: false, message: '这条记录缺少应急编号，无法打包' }
  }
  const bookmark: DisposalBookmark = {
    version: BOOKMARK_VERSION,
    emergencyNo,
    snapshotStatus: String(row.status ?? ''),
    operator,
    state: 'packaging',
    progress: { done: 0, total: PACKAGE_STEPS.length },
    files: [],
    packagedAt: '',
  }
  return runSteps(bookmark, row)
}

/** 失败/中断后从断点续做：按书签里存的进度接着打包，不重跑已完成的步骤。 */
export function resumePackaging(emergencyNo: string): PackageResult {
  const bookmark = getBookmark(emergencyNo)
  if (!bookmark) {
    return { ok: false, resumable: false, message: `没有找到应急编号 ${emergencyNo} 的打包断点` }
  }
  if (bookmark.state === 'ready') {
    return { ok: false, resumable: false, message: `应急编号 ${emergencyNo} 的书签已打包完成，无需续做` }
  }
  const row = findRow(emergencyNo)
  if (!row) {
    return {
      ok: false,
      resumable: true,
      message: `台账里找不到应急编号 ${emergencyNo}，断点保留，记录恢复后可继续`,
    }
  }
  return runSteps({ ...bookmark, files: [...bookmark.files] }, row)
}

export function downloadBookmark(emergencyNo: string): PackageResult {
  const bookmark = getBookmark(emergencyNo)
  if (!bookmark) {
    return { ok: false, resumable: false, message: `没有找到应急编号 ${emergencyNo} 的处置书签` }
  }
  if (bookmark.state !== 'ready') {
    return {
      ok: false,
      resumable: true,
      message: `应急编号 ${emergencyNo} 的书签还没打包完（${bookmark.progress.done}/${bookmark.progress.total}），不能按完成版下载`,
    }
  }
  const blob = new Blob([JSON.stringify(bookmark, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `应急处置书签-${bookmark.emergencyNo}.json`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  return { ok: true, resumable: false, message: `已下载应急编号 ${emergencyNo} 的处置书签` }
}

export type ImportResult = {
  loaded: number
  replaced: number
  skipped: number
  message: string
}

/** 装载书签文件：既有 v1 书签照常识别，同一事件多次装载只留一个版本。 */
export function importBookmarkPayloads(payloads: unknown[]): ImportResult {
  let loaded = 0
  let replaced = 0
  let skipped = 0
  for (const payload of payloads) {
    const bookmark = normalizeBookmark(payload)
    if (!bookmark) {
      skipped += 1
      continue
    }
    if (upsertBookmark(bookmark)) {
      replaced += 1
    }
    loaded += 1
  }
  const parts = [`装载 ${loaded} 份处置书签`]
  if (replaced > 0) {
    parts.push(`其中 ${replaced} 份覆盖了同事件旧版本`)
  }
  if (skipped > 0) {
    parts.push(`${skipped} 份格式无法识别已跳过`)
  }
  return { loaded, replaced, skipped, message: parts.join('，') }
}

/**
 * 保障运营概览用的对照标记：
 * 台账状态与现场确认冲突时以现场确认优先；
 * 只有打包完成且现场确认「已解除」的书签才算办结，未解除的一律不得展示成已完成。
 */
export function listBookmarkMarkers(): BookmarkMarker[] {
  return listBookmarks()
    .map((bookmark) => {
      const row = findRow(bookmark.emergencyNo)
      const ledgerStatus = row ? String(row.status ?? '') : null
      const siteStatus = bookmark.snapshotStatus || '未确认'
      const conflict = ledgerStatus !== null && ledgerStatus !== siteStatus
      const effectiveStatus = siteStatus
      return {
        emergencyNo: bookmark.emergencyNo,
        siteStatus,
        ledgerStatus,
        conflict,
        effectiveStatus,
        settled: bookmark.state === 'ready' && effectiveStatus === RELEASED_STATUS,
        state: bookmark.state,
        progress: bookmark.progress,
        fileCount: bookmark.files.length,
        packagedAt: bookmark.packagedAt,
        operator: bookmark.operator,
      }
    })
    .sort((a, b) => {
      // 打包中的排最前，未解除其次，已解除垫底，方便值班员先盯没闭环的
      const rank = (marker: BookmarkMarker) =>
        marker.state === 'packaging' ? 0 : marker.settled ? 2 : 1
      return rank(a) - rank(b) || a.emergencyNo.localeCompare(b.emergencyNo)
    })
}
