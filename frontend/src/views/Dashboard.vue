<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <section class="bookmark-panel">
      <header class="page-head">
        <div>
          <h3 class="panel-title">应急保障处置书签对照</h3>
          <p class="page-desc">操作员在应急保障页按应急编号打包现场文件后，这里保留对应对照标记。</p>
        </div>
        <div class="page-actions">
          <button class="btn" type="button" @click="openImport">装载处置书签</button>
          <input
            ref="fileInput"
            class="visually-hidden"
            type="file"
            accept=".json,application/json"
            multiple
            @change="handleImport"
          />
        </div>
      </header>

      <div class="stat-row">
        <article v-for="card in bookmarkCards" :key="card.label" class="stat-card">
          <span class="stat-label">{{ card.label }}</span>
          <strong class="stat-value">{{ card.value }}</strong>
        </article>
      </div>

      <p class="status-legend">
        <span class="legend-item">状态冲突时以现场确认优先</span>
        <span class="legend-item">只有现场确认「已解除」才算办结</span>
        <span class="legend-item">打包中断的书签可从断点续做</span>
      </p>

      <table class="data-table">
        <thead>
          <tr>
            <th>应急编号</th>
            <th>现场确认状态</th>
            <th>台账应急状态</th>
            <th>对照结果</th>
            <th>办结情况</th>
            <th>打包时间</th>
            <th>操作员</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="marker in markers" :key="marker.emergencyNo">
            <td>{{ marker.emergencyNo }}</td>
            <td>{{ marker.siteStatus }}</td>
            <td>{{ marker.ledgerStatus ?? '台账无记录' }}</td>
            <td>
              <span v-if="marker.state === 'packaging'" class="tag warn">
                打包中断 {{ marker.progress.done }}/{{ marker.progress.total }}，待续做
              </span>
              <span v-else-if="marker.conflict" class="tag warn">状态冲突，以现场确认优先</span>
              <span v-else class="tag ok">一致</span>
            </td>
            <td>
              <span v-if="marker.settled" class="tag ok">已解除</span>
              <span v-else class="tag">未解除</span>
            </td>
            <td>{{ marker.packagedAt ? formatTime(marker.packagedAt) : '—' }}</td>
            <td>{{ marker.operator }}</td>
          </tr>
          <tr v-if="!markers.length">
            <td colspan="7" class="empty-state">
              暂无处置书签对照标记，可在应急保障页按应急编号打包现场文件，或在此装载既有书签
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="bookmarkNotice" class="notice-text">{{ bookmarkNotice }}</p>
    </section>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { importBookmarkPayloads, listBookmarkMarkers } from '@/api/emergency-bookmarks'
import type { BookmarkMarker } from '@/api/emergency-bookmarks'
import { loadOverview } from '@/api/local-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const markers = ref<BookmarkMarker[]>([])
const bookmarkNotice = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const bookmarkCards = computed(() => [
  { label: '处置书签', value: markers.value.length },
  { label: '未解除', value: markers.value.filter((item) => !item.settled).length },
  { label: '已解除', value: markers.value.filter((item) => item.settled).length },
  { label: '状态冲突', value: markers.value.filter((item) => item.conflict).length },
])

function formatTime(iso: string): string {
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString()
}

function openImport() {
  fileInput.value?.click()
}

async function handleImport(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) {
    return
  }
  const payloads: unknown[] = []
  let unreadable = 0
  for (const file of files) {
    try {
      payloads.push(JSON.parse(await file.text()))
    } catch {
      unreadable += 1
    }
  }
  const result = importBookmarkPayloads(payloads)
  bookmarkNotice.value = unreadable > 0 ? `${result.message}，${unreadable} 个文件无法解析` : result.message
  refresh()
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  markers.value = listBookmarkMarkers()
}

onMounted(refresh)
</script>
