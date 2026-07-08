<script setup lang="ts">
import { computed } from 'vue';
import { pomodoroService } from '../services/pomodoroService';
import { buildSmartOrganizationPlan } from '../services/smartTaskOrganizerService';
import { buildTaskReview } from '../services/taskReviewService';
import type { Task } from '../types/task';
import AppIcon from './AppIcon.vue';

const props = defineProps<{
  tasks: Task[];
}>();

const emit = defineEmits<{
  (event: 'organize'): void;
}>();

const review = computed(() => buildTaskReview({
  tasks: props.tasks,
  pomodoros: pomodoroService.getHistory(),
}));

const smartPlan = computed(() => buildSmartOrganizationPlan(props.tasks));

const completionTrendMax = computed(() => Math.max(1, ...review.value.completionTrend.map((point) => point.count)));

const primaryStats = computed(() => [
  { label: '完成率', value: `${review.value.completionRate}%`, hint: `${review.value.completed}/${review.value.total} 已完成`, icon: 'checkCircle2' },
  { label: '延期率', value: `${review.value.delayRate}%`, hint: `${review.value.overdue}/${review.value.active} 活跃延期`, icon: 'alarmClock' },
  { label: '本周到期', value: String(review.value.dueThisWeek), hint: `${review.value.noDueDate} 项未设日期`, icon: 'calendarClock' },
  { label: '番茄投入', value: `${review.value.focusMinutes}m`, hint: `已归档 ${review.value.archived} 项`, icon: 'timer' },
]);
</script>

<template>
  <section class="review-panel" aria-label="统计与复盘">
    <div class="review-panel__header">
      <div>
        <p class="review-kicker">P2 复盘</p>
        <h2>统计洞察与智能整理</h2>
      </div>
      <button type="button" class="btn-primary review-organize" :disabled="smartPlan.changes.length === 0" @click="emit('organize')">
        <AppIcon name="star" :size="15" />
        <span>智能整理 {{ smartPlan.changes.length }}</span>
      </button>
    </div>

    <div class="review-stats">
      <article v-for="stat in primaryStats" :key="stat.label" class="review-stat-card">
        <span class="review-stat-card__icon"><AppIcon :name="stat.icon" :size="16" /></span>
        <span class="review-stat-card__label">{{ stat.label }}</span>
        <strong>{{ stat.value }}</strong>
        <span class="review-stat-card__hint">{{ stat.hint }}</span>
      </article>
    </div>

    <div class="review-grid">
      <article class="review-block">
        <div class="review-block__title">7 日完成趋势</div>
        <div class="trend-bars" aria-label="最近 7 日完成趋势">
          <div v-for="point in review.completionTrend" :key="point.date" class="trend-bar-item">
            <span class="trend-bar" :style="{ height: `${Math.max(8, (point.count / completionTrendMax) * 64)}px` }" />
            <span class="trend-count">{{ point.count }}</span>
            <span class="trend-date">{{ point.date }}</span>
          </div>
        </div>
      </article>

      <article class="review-block">
        <div class="review-block__title">分布复盘</div>
        <div class="review-breakdown">
          <div>
            <span class="review-muted">分组</span>
            <p v-if="review.topGroups.length === 0" class="review-empty">暂无分组</p>
            <span v-for="group in review.topGroups" :key="group.name" class="review-chip">~{{ group.name }} · {{ group.count }}</span>
          </div>
          <div>
            <span class="review-muted">标签</span>
            <p v-if="review.topTags.length === 0" class="review-empty">暂无标签</p>
            <span v-for="tag in review.topTags" :key="tag.name" class="review-chip">#{{ tag.name }} · {{ tag.count }}</span>
          </div>
        </div>
      </article>

      <article class="review-block review-block--smart">
        <div class="review-block__title">智能整理建议</div>
        <p v-if="smartPlan.changes.length === 0" class="review-empty">当前任务元数据已较完整。</p>
        <ul v-else class="smart-list">
          <li v-for="change in smartPlan.changes.slice(0, 4)" :key="change.taskId">
            <span>{{ change.title }}</span>
            <small>{{ change.reasons.join('、') }}</small>
          </li>
        </ul>
      </article>
    </div>
  </section>
</template>

<style scoped>
.review-panel {
  margin: 0 var(--space-5) var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, var(--color-accent-soft));
  box-shadow: var(--shadow-sm);
}

.review-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.review-kicker {
  margin: 0 0 2px;
  font-size: var(--text-xs);
  color: var(--color-accent);
  font-weight: 700;
  letter-spacing: 0.04em;
}

.review-panel h2 {
  margin: 0;
  font-size: var(--text-lg);
  color: var(--color-text-primary);
}

.review-organize {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  white-space: nowrap;
}

.review-organize:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.review-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-2);
}

.review-stat-card,
.review-block {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
}

.review-stat-card {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px var(--space-2);
  padding: var(--space-3);
  min-width: 0;
}

.review-stat-card__icon {
  grid-row: span 3;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-full);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.review-stat-card__label,
.review-muted,
.review-stat-card__hint,
.review-empty,
.smart-list small,
.trend-date,
.trend-count {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.review-stat-card strong {
  font-size: var(--text-xl);
  color: var(--color-text-primary);
  line-height: 1.1;
}

.review-grid {
  margin-top: var(--space-2);
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-2);
}

.review-block {
  padding: var(--space-3);
  min-width: 0;
}

.review-block__title {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--color-text-primary);
  margin-bottom: var(--space-2);
}

.trend-bars {
  display: flex;
  align-items: end;
  gap: var(--space-2);
  min-height: 96px;
}

.trend-bar-item {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.trend-bar {
  width: 100%;
  max-width: 18px;
  border-radius: var(--radius-full) var(--radius-full) 3px 3px;
  background: linear-gradient(180deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 45%, transparent));
}

.review-breakdown {
  display: grid;
  gap: var(--space-3);
}

.review-chip {
  display: inline-flex;
  margin: 6px 6px 0 0;
  padding: 3px 8px;
  border-radius: var(--radius-full);
  background: var(--color-bg-input);
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
}

.smart-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: var(--space-2);
}

.smart-list li {
  display: grid;
  gap: 2px;
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border-subtle);
}

.smart-list li:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.smart-list span {
  color: var(--color-text-primary);
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 980px) {
  .review-stats,
  .review-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .review-block--smart {
    grid-column: 1 / -1;
  }
}

@media (max-width: 720px) {
  .review-panel {
    margin-inline: var(--space-3);
  }

  .review-panel__header,
  .review-stats,
  .review-grid {
    grid-template-columns: 1fr;
  }

  .review-panel__header {
    display: grid;
  }
}
</style>
