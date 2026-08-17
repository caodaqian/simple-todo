<script setup lang="ts">
  import { computed, ref } from 'vue';
import PomodoroStartButton from '../../components/PomodoroStartButton.vue';
import SmartTaskInput from '../../components/SmartTaskInput.vue';
import TaskCard from '../../components/TaskCard.vue';
import TaskCompletionBlockedModal from '../../components/TaskCompletionBlockedModal.vue';
import TaskEditor from '../../components/TaskEditor.vue';
import TaskQuickActions from '../../components/TaskQuickActions.vue';
import ViewToolbar from '../../components/ViewToolbar.vue';
import { useTaskQuickActions } from '../../composables/useTaskQuickActions';
import { DEFAULT_TASK_SORT_CONFIG } from '../../services/filterUtils';
import { searchAndSortTasks } from '../../services/searchService';
import { taskService } from '../../services/taskService';
import type { SaveTaskInput, Task, TaskSearchFilter, TaskSortConfig, TaskStatus } from '../../types/task';

  const props = defineProps<{
    tasks: Task[];
    filter?: TaskSearchFilter;
    sort?: TaskSortConfig;
  }>();

  const emit = defineEmits<{
    (e: 'refresh'): void;
  }>();

  const editorVisible = ref(false);
  const editingTask = ref<Task | null>(null);
  const draggingTaskId = ref<string>('');
  const dragOverStatus = ref<TaskStatus | null>(null);

  const statusOrder: TaskStatus[] = ['todo', 'doing', 'done'];
  const statusMeta: Record<TaskStatus, { label: string; color: string }> = {
    todo: { label: '待办', color: 'var(--color-text-muted)' },
    doing: { label: '进行中', color: 'var(--color-priority-medium)' },
    done: { label: '已完成', color: 'var(--color-status-done)' },
  };

  const reloadTasks = (): void => { /* no-op: tasks come from props */ };

  const effectiveSort = computed<TaskSortConfig>(() => props.sort ?? DEFAULT_TASK_SORT_CONFIG);

  const filteredTasks = computed(() =>
    taskService.getTasksInParentOrder(
      searchAndSortTasks(
        props.tasks,
        { ...props.filter },
        effectiveSort.value,
      ),
    ),
  );

  const taskById = computed(() => new Map(props.tasks.map((task) => [task.id, task])));

  const getTaskDepth = (task: Task): number => {
    if (!task.parentTaskId) return 0;
    const visited = new Set<string>([task.id]);
    let depth = 0;
    let parentId: string | undefined = task.parentTaskId;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      depth += 1;
      parentId = taskById.value.get(parentId)?.parentTaskId;
    }
    return depth;
  };

  const getParentTitle = (task: Task): string => {
    if (!task.parentTaskId) return '';
    return taskById.value.get(task.parentTaskId)?.title ?? '';
  };

  const columns = computed<Record<TaskStatus, Task[]>>(() => {
    const g: Record<TaskStatus, Task[]> = { todo: [], doing: [], done: [] };
    for (const task of filteredTasks.value) g[task.status].push(task);
    return g;
  });

  const quickActions = useTaskQuickActions(() => emit('refresh'));
  const { blockedInfo, dismissBlockedModal } = quickActions;

  const handleStatusChange = (task: Task, status: TaskStatus): void => {
    quickActions.setStatus(task, status);
  };

  const handleViewBlockedChildren = (): void => {
    const parent = blockedInfo.value?.parent;
    dismissBlockedModal();
    if (parent) handleOpenEdit(parent);
  };

  const handleDragStart = (event: DragEvent, task: Task): void => {
    draggingTaskId.value = task.id;
    event.dataTransfer?.setData('text/plain', task.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  };

  const handleDragOver = (event: DragEvent, status: TaskStatus): void => {
    event.preventDefault();
    dragOverStatus.value = status;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDragLeave = (status: TaskStatus): void => {
    if (dragOverStatus.value === status) {
      dragOverStatus.value = null;
    }
  };

  const handleDrop = (event: DragEvent, status: TaskStatus): void => {
    event.preventDefault();
    const taskId = event.dataTransfer?.getData('text/plain') || draggingTaskId.value;
    draggingTaskId.value = '';
    dragOverStatus.value = null;

    const task = props.tasks.find((item) => item.id === taskId);
    if (!task || task.status === status) return;
    handleStatusChange(task, status);
  };

  const handleDragEnd = (): void => {
    draggingTaskId.value = '';
    dragOverStatus.value = null;
  };

  const handleQuickCreate = (payload: SaveTaskInput): void => {
    taskService.saveTask(payload);
    emit('refresh');
  };
  const handleOpenEdit = (task: Task): void => { editingTask.value = task; editorVisible.value = true; };
  const handleSaved = (): void => { emit('refresh'); };
</script>

<template>
  <section class="kanban-view">
    <!-- Toolbar -->
    <ViewToolbar>
      <template #left>
        <SmartTaskInput @create="handleQuickCreate" />
      </template>
      <template #actions>
      </template>
    </ViewToolbar>

    <!-- Board -->
    <div class="board">
      <div v-for="status in statusOrder" :key="status" class="board-column" :class="{ 'board-column--drag-over': dragOverStatus === status }"
        @dragover="handleDragOver($event, status)" @dragleave="handleDragLeave(status)" @drop="handleDrop($event, status)">
        <!-- Column header -->
        <div class="column-header" :style="{ '--col-color': statusMeta[status].color }">
          <span class="col-dot" />
          <span class="col-label">{{ statusMeta[status].label }}</span>
          <span class="count-badge">{{ columns[status].length }}</span>
        </div>

        <!-- Cards -->
        <div class="column-cards">
          <TaskCard v-for="task in columns[status]" :key="task.id" :task="task" variant="panel"
            priority-display="stripe" :show-status-toggle="false" :depth="getTaskDepth(task)"
            :parent-title="getParentTitle(task)" draggable="true"
            :class="{ 'task-card--dragging': draggingTaskId === task.id }" @dragstart="handleDragStart($event, task)"
            @dragend="handleDragEnd" @click="handleOpenEdit">
            <template #actions="{ task: t }">
              <PomodoroStartButton :task="t" />
              <TaskQuickActions :task="t" @cycle-status="quickActions.cycleStatus"
                @set-priority="quickActions.setPriority" @toggle-archive="quickActions.toggleArchive" />
            </template>
          </TaskCard>

          <div v-if="columns[status].length === 0" class="column-empty">暂无任务</div>
        </div>
      </div>
    </div>

    <TaskEditor v-model="editorVisible" :task="editingTask" @saved="handleSaved" />
    <TaskCompletionBlockedModal v-if="blockedInfo" :info="blockedInfo" @cancel="dismissBlockedModal"
      @view-children="handleViewBlockedChildren" />
  </section>
</template>

<style scoped>
  .kanban-view {
    padding: var(--space-4) var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 100%;
    box-sizing: border-box;
  }

  /* Board */
  .board {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(3, minmax(260px, 1fr));
    gap: var(--space-3);
    min-height: 0;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .board-column {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: border-color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast);
  }

  .board-column--drag-over {
    border-color: color-mix(in srgb, var(--color-accent) 55%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-accent-soft) 55%, var(--color-bg-surface));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 30%, transparent);
  }

  /* Column header */
  .column-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-bg-input) 50%, transparent);
    flex-shrink: 0;
  }

  .col-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--col-color);
    flex-shrink: 0;
  }

  .col-label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
    flex: 1;
  }

  /* Cards container */
  .column-cards {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    padding: var(--space-2) var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .column-cards > .task-card {
    flex: 0 0 auto;
  }

  .column-empty {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    text-align: center;
    padding: var(--space-5) 0;
  }

  .kanban-view .task-card[draggable="true"] {
    cursor: grab;
  }

  .kanban-view .task-card--dragging {
    opacity: 0.55;
    cursor: grabbing;
  }

  /* Tablet/compact desktop: keep three columns visible without returning to cramped 220px cards. */
  @media (min-width: 921px) and (max-width: 1100px) {
    .kanban-view {
      padding-left: var(--space-3);
      padding-right: var(--space-3);
    }

    .board {
      grid-template-columns: repeat(3, minmax(240px, 1fr));
    }
  }

  /* Medium window: prioritize card readability and allow horizontal board scroll. */
  @media (min-width: 721px) and (max-width: 920px) {
    .kanban-view {
      padding-left: var(--space-3);
      padding-right: var(--space-3);
    }

    .board {
      grid-template-columns: repeat(3, minmax(300px, 320px));
      justify-content: start;
      overflow-x: auto;
      padding-bottom: var(--space-2);
    }

    .board-column {
      min-width: 300px;
    }
  }

  /* Narrow window: single visible column, horizontal scroll for the rest */
  @media (max-width: 720px) {
    .board {
      grid-template-columns: minmax(260px, 1fr);
      grid-auto-flow: column;
      overflow-x: auto;
      padding-bottom: var(--space-2);
    }

    .board-column {
      min-width: 260px;
    }
  }
</style>