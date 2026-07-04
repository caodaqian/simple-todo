<script setup lang="ts">
  import { computed } from 'vue';
import type { Task, TaskPriority, TaskStatus } from '../types/task';
import { getTaskEnd, getTaskStart } from '../types/task';
import AppIcon from './AppIcon.vue';

  type TaskCardVariant = 'row' | 'panel' | 'tile' | 'day';
  type PriorityDisplay = 'dot' | 'stripe' | 'none';

  defineOptions({ name: 'TaskCard' });

  const props = withDefaults(
    defineProps<{
      task: Task;
      variant?: TaskCardVariant;
      priorityDisplay?: PriorityDisplay;
      showStatusToggle?: boolean;
      selectable?: boolean;
      selected?: boolean;
      maxTags?: number;
      clickable?: boolean;
    }>(),
    {
      variant: 'row',
      priorityDisplay: 'dot',
      showStatusToggle: true,
      selectable: false,
      selected: false,
      maxTags: 3,
      clickable: true,
    },
  );

  const emit = defineEmits<{
    (e: 'click', task: Task): void;
    (e: 'toggle-status', task: Task): void;
    (e: 'toggle-select', task: Task): void;
  }>();

  defineSlots<{
    actions?: (props: { task: Task }) => unknown;
    metaExtra?: (props: { task: Task }) => unknown;
  }>();

  /* ---------- shared helpers ---------- */

  function statusIconName(s: TaskStatus): string {
    if (s === 'todo') return 'circle';
    if (s === 'doing') return 'circleDot';
    return 'checkCircle2';
  }

  function statusColorVar(s: TaskStatus): string {
    if (s === 'todo') return 'var(--color-text-muted)';
    if (s === 'doing') return 'var(--color-status-doing)';
    return 'var(--color-status-done)';
  }

  function priorityClass(p: TaskPriority): 'high' | 'medium' | 'low' | 'urgent' {
    return p;
  }

  function formatDate(ts?: number): string {
    return ts
      ? new Date(ts).toLocaleDateString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
      })
      : '';
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function formatDueLabel(task: Task): string {
    const start = getTaskStart(task);
    if (start === undefined) return '';
    if (task.allDay) {
      return new Date(start).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    }
    const end = getTaskEnd(task);
    if (end !== undefined && end !== start) {
      // 时间段：显示 日期 + 起止时间
      return `${new Date(start).toLocaleDateString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
      })} ${formatTime(start)}-${formatTime(end)}`;
    }
    // 瞬时：日期 + 时间
    return `${new Date(start).toLocaleDateString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
    })} ${formatTime(start)}`;
  }

  function isOverdue(task: Task): boolean {
    const end = getTaskEnd(task);
    return !!(end !== undefined && end < Date.now() && task.status !== 'done');
  }

  function subtaskProgress(task: Task): string {
    const done = task.subtasks.filter((s) => s.completed).length;
    return `${done}/${task.subtasks.length}`;
  }

  function subtaskCount(task: Task): number {
    return task.subtasks.length;
  }

  const visibleTags = computed<string[]>(() =>
    props.task.tags.slice(0, props.maxTags),
  );
  const hiddenTagCount = computed<number>(() =>
    Math.max(0, props.task.tags.length - props.maxTags),
  );

  const isDone = computed(() => props.task.status === 'done');
  const overdue = computed(() => isOverdue(props.task));
  const dueLabel = computed(() => formatDueLabel(props.task));

  function handleBodyClick(): void {
    if (props.clickable) emit('click', props.task);
  }
</script>

<template>
  <div class="task-card" :class="[
    `task-card--${variant}`,
    {
      'task-card--done': isDone,
      'task-card--selectable': selectable,
    },
  ]" @click="handleBodyClick">
    <!-- ============ ROW ============ -->
    <template v-if="variant === 'row'">
      <input v-if="selectable" type="checkbox" class="task-card__checkbox" :checked="selected"
        @click.stop="emit('toggle-select', task)" />
      <button v-else-if="showStatusToggle" type="button" class="task-card__status" :class="task.status"
        :title="`状态: ${task.status}`" @click.stop="emit('toggle-status', task)">
        <AppIcon :name="statusIconName(task.status)" :size="16" :color="statusColorVar(task.status)" />
      </button>

      <span v-if="priorityDisplay === 'dot'" class="priority-dot" :class="priorityClass(task.priority)"
        aria-hidden="true" />

      <div class="task-card__body">
        <div class="task-card__title-row">
          <span class="task-card__title">{{ task.title }}</span>
          <span v-if="dueLabel" class="task-card__due" :class="{ overdue }">{{ dueLabel }}</span>
        </div>
        <div class="task-card__meta-row">
          <span v-if="task.group" class="chip chip--group">{{ task.group }}</span>
          <span v-for="tag in visibleTags" :key="tag" class="tag-chip">{{ tag }}</span>
          <span v-if="hiddenTagCount > 0" class="task-card__tag-overflow">
            +{{ hiddenTagCount }}
          </span>
          <span v-if="subtaskCount(task) > 0" class="task-card__sub-count">
            <AppIcon name="listTree" :size="12" />
            {{ subtaskProgress(task) }}
          </span>
          <slot name="metaExtra" :task="task" />
        </div>
      </div>

      <div class="task-card__actions" @click.stop>
        <slot name="actions" :task="task" />
      </div>
    </template>

    <!-- ============ PANEL ============ -->
    <template v-else-if="variant === 'panel'">
      <div v-if="priorityDisplay === 'stripe'" class="task-card__stripe" :class="priorityClass(task.priority)" />
      <div class="task-card__content">
        <div class="task-card__header-row">
          <span v-if="priorityDisplay === 'dot'" class="priority-dot" :class="priorityClass(task.priority)"
            aria-hidden="true" />
          <p class="task-card__title task-card__title--clamp2">{{ task.title }}</p>
          <div class="task-card__actions" @click.stop>
            <slot name="actions" :task="task" />
          </div>
        </div>

        <div v-if="task.tags.length > 0" class="task-card__tags-row">
          <span v-for="tag in visibleTags" :key="tag" class="tag-chip">{{ tag }}</span>
          <span v-if="hiddenTagCount > 0" class="task-card__tag-overflow">
            +{{ hiddenTagCount }}
          </span>
        </div>

        <div class="task-card__footer-row">
          <span v-if="task.group" class="chip chip--group">{{ task.group }}</span>
          <span v-if="dueLabel" class="task-card__due" :class="{ overdue }">
            <AppIcon name="calendarClock" :size="12" />
            {{ dueLabel }}
          </span>
          <span v-if="subtaskCount(task) > 0" class="task-card__sub-count">
            <AppIcon name="listTree" :size="12" />
            {{ subtaskProgress(task) }}
          </span>
          <slot name="metaExtra" :task="task" />
        </div>
      </div>
    </template>

    <!-- ============ TILE ============ -->
    <template v-else-if="variant === 'tile'">
      <div class="task-card__content">
        <div class="task-card__title-row">
          <div class="task-card__title">{{ task.title }}</div>
          <span v-if="priorityDisplay === 'dot'" class="priority-dot" :class="priorityClass(task.priority)"
            aria-hidden="true" />
        </div>
        <div class="task-card__meta-row">
          <span v-if="dueLabel" class="task-card__due" :class="{ overdue }">
            <AppIcon name="calendarClock" :size="12" />
            {{ dueLabel }}
          </span>
          <span v-for="tag in visibleTags" :key="tag" class="tag-chip">{{ tag }}</span>
          <span v-if="hiddenTagCount > 0" class="task-card__tag-overflow">
            +{{ hiddenTagCount }}
          </span>
          <slot name="metaExtra" :task="task" />
          <div class="task-card__actions task-card__actions--end" @click.stop>
            <slot name="actions" :task="task" />
          </div>
        </div>
      </div>
    </template>

    <!-- ============ DAY ============ -->
    <template v-else>
      <span v-if="priorityDisplay === 'dot'" class="priority-dot" :class="priorityClass(task.priority)"
        aria-hidden="true" />
      <span class="task-card__title">{{ task.title }}</span>
      <span v-for="tag in visibleTags" :key="tag" class="tag-chip">{{ tag }}</span>
      <span v-if="hiddenTagCount > 0" class="task-card__tag-overflow">
        +{{ hiddenTagCount }}
      </span>
      <slot name="metaExtra" :task="task" />
      <div class="task-card__actions" @click.stop>
        <slot name="actions" :task="task" />
      </div>
    </template>
  </div>
</template>

<style scoped>

  /* ---------- Root variants ---------- */
  .task-card {
    /* sane defaults overridden per variant */
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast),
      transform var(--transition-fast),
      opacity var(--transition-fast);
    cursor: default;
  }

  .task-card:hover {
    background: var(--color-bg-hover);
    border-color: var(--color-border-default);
  }

  .task-card--done {
    opacity: 0.55;
  }

  .task-card--done .task-card__title {
    text-decoration: line-through;
  }

  .task-card--selectable {
    cursor: pointer;
  }

  /* ---------- Status button ---------- */
  .task-card__status {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    flex-shrink: 0;
    color: var(--color-text-muted);
  }

  .task-card__status:hover {
    background: var(--color-bg-hover);
  }

  .task-card__status.todo {
    color: var(--color-status-todo);
  }

  .task-card__status.doing {
    color: var(--color-status-doing);
  }

  .task-card__status.done {
    color: var(--color-status-done);
  }

  /* ---------- Checkbox ---------- */
  .task-card__checkbox {
    width: 16px;
    height: 16px;
    cursor: pointer;
    accent-color: var(--color-accent);
    flex-shrink: 0;
    margin: 0;
  }

  /* ---------- Title ---------- */
  .task-card__title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-md);
    font-weight: 500;
    color: var(--color-text-primary);
  }

  .task-card__title--clamp2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 500;
    color: var(--color-text-primary);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    word-break: break-word;
    white-space: normal;
    text-overflow: clip;
  }

  .task-card__title-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  /* ---------- Due ---------- */
  .task-card__due {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .task-card__due.overdue {
    color: var(--color-danger);
  }

  /* ---------- Actions slot (in-flow, no absolute) ---------- */
  .task-card__actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .task-card__actions--end {
    margin-left: auto;
  }

  /* ---------- Meta ---------- */
  .task-card__body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .task-card__meta-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .task-card__sub-count {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    white-space: nowrap;
  }

  .task-card__tag-overflow {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* ============ Panel variant ============ */
  .task-card--panel {
    display: flex;
    align-items: stretch;
    padding: 0;
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .task-card--panel:hover {
    background: var(--color-bg-hover);
    border-color: var(--color-border-default);
    transform: translateY(-1px);
  }

  .task-card--panel .task-card__stripe {
    width: 3px;
    flex-shrink: 0;
    align-self: stretch;
  }

  .task-card--panel .task-card__stripe.high {
    background: var(--color-priority-high);
  }

  .task-card--panel .task-card__stripe.medium {
    background: var(--color-priority-medium);
  }

  .task-card--panel .task-card__stripe.low {
    background: var(--color-priority-low);
  }

  .task-card--panel .task-card__stripe.urgent {
    background: var(--color-priority-urgent);
  }

  .task-card--panel .task-card__content {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .task-card--panel .task-card__header-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .task-card--panel .task-card__tags-row {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .task-card--panel .task-card__footer-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  /* ============ Tile variant ============ */
  .task-card--tile {
    display: block;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast),
      opacity var(--transition-fast);
  }

  .task-card--tile:hover {
    background: var(--color-bg-hover);
    border-color: var(--color-border-default);
    transform: none;
  }

  .task-card--tile.task-card--done {
    opacity: 0.45;
  }

  .task-card--tile .task-card__content {
    display: block;
  }

  .task-card--tile .task-card__title-row {
    align-items: center;
    margin-bottom: 4px;
  }

  .task-card--tile .task-card__title {
    font-weight: 500;
  }

  /* ============ Day variant ============ */
  .task-card--day {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast),
      opacity var(--transition-fast);
  }

  .task-card--day:hover {
    background: var(--color-bg-hover);
    border-color: var(--color-border-default);
    transform: none;
  }

  .task-card--day .task-card__title {
    font-weight: 500;
  }

  /* ---------- Responsive ---------- */
  @media (max-width: 720px) {
    .task-card--row {
      gap: var(--space-1);
    }
  }
</style>