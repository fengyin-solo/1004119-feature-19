// 逻辑验证脚本：打包→失败断点→续做→重复装载去重→现场确认优先→未解除不显示已完成。
// 运行：node_modules/.bin/esbuild 打包后用 node 执行（见 Makefile 外的手动步骤）。
import {
  bookmarkView,
  downloadBookmark,
  effectiveStatusOf,
  listBookmarkMarkers,
  packageEmergency,
  resumePackage,
} from '@/api/emergency-service'
import { getBookmark, listBookmarks } from '@/data/bookmarks'
import { listRows } from '@/data/local-store'

// node 里没有浏览器下载 API，补最小桩让 downloadBookmark 能跑完。
const downloads: string[] = []
;(globalThis as any).Blob = class {
  parts: unknown[]
  constructor(parts: unknown[]) {
    this.parts = parts
    downloads.push(String(parts[0]))
  }
}
;(globalThis as any).URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} }
;(globalThis as any).document = {
  createElement: () => ({ click: () => {} }),
  body: { appendChild: () => {}, removeChild: () => {} },
}

let failures = 0
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`ok   ${label}`)
  } else {
    failures += 1
    console.error(`FAIL ${label}`, extra ?? '')
  }
}

const row1 = () => listRows('air_emergency').find((r) => Number(r.id) === 1)!

// 1) 打包：第 2 个文件缺文件名 → 装载失败，断点停在 1/3
const pack = packageEmergency(1, {
  files: [
    { kind: '现场照片', name: '照片-AIR_-0001' },
    { kind: '处置记录单', name: '  ' },
    { kind: '签到表', name: '签到-AIR_-0001' },
  ],
  fieldStatus: '处置中',
  operator: '测试员',
})
check('缺文件名时装载失败', pack.ok === false && pack.bookmark?.state === 'failed', pack.message)
check('断点停在 1/3', pack.bookmark?.checkpoint.done === 1 && pack.bookmark?.checkpoint.total === 3)
check('断点前的文件已装载', pack.bookmark?.files[0].loaded === true && pack.bookmark?.files[2].loaded === false)

// 2) 现场确认优先：台账状态从「待响应」被修正为「处置中」并标异常
check('冲突时按现场确认修正台账', String(row1().status) === '处置中', row1().status)
check('冲突修正后标异常留痕', row1().abnormal === true)

// 3) 断点续做：补录文件名后从断点接着装，不返工
const resumed = resumePackage('AIR_-0001', '处置记录单-补录')
check('断点续做成功', resumed.ok === true && resumed.bookmark?.state === 'ready', resumed.message)
check('续做后全部装载完成', resumed.bookmark?.checkpoint.done === 3)
check('续做保留断点前的成果', resumed.bookmark?.files[0].name === '照片-AIR_-0001')
check('补录的文件名生效', resumed.bookmark?.files[1].name === '处置记录单-补录')

// 4) 未解除不能展示成已完成
const notReleased = bookmarkView(getBookmark('AIR_-0001')!, row1())
check('未解除的书签不显示已完成', notReleased.done === false && notReleased.displayStatus === '处置中')

// 5) 同一事件多次装载只留一个版本，createdAt 保留
const firstCreatedAt = getBookmark('AIR_-0001')!.createdAt
const repack = packageEmergency(1, {
  files: [{ kind: '现场照片', name: '照片-第二版' }],
  fieldStatus: '已解除',
  operator: '测试员',
})
check('重复装载成功', repack.ok === true, repack.message)
check('同一事件只留一个版本', listBookmarks().filter((b) => b.emergencyNo === 'AIR_-0001').length === 1)
check('覆盖后保留首次生成时间', getBookmark('AIR_-0001')!.createdAt === firstCreatedAt)
check('覆盖后是新文件清单', getBookmark('AIR_-0001')!.files.length === 1)
check('台账状态随现场确认解除', String(row1().status) === '已解除' && row1().pending === false)

// 6) 已解除才显示已完成，且可下载
const released = bookmarkView(getBookmark('AIR_-0001')!, row1())
check('已解除才显示已完成', released.done === true && released.canDownload === true)
const dl = downloadBookmark('AIR_-0001')
check('就绪书签可下载', dl.ok === true, dl.message)
check('下载内容含现场确认优先留痕', downloads.some((text) => text.includes('现场确认')))

// 7) 概览对照标记
const markers = listBookmarkMarkers()
check('概览保留对照标记', markers.length === 1 && markers[0].emergencyNo === 'AIR_-0001' && markers[0].done === true)
check('对照标记记录冲突修正', markers[0].conflictResolved === true)

// 8) 有效状态：现场确认优先于台账状态
const bm = getBookmark('AIR_-0001')!
check('有效状态以现场确认为准', effectiveStatusOf(row1(), bm) === '已解除')

// 9) 失败的书签不允许下载
const pack2 = packageEmergency(2, {
  files: [{ kind: '现场照片', name: '' }],
  fieldStatus: '响应中',
  operator: '测试员',
})
check('第二条事件装载失败', pack2.ok === false)
const dl2 = downloadBookmark('AIR_-0002')
check('未就绪书签禁止下载', dl2.ok === false)
check('失败书签不显示已完成', bookmarkView(getBookmark('AIR_-0002')!, listRows('air_emergency').find((r) => Number(r.id) === 2)!).done === false)

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
