// 既有书签兼容验证：v1 旧结构（文件是字符串数组、没有断点/现场确认/版本号）读取时自动补齐。
// 运行：esbuild 打包后 node 执行。
import { bookmarkView, downloadBookmark, effectiveStatusOf } from '@/api/emergency-service'
import { BOOKMARK_VERSION, getBookmark, listBookmarks } from '@/data/bookmarks'
import { listRows } from '@/data/local-store'

// 先装好假的 localStorage，再碰任何数据函数（模块里都是用时才读 window）。
const store = new Map<string, string>()
const v1Array = [
  {
    emergencyNo: 'AIR_-0003',
    entryId: 3,
    title: 'AIR_-0003 处置记录书签',
    operator: '老系统',
    createdAt: '2026/9/1 10:00:00',
    files: ['现场照片.jpg', '处置记录单.pdf'],
    state: 'ready',
  },
  // 同一事件两条旧书签：updatedAt 新的那份应当留下。
  { emergencyNo: 'AIR_-0001', entryId: 1, createdAt: '2026/9/1 09:00:00', updatedAt: '2026/9/1 09:00:00', files: ['旧版.pdf'] },
  { emergencyNo: 'AIR_-0001', entryId: 1, createdAt: '2026/9/1 09:00:00', updatedAt: '2026/9/2 09:00:00', files: ['新版.pdf', '补充.pdf'] },
]
store.set('airport-ground-handling:emergency-bookmarks', JSON.stringify(v1Array))
;(globalThis as any).window = {
  localStorage: {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, value),
  },
}
const downloads: string[] = []
;(globalThis as any).Blob = class {
  constructor(parts: unknown[]) {
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

const all = listBookmarks()
check('v1 书签能读出来', all.length === 2, all.length)
check('同一事件的旧书签去重只留一个', all.filter((b) => b.emergencyNo === 'AIR_-0001').length === 1)

const legacy = getBookmark('AIR_-0003')
check('旧书签补齐版本号', legacy?.version === BOOKMARK_VERSION)
check('字符串文件补成结构化文件', legacy?.files[0].name === '现场照片.jpg' && legacy?.files[0].loaded === true)
check('旧书签补齐断点信息', legacy?.checkpoint.done === 2 && legacy?.checkpoint.total === 2)
check('旧书签默认可用', legacy?.state === 'ready')

const dedup = getBookmark('AIR_-0001')
check('撞号保留更新时间新的', dedup?.files.length === 2 && dedup.files[0].name === '新版.pdf')

const row3 = listRows('air_emergency').find((r) => Number(r.id) === 3)!
check('没有现场确认时回落到台账状态', effectiveStatusOf(row3, legacy!) === String(row3.status))
const view = bookmarkView(legacy!, row3)
check('旧书签未解除不显示已完成', view.done === false && view.displayStatus === String(row3.status))
check('旧书签可直接下载', view.canDownload === true)

const dl = downloadBookmark('AIR_-0003')
check('旧书签下载成功', dl.ok === true, dl.message)
check('下载内容带当前版本号', downloads.some((text) => text.includes('"书签版本": 2')))

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
