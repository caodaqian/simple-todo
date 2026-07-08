<script setup lang="ts">
  import { computed, ref } from 'vue';
  import AppIcon from '../../components/AppIcon.vue';
  import PomodoroStartButton from '../../components/PomodoroStartButton.vue';
  import SmartTaskInput from '../../components/SmartTaskInput.vue';
  import TaskCard from '../../components/TaskCard.vue';
  import TaskEditor from '../../components/TaskEditor.vue';
  import ViewToolbar from '../../components/ViewToolbar.vue';
  import { useTaskHierarchy } from '../../composables/useTaskHierarchy';
  import { searchAndSortTasks } from '../../services/searchService';
  import { taskService } from '../../services/taskService';
  import { taskWorkflowService } from '../../services/taskWorkflowService';
  import type { SaveTaskInput, Task, TaskSearchFilter, TaskStatus } from '../../types/task';

  const props = defineProps<{
    tasks: Task[];
    filter?: TaskSearchFilter;
  }>();

  const emit = defineEmits<{ (e: 'refresh'): void }>();

  type QuadrantKey = 'importantUrgent' | 'importantNotUrgent' | 'urgentNotImportant' | 'notImportantNotUrgent';

  const editorVisible = ref(false);
  const editingTask = ref<Task | null>(null);

  const quadrantMeta: Array<{ key: QuadrantKey; title: string; accent: string; desc: string }> = [
    { key: 'importantUrgent', title: '重要且紧急', accent: 'var(--color-priority-urgent)', desc: '立刻处理' },
    { key: 'importantNotUrgent', title: '重要不紧急', accent: 'var(--color-priority-high)', desc: '计划安排' },
    { key: 'urgentNotImportant', title: '紧急不重要', accent: 'var(--color-priority-medium)', desc: '委托他人' },
    { key: 'notImportantNotUrgent', title: '不重要不紧急', accent: 'var(--color-priority-low)', desc: '考虑放弃' },
  ];

  const resolveQuadrant = (t: Task): QuadrantKey => {
    switch (t.priority) {
      case 'urgent': return 'importantUrgent';
      case 'high': return 'importantNotUrgent';
      case 'medium': return 'urgentNotImportant';
      default: return 'notImportantNotUrgent';
    }
  };

  const filteredTasks = computed(() =>
    taskService.getTasksInParentOrder(
      searchAndSortTasks(
        props.tasks,
        { ...props.filter },
        { field: 'dueDate', order: 'asc' },
      ),
    ),
  );

  const { getTaskDepth, getParentTitle } = useTaskHierarchy(() => props.tasks);

  const quadrants = computed<Record<QuadrantKey, Task[]>>(() => {
    const g: Record<QuadrantKey, Task[]> = {
      importantUrgent: [], importantNotUrgent: [],
      urgentNotImportant: [], notImportantNotUrgent: [],
    };
    for (const t of filteredTasks.value) g[resolveQuadrant(t)].push(t);
    return g;
  });

  const formatDate = (ts?: number): string =>
    ts ? new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '';

  const handleStatusChange = (taskId: string, status: TaskStatus): void => {
    taskWorkflowService.changeStatus(taskId, status);
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
  <section class="eisenhower-view">
    <!-- Toolbar -->
    <ViewToolbar>
      <template #left>
        <SmartTaskInput @create="handleQuickCreate" />
      </template>
      <template #actions>
        <button type="button" class="btn btn-ghost ei-hint-btn" title="判定规则">
          <AppIcon name="info" :size="14" />
          <span class="ei-hint-text">优先级 紧急/高/中/低 分别对应象限 I/II/III/IV</span>
        </button>
      </template>
    </ViewToolbar>

    <!-- Matrix with X/Y axis labels -->
    <div class="matrix">
      <!-- top axis: column labels (重要 / 不重要) -->
      <div class="axis axis--top axis--col" aria-hidden="true">
        <span class="axis-label">重要</span>
        <span class="axis-label">不重要</span>
      </div>
      <!-- left axis: row labels (紧急 / 不紧急) — vertical -->
      <div class="axis axis--left axis--row" aria-hidden="true">
        <span class="axis-label">紧急</span>
        <span class="axis-label">不紧急</span>
      </div>
      <!-- the 4 quadrants in a 2x2 grid -->
      <div class="quadrants">
        <div v-for="quad in quadrantMeta" :key="quad.key" class="quadrant" :style="{ '--q-accent': quad.accent }">
          <div class="quadrant-header">
            <span class="q-dot" />
            <span class="q-title">{{ quad.title }}</span>
            <span class="count-badge">{{ quadrants[quad.key].length }}</span>
            <span class="q-desc">{{ quad.desc }}</span>
          </div>

          <div class="quadrant-cards">
            <TaskCard v-for="task in quadrants[quad.key]" :key="task.id" :task="task" variant="tile"
              priority-display="none" :show-status-toggle="false" :depth="getTaskDepth(task)"
              :parent-title="getParentTitle(task)" @click="handleOpenEdit">
              <template #actions="{ task: t }">
                <PomodoroStartButton :task="t" />
                <button type="button" class="btn-icon q-action-btn" :class="{ active: t.status === 'todo' }" title="待办"
                  @click.stop="handleStatusChange(t.id, 'todo')">
                  <AppIcon name="circle" :size="14" />
                </button>
                <button type="button" class="btn-icon q-action-btn" :class="{ active: t.status === 'doing' }"
                  title="进行中" @click.stop="handleStatusChange(t.id, 'doing')">
                  <AppIcon name="play" :size="14" />
                </button>
                <button type="button" class="btn-icon q-action-btn" :class="{ active: t.status === 'done' }" title="已完成"
                  @click.stop="handleStatusChange(t.id, 'done')">
                  <AppIcon name="check" :size="14" />
                </button>
              </template>
            </TaskCard>

            <div v-if="quadrants[quad.key].length === 0" class="q-empty">暂无任务</div>
          </div>
        </div>
      </div>
    </div>

    <TaskEditor v-model="editorVisible" :task="editingTask" @saved="handleSaved" />
  </section>
</template>

<style scoped>
  .eisenhower-view {
    padding: var(--space-4) var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 100%;
    box-sizing: border-box;
  }

  /* Toolbar hint */
  .ei-hint-btn {
    color: var(--color-text-muted);
    gap: var(--space-1);
  }

  /* Matrix layout with axis labels */
  .matrix {
    flex: 1;
    display: grid;
    grid-template-columns: 22px 1fr;
    grid-template-rows: 22px 1fr;
    grid-template-areas:
      ".    top"
      "left quadrants";
    gap: var(--space-2);
    min-height: 0;
  }

  .axis--top {
    grid-area: top;
  }

  .axis--left {
    grid-area: left;
  }

  .quadrants {
    grid-area: quadrants;
  }

  .axis {
    display: flex;
  }

  .axis--col {
    flex-direction: row;
    gap: var(--space-1);
  }

  .axis--col .axis-label {
    flex: 1;
    text-align: center;
  }

  .axis--row {
    flex-direction: column;
    gap: var(--space-1);
  }

  .axis--row .axis-label {
    flex: 1;
    writing-mode: vertical-rl;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .axis-label {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }

  .quadrants {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
    min-height: 0;
  }

  .quadrant {
    display: flex;
    flex-direction: column;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border-subtle);
    border-top: 3px solid var(--q-accent);
    border-radius: var(--radius-lg);
    overflow: hidden;
    min-height: 0;
  }

  .quadrant-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
    flex-shrink: 0;
  }

  .q-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--q-accent);
    flex-shrink: 0;
  }

  .q-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .q-desc {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .quadrant-cards {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 0;
  }

  .q-empty {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    text-align: center;
    padding: var(--space-4) 0;
  }

  /* Status action buttons (in flow, in TaskCard #actions slot) */
  .q-action-btn {
    width: 24px;
    height: 24px;
    opacity: 0.55;
    transition: opacity var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
  }

  .q-action-btn:hover {
    opacity: 1;
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }

  .q-action-btn.active {
    opacity: 1;
    background: var(--color-accent-soft);
    color: var(--color-accent);
  }

  /* Responsive: narrow screens */
  @media (max-width: 1024px) {
    .ei-hint-text {
      display: none;
    }

    .q-desc {
      display: none;
    }
  }

  @media (max-width: 720px) {
    .matrix {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto 1fr;
      grid-template-areas:
        "top"
        "left"
        "quadrants";
    }

    .axis--top {
      flex-direction: row;
    }

    .axis--left {
      flex-direction: row;
      height: 22px;
    }

    .axis--left .axis-label {
      writing-mode: horizontal-tb;
      transform: none;
    }

    .quadrants {
      grid-template-columns: 1fr;
      grid-template-rows: repeat(4, minmax(120px, 1fr));
      overflow-y: auto;
    }

    .q-desc {
      display: none;
    }
  }
</style>