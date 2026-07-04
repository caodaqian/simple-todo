<script setup lang="ts">
  import { computed, ref } from 'vue';
  import AppIcon from '../../components/AppIcon.vue';
  import SmartTaskInput from '../../components/SmartTaskInput.vue';
  import TaskCard from '../../components/TaskCard.vue';
  import TaskEditor from '../../components/TaskEditor.vue';
  import ViewToolbar from '../../components/ViewToolbar.vue';
  import { searchAndSortTasks } from '../../services/searchService';
  import { taskService } from '../../services/taskService';
  import type { SaveTaskInput, Task, TaskSearchFilter, TaskSortField, TaskSortOption, TaskStatus } from '../../types/task';

  const props = defineProps<{
    tasks: Task[];
    filter?: TaskSearchFilter;
    sort?: TaskSortOption;
  }>();

  const emit = defineEmits<{
    (e: 'refresh'): void;
    (e: 'update:sort', value: TaskSortOption): void;
  }>();

  const editorVisible = ref(false);
  const editingTask = ref<Task | null>(null);

  const statusOrder: TaskStatus[] = ['todo', 'doing', 'done'];
  const statusMeta: Record<TaskStatus, { label: string; color: string }> = {
    todo: { label: '待办', color: 'var(--color-text-muted)' },
    doing: { label: '进行中', color: 'var(--color-priority-medium)' },
    done: { label: '已完成', color: 'var(--color-status-done)' },
  };

  const otherStatuses = (current: TaskStatus): TaskStatus[] =>
    statusOrder.filter((s) => s !== current);

  const moveIcon = (s: TaskStatus): string =>
    s === 'done' ? 'checkCircle2' : s === 'doing' ? 'play' : 'circle';

  const defaultSortOrder: Record<TaskSortField, 'asc' | 'desc'> = {
    priority: 'desc', dueDate: 'asc', createdAt: 'desc', updatedAt: 'desc',
  };

  const sortOptions: Array<{ label: string; value: TaskSortField }> = [
    { label: '优先级', value: 'priority' },
    { label: '截止时间', value: 'dueDate' },
    { label: '创建时间', value: 'createdAt' },
    { label: '更新时间', value: 'updatedAt' },
  ];

  const sortField = computed<TaskSortField>({
    get: () => (props.sort ? props.sort.field : 'updatedAt'),
    set: (value) => emit('update:sort', { field: value, order: defaultSortOrder[value] }),
  });

  const reloadTasks = (): void => { /* no-op: tasks come from props */ };

  const effectiveSort = computed<TaskSortOption>(() =>
    props.sort ?? { field: 'updatedAt', order: defaultSortOrder.updatedAt },
  );

  const filteredTasks = computed(() =>
    searchAndSortTasks(
      props.tasks,
      { ...props.filter },
      effectiveSort.value,
    ),
  );

  const columns = computed<Record<TaskStatus, Task[]>>(() => {
    const g: Record<TaskStatus, Task[]> = { todo: [], doing: [], done: [] };
    for (const task of filteredTasks.value) g[task.status].push(task);
    return g;
  });

  const handleStatusChange = (taskId: string, status: TaskStatus): void => {
    taskService.changeStatus(taskId, status);
    emit('refresh');
  };

  const handleDelete = (taskId: string): void => {
    taskService.delete(taskId);
    emit('refresh');
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
        <select v-model="sortField" class="sort-select" aria-label="排序方式">
          <option v-for="o in sortOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </template>
    </ViewToolbar>

    <!-- Board -->
    <div class="board">
      <div v-for="status in statusOrder" :key="status" class="board-column">
        <!-- Column header -->
        <div class="column-header" :style="{ '--col-color': statusMeta[status].color }">
          <span class="col-dot" />
          <span class="col-label">{{ statusMeta[status].label }}</span>
          <span class="count-badge">{{ columns[status].length }}</span>
        </div>

        <!-- Cards -->
        <div class="column-cards">
          <TaskCard v-for="task in columns[status]" :key="task.id" :task="task" variant="panel"
            priority-display="stripe" @click="handleOpenEdit">
            <template #actions="{ task: t }">
              <button v-for="s in otherStatuses(status)" :key="s" type="button" class="btn-icon kanban-card__move"
                :title="`移至 ${statusMeta[s].label}`" @click.stop="handleStatusChange(t.id, s)">
                <AppIcon :name="moveIcon(s)" :size="14" />
              </button>
              <button type="button" class="btn-icon btn-danger kanban-card__delete" title="删除"
                @click.stop="handleDelete(t.id)">
                <AppIcon name="trash2" :size="14" />
              </button>
            </template>
          </TaskCard>

          <div v-if="columns[status].length === 0" class="column-empty">暂无任务</div>
        </div>
      </div>
    </div>

    <TaskEditor v-model="editorVisible" :task="editingTask" @saved="handleSaved" />
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

  .sort-select {
    height: 32px;
    min-width: 110px;
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
    background: var(--color-bg-input);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    cursor: pointer;
  }

  /* Board */
  .board {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(3, minmax(220px, 1fr));
    gap: var(--space-3);
    min-height: 0;
    overflow: hidden;
  }

  .board-column {
    display: flex;
    flex-direction: column;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
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
    overflow-y: auto;
    padding: var(--space-2) var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .column-empty {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    text-align: center;
    padding: var(--space-5) 0;
  }

  /* Slotted quick actions — fade by default, reveal on card hover.
     Slotted buttons carry KanbanView's scoped attr, and TaskCard's root
     (.task-card) also carries KanbanView's scoped attr, so plain selectors
     match without :deep. */
  .kanban-card__move,
  .kanban-card__delete {
    width: 26px;
    height: 26px;
    opacity: 0;
    transition: opacity var(--transition-fast);
  }

  .kanban-view .task-card:hover .kanban-card__move,
  .kanban-view .task-card:hover .kanban-card__delete {
    opacity: 1;
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