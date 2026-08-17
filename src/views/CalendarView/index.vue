<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue';
import AppIcon from '../../components/AppIcon.vue';
import PomodoroStartButton from '../../components/PomodoroStartButton.vue';
import SmartTaskInput from '../../components/SmartTaskInput.vue';
import TaskCard from '../../components/TaskCard.vue';
import TaskCompletionBlockedModal from '../../components/TaskCompletionBlockedModal.vue';
import TaskEditor from '../../components/TaskEditor.vue';
import TaskQuickActions from '../../components/TaskQuickActions.vue';
import ViewToolbar from '../../components/ViewToolbar.vue';
import { useTaskHierarchy } from '../../composables/useTaskHierarchy';
import { useTaskQuickActions } from '../../composables/useTaskQuickActions';
import { buildCalendarRangeSegments } from '../../services/calendarViewProjection';
import { DEFAULT_TASK_SORT_CONFIG } from '../../services/filterUtils';
import { searchAndSortTasks } from '../../services/searchService';
import { taskService } from '../../services/taskService';
import type { CreateTaskInput, Task, TaskSearchFilter, TaskSortConfig } from '../../types/task';

  const props = defineProps<{
    tasks: Task[];
    filter?: TaskSearchFilter;
    sort?: TaskSortConfig;
  }>();

  const emit = defineEmits<{ (e: 'refresh'): void }>();

  interface CalendarCell { key: string; day: number; inCurrentMonth: boolean; isToday: boolean; }

  const currentMonth = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const selectedDateKey = ref<string>('');
  const editorVisible = ref(false);
  const editingTask = ref<Task | null>(null);

  const weekDays = ['一', '二', '三', '四', '五', '六', '日'];
  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const toKey = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const filteredTasks = computed(() =>
    taskService.getTasksInParentOrder(
      searchAndSortTasks(props.tasks, { ...props.filter }, props.sort ?? DEFAULT_TASK_SORT_CONFIG),
    ),
  );

  const { getTaskDepth, getParentTitle } = useTaskHierarchy(() => props.tasks);

  const calendarCells = computed<CalendarCell[]>(() => {
    const year = currentMonth.value.getFullYear();
    const mo = currentMonth.value.getMonth();
    const firstDay = new Date(year, mo, 1);
    const startWd = (firstDay.getDay() + 6) % 7;
    const start = new Date(year, mo, 1 - startWd);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const k = toKey(d.getTime());
      return { key: k, day: d.getDate(), inCurrentMonth: d.getMonth() === mo, isToday: k === todayKey };
    });
  });

  const calendarSegments = computed(() =>
    buildCalendarRangeSegments(filteredTasks.value, calendarCells.value.map((cell) => cell.key)),
  );

  const tasksByDate = computed(() =>
    new Map(
      [...calendarSegments.value].map(([key, segments]) => [key, segments.map((segment) => segment.task)]),
    ),
  );

  const selectedTasks = computed(() =>
    selectedDateKey.value ? (tasksByDate.value.get(selectedDateKey.value) ?? []) : [],
  );

  const monthTitle = computed(() => {
    const y = currentMonth.value.getFullYear();
    const m = String(currentMonth.value.getMonth() + 1).padStart(2, '0');
    return `${y} / ${m}`;
  });

  const prevMonth = (): void => { currentMonth.value = new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth() - 1, 1); };
  const nextMonth = (): void => { currentMonth.value = new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth() + 1, 1); };
  const goToday = (): void => {
    const t = new Date();
    currentMonth.value = new Date(t.getFullYear(), t.getMonth(), 1);
    selectedDateKey.value = todayKey;
  };

  const formatLabel = (key: string): string => {
    const [y, m, d] = key.split('-');
    return `${y}年${m}月${d}日`;
  };

  const { blockedInfo, cycleStatus, setPriority, toggleArchive, dismissBlockedModal } =
    useTaskQuickActions(() => emit('refresh'));

  const handleViewBlockedChildren = (): void => {
    const parent = blockedInfo.value?.parent;
    dismissBlockedModal();
    if (parent) handleOpenEdit(parent);
  };

  const handleQuickCreate = (payload: CreateTaskInput): void => {
    taskService.create(payload);
    emit('refresh');
  };
  const handleCreateOnSelectedDate = (): void => {
    if (!selectedDateKey.value) return;
    editingTask.value = null;
    editorVisible.value = true;
  };
  const handleOpenEdit = (task: Task): void => { editingTask.value = task; editorVisible.value = true; };
  const handleSaved = (): void => { emit('refresh'); };

  onMounted(() => { goToday(); });
</script>

<template>
  <section class="calendar-view">
    <ViewToolbar>
      <template #left>
        <div class="cal-nav">
          <button type="button" class="btn btn-ghost btn-icon nav-btn" title="上个月" @click="prevMonth">
            <AppIcon name="chevronLeft" :size="18" />
          </button>
          <span class="month-title">{{ monthTitle }}</span>
          <button type="button" class="btn btn-ghost btn-icon nav-btn" title="下个月" @click="nextMonth">
            <AppIcon name="chevronRight" :size="18" />
          </button>
          <button type="button" class="btn btn-ghost today-btn" @click="goToday">今天</button>
        </div>
        <div class="cal-nav__spacer" />
        <SmartTaskInput @create="handleQuickCreate" />
      </template>
    </ViewToolbar>

    <div class="cal-body">
      <div class="cal-left">
        <div class="weekdays">
          <span v-for="d in weekDays" :key="d">{{ d }}</span>
        </div>
        <div class="cal-grid">
          <button v-for="cell in calendarCells" :key="cell.key" type="button" class="day-cell" :class="{
            'day-cell--other': !cell.inCurrentMonth,
            'day-cell--today': cell.isToday,
            'day-cell--selected': selectedDateKey === cell.key,
          }" :aria-label="`${formatLabel(cell.key)}，${tasksByDate.get(cell.key)?.length ?? 0} 项任务`"
            @click="selectedDateKey = cell.key">
            <span class="day-cell__header">
              <span class="day-num">{{ cell.day }}</span>
              <span v-if="tasksByDate.get(cell.key)?.length" class="count-badge count-badge--muted day-count">
                {{ tasksByDate.get(cell.key)!.length }}
              </span>
            </span>
            <span v-if="calendarSegments.get(cell.key)?.length" class="day-ranges" aria-hidden="true">
              <template v-for="segment in calendarSegments.get(cell.key)" :key="segment.task.id">
                <span v-if="segment.position === 'single'" class="range-marker" :class="segment.task.priority">
                  <span class="range-marker__dot" />
                  <span>{{ segment.endLabel }}</span>
                </span>
                <span v-else class="range-band" :class="[
                  segment.task.priority,
                  { 'range-band--open': segment.opensSegment, 'range-band--close': segment.closesSegment },
                ]">
                  <span v-if="segment.title" class="range-band__title">{{ segment.title }}</span>
                  <span v-if="segment.startLabel" class="range-band__time">{{ segment.startLabel }}</span>
                  <span v-if="segment.endLabel" class="range-band__time range-band__time--end">{{ segment.endLabel }}</span>
                </span>
              </template>
            </span>
          </button>
        </div>
      </div>

      <aside class="day-panel" v-if="selectedDateKey">
        <div class="day-panel-header">
          <span class="day-panel-title">{{ formatLabel(selectedDateKey) }}</span>
          <span class="count-badge">{{ selectedTasks.length }} 项</span>
          <button type="button" class="btn btn-ghost day-panel-create" @click="handleCreateOnSelectedDate">
            <AppIcon name="plus" :size="14" />
            <span>新建</span>
          </button>
        </div>
        <div v-if="selectedTasks.length > 0" class="day-task-list">
          <TaskCard v-for="task in selectedTasks" :key="task.id" :task="task" variant="day" priority-display="dot"
            :show-status-toggle="false" :depth="getTaskDepth(task)" :parent-title="getParentTitle(task)"
            @click="handleOpenEdit">
            <template #actions="{ task: t }">
              <PomodoroStartButton :task="t" />
              <TaskQuickActions :task="t" @cycle-status="cycleStatus" @set-priority="setPriority"
                @toggle-archive="toggleArchive" />
            </template>
          </TaskCard>
        </div>
        <div v-else class="day-panel-empty">该日暂无任务</div>
      </aside>
    </div>

    <TaskEditor v-model="editorVisible" :task="editingTask" :initial-due-date="selectedDateKey" @saved="handleSaved" />
    <TaskCompletionBlockedModal v-if="blockedInfo" :info="blockedInfo" @cancel="dismissBlockedModal"
      @view-children="handleViewBlockedChildren" />
  </section>
</template>

<style scoped>
  .calendar-view {
    padding: var(--space-4) var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
  }

  /* ---------- Top toolbar ---------- */
  .cal-nav {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .cal-nav .nav-btn {
    width: 32px;
    height: 32px;
  }

  .cal-nav__spacer {
    flex: 1;
    min-width: 0;
  }

  .month-title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--color-text-primary);
    min-width: 90px;
    text-align: center;
  }

  .today-btn {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
  }

  /* ---------- Body layout ---------- */
  .cal-body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
    overflow: auto;
  }

  .cal-left {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: min-content;
  }

  .day-panel {
    min-height: min-content;
  }

  @media (min-width: 1024px) {
    .cal-body {
      grid-template-columns: minmax(0, 1fr) 320px;
      overflow: hidden;
    }

    .cal-left {
      min-height: 0;
    }

    .day-panel {
      min-height: 0;
    }
  }

  /* ---------- Weekdays ---------- */
  .weekdays {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .weekdays span {
    text-align: center;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    padding: var(--space-1) 0;
  }

  /* ---------- Calendar grid ---------- */
  .cal-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    grid-auto-rows: minmax(72px, max-content);
    gap: var(--space-1);
    align-content: start;
  }

  .day-cell {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-1);
    padding: var(--space-1);
    min-height: 72px;
    text-align: left;
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .day-cell:hover {
    background: var(--color-bg-hover);
    border-color: var(--color-border-default);
  }

  .day-cell--other {
    opacity: 0.35;
  }

  .day-cell--today {
    background: var(--color-accent-soft);
    border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
  }

  .day-cell--today .day-num {
    color: var(--color-accent);
    font-weight: 700;
  }

  .day-cell--selected {
    box-shadow: inset 0 0 0 2px var(--color-accent);
  }

  .day-cell--selected.day-cell--today {
    background: color-mix(in srgb, var(--color-accent-soft) 80%, var(--color-bg-elevated));
  }

  .day-num {
    font-size: var(--text-md);
    font-weight: 500;
    color: var(--color-text-primary);
    line-height: 1;
  }

  .day-cell__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1);
  }

  .day-count {
    height: 16px;
    min-width: 16px;
    padding: 0 5px;
    font-size: var(--text-xs);
  }

  .day-ranges {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .range-band,
  .range-marker {
    --range-color: var(--color-priority-medium);
  }

  .range-band.urgent,
  .range-marker.urgent {
    --range-color: var(--color-priority-urgent);
  }

  .range-band.high,
  .range-marker.high {
    --range-color: var(--color-priority-high);
  }

  .range-band.medium,
  .range-marker.medium {
    --range-color: var(--color-priority-medium);
  }

  .range-band.low,
  .range-marker.low {
    --range-color: var(--color-priority-low);
  }

  .range-band {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    height: 19px;
    margin-inline: calc(var(--space-1) * -1);
    padding: 0 var(--space-1);
    color: var(--range-color);
    background: color-mix(in srgb, var(--range-color) 18%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--range-color) 38%, transparent);
    font-size: 10px;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
  }

  .range-band--open {
    margin-left: 0;
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  }

  .range-band--close {
    margin-right: 0;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }

  .range-band--open.range-band--close {
    border-radius: var(--radius-sm);
  }

  .range-band__title {
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
  }

  .range-band__time {
    flex-shrink: 0;
    color: var(--color-text-muted);
  }

  .range-band__time--end {
    margin-left: auto;
    padding-right: 1px;
  }

  .range-marker {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 4px;
    max-width: 100%;
    color: var(--color-text-muted);
    font-size: 10px;
    line-height: 16px;
    white-space: nowrap;
  }

  .range-marker__dot {
    width: 5px;
    height: 5px;
    border-radius: var(--radius-full);
    background: var(--range-color);
  }

  /* ---------- Day panel ---------- */
  .day-panel {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .day-panel-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
    flex-shrink: 0;
  }

  .day-panel-title {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--color-text-primary);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .day-panel-create {
    height: 28px;
    padding: 0 var(--space-2);
    gap: 4px;
    font-size: var(--text-xs);
    flex-shrink: 0;
  }

  .day-task-list {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .day-panel-empty {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    text-align: center;
    padding: var(--space-5) 0;
  }

  /* ---------- Narrow screens ---------- */
  @media (max-width: 720px) {
    .month-title {
      min-width: 70px;
      font-size: var(--text-md);
    }

    .today-btn {
      padding: var(--space-1) var(--space-2);
    }

    .cal-grid {
      grid-auto-rows: minmax(64px, max-content);
    }

    .day-cell {
      min-height: 64px;
    }

    .range-band {
      height: 17px;
      font-size: 9px;
    }

    .range-band__title {
      max-width: 48px;
    }
  }
</style>