<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import AppIcon from '../../components/AppIcon.vue';
import PomodoroStartButton from '../../components/PomodoroStartButton.vue';
import PomodoroStatusPill from '../../components/PomodoroStatusPill.vue';
import TaskCompletionBlockedModal from '../../components/TaskCompletionBlockedModal.vue';
import { useCompletionBlockedModal } from '../../composables/useCompletionBlockedModal';
import { renderMarkdown } from '../../services/markdownService';
import { stickyNoteService } from '../../services/stickyNoteService';
import { buildStickyTaskGroups } from '../../services/stickyViewProjection';
import { taskService } from '../../services/taskService';
import type { StickyNoteSource, StickyTaskItem } from '../../types/stickyNote';
import type { Task, TaskPriority, TaskStatus } from '../../types/task';
import { getTaskEnd, getTaskStart } from '../../types/task';
import { useStickyDetailMenu } from './useStickyDetailMenu';

const TASKS_CHANGED_EVENT = 'jianyue:tasks-changed';
const STICKY_INIT_EVENT = 'jianyue:sticky-window-init';
const STICKY_SOURCE_UPDATED_EVENT = 'jianyue:sticky-source-updated';
const STICKY_INIT_KEY = 'jianyue.sticky.init';

interface StickyWindowInitPayload {
  type: 'sticky-note';
  source: StickyNoteSource;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isStickyNoteSource = (value: unknown): value is StickyNoteSource => {
  if (!isRecord(value)) return false;
  return value.sourceKind === 'current' || value.sourceKind === 'saved'
    ? typeof value.title === 'string' && typeof value.view === 'string' && typeof value.section === 'string' && isRecord(value.filter)
    : false;
};

const isStickyInitPayload = (value: unknown): value is StickyWindowInitPayload => {
  if (!isRecord(value)) return false;
  return value.type === 'sticky-note' && isStickyNoteSource(value.source);
};

const readInitSource = (): StickyNoteSource | null => {
  try {
    const raw = window.sessionStorage.getItem(STICKY_INIT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isStickyInitPayload(parsed) ? parsed.source : null;
  } catch {
    return null;
  }
};

const source = ref(readInitSource() ?? stickyNoteService.getSource());
const tasks = ref<Task[]>([]);
const detailMenu = useStickyDetailMenu();

const groups = computed(() => buildStickyTaskGroups(tasks.value, source.value));
const totalCount = computed(() => groups.value.reduce((sum, group) => sum + group.tasks.length, 0));
const activeDetailItem = computed<StickyTaskItem | null>(() => {
  if (!detailMenu.activeTaskId.value) return null;
  for (const group of groups.value) {
    const found = group.tasks.find((item) => item.task.id === detailMenu.activeTaskId.value);
    if (found) return found;
  }
  return null;
});
const activeDetailChildren = computed(() => activeDetailItem.value?.children ?? []);
const descriptionHtml = computed(() => {
  const description = activeDetailItem.value?.task.description.trim() ?? '';
  return description ? renderMarkdown(description) : '<p class="sticky-detail__empty">暂无描述</p>';
});

const statusMeta: Record<TaskStatus, { label: string; icon: string }> = {
  todo: { label: '待办', icon: 'circle' },
  doing: { label: '进行中', icon: 'play' },
  done: { label: '完成', icon: 'check' },
};

const priorityLabels: Record<TaskPriority, string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
};

const viewLabel = computed(() => {
  const map = { list: '列表', kanban: '看板', eisenhower: '四象限', calendar: '日历' } as const;
  return map[source.value.view];
});

const load = (): void => {
  source.value = readInitSource() ?? stickyNoteService.getSource();
  tasks.value = taskService.getAll();
};

const applyStickyInit = (payload: unknown): void => {
  if (!isStickyInitPayload(payload)) return;
  source.value = payload.source;
  stickyNoteService.saveSource(payload.source);
  tasks.value = taskService.getAll();
};

const handleStickyInit = (event: Event): void => {
  applyStickyInit((event as CustomEvent<unknown>).detail);
};

const notifyParentChanged = (): void => {
  window.dispatchEvent(new CustomEvent(TASKS_CHANGED_EVENT));
  try {
    const utools = window.utools;
    if (utools?.getWindowType?.() === 'browser') {
      utools.sendToParent?.(TASKS_CHANGED_EVENT);
    }
  } catch {
    // Cross-window refresh is best effort.
  }
};

const refreshAfterWrite = (): void => {
  load();
  notifyParentChanged();
};

const { blockedInfo, guardedChangeStatus, dismissBlockedModal } = useCompletionBlockedModal();

const handleStatusChange = (task: Task, status: TaskStatus): void => {
  guardedChangeStatus(task.id, status);
  refreshAfterWrite();
};

const handleViewBlockedChildren = (): void => {
  const parent = blockedInfo.value?.parent;
  dismissBlockedModal();
  if (parent) detailMenu.open(parent.id);
};

const closeWindow = (): void => {
  window.close();
};

const stickyTaskStyle = (item: StickyTaskItem): Record<string, string> => ({
  '--sticky-task-depth': String(Math.min(item.depth, 3)),
});

const formatDue = (task: Task): string => {
    const start = getTaskStart(task);
    const deadline = getTaskEnd(task);
    if (start === undefined && deadline === undefined) return '';
    if (start !== undefined && deadline !== undefined && start !== deadline) {
      const fmt = (ts: number): string => new Date(ts).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: task.allDay ? undefined : '2-digit',
        minute: task.allDay ? undefined : '2-digit',
        hour12: false,
      });
      return task.allDay ? `${fmt(start)} ~ ${fmt(deadline)}` : `${fmt(start)} - ${fmt(deadline)}`;
    }
    const ts = deadline ?? start;
  if (ts === undefined) return '';
  return new Date(ts).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric',
    hour: task.allDay ? undefined : '2-digit',
    minute: task.allDay ? undefined : '2-digit',
    hour12: false,
  });
};

let refreshTimer: number | null = null;

onMounted(() => {
  load();
  window.addEventListener(STICKY_INIT_EVENT, handleStickyInit);
  window.addEventListener(STICKY_SOURCE_UPDATED_EVENT, handleStickyInit);
  window.addEventListener('keydown', detailMenu.closeOnEscape);
  refreshTimer = window.setInterval(load, 2_000);
});

onUnmounted(() => {
  window.removeEventListener(STICKY_INIT_EVENT, handleStickyInit);
  window.removeEventListener(STICKY_SOURCE_UPDATED_EVENT, handleStickyInit);
  window.removeEventListener('keydown', detailMenu.closeOnEscape);
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
});
</script>

<template>
  <section class="sticky-window">
    <header class="sticky-header">
      <div class="sticky-header__title">
        <AppIcon name="pin" :size="16" />
        <div class="sticky-title-wrap">
          <strong>{{ source.title }}</strong>
          <span>{{ viewLabel }} · {{ totalCount }} 项</span>
        </div>
      </div>
      <button type="button" class="sticky-close" title="关闭便签" aria-label="关闭便签" @click="closeWindow">
        <AppIcon name="x" :size="16" />
      </button>
    </header>

    <div class="sticky-timer">
      <PomodoroStatusPill />
    </div>

    <main class="sticky-body">
      <div v-if="totalCount === 0" class="sticky-empty">当前视图暂无任务</div>
      <section v-for="group in groups" v-else :key="group.key" class="sticky-group">
        <div class="sticky-group__header">
          <span>{{ group.title }}</span>
          <span class="count-badge count-badge--muted">{{ group.tasks.length }}</span>
        </div>

        <template v-for="item in group.tasks" :key="item.task.id">
          <article class="sticky-task"
            :style="stickyTaskStyle(item)"
            :class="{ 'is-detail-open': detailMenu.activeTaskId.value === item.task.id, 'sticky-task--child': item.depth > 0 }"
            @contextmenu="detailMenu.openFromContextMenu($event, item.task.id)">
            <span v-if="item.depth > 0" class="sticky-task__child-marker" aria-hidden="true">
              <AppIcon name="listTree" :size="13" />
            </span>
            <span class="priority-dot" :class="item.task.priority" aria-hidden="true" />
            <div class="sticky-task__main">
              <div class="sticky-task__title-row">
                <span class="sticky-task__title">{{ item.task.title }}</span>
                <span v-if="formatDue(item.task)" class="sticky-task__due">{{ formatDue(item.task) }}</span>
              </div>
              <div class="sticky-task__meta">
                <span v-if="item.depth > 0" class="sticky-child-label">子任务</span>
                <span v-if="item.parentTitle" class="sticky-parent-context">属于：{{ item.parentTitle }}</span>
                <span v-if="item.task.group" class="chip chip--group">{{ item.task.group }}</span>
                <span v-for="tag in item.task.tags.slice(0, 2)" :key="tag" class="tag-chip">{{ tag }}</span>
                <span v-if="item.subtaskTotal > 0" class="sticky-subtasks">{{ item.subtaskCompleted }}/{{ item.subtaskTotal }}</span>
              </div>
            </div>
            <div class="sticky-task__actions">
              <button v-for="(meta, status) in statusMeta" :key="status" type="button" class="sticky-status-btn"
                :class="[{ active: item.task.status === status }, status]" :title="meta.label" :aria-label="meta.label"
                @click.stop="handleStatusChange(item.task, status as TaskStatus)">
                <AppIcon :name="meta.icon" :size="12" />
              </button>
              <PomodoroStartButton :task="item.task" @started="load" />
            </div>
          </article>
        </template>
      </section>
    </main>

    <aside v-if="activeDetailItem" class="sticky-detail" @click.stop>
      <div class="sticky-detail__header">
        <h2>{{ activeDetailItem.task.title }}</h2>
        <button type="button" class="sticky-detail__close" title="关闭详情" aria-label="关闭详情" @click="detailMenu.close">
          <AppIcon name="x" :size="14" />
        </button>
      </div>
      <div class="sticky-detail__meta">
        <span v-if="activeDetailItem.parentTitle" class="sticky-parent-context">属于：{{ activeDetailItem.parentTitle }}</span>
        <span v-if="activeDetailItem.task.group" class="chip chip--group">{{ activeDetailItem.task.group }}</span>
        <span v-for="tag in activeDetailItem.task.tags" :key="tag" class="tag-chip">{{ tag }}</span>
        <span v-if="formatDue(activeDetailItem.task)" class="sticky-task__due">{{ formatDue(activeDetailItem.task) }}</span>
      </div>
      <div class="sticky-detail__desc" v-html="descriptionHtml"></div>
      <div class="sticky-detail__subtasks">
        <strong>子任务</strong>
        <p v-if="activeDetailChildren.length === 0" class="sticky-detail__empty">暂无子任务</p>
        <div v-else class="sticky-detail__subtask-list">
          <article v-for="child in activeDetailChildren" :key="child.task.id" class="sticky-detail__subtask-item">
            <span class="priority-dot" :class="child.task.priority" aria-hidden="true" />
            <div class="sticky-detail__subtask-main">
              <div class="sticky-detail__subtask-title">{{ child.task.title }}</div>
              <div class="sticky-detail__subtask-meta">
                <span class="sticky-child-label">子任务</span>
                <span class="sticky-priority-label">优先级：{{ priorityLabels[child.task.priority] }}</span>
                <span v-if="formatDue(child.task)" class="sticky-task__due">{{ formatDue(child.task) }}</span>
              </div>
            </div>
            <div class="sticky-detail__subtask-actions">
              <button v-for="(meta, status) in statusMeta" :key="status" type="button" class="sticky-status-btn"
                :class="[{ active: child.task.status === status }, status]" :title="meta.label" :aria-label="meta.label"
                @click.stop="handleStatusChange(child.task, status as TaskStatus)">
                <AppIcon :name="meta.icon" :size="12" />
              </button>
              <PomodoroStartButton :task="child.task" @started="load" />
            </div>
          </article>
        </div>
      </div>
    </aside>
    <TaskCompletionBlockedModal v-if="blockedInfo" :info="blockedInfo" @cancel="dismissBlockedModal"
      @view-children="handleViewBlockedChildren" />
  </section>
</template>

<style scoped>
.sticky-window {
  position: relative;
  height: 100vh;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-bg-elevated) 96%, transparent);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
}

.sticky-header {
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--color-accent-soft);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.sticky-header__title {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: var(--space-2);
  color: var(--color-accent);
}

.sticky-title-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.sticky-title-wrap strong,
.sticky-title-wrap span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sticky-title-wrap span {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.sticky-close {
  -webkit-app-region: no-drag;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
}

.sticky-close:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

.sticky-timer {
  padding: var(--space-1) var(--space-3) 0;
  min-height: 24px;
  flex-shrink: 0;
}

.sticky-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-1) var(--space-3) var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.sticky-empty {
  color: var(--color-text-muted);
  text-align: center;
  padding: var(--space-8) 0;
}

.sticky-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.sticky-group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  font-weight: 600;
}

.sticky-task {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: calc(var(--sticky-task-depth, 0) * var(--space-3));
  padding: 6px var(--space-2);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-bg-elevated);
  min-width: 0;
}

.sticky-task--child {
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, var(--color-accent-soft));
  border-style: dashed;
}

.sticky-task:hover,
.sticky-task.is-detail-open,
.sticky-task:focus-visible {
  background: var(--color-bg-hover);
  border-color: var(--color-border-default);
  outline: none;
}

.sticky-task__main {
  flex: 1;
  min-width: 0;
}

.sticky-task__child-marker {
  flex-shrink: 0;
  color: var(--color-text-muted);
  display: inline-flex;
}

.sticky-task__title-row,
.sticky-task__meta,
.sticky-task__actions,
.sticky-detail__meta {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.sticky-task__title-row {
  width: 100%;
}

.sticky-task__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.sticky-task__due,
.sticky-subtasks {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.sticky-task__meta {
  margin-top: 2px;
  overflow: hidden;
  white-space: nowrap;
}

.sticky-task__actions {
  -webkit-app-region: no-drag;
  flex-shrink: 0;
}

.sticky-status-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
}

.sticky-task__actions :deep(.pomodoro-start) {
  width: 20px;
  height: 20px;
}

.sticky-status-btn.active.todo { color: var(--color-status-todo); }
.sticky-status-btn.active.doing { color: var(--color-status-doing); }
.sticky-status-btn.active.done { color: var(--color-status-done); }

.sticky-child-label,
.sticky-parent-context,
.sticky-priority-label {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.sticky-child-label {
  color: var(--color-accent);
  font-weight: 600;
}

.sticky-detail {
  -webkit-app-region: no-drag;
  position: absolute;
  top: 72px;
  right: var(--space-3);
  z-index: var(--z-popover);
  width: min(320px, calc(100vw - 24px));
  max-height: 70vh;
  overflow-y: auto;
  padding: var(--space-3);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  box-shadow: var(--shadow-lg);
}

.sticky-detail__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.sticky-detail__header h2 {
  margin: 0;
  font-size: var(--text-md);
}

.sticky-detail__close {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
}

.sticky-detail__close:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

.sticky-detail__meta {
  flex-wrap: wrap;
  margin-bottom: var(--space-2);
}

.sticky-detail__desc {
  padding: var(--space-2) 0;
  border-top: 1px solid var(--color-border-subtle);
  border-bottom: 1px solid var(--color-border-subtle);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.sticky-detail__desc :deep(p) {
  margin: 0 0 var(--space-1);
}

.sticky-detail__subtasks {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-top: var(--space-2);
}

.sticky-detail__empty {
  color: var(--color-text-muted);
  margin: 0;
}

.sticky-detail__subtask-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.sticky-detail__subtask-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
}

.sticky-detail__subtask-main {
  flex: 1;
  min-width: 0;
}

.sticky-detail__subtask-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-primary);
  font-size: var(--text-sm);
  font-weight: 500;
}

.sticky-detail__subtask-meta,
.sticky-detail__subtask-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.sticky-detail__subtask-meta {
  min-width: 0;
  overflow: hidden;
}

.sticky-detail__subtask-actions {
  flex-shrink: 0;
}

.sticky-detail__subtask-actions :deep(.pomodoro-start) {
  width: 22px;
  height: 22px;
}

@media (max-height: 340px) {
  .sticky-header {
    padding: 6px var(--space-2);
  }

  .sticky-title-wrap span,
  .sticky-timer,
  .sticky-group__header,
  .sticky-task__meta {
    display: none;
  }

  .sticky-close {
    width: 24px;
    height: 24px;
  }

  .sticky-body {
    padding: 4px var(--space-2) var(--space-2);
    gap: 4px;
  }

  .sticky-group {
    gap: 4px;
  }

  .sticky-task {
    min-height: 30px;
    padding: 4px 6px;
  }

  .sticky-task__actions {
    gap: 0;
  }

  .sticky-status-btn {
    width: 18px;
    height: 18px;
  }

  .sticky-task__actions :deep(.pomodoro-start) {
    width: 18px;
    height: 18px;
  }

  .sticky-detail {
    top: 40px;
    max-height: calc(100vh - 48px);
  }
}
</style>
