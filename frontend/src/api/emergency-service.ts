import { BOOKMARK_VERSION, getBookmark, listBookmarks, saveBookmark } from '@/data/bookmarks'
import { listRows } from '@/data/local-store'
import { confirmFieldStatus, downloadTextFile, moduleMeta } from '@/api/local-service'
import type { ActionResult, EmergencyBookmark, EntryRow, PackagedFile } from '@/data/types'

// 处置书签只挂在应急保障模块上，其它模块不走这里。
const MODULE_KEY = 'air_emergency'
const RELEASED_STATUS = '已解除'

// 现场文件的常用类别，打包面板按这份清单预填，操作员再改文件名。
export const ONSITE_FILE_PRESETS = ['现场照片', '处置记录单', '响应人员签到表', '设备动用清单', '医疗交接单']

export type PackageInput = {
  files: { name: string; kind: string }[]
  fieldStatus: string
  operator: string
}

export type PackageResult = ActionResult & {
  bookmark?: EmergencyBookmark
}

export type BookmarkView = {
  stateLabel: string
  progress: string
  displayStatus: string
  done: boolean
  canDownload: boolean
  canResume: boolean
}

export type BookmarkMarker = {
  emergencyNo: string
  entryId: number
  eventType: string
  stateLabel: string
  effectiveStatus: string
  done: boolean
  conflictResolved: boolean
  updatedAt: string
}

function now(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function findEntry(entryId: number): EntryRow | undefined {
  return listRows(MODULE_KEY).find((row) => Number(row.id) === entryId)
}

// 逐个装载现场文件：失败就停在断点，已装的不返工，续做从断点接着走。
function runLoadSteps(bookmark: EmergencyBookmark): EmergencyBookmark {
  const files = bookmark.files.map((file) => ({ ...file }))
  for (let index = bookmark.checkpoint.done; index < files.length; index += 1) {
    const file = files[index]
    if (!file.name.trim()) {
      return {
        ...bookmark,
        files,
        state: 'failed',
        checkpoint: {
          done: index,
          total: files.length,
          failedAt: file.kind || `第 ${index + 1} 个文件`,
          message: `现场文件「${file.kind || `第 ${index + 1} 个文件`}」缺文件名，装载中断，已记住断点 ${index}/${files.length}`,
        },
        updatedAt: now(),
      }
    }
    files[index] = { ...file, name: file.name.trim(), loaded: true }
  }
  return {
    ...bookmark,
    files,
    state: 'ready',
    checkpoint: { done: files.length, total: files.length },
    updatedAt: now(),
  }
}

// 有效状态：现场确认优先；既有书签（v1）没有现场确认，回落到台账里的应急状态。
export function effectiveStatusOf(row: EntryRow | undefined, bookmark: EmergencyBookmark): string {
  return bookmark.fieldStatus || String(row?.status ?? '')
}

// 展示口径：只有装载完成且有效状态为「已解除」才能显示已完成，未解除绝不显示已完成。
export function bookmarkView(bookmark: EmergencyBookmark, row: EntryRow | undefined): BookmarkView {
  const progress = `${bookmark.checkpoint.done}/${bookmark.checkpoint.total}`
  if (bookmark.state === 'failed') {
    return {
      stateLabel: '装载失败',
      progress,
      displayStatus: effectiveStatusOf(row, bookmark),
      done: false,
      canDownload: false,
      canResume: true,
    }
  }
  if (bookmark.state === 'loading') {
    return {
      stateLabel: '装载中',
      progress,
      displayStatus: effectiveStatusOf(row, bookmark),
      done: false,
      canDownload: false,
      canResume: true,
    }
  }
  const effective = effectiveStatusOf(row, bookmark)
  return {
    stateLabel: '已就绪',
    progress,
    displayStatus: effective,
    done: effective === RELEASED_STATUS,
    canDownload: true,
    canResume: false,
  }
}

// 打包：按应急编号把现场文件装载成处置书签；同一事件重复装载覆盖旧版本，只留一个。
export function packageEmergency(entryId: number, input: PackageInput): PackageResult {
  const meta = moduleMeta(MODULE_KEY)
  const row = findEntry(entryId)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${entryId} 的${meta.entity}` }
  }
  const emergencyNo = String(row['应急编号'] ?? '').trim()
  if (!emergencyNo) {
    return { ok: false, message: '这条应急保障没有应急编号，无法打包现场文件' }
  }
  const files = input.files.filter((file) => file.kind.trim() || file.name.trim())
  if (!files.length) {
    return { ok: false, message: '至少装入一个现场文件才能生成书签' }
  }
  if (!meta.statuses.includes(input.fieldStatus)) {
    return { ok: false, message: `现场确认状态「${input.fieldStatus}」不在${meta.entity}的状态表里` }
  }

  const existing = getBookmark(emergencyNo)
  const entryStatus = String(row.status)
  const conflict = input.fieldStatus !== entryStatus
    ? { entryStatus, fieldStatus: input.fieldStatus }
    : undefined

  const draft: EmergencyBookmark = {
    version: BOOKMARK_VERSION,
    emergencyNo,
    entryId,
    title: `${emergencyNo} 处置记录书签`,
    operator: input.operator,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    files: files.map<PackagedFile>((file) => ({
      name: file.name,
      kind: file.kind.trim() || '现场文件',
      loaded: false,
    })),
    fieldStatus: input.fieldStatus,
    ...(conflict ? { conflict } : {}),
    state: 'loading',
    checkpoint: { done: 0, total: files.length },
  }
  const bookmark = runLoadSteps(draft)
  saveBookmark(bookmark)

  // 应急状态与现场记录冲突时，以现场确认优先修正台账。
  const notes: string[] = []
  if (conflict) {
    const fixed = confirmFieldStatus(MODULE_KEY, entryId, input.fieldStatus)
    notes.push(fixed.message)
  }
  if (existing) {
    notes.push('同一事件重复装载，已覆盖旧书签只留一个版本')
  }

  if (bookmark.state === 'failed') {
    return {
      ok: false,
      message: `${bookmark.checkpoint.message ?? '装载中断'}，可从断点续做${notes.length ? `；${notes.join('；')}` : ''}`,
      bookmark,
    }
  }
  return {
    ok: true,
    message: `「${emergencyNo}」处置书签已就绪（${bookmark.files.length} 个现场文件）${notes.length ? `；${notes.join('；')}` : ''}`,
    bookmark,
  }
}

// 断点续做：从上次失败的文件接着装载，可顺带补录失败文件的文件名。
export function resumePackage(emergencyNo: string, fixedName = ''): PackageResult {
  const bookmark = getBookmark(emergencyNo)
  if (!bookmark) {
    return { ok: false, message: `没有找到「${emergencyNo}」的处置书签` }
  }
  if (bookmark.state === 'ready') {
    return { ok: false, message: `「${emergencyNo}」书签已就绪，不需要续做`, bookmark }
  }
  const files = bookmark.files.map((file) => ({ ...file }))
  const breakIndex = bookmark.checkpoint.done
  if (fixedName.trim() && files[breakIndex]) {
    files[breakIndex] = { ...files[breakIndex], name: fixedName.trim() }
  }
  const resumed = runLoadSteps({ ...bookmark, files, state: 'loading', updatedAt: now() })
  saveBookmark(resumed)
  if (resumed.state === 'failed') {
    return {
      ok: false,
      message: `${resumed.checkpoint.message ?? '续做仍中断'}，断点保持在 ${resumed.checkpoint.done}/${resumed.checkpoint.total}`,
      bookmark: resumed,
    }
  }
  return {
    ok: true,
    message: `断点续做完成，「${emergencyNo}」处置书签已就绪（续装 ${resumed.checkpoint.total - breakIndex} 个文件）`,
    bookmark: resumed,
  }
}

// 下载书签：只有装载完成才允许导出，避免把半成品当成处置完成凭证。
export function downloadBookmark(emergencyNo: string): ActionResult {
  const bookmark = getBookmark(emergencyNo)
  if (!bookmark) {
    return { ok: false, message: `没有找到「${emergencyNo}」的处置书签` }
  }
  if (bookmark.state !== 'ready') {
    return { ok: false, message: `「${emergencyNo}」书签还没装载完成，先断点续做再下载` }
  }
  const row = findEntry(bookmark.entryId)
  const meta = moduleMeta(MODULE_KEY)
  const payload = {
    书签版本: bookmark.version,
    应急编号: bookmark.emergencyNo,
    标题: bookmark.title,
    操作员: bookmark.operator,
    生成时间: bookmark.createdAt,
    更新时间: bookmark.updatedAt,
    有效状态: effectiveStatusOf(row, bookmark),
    现场确认状态: bookmark.fieldStatus ?? null,
    状态冲突: bookmark.conflict
      ? `应急状态「${bookmark.conflict.entryStatus}」与现场确认「${bookmark.conflict.fieldStatus}」冲突，已按现场确认优先`
      : null,
    现场文件: bookmark.files.map((file) => ({ 类别: file.kind, 文件名: file.name })),
    处置记录: row
      ? Object.fromEntries(meta.fields.map((field) => [field, row[field] ?? '']))
      : null,
  }
  downloadTextFile(
    `应急书签-${bookmark.emergencyNo}.json`,
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8',
  )
  return { ok: true, message: `「${emergencyNo}」处置书签已下载` }
}

// 保障运营概览的对照标记：每个书签对应一条应急保障记录，冲突修正也标出来。
export function listBookmarkMarkers(): BookmarkMarker[] {
  return listBookmarks().map((bookmark) => {
    const row = findEntry(bookmark.entryId)
    const view = bookmarkView(bookmark, row)
    return {
      emergencyNo: bookmark.emergencyNo,
      entryId: bookmark.entryId,
      eventType: String(row?.['事件类型'] ?? '—'),
      stateLabel: view.stateLabel,
      effectiveStatus: view.displayStatus,
      done: view.done,
      conflictResolved: Boolean(bookmark.conflict),
      updatedAt: bookmark.updatedAt,
    }
  })
}
