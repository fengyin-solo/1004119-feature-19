import type { EntryRow } from './types'

/** 应急处置书签：操作员按应急编号打包现场文件后生成的可下载记录。 */

// 书签格式版本：v1 是既有书签（只有中文键三个字段），当前写入一律用 v2。
export const BOOKMARK_VERSION = 2

export type BookmarkFileEntry = {
  name: string
  content: string
}

export type DisposalBookmark = {
  version: number
  /** 应急编号：同一事件的对照键，多次打包/装载只保留一个版本 */
  emergencyNo: string
  /** 现场确认状态：打包那一刻以现场为准记下的状态，与台账冲突时以它优先 */
  snapshotStatus: string
  operator: string
  /** packaging=还有断点没续完；ready=可下载的完整书签 */
  state: 'packaging' | 'ready'
  /** 断点：done 之前的步骤已落盘，失败/中断后从 done 续做 */
  progress: { done: number; total: number }
  files: BookmarkFileEntry[]
  /** 打包完成时间（ISO），打包中为空串 */
  packagedAt: string
}

type PackageStep = {
  name: string
  /** 这一步依赖的台账字段，任一为空就打包失败并留下断点 */
  require: string[]
  build: (row: EntryRow) => string
}

// 现场文件清单：每个文件一个打包步骤，逐步落 checkpoint，失败可从断点续做。
export const PACKAGE_STEPS: PackageStep[] = [
  {
    name: '事件快报.txt',
    require: ['事件类型', '涉及航班', '事发位置'],
    build: (row) =>
      [
        `事件类型：${row['事件类型']}`,
        `涉及航班：${row['涉及航班']}`,
        `事发位置：${row['事发位置']}`,
      ].join('\n'),
  },
  {
    name: '响应记录.txt',
    require: ['响应等级', '响应人员'],
    build: (row) => [`响应等级：${row['响应等级']}`, `响应人员：${row['响应人员']}`].join('\n'),
  },
  {
    name: '处置记录单.txt',
    require: ['处置措施'],
    build: (row) => `处置措施：${row['处置措施']}`,
  },
  {
    name: '现场确认单.txt',
    require: [],
    build: (row) => `现场确认状态：${String(row.status ?? '')}`,
  },
]
