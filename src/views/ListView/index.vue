<script setup lang="ts">
  import { computed, ref } from 'vue';
  import AppIcon from '../../components/AppIcon.vue';
  import SmartTaskInput from '../../components/SmartTaskInput.vue';
  import TaskCard from '../../components/TaskCard.vue';
  import TaskEditor from '../../components/TaskEditor.vue';
  import ViewToolbar from '../../components/ViewToolbar.vue';
  import { searchAndSortTasks } from '../../services/searchService';
  import { taskService } from '../../services/taskService';
  import type { SaveTaskInput, Task, TaskPriority, TaskSearchFilter, TaskSortField, TaskSortOption, TaskStatus } from '../../types/task';

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

  // 批量操作状态：按 id 集合维护，避免排序/筛选联动问题
  const batchMode = ref(false);
  const selectedIds = ref<Set<string>>(new Set());
  const batchPriority = ref<TaskPriority>('medium');
  const batchGroup = ref('');

  const sortOptions: Array<{ label: string; value: TaskSortField }> = [
    { label: '优先级', value: 'priority' },
    { label: '截止时间', value: 'dueDate' },
    { label: '创建时间', value: 'createdAt' },
    { label: '更新时间', value: 'updatedAt' },
  ];

  const defaultSortOrder: Record<TaskSortField, 'asc' | 'desc'> = {
    priority: 'desc',
    dueDate: 'asc',
    createdAt: 'desc',
    updatedAt: 'desc',
  };

  const sortField = computed<TaskSortField>({
    get: () => (props.sort ? props.sort.field : 'updatedAt'),
    set: (value) => emit('update:sort', { field: value, order: defaultSortOrder[value] }),
  });

  const priorityOptions: Array<{ label: string; value: TaskPriority }> = [
    { label: '低', value: 'low' },
    { label: '中', value: 'medium' },
    { label: '高', value: 'high' },
    { label: '紧急', value: 'urgent' },
  ];

  const reloadTasks = (): void => { /* no-op: tasks come from props */ };

  const effectiveSort = computed<TaskSortOption>(() =>
    props.sort ?? { field: 'updatedAt', order: defaultSortOrder.updatedAt },
  );

  const visibleTasks = computed(() =>
    searchAndSortTasks(
      props.tasks,
      { ...props.filter },
      effectiveSort.value,
    ),
  );

  const selectedCount = computed(() => selectedIds.value.size);

  const groupOptions = computed(() => {
    const set = new Set<string>();
    for (const t of props.tasks) {
      if (t.group) set.add(t.group);
    }
    return [...set].sort();
  });

  const isSelected = (id: string): boolean => selectedIds.value.has(id);

  const toggleSelect = (id: string): void => {
    const next = new Set(selectedIds.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selectedIds.value = next;
  };

  const selectAll = (): void => {
    selectedIds.value = new Set(visibleTasks.value.map((t) => t.id));
  };

  const invertSelect = (): void => {
    const next = new Set(selectedIds.value);
    for (const t of visibleTasks.value) {
      if (next.has(t.id)) {
        next.delete(t.id);
      } else {
        next.add(t.id);
      }
    }
    selectedIds.value = next;
  };

  const clearSelection = (): void => { selectedIds.value = new Set(); };

  const enterBatchMode = (): void => {
    batchMode.value = true;
    clearSelection();
  };

  const exitBatchMode = (): void => {
    batchMode.value = false;
    clearSelection();
  };

  const finalizeBatch = (): void => {
    reloadTasks();
    emit('refresh');
    exitBatchMode();
  };

  const selectedArray = (): string[] => [...selectedIds.value];

  const batchSetStatus = (status: TaskStatus): void => {
    if (selectedIds.value.size === 0) return;
    taskService.bulkUpdate(selectedArray(), { status });
    finalizeBatch();
  };

  const batchSetPriority = (): void => {
    if (selectedIds.value.size === 0) return;
    taskService.bulkUpdate(selectedArray(), { priority: batchPriority.value });
    finalizeBatch();
  };

  const batchSetGroup = (): void => {
    if (selectedIds.value.size === 0) return;
    taskService.bulkUpdate(selectedArray(), { group: batchGroup.value });
    finalizeBatch();
  };

  const batchDelete = (): void => {
    if (selectedIds.value.size === 0) return;
    if (!window.confirm(`确定删除选中的 ${selectedIds.value.size} 条任务？`)) return;
    taskService.bulkDelete(selectedArray());
    finalizeBatch();
  };

  const handleStatusChange = (taskId: string, status: TaskStatus): void => {
    taskService.changeStatus(taskId, status);
    emit('refresh');
  };

  const handleToggleStatusClick = (task: Task): void => {
    handleStatusChange(task.id, task.status === 'done' ? 'todo' : task.status === 'todo' ? 'doing' : 'done');
  };

  const onToggleSelect = (task: Task): void => {
    toggleSelect(task.id);
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
  <section class="list-view">
    <!-- Toolbar -->
    <ViewToolbar>
      <template #left>
        <SmartTaskInput @create="handleQuickCreate" />
      </template>
      <template #actions>
        <select v-model="sortField" class="sort-select" aria-label="排序方式">
          <option v-for="o in sortOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <span class="toolbar-divider" />
        <button type="button" class="btn btn-ghost" :class="{ active: batchMode }"
          @click="batchMode ? exitBatchMode() : enterBatchMode()">
          <AppIcon name="checkCircle2" :size="14" />
          <span>{{ batchMode ? '退出批量' : '批量' }}</span>
        </button>
      </template>
    </ViewToolbar>

    <!-- Batch action bar -->
    <div v-if="batchMode" class="batch-bar">
      <span class="batch-bar__count count-badge count-badge--accent">已选 {{ selectedCount }}</span>
      <span class="toolbar-divider" />
      <div class="batch-bar__group">
        <button type="button" class="btn btn-ghost" @click="selectAll">全选</button>
        <button type="button" class="btn btn-ghost" @click="invertSelect">反选</button>
      </div>
      <span class="toolbar-divider" />
      <div class="batch-bar__group">
        <button type="button" class="btn btn-ghost" @click="batchSetStatus('done')">完成</button>
        <button type="button" class="btn btn-ghost" @click="batchSetStatus('doing')">进行中</button>
        <button type="button" class="btn btn-ghost" @click="batchSetStatus('todo')">待办</button>
      </div>
      <span class="toolbar-divider" />
      <div class="batch-bar__group">
        <select class="batch-select" v-model="batchPriority" @change="batchSetPriority" title="改优先级">
          <option v-for="o in priorityOptions" :key="o.value" :value="o.value">优先级: {{ o.label }}</option>
        </select>
        <input class="batch-input" list="batch-group-options" v-model="batchGroup" placeholder="改分组"
          @keydown.enter.prevent="batchSetGroup" />
        <datalist id="batch-group-options">
          <option v-for="g in groupOptions" :key="g" :value="g" />
        </datalist>
        <button type="button" class="btn btn-ghost" @click="batchSetGroup">应用分组</button>
      </div>
      <span class="toolbar-divider" />
      <div class="batch-bar__group">
        <button type="button" class="btn btn-danger" @click="batchDelete">
          <AppIcon name="trash2" :size="14" /><span>删除</span>
        </button>
        <button type="button" class="btn btn-ghost" @click="exitBatchMode">取消</button>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="visibleTasks.length === 0" class="list-empty">
      <span class="empty-icon">
        <AppIcon name="inbox" :size="36" />
      </span>
      <p>暂无任务</p>
    </div>

    <!-- Task list -->
    <div v-else class="task-list">
      <TaskCard v-for="task in visibleTasks" :key="task.id" :task="task" variant="row" :selectable="batchMode"
        :selected="isSelected(task.id)" @click="handleOpenEdit" @toggle-status="handleToggleStatusClick"
        @toggle-select="onToggleSelect">
        <template #actions="{ task: t }">
          <button v-if="!batchMode" type="button" class="btn-icon btn-danger task-card__delete" title="删除"
            @click.stop="handleDelete(t.id)">
            <AppIcon name="trash2" :size="14" />
          </button>
        </template>
      </TaskCard>
    </div>

    <TaskEditor v-model="editorVisible" :task="editingTask" @saved="handleSaved" />
  </section>
</template>

<style scoped>
  .list-view {
    padding: var(--space-4) var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
  }

  /* Sort select inside the unified toolbar */
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

  /* Active state for the batch toggle (.btn-ghost.active) inside the toolbar */
  .list-view :deep(.btn-ghost).active {
    color: var(--color-accent);
    border-color: var(--color-accent);
    background: var(--color-accent-soft);
  }

  /* Empty state */
  .list-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: 60px 0;
    color: var(--color-text-muted);
  }

  .empty-icon {
    color: var(--color-text-muted);
    opacity: 0.4;
    display: inline-flex;
  }

  .list-empty p {
    margin: 0;
    font-size: var(--text-sm);
  }

  /* Task list */
  .task-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* Slotted delete button: hidden by default, revealed on TaskCard hover.
     The slotted button retains this view's scoped attribute, so the base
     rule matches. The hover part crosses into TaskCard's scope via :deep(). */
  .task-card__delete {
    width: 28px;
    height: 28px;
    opacity: 0;
    transition: opacity var(--transition-fast);
  }

  .list-view :deep(.task-card:hover) .task-card__delete {
    opacity: 1;
  }

  /* Batch action bar */
  .batch-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
    padding: var(--space-2) var(--space-5);
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-bg-surface);
    flex-wrap: wrap;
  }

  .batch-bar__group {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .batch-bar .btn {
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-sm);
  }

  .batch-select,
  .batch-input {
    height: 28px;
    font-size: var(--text-sm);
    padding: 0 var(--space-2);
    background: var(--color-bg-input);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
  }

  .batch-select {
    min-width: 130px;
  }

  .batch-input {
    width: 110px;
  }

  @media (max-width: 720px) {
    .batch-bar {
      flex-wrap: wrap;
    }

    .batch-bar__group {
      flex-wrap: wrap;
    }

    .batch-bar .toolbar-divider {
      display: none;
    }
  }
</style>