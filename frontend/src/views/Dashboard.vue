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

    <section class="marker-section">
      <h3>应急书签对照</h3>
      <p class="page-desc">应急保障打包的处置书签在这里留对照标记；状态以现场确认优先，未解除的不会显示已完成。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>应急编号</th>
            <th>事件类型</th>
            <th>书签状态</th>
            <th>有效状态</th>
            <th>对照标记</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="marker in markers" :key="marker.emergencyNo">
            <td>{{ marker.emergencyNo }}</td>
            <td>{{ marker.eventType }}</td>
            <td>{{ marker.stateLabel }}</td>
            <td>
              <span class="marker-chip" :class="{ done: marker.done }">
                {{ marker.done ? '已完成' : marker.effectiveStatus }}
              </span>
            </td>
            <td>
              记录 #{{ marker.entryId }}
              <span v-if="marker.conflictResolved" class="conflict-note">冲突已按现场确认修正</span>
              <span v-else>状态一致</span>
            </td>
            <td>{{ marker.updatedAt }}</td>
            <td>
              <button
                v-if="marker.stateLabel === '已就绪'"
                class="link"
                type="button"
                @click="download(marker.emergencyNo)"
              >
                下载书签
              </button>
              <span v-else>—</span>
            </td>
          </tr>
          <tr v-if="!markers.length">
            <td colspan="7" class="empty-state">还没有处置书签，可先到应急保障里按应急编号打包现场文件</td>
          </tr>
        </tbody>
      </table>
      <p v-if="markerError" class="error-text">{{ markerError }}</p>
    </section>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { downloadBookmark, listBookmarkMarkers } from '@/api/emergency-service'
import type { BookmarkMarker } from '@/api/emergency-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const markers = ref<BookmarkMarker[]>([])
const markerError = ref('')

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  markers.value = listBookmarkMarkers()
}

function download(emergencyNo: string) {
  markerError.value = ''
  const result = downloadBookmark(emergencyNo)
  if (!result.ok) {
    markerError.value = result.message
  }
}

onMounted(refresh)
</script>

<style scoped>
.marker-section {
  margin-top: 16px;
}
.marker-section h3 {
  margin: 0 0 4px;
  font-size: 14px;
}
.marker-chip {
  background: #eef2f7;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}
.marker-chip.done {
  background: #dcfae6;
  color: #067647;
}
.conflict-note {
  color: #b54708;
  margin-left: 6px;
}
</style>
