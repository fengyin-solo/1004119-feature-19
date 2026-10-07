<template>
  <section class="page" data-module="air_emergency">
    <header class="page-head">
      <div>
        <h2>应急保障管理</h2>
        <p class="page-desc">维护应急保障，围绕应急编号、事件类型、涉及航班、事发位置做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记应急保障</button>
        <button class="btn" type="button" @click="exportRows">导出应急保障清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>处置书签</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span v-if="viewFor(row)" class="bookmark-chip" :class="{ done: viewFor(row)?.done }">
              {{ chipText(row) }}
            </span>
            <span v-else>—</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openPack(row)">打包现场文件</button>
            <button
              v-if="viewFor(row)?.canResume"
              class="link"
              type="button"
              @click="openResume(row)"
            >
              断点续做
            </button>
            <button
              v-if="viewFor(row)?.canDownload"
              class="link"
              type="button"
              @click="downloadFor(row)"
            >
              下载书签
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无应急保障数据，可先登记应急保障</td>
        </tr>
      </tbody>
    </table>

    <section v-if="panelRow" class="pack-panel">
      <h3>
        {{ panelMode === 'pack' ? '打包现场文件' : '断点续做' }} — {{ panelEmergencyNo }}
      </h3>
      <p v-if="panelMode === 'pack' && existingBookmark" class="panel-note">
        该事件已有书签（{{ existingBookmark.state === 'ready' ? '已就绪' : '未装完' }}），再次装载将覆盖旧版本，只留一个。
      </p>
      <p v-if="panelMode === 'resume' && existingBookmark" class="panel-note">
        {{ existingBookmark.checkpoint.message ?? '上次装载中断' }}，已装
        {{ existingBookmark.checkpoint.done }}/{{ existingBookmark.checkpoint.total }}，从断点接着做。
      </p>
      <label v-if="panelMode === 'pack'" class="filter-item">
        <span>现场确认状态（与应急状态冲突时以此为准）</span>
        <select v-model="fieldStatus">
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <table class="data-table">
        <thead>
          <tr><th>文件类别</th><th>文件名</th><th v-if="panelMode === 'resume'">装载情况</th><th v-if="panelMode === 'pack'">操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="(file, index) in fileDrafts" :key="index">
            <td><input v-model="file.kind" :disabled="isLocked(index)" placeholder="文件类别" /></td>
            <td><input v-model="file.name" :disabled="isLocked(index)" placeholder="现场文件名" /></td>
            <td v-if="panelMode === 'resume'">{{ file.loaded ? '已装载' : index === breakIndex ? '断点在此' : '待装载' }}</td>
            <td v-if="panelMode === 'pack'">
              <button class="link" type="button" @click="fileDrafts.splice(index, 1)">移除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="panel-actions">
        <button v-if="panelMode === 'pack'" class="btn ghost" type="button" @click="addFile">添加文件</button>
        <button class="btn primary" type="button" @click="submitPanel">
          {{ panelMode === 'pack' ? '开始装载' : '从断点续做' }}
        </button>
        <button class="btn ghost" type="button" @click="closePanel">取消</button>
      </div>
      <p v-if="panelMessage" class="error-text">{{ panelMessage }}</p>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条应急保障记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  ONSITE_FILE_PRESETS,
  bookmarkView,
  downloadBookmark,
  packageEmergency,
  resumePackage,
} from '@/api/emergency-service'
import { listBookmarks } from '@/data/bookmarks'
import type { BookmarkView } from '@/api/emergency-service'
import type { EmergencyBookmark, EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('air_emergency')
const columns = ["应急编号", "事件类型", "涉及航班", "事发位置", "响应等级", "响应人员", "处置措施", "应急状态"]
const actions = ["启动响应", "落实处置", "解除应急"]
const statuses = ["待响应", "响应中", "处置中", "已解除"]
const stats = [{"label": "待响应事件", "value": 0}, {"label": "处置中事件", "value": 0}, {"label": "已解除事件", "value": 0}]

const store = useSessionStore()
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const bookmarks = ref<EmergencyBookmark[]>([])

const panelRow = ref<EntryRow | null>(null)
const panelMode = ref<'pack' | 'resume'>('pack')
const fieldStatus = ref('')
const fileDrafts = ref<{ name: string; kind: string; loaded?: boolean }[]>([])
const panelMessage = ref('')

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const bookmarkByNo = computed(() => {
  const map = new Map<string, EmergencyBookmark>()
  for (const bookmark of bookmarks.value) {
    map.set(bookmark.emergencyNo, bookmark)
  }
  return map
})

const panelEmergencyNo = computed(() => String(panelRow.value?.['应急编号'] ?? ''))

const existingBookmark = computed(() => bookmarkByNo.value.get(panelEmergencyNo.value))

const breakIndex = computed(() => existingBookmark.value?.checkpoint.done ?? 0)

function bookmarkFor(row: EntryRow): EmergencyBookmark | undefined {
  return bookmarkByNo.value.get(String(row['应急编号'] ?? ''))
}

function viewFor(row: EntryRow): BookmarkView | null {
  const bookmark = bookmarkFor(row)
  return bookmark ? bookmarkView(bookmark, row) : null
}

// 未解除的书签只显示有效状态，绝不显示「已完成」。
function chipText(row: EntryRow): string {
  const bookmark = bookmarkFor(row)
  if (!bookmark) {
    return ''
  }
  const view = bookmarkView(bookmark, row)
  if (view.done) {
    return '已完成'
  }
  if (bookmark.state === 'ready') {
    return view.displayStatus
  }
  return `${view.stateLabel} ${view.progress}`
}

function isLocked(index: number): boolean {
  return panelMode.value === 'resume' && index !== breakIndex.value
}

function refreshBookmarks() {
  bookmarks.value = [...listBookmarks()]
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '应急保障登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function openPack(row: EntryRow) {
  panelRow.value = row
  panelMode.value = 'pack'
  fieldStatus.value = String(row.status)
  const no = String(row['应急编号'] ?? '')
  fileDrafts.value = ONSITE_FILE_PRESETS.map((kind) => ({ kind, name: `${kind}-${no}` }))
  panelMessage.value = ''
}

function openResume(row: EntryRow) {
  const bookmark = bookmarkFor(row)
  if (!bookmark) {
    return
  }
  panelRow.value = row
  panelMode.value = 'resume'
  fileDrafts.value = bookmark.files.map((file) => ({ ...file }))
  panelMessage.value = ''
}

function addFile() {
  fileDrafts.value.push({ kind: '', name: '' })
}

function closePanel() {
  panelRow.value = null
  panelMessage.value = ''
}

function submitPanel() {
  panelMessage.value = ''
  if (!panelRow.value) {
    return
  }
  if (panelMode.value === 'pack') {
    const result = packageEmergency(Number(panelRow.value.id), {
      files: fileDrafts.value,
      fieldStatus: fieldStatus.value,
      operator: store.operator,
    })
    if (!result.ok) {
      panelMessage.value = result.message
    }
    finishOp()
    return
  }
  const fixedName = fileDrafts.value[breakIndex.value]?.name ?? ''
  const result = resumePackage(panelEmergencyNo.value, fixedName)
  if (!result.ok) {
    panelMessage.value = result.message
  }
  finishOp()
}

function downloadFor(row: EntryRow) {
  errorMessage.value = ''
  const result = downloadBookmark(String(row['应急编号'] ?? ''))
  if (!result.ok) {
    errorMessage.value = result.message
  }
}

function finishOp() {
  refreshBookmarks()
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '应急保障列表读取失败'
  }
}

onMounted(() => {
  reload()
  refreshBookmarks()
})
</script>

<style scoped>
.pack-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px;
  margin-top: 12px;
}
.pack-panel h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.panel-note {
  color: var(--muted);
  font-size: 12px;
  margin: 0 0 8px;
}
.panel-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.bookmark-chip {
  background: #eef2f7;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}
.bookmark-chip.done {
  background: #dcfae6;
  color: #067647;
}
</style>
