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
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
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
            <button class="link" type="button" @click="packageRow(row)">打包处置书签</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无应急保障数据，可先登记应急保障</td>
        </tr>
      </tbody>
    </table>

    <section class="bookmark-panel">
      <h3 class="panel-title">处置书签</h3>
      <p class="status-legend">
        <span class="legend-item">书签记录现场确认状态，与台账冲突时以现场确认优先</span>
        <span class="legend-item">同一应急编号只保留一个版本</span>
        <span class="legend-item">未解除的事件不会标记为办结</span>
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>应急编号</th>
            <th>现场确认状态</th>
            <th>打包进度</th>
            <th>书签状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in bookmarkRows" :key="item.emergencyNo">
            <td>{{ item.emergencyNo }}</td>
            <td>{{ item.siteStatus }}</td>
            <td>
              <span v-if="item.state === 'ready'">{{ item.fileCount }} 份现场文件</span>
              <span v-else>已打包 {{ item.progress.done }}/{{ item.progress.total }}，断点可续</span>
            </td>
            <td>
              <span v-if="item.state === 'ready'" class="tag ok">可下载</span>
              <span v-else class="tag warn">打包中断</span>
            </td>
            <td class="row-actions">
              <button
                v-if="item.state === 'ready'"
                class="link"
                type="button"
                @click="downloadOne(item.emergencyNo)"
              >
                下载书签
              </button>
              <button v-else class="link" type="button" @click="resumeOne(item.emergencyNo)">
                断点续做
              </button>
            </td>
          </tr>
          <tr v-if="!bookmarkRows.length">
            <td colspan="5" class="empty-state">暂无处置书签，可在上方列表按应急编号打包现场文件</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条应急保障记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadBookmark,
  listBookmarkMarkers,
  resumePackaging,
  startPackaging,
} from '@/api/emergency-bookmarks'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { BookmarkMarker } from '@/api/emergency-bookmarks'
import type { EntryRow } from '@/data/types'
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
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const bookmarkRows = ref<BookmarkMarker[]>([])
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

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
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function packageRow(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = startPackaging(row, store.operator)
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    noticeMessage.value = result.message
  }
  reloadBookmarks()
}

function downloadOne(emergencyNo: string) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = downloadBookmark(emergencyNo)
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    noticeMessage.value = result.message
  }
}

function resumeOne(emergencyNo: string) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = resumePackaging(emergencyNo)
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    noticeMessage.value = result.message
  }
  reloadBookmarks()
}

function reloadBookmarks() {
  bookmarkRows.value = listBookmarkMarkers()
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
  reloadBookmarks()
}

onMounted(reload)
</script>
