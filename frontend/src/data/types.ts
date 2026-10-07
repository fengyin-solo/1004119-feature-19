/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 现场文件：打包时逐个装载，loaded 记录断点进度。 */
export type PackagedFile = {
  name: string
  kind: string
  loaded: boolean
}

/** 装载断点：失败时记住进度，续做从 done 接着往下走，不重头再来。 */
export type BookmarkCheckpoint = {
  done: number
  total: number
  failedAt?: string
  message?: string
}

/** 状态冲突留痕：应急状态与现场确认不一致时，以现场确认优先。 */
export type StatusConflict = {
  entryStatus: string
  fieldStatus: string
}

/** 处置记录书签：同一应急编号只留一个版本，version 用于既有书签兼容。 */
export type EmergencyBookmark = {
  version: number
  emergencyNo: string
  entryId: number
  title: string
  operator: string
  createdAt: string
  updatedAt: string
  files: PackagedFile[]
  fieldStatus?: string
  conflict?: StatusConflict
  state: 'loading' | 'failed' | 'ready'
  checkpoint: BookmarkCheckpoint
}
