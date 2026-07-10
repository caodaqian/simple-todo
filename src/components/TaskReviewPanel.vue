<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { pomodoroService } from '../services/pomodoroService';
import { buildSmartOrganizationPlan } from '../services/smartTaskOrganizerService';
import { buildTaskReview } from '../services/taskReviewService';
import type { Task } from '../types/task';
import AppIcon from './AppIcon.vue';

type ReviewLayer = 'overview' | 'weekly';

const props = defineProps<{
  tasks: Task[];
}>();

const emit = defineEmits<{
  (event: 'navigate', section: 'overdue' | 'week'): void;
  (event: 'organize', taskIds: string[]): void;
}>();

const layer = ref<ReviewLayer>('overview');
const selectedTaskIds = ref<Set<string>>(new Set());
const deselectedTaskIds = ref<Set<string>>(new Set());

const review = computed(() => buildTaskReview({
  tasks: props.tasks,
  pomodoros: pomodoroService.getHistory(),
}));

const smartPlan = computed(() => buildSmartOrganizationPlan(props.tasks));
const selectedCount = computed(() => selectedTaskIds.value.size);
const completionTrendMax = computed(() => Math.max(...review.value.completionTrend.map((point) => point.count), 1));
const recentCompletionCount = computed(() => review.value.completionTrend.reduce((total, point) => total + point.count, 0));

const weeklyStats = computed(() => [
  { label: '完成率', value: `${review.value.completionRate}%`, hint: `${review.value.completed}/${review.value.total} 已完成`, icon: 'checkCircle2' },
  { label: '近 7 天专注', value: `${review.value.focusMinutes}m`, hint: `已归档 ${review.value.archived} 项`, icon: 'timer' },
]);

watch(smartPlan, (plan) => {
  const validTaskIds = new Set(plan.changes.map((change) => change.taskId));
  deselectedTaskIds.value = new Set([...deselectedTaskIds.value].filter((taskId) => validTaskIds.has(taskId)));
  selectedTaskIds.value = new Set(plan.changes
    .map((change) => change.taskId)
    .filter((taskId) => !deselectedTaskIds.value.has(taskId)));
}, { immediate: true });

const showWeeklyReview = (): void => {
  layer.value = 'weekly';
};

const toggleSuggestion = (taskId: string): void => {
  const next = new Set(selectedTaskIds.value);
  const deselected = new Set(deselectedTaskIds.value);
  if (next.has(taskId)) {
    next.delete(taskId);
    deselected.add(taskId);
  } else {
    next.add(taskId);
    deselected.delete(taskId);
  }
  selectedTaskIds.value = next;
  deselectedTaskIds.value = deselected;
};

const applySelected = (): void => {
  if (selectedCount.value > 0) emit('organize', [...selectedTaskIds.value]);
};

const applyAll = (): void => {
  emit('organize', smartPlan.value.changes.map((change) => change.taskId));
};
</script>

<template>
  <section class="review-panel" aria-label="任务洞察">
    <header class="review-panel__header">
      <div>
        <p class="review-kicker">任务洞察</p>
        <h2>{{ layer === 'overview' ? '任务概览' : '周复盘' }}</h2>
      </div>
      <div class="review-tabs" aria-label="切换洞察层级">
        <button
          type="button"
          class="review-tab"
          :class="{ active: layer === 'overview' }"
          :aria-pressed="layer === 'overview'"
          @click="layer = 'overview'"
        >概览</button>
        <button
          type="button"
          class="review-tab"
          :class="{ active: layer === 'weekly' }"
          :aria-pressed="layer === 'weekly'"
          @click="showWeeklyReview"
        >周复盘</button>
      </div>
    </header>

    <div v-if="layer === 'overview'" class="review-overview" aria-label="任务概览">
      <div class="action-metrics">
        <button type="button" class="action-metric action-metric--danger" @click="emit('navigate', 'overdue')">
          <span>逾期</span>
          <strong>{{ review.overdue }}</strong>
          <small>查看已过期任务 <AppIcon name="chevronRight" :size="13" /></small>
        </button>
        <button type="button" class="action-metric action-metric--warning" @click="emit('navigate', 'week')">
          <span>未来 7 天到期</span>
          <strong>{{ review.dueNextSevenDays }}</strong>
          <small>查看最近 7 天 <AppIcon name="chevronRight" :size="13" /></small>
        </button>
        <button type="button" class="action-metric action-metric--accent" @click="showWeeklyReview">
          <span>待整理</span>
          <strong>{{ smartPlan.changes.length }}</strong>
          <small>查看整理建议 <AppIcon name="chevronRight" :size="13" /></small>
        </button>
      </div>

      <div class="mini-trend" aria-label="近 7 日完成趋势">
        <div class="mini-trend__heading">
          <span>近 7 日完成</span>
          <strong>{{ recentCompletionCount }} 项已完成</strong>
        </div>
        <div class="mini-trend__bars">
          <div v-for="point in review.completionTrend" :key="point.date" class="mini-trend__item">
            <span class="mini-trend__count">{{ point.count }}</span>
            <span
              class="mini-trend__bar"
              :class="{ 'is-empty': point.count === 0 }"
              :style="point.count > 0 ? { height: `${Math.max(8, (point.count / completionTrendMax) * 36)}px` } : undefined"
            />
            <span class="mini-trend__date">{{ point.date }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="weekly-review" aria-label="周复盘">
      <div class="weekly-stats">
        <article v-for="stat in weeklyStats" :key="stat.label" class="weekly-stat">
          <span class="weekly-stat__icon"><AppIcon :name="stat.icon" :size="16" /></span>
          <div>
            <span>{{ stat.label }}</span>
            <strong>{{ stat.value }}</strong>
            <small>{{ stat.hint }}</small>
          </div>
        </article>
      </div>

      <article class="review-block">
        <div class="review-block__title">近 7 日完成趋势</div>
        <div class="trend-bars" aria-label="近 7 日完成趋势">
          <div v-for="point in review.completionTrend" :key="point.date" class="trend-bar-item">
            <span class="trend-count">{{ point.count }}</span>
            <span
              class="trend-bar"
              :class="{ 'is-empty': point.count === 0 }"
              :style="point.count > 0 ? { height: `${Math.max(8, (point.count / completionTrendMax) * 64)}px` } : undefined"
            />
            <span class="trend-date">{{ point.date }}</span>
          </div>
        </div>
      </article>

      <article class="review-block">
        <div class="review-block__title">任务分布</div>
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
        <div class="review-block__heading">
          <div>
            <div class="review-block__title">整理建议</div>
            <p class="review-muted">只补充缺失的优先级、分组、标签或日期。</p>
          </div>
          <span class="review-count">{{ smartPlan.changes.length }}</span>
        </div>
        <p v-if="smartPlan.changes.length === 0" class="review-empty">没有待补充的信息。</p>
        <ul v-else class="smart-list">
          <li v-for="change in smartPlan.changes" :key="change.taskId">
            <label class="smart-suggestion">
              <input type="checkbox" :checked="selectedTaskIds.has(change.taskId)" @change="toggleSuggestion(change.taskId)">
              <span>
                <strong>{{ change.title }}</strong>
                <small>{{ change.reasons.join('、') }}</small>
              </span>
            </label>
          </li>
        </ul>
        <div v-if="smartPlan.changes.length > 0" class="smart-actions">
          <button type="button" class="btn btn-ghost" @click="applyAll">全部应用 {{ smartPlan.changes.length }}</button>
          <button type="button" class="btn-primary" :disabled="selectedCount === 0" @click="applySelected">应用已选 {{ selectedCount }}</button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.review-panel {
  margin: 0 var(--space-5) var(--space-3);
  padding: var(--space-3) var(--space-4) var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--color-bg-elevated) 90%, var(--color-accent-soft));
  box-shadow: var(--shadow-sm);
}

.review-panel__header,
.review-tabs,
.action-metrics,
.mini-trend__heading,
.weekly-stats,
.review-block__heading,
.smart-actions {
  display: flex;
  align-items: center;
}

.review-panel__header {
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.review-kicker,
.review-panel h2,
.review-muted,
.review-empty,
.weekly-stat span,
.weekly-stat small,
.mini-trend__date,
.mini-trend__count,
.trend-date,
.trend-count,
.smart-suggestion small {
  margin: 0;
}

.review-kicker {
  color: var(--color-accent);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: .04em;
}

.review-panel h2 { font-size: var(--text-lg); }

.review-tabs {
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-md);
  background: var(--color-bg-input);
}

.review-tab {
  border: 0;
  border-radius: calc(var(--radius-md) - 2px);
  padding: 5px 9px;
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.review-tab.active {
  background: var(--color-bg-elevated);
  box-shadow: var(--shadow-sm);
  color: var(--color-text-primary);
  font-weight: 700;
}

.action-metrics { gap: var(--space-2); }

.action-metric {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
  padding: 10px var(--space-3);
  border: 1px solid var(--metric-border);
  border-radius: var(--radius-md);
  background: var(--metric-bg);
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition-fast), transform var(--transition-fast);
}

.action-metric:hover { transform: translateY(-1px); border-color: var(--metric-color); }
.action-metric:focus-visible, .review-tab:focus-visible { outline: none; box-shadow: var(--ring-focus); }
.action-metric > span { color: var(--color-text-secondary); font-size: var(--text-xs); }
.action-metric strong { color: var(--metric-color); font-size: var(--text-xl); line-height: 1.05; }
.action-metric small { display: inline-flex; align-items: center; color: var(--color-text-muted); font-size: var(--text-xs); }
.action-metric--danger { --metric-color: var(--color-danger); --metric-bg: var(--color-danger-soft); --metric-border: color-mix(in srgb, var(--color-danger) 22%, var(--color-border-subtle)); }
.action-metric--warning { --metric-color: var(--color-warning); --metric-bg: var(--color-warning-soft); --metric-border: color-mix(in srgb, var(--color-warning) 22%, var(--color-border-subtle)); }
.action-metric--accent { --metric-color: var(--color-accent); --metric-bg: var(--color-accent-soft); --metric-border: color-mix(in srgb, var(--color-accent) 22%, var(--color-border-subtle)); }

.mini-trend {
  margin-top: var(--space-3);
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border-subtle);
}

.mini-trend__heading { justify-content: space-between; color: var(--color-text-secondary); font-size: var(--text-xs); }
.mini-trend__heading strong { color: var(--color-text-muted); font-size: inherit; font-weight: 500; }
.mini-trend__bars, .trend-bars { display: flex; align-items: end; gap: var(--space-2); }
.mini-trend__bars { height: 58px; margin-top: var(--space-1); }
.mini-trend__item, .trend-bar-item { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.mini-trend__bar, .trend-bar { width: 100%; max-width: 18px; min-height: 2px; border-radius: var(--radius-full) var(--radius-full) 2px 2px; background: linear-gradient(180deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 45%, transparent)); }
.mini-trend__bar.is-empty, .trend-bar.is-empty { background: var(--color-border-default); }
.mini-trend__date, .mini-trend__count, .trend-date, .trend-count, .review-muted, .review-empty, .weekly-stat span, .weekly-stat small, .smart-suggestion small { color: var(--color-text-muted); font-size: var(--text-xs); }

.weekly-review { display: grid; gap: var(--space-2); max-height: min(360px, calc(100vh - 210px)); overflow-y: auto; padding-right: 2px; }
.weekly-stats { gap: var(--space-2); }
.weekly-stat, .review-block { border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-bg-surface); }
.weekly-stat { flex: 1; min-width: 0; display: flex; gap: var(--space-2); align-items: center; padding: var(--space-2) var(--space-3); }
.weekly-stat__icon { flex: 0 0 auto; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius-full); color: var(--color-accent); background: var(--color-accent-soft); }
.weekly-stat > div { min-width: 0; display: grid; gap: 1px; }
.weekly-stat strong { font-size: var(--text-lg); line-height: 1.1; }
.review-block { padding: var(--space-3); }
.review-block__title { color: var(--color-text-primary); font-size: var(--text-sm); font-weight: 700; }
.trend-bars { min-height: 92px; margin-top: var(--space-2); }
.review-breakdown { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); margin-top: var(--space-2); }
.review-chip { display: inline-flex; margin: 5px 4px 0 0; padding: 2px 7px; border-radius: var(--radius-full); background: var(--color-bg-input); color: var(--color-text-secondary); font-size: var(--text-xs); }
.review-block__heading { align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
.review-count { min-width: 20px; padding: 1px 6px; border-radius: var(--radius-full); background: var(--color-accent-soft); color: var(--color-accent); font-size: var(--text-xs); font-weight: 700; text-align: center; }
.smart-list { display: grid; gap: var(--space-1); margin: var(--space-2) 0 0; padding: 0; list-style: none; }
.smart-suggestion { display: flex; gap: var(--space-2); align-items: flex-start; padding: var(--space-2); border-radius: var(--radius-sm); cursor: pointer; }
.smart-suggestion:hover { background: var(--color-bg-hover); }
.smart-suggestion input { margin: 2px 0 0; accent-color: var(--color-accent); }
.smart-suggestion span { min-width: 0; display: grid; gap: 2px; }
.smart-suggestion strong { overflow: hidden; color: var(--color-text-primary); font-size: var(--text-sm); text-overflow: ellipsis; white-space: nowrap; }
.smart-actions { justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-2); }

@media (max-width: 720px) {
  .review-panel { margin-inline: var(--space-3); }
  .action-metrics { display: grid; grid-template-columns: 1fr; }
  .weekly-stats, .review-breakdown { display: grid; grid-template-columns: 1fr; }
}
</style>
