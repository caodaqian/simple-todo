<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import AppIcon from '../../components/AppIcon.vue';
import FilterToolbar from '../../components/FilterToolbar.vue';
import PomodoroStatusPill from '../../components/PomodoroStatusPill.vue';
import SettingsPanel from '../../components/SettingsPanel.vue';
import TaskEditor from '../../components/TaskEditor.vue';
import TaskReviewPanel from '../../components/TaskReviewPanel.vue';
import { useImeGuard } from '../../composables/useImeGuard';
import { catchUpReminders, useReminderScheduler } from '../../composables/useReminderScheduler';
import { useUtoolsTaskSearch } from '../../composables/useUtoolsTaskSearch';
import { mergePatch, toggleArrayValue } from '../../services/filterUtils';
import {
    extractTaskGroups,
    extractTaskTags,
    getTaskDateRules,
    isTaskDueToday,
    isTaskInRecentDays,
    isTaskOverdue,
} from '../../services/searchService';
import { settingsService } from '../../services/settingsService';
import { buildSmartOrganizationPlan } from '../../services/smartTaskOrganizerService';
import { stickyNoteService } from '../../services/stickyNoteService';
import { openStickyNoteWindow } from '../../services/stickyWindowService';
import { taskService } from '../../services/taskService';
import { uiStateService } from '../../services/uiStateService';
import type { AppSettings, SavedFilterView, TodoView } from '../../types/settings';
import type { Task, TaskSearchFilter, TaskSortOption } from '../../types/task';
import type { SideSection } from '../../types/uiState';
import CalendarView from '../CalendarView/index.vue';
import EisenhowerView from '../EisenhowerView/index.vue';
import KanbanView from '../KanbanView/index.vue';
import ListView from '../ListView/index.vue';

  /* ── State ─────────────────────────────────────────────────────── */
  const settings = ref<AppSettings>(settingsService.getSettings());
  const settingsPanelVisible = ref(false);
  const editorVisible = ref(false);
  const reviewPanelVisible = ref(false);
  const tasks = ref<Task[]>([]);

  // 视图状态：从持久化 uiState 恢复"上次视图"，重启后保持 currentView/分区/筛选/排序。
  const persistedUiState = uiStateService.getUiState();
  const currentView = ref<TodoView>(persistedUiState.currentView);

  const activeSection = ref<SideSection>(persistedUiState.activeSection);

  // 视图筛选条件——所有视图共享同一份；切换视图保留筛选；保存视图按需快照
  const activeFilter = ref<TaskSearchFilter>(persistedUiState.activeFilter);
  // 视图排序——list/kanban 接收此 prop；eisenhower/calendar 内部硬编码，忽略此 ref
  const activeSort = ref<TaskSortOption>(persistedUiState.activeSort);

  const utoolsTaskSearch = useUtoolsTaskSearch({
    getTitleKeyword: () => activeFilter.value.titleKeyword ?? '',
    onInput: (text) => {
      activeFilter.value = mergePatch(activeFilter.value, { titleKeyword: text.trim() || undefined });
    },
  });

  // 持久化运行时视图状态：任一变化即回写 dbStorage。
  watch(
    [currentView, activeSection, activeFilter, activeSort],
    () => {
      uiStateService.saveUiState({
        currentView: currentView.value,
        activeSection: activeSection.value,
        activeFilter: { ...activeFilter.value },
        activeSort: { ...activeSort.value },
      });
    },
    { deep: true },
  );

  /* ── 当前实际生效的 filter（showCompleted 回退到全局默认）──────── */
  const currentFilter = computed<TaskSearchFilter>(() => ({
    ...activeFilter.value,
    showCompleted: activeFilter.value.showCompleted ?? settings.value.showCompleted,
  }));

  const activeTags = computed<string[]>(() => activeFilter.value.tags ?? []);

  /* ── Saved filter views ─────────────────────────────────────── */
  const savedViews = computed(() => settings.value.savedViews);
  const savingViewMode = ref(false);
  const newViewName = ref('');
  const savedViewInputRef = ref<HTMLInputElement | null>(null);
  const savedViewImeGuard = useImeGuard();

  const saveCurrentView = (): void => {
    savingViewMode.value = true;
    newViewName.value = sectionLabel.value;
    requestAnimationFrame(() => {
      savedViewInputRef.value?.focus();
      savedViewInputRef.value?.select();
    });
  };

  const confirmSaveView = (): void => {
    const name = newViewName.value.trim();
    if (!name) {
      savingViewMode.value = false;
      return;
    }

    settingsService.saveView(name, {
      view: currentView.value,
      section: activeSection.value,
      filter: { ...activeFilter.value },
      sort: { ...activeSort.value },
    });
    settings.value = settingsService.getSettings();
    savingViewMode.value = false;
    newViewName.value = '';
  };

  const onSavedViewKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || savedViewImeGuard.shouldIgnoreKeydown(event)) return;
    event.preventDefault();
    confirmSaveView();
  };

  const cancelSaveView = (): void => {
    savingViewMode.value = false;
    newViewName.value = '';
  };

  const applySavedView = (view: SavedFilterView): void => {
    currentView.value = view.view;
    activeSection.value = view.section as SideSection;
    activeFilter.value = { ...view.filter };
    if (view.sort) {
      activeSort.value = { ...view.sort };
    }
  };

  const deleteSavedView = (id: string): void => {
    settingsService.deleteView(id);
    settings.value = settingsService.getSettings();
  };

  const handleStickyOpenFailure = (reason: string): void => {
    const message = reason === 'utools-unavailable' ? '请在 uTools 插件中打开便签' : '便签窗口创建失败';
    console.warn(message);
  };

  const openCurrentStickyNote = (): void => {
    const result = openStickyNoteWindow(stickyNoteService.buildSourceFromCurrent({
      title: sectionLabel.value,
      view: currentView.value,
      section: activeSection.value,
      filter: { ...currentFilter.value },
      sort: { ...activeSort.value },
    }));
    if (!result.ok) handleStickyOpenFailure(result.reason);
  };

  const openSavedStickyNote = (view: SavedFilterView): void => {
    const result = openStickyNoteWindow(stickyNoteService.buildSourceFromSaved(view));
    if (!result.ok) handleStickyOpenFailure(result.reason);
  };

  /* ── View tabs ────────────────────────────────────────────────── */
  const viewTabs: Array<{ key: TodoView; icon: string; label: string }> = [
    { key: 'list', icon: 'list', label: '列表' },
    { key: 'kanban', icon: 'layoutGrid', label: '看板' },
    { key: 'eisenhower', icon: 'grid2x2', label: '四象限' },
    { key: 'calendar', icon: 'calendar', label: '日历' },
  ];

  /* ── Sidebar sections ─────────────────────────────────────────── */
  const sideSections = [
    { key: 'today' as SideSection, label: '今天', icon: 'sun' },
    { key: 'week' as SideSection, label: '最近7天', icon: 'clock' },
    { key: 'overdue' as SideSection, label: '已过期', icon: 'alarmClock' },
    { key: 'inbox' as SideSection, label: '收集箱', icon: 'inbox' },
    { key: 'done' as SideSection, label: '已完成', icon: 'check' },
    { key: 'archived' as SideSection, label: '已归档', icon: 'archive' },
  ];

  /* ── Tags in sidebar ──────────────────────────────────────────── */
  const activeTasks = computed(() => tasks.value.filter((task) => task.archivedAt === undefined));

  const allTags = computed(() => extractTaskTags(activeTasks.value));

  /* ── Groups in sidebar ────────────────────────────────────── */
  const allGroups = computed(() => extractTaskGroups(activeTasks.value));

  /* ── Section presets：点击侧边栏节点即把对应 filter 预设写入 activeFilter ── */
  const buildSectionPreset = (section: SideSection): TaskSearchFilter => {
    const rules = getTaskDateRules();
    const base: TaskSearchFilter = {};

    switch (section) {
      case 'today':
        return { ...base, dateRange: { start: rules.startOfToday, end: rules.endOfToday }, status: ['todo', 'doing'] };
      case 'week':
        return { ...base, dateRange: { start: rules.startOfToday, end: rules.endOfRecentDays }, status: ['todo', 'doing'] };
      case 'overdue':
        return { ...base, overdueOnly: true, status: ['todo', 'doing'] };
      case 'inbox':
        return base;
      case 'done':
        return { ...base, showCompleted: true, status: 'done' };
      case 'archived':
        return { ...base, archived: true, showCompleted: true };
      default:
        if (section.startsWith('tag:')) {
          const tag = section.slice(4);
          return { ...base, tags: [tag] };
        }
        if (section.startsWith('group:')) {
          const group = section.slice(6);
          return { ...base, group };
        }
        return base;
    }
  };

  const selectSection = (section: SideSection): void => {
    activeSection.value = section;
    activeFilter.value = buildSectionPreset(section);
  };

  /* ── Section label for header ─────────────────────────────────── */
  const sectionLabel = computed(() => {
    const s = activeSection.value;
    if (s.startsWith('tag:')) return `#${s.slice(4)}`;
    if (s.startsWith('group:')) return `~${s.slice(6)}`;
    return sideSections.find(x => x.key === s)?.label ?? '收集箱';
  });

  /* ── Stats per section ────────────────────────────────────────── */
  const sectionCount = (key: SideSection): number => {
    const rules = getTaskDateRules();

    switch (key) {
      case 'today':
        return activeTasks.value.filter(t => isTaskDueToday(t, rules) && t.status !== 'done').length;
      case 'week':
        return activeTasks.value.filter(t => isTaskInRecentDays(t, rules) && t.status !== 'done').length;
      case 'overdue':
        return activeTasks.value.filter(t => isTaskOverdue(t, rules)).length;
      case 'inbox':
        return activeTasks.value.filter(t => t.status !== 'done').length;
      case 'done':
        return activeTasks.value.filter(t => t.status === 'done').length;
      case 'archived':
        return tasks.value.filter(t => t.archivedAt !== undefined).length;
      default:
        if (key.startsWith('group:')) {
          const groupName = key.slice(6);
          return activeTasks.value.filter(t => t.group === groupName).length;
        }
        return 0;
    }
  };

  /* ── Tag filter toggle ────────────────────────────────────────── */
  const toggleTagFilter = (tag: string) => {
    const next = toggleArrayValue(activeFilter.value.tags, tag);
    activeFilter.value = mergePatch(activeFilter.value, { tags: next });
  };

  const resetActiveFilter = (): void => {
    activeFilter.value = {};
  };

  /* ── Data loading ─────────────────────────────────────────────── */
  const loadTasks = (): void => {
    tasks.value = taskService.getAll();
  };

  const handleTaskSaved = (): void => {
    loadTasks();
  };

  const applySmartOrganization = (taskIds: string[]): void => {
    const plan = buildSmartOrganizationPlan(activeTasks.value);
    const selectedIds = new Set(taskIds);
    const selectedChanges = plan.changes.filter((change) => selectedIds.has(change.taskId));
    if (selectedChanges.length === 0) {
      return;
    }

    for (const change of selectedChanges) {
      taskService.update(change.taskId, change.patch);
    }
    loadTasks();
  };

  const handleReviewNavigation = (section: 'overdue' | 'week'): void => {
    selectSection(section);
    reviewPanelVisible.value = false;
  };

  /* ── External change refresh ──────────────────────────────────── */
  // preload MCP tools dispatch this event after writing to dbStorage.
  const TASKS_CHANGED_EVENT = 'jianyue:tasks-changed';
  const handleTasksChanged = (): void => {
    loadTasks();
  };

  // 从持久化 uiState 重新水合四个视图 ref（云同步恢复后同步另一端变更）。
  const reloadUiState = (): void => {
    const restored = uiStateService.getUiState();
    currentView.value = restored.currentView;
    activeSection.value = restored.activeSection;
    activeFilter.value = { ...restored.activeFilter };
    activeSort.value = { ...restored.activeSort };
  };

  /* ── Settings ─────────────────────────────────────────────────── */
  const handleSettingsChange = (next: AppSettings): void => {
    const prevDefaultView = settings.value.defaultView;
    settings.value = next;
    settingsService.saveSettings(next);
    // 仅当默认视图设置本身改变时才同步当前视图，
    // 避免点击【已完成】按钮或切换其它设置时把当前视图拉回默认 list。
    if (prevDefaultView !== next.defaultView) {
      currentView.value = next.defaultView;
    }
  };

  onMounted(() => {
    loadTasks();
    utoolsTaskSearch.activate();
    window.addEventListener(TASKS_CHANGED_EVENT, handleTasksChanged);
    // Fallback: refresh when uTools restores db from cloud.
    const utools = window.utools;
    if (utools && typeof (utools as unknown as { onDbRestore?: unknown }).onDbRestore === 'function') {
      (utools as unknown as { onDbRestore: (cb: () => void) => void }).onDbRestore(() => {
        loadTasks();
        reloadUiState();
      });
    }
    // 启动提醒调度：窗口打开期间实时轮询 + 进入时补报漏掉的提醒。
    useReminderScheduler();
    if (utools && typeof (utools as unknown as { onPluginEnter?: unknown }).onPluginEnter === 'function') {
      (utools as unknown as { onPluginEnter: (cb: () => void) => void }).onPluginEnter(() => {
        loadTasks();
        catchUpReminders();
      });
    } else {
      catchUpReminders();
    }
  });

  onUnmounted(() => {
    utoolsTaskSearch.dispose();
    window.removeEventListener(TASKS_CHANGED_EVENT, handleTasksChanged);
  });
</script>

<template>
  <div class="hub-root">

    <!-- ── Sidebar ──────────────────────────────────────────── -->
    <aside class="hub-sidebar">
      <!-- View mode icons -->
      <nav class="sidebar-views view-tabs" aria-label="视图切换">
        <button v-for="tab in viewTabs" :key="tab.key" class="view-tab"
          :class="{ active: currentView === tab.key }" :title="tab.label"
          :aria-current="currentView === tab.key ? 'page' : undefined"
          @click="currentView = tab.key">
          <AppIcon :name="tab.icon" :size="16" />
          <span class="view-tab__label">{{ tab.label }}</span>
        </button>
      </nav>

      <!-- Sections -->
      <div class="sidebar-sections">
        <button v-for="sec in sideSections" :key="sec.key" class="sidebar-item"
          :class="{ active: activeSection === sec.key }" :aria-label="sec.label"
          @click="selectSection(sec.key)">
          <span class="sidebar-item-icon"><AppIcon :name="sec.icon" :size="16" /></span>
          <span class="sidebar-item-label">{{ sec.label }}</span>
          <span v-if="sectionCount(sec.key) > 0" class="count-badge">
            {{ sectionCount(sec.key) }}
          </span>
        </button>
      </div>

      <!-- Groups -->
      <div class="sidebar-groups-section">
        <div class="sidebar-tags-header">
          <span class="section-label">分组</span>
        </div>
        <button v-for="group in allGroups" :key="group.name" class="sidebar-item sidebar-group-item"
          :class="{ active: activeSection === `group:${group.name}` }" :aria-label="`分组 ${group.name}`"
          @click="selectSection(`group:${group.name}`)">
          <span class="sidebar-item-icon"><AppIcon name="folder" :size="14" /></span>
          <span class="sidebar-item-label">{{ group.name }}</span>
          <span class="count-badge count-badge--muted">{{ group.count }}</span>
        </button>
        <p v-if="allGroups.length === 0" class="sidebar-empty-hint">暂无分组</p>
      </div>

      <!-- Tags -->
      <div class="sidebar-tags-section">
        <div class="sidebar-tags-header">
          <span class="section-label">标签</span>
        </div>
        <button v-for="tag in allTags" :key="tag.name" class="sidebar-item sidebar-tag-item"
          :class="{ active: activeSection === `tag:${tag.name}` }" :aria-label="`标签 ${tag.name}`"
          @click="selectSection(`tag:${tag.name}`)">
          <span class="sidebar-item-icon"><AppIcon name="hash" :size="14" /></span>
          <span class="sidebar-item-label">{{ tag.name }}</span>
          <span class="count-badge count-badge--muted">{{ tag.count }}</span>
        </button>
        <p v-if="allTags.length === 0" class="sidebar-empty-hint">暂无标签</p>
      </div>

      <!-- Saved filter views -->
      <div class="sidebar-saved-views">
        <div class="sidebar-tags-header">
          <span class="section-label">保存视图</span>
          <button class="view-icon-btn save-view-trigger" title="保存当前视图" @click="saveCurrentView">
            <AppIcon name="plus" :size="14" />
          </button>
        </div>

        <div v-if="savingViewMode" class="saved-view-form">
          <label class="sr-only" for="saved-view-name-input">视图名称</label>
          <input
            id="saved-view-name-input"
            ref="savedViewInputRef"
            v-model.trim="newViewName"
            type="text"
            placeholder="视图名称"
            @keydown="onSavedViewKeydown"
            @compositionstart="savedViewImeGuard.onCompositionStart"
            @compositionend="savedViewImeGuard.onCompositionEnd"
            @keydown.esc="cancelSaveView"
            @blur="cancelSaveView"
          />
        </div>

        <div
          v-for="view in savedViews"
          :key="view.id"
          class="sidebar-saved-row"
        >
          <button
            type="button"
            class="sidebar-item sidebar-saved-item"
            :title="`${view.name} · ${view.view}`"
            @click="applySavedView(view)"
          >
            <span class="sidebar-item-icon"><AppIcon name="bookmark" :size="14" /></span>
            <span class="sidebar-item-label">{{ view.name }}</span>
          </button>
          <button type="button" class="saved-view-delete" :title="`删除视图 ${view.name}`" :aria-label="`删除视图 ${view.name}`" @click.stop="deleteSavedView(view.id)">
            <AppIcon name="x" :size="12" />
          </button>
          <button type="button" class="saved-view-delete" :title="`打开便签 ${view.name}`" :aria-label="`打开便签 ${view.name}`" @click.stop="openSavedStickyNote(view)">
            <AppIcon name="pin" :size="12" />
          </button>
        </div>
        <p v-if="savedViews.length === 0 && !savingViewMode" class="sidebar-empty-hint">暂无保存视图</p>
      </div>

      <!-- Bottom actions -->
      <div class="sidebar-bottom">
        <button class="view-icon-btn" title="设置" @click="settingsPanelVisible = true">
          <AppIcon name="settings" :size="18" />
        </button>
      </div>
    </aside>

    <!-- ── Main content ─────────────────────────────────────── -->
    <main class="hub-main">

      <!-- Content header -->
      <header class="hub-header">
        <h1 class="hub-title">{{ sectionLabel }}</h1>

        <!-- Active tag filter chips -->
        <div v-if="activeTags.length > 0" class="hub-header__chips">
          <span v-for="tag in activeTags" :key="tag" class="tag-chip removable"
            @click="toggleTagFilter(tag)">#{{ tag }} <AppIcon name="x" :size="12" /></span>
        </div>

        <div class="hub-header__spacer" />

        <PomodoroStatusPill />

        <button class="btn btn-ghost sticky-open-btn" title="打开当前视图便签" @click="openCurrentStickyNote">
          <AppIcon name="pin" :size="16" />
          <span>便签</span>
        </button>

        <button class="btn btn-ghost sticky-open-btn" :class="{ active: reviewPanelVisible }" title="统计与复盘" @click="reviewPanelVisible = !reviewPanelVisible">
          <AppIcon name="star" :size="16" />
          <span>复盘</span>
        </button>

        <!-- 顶部筛选下拉（带已应用数量徽标） -->
        <FilterToolbar
          v-model="activeFilter"
          :available-tags="allTags.map(t => t.name)"
          @reset="resetActiveFilter"
        />

        <button class="btn-primary hub-add-btn" @click="editorVisible = true">
          <AppIcon name="plus" :size="16" />
          <span class="hub-add-btn__label">新建任务</span>
        </button>
      </header>

      <!-- Tag filter chips bar (from tasks in view) -->
      <div v-if="allTags.length > 0" class="tag-filter-bar">
        <span v-for="tag in allTags.slice(0, 12)" :key="tag.name" class="tag-chip"
          :class="{ 'chip--active': activeTags.includes(tag.name) }" style="cursor:pointer"
          @click="toggleTagFilter(tag.name)">#{{ tag.name }}</span>
      </div>

      <TaskReviewPanel
        v-if="reviewPanelVisible"
        :tasks="tasks"
        @navigate="handleReviewNavigation"
        @organize="applySmartOrganization"
      />

      <!-- Views -->
      <div class="hub-view-container">
        <ListView
          v-if="currentView === 'list'"
          :tasks="tasks"
          :filter="currentFilter"
          v-model:sort="activeSort"
          @refresh="loadTasks"
        />
        <KanbanView
          v-else-if="currentView === 'kanban'"
          :tasks="tasks"
          :filter="currentFilter"
          v-model:sort="activeSort"
          @refresh="loadTasks"
        />
        <EisenhowerView v-else-if="currentView === 'eisenhower'" :tasks="tasks" :filter="currentFilter" @refresh="loadTasks" />
        <CalendarView v-else :tasks="tasks" :filter="currentFilter" @refresh="loadTasks" />
      </div>
    </main>

    <!-- ── Overlays ─────────────────────────────────────────── -->
    <TaskEditor v-model="editorVisible" :task="null" @saved="handleTaskSaved" />
    <SettingsPanel v-model="settingsPanelVisible" :settings="settings" @change="handleSettingsChange"
      @refresh="loadTasks" />
  </div>
</template>

<style scoped>

  /* ── Layout ─────────────────────────────────────────────────── */
  .hub-root {
    display: flex;
    height: 100vh;
    overflow: hidden;
    background: var(--color-bg-app);
  }

  /* ── Sidebar ────────────────────────────────────────────────── */
  .hub-sidebar {
    display: flex;
    flex-direction: column;
    width: 220px;
    min-width: 220px;
    background: var(--color-bg-sidebar);
    border-right: 1px solid var(--color-border);
    overflow-y: auto;
    overflow-x: hidden;
  }

  /* View mode icons */
  .sidebar-views {
    padding: var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-1);
    background: var(--color-bg-input);
    border-radius: var(--radius-md);
    margin: var(--space-3);
    width: auto;
  }

  .sidebar-views .view-tab {
    height: 32px;
    justify-content: center;
    padding: 0 var(--space-2);
    gap: var(--space-1);
    font-size: var(--text-sm);
  }

  .view-icon-btn {
    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 16px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }

  .view-icon-btn:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .view-icon-btn.active {
    background: var(--color-accent-soft);
    color: var(--color-accent);
  }

  /* Sections */
  .sidebar-sections {
    padding: 8px 8px 4px;
  }

  .sidebar-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 8px;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 13px;
    text-align: left;
    transition: background 0.12s, color 0.12s;
  }

  .sidebar-item:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }

  .sidebar-item.active {
    background: var(--color-bg-active);
    color: var(--color-text-primary);
  }

  .sidebar-item-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    flex-shrink: 0;
    color: var(--color-text-muted);
  }

  .sidebar-item.active .sidebar-item-icon {
    color: var(--color-accent);
  }

  .sidebar-item-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Tags */
  .sidebar-tags-section {
    padding: 4px 8px 8px;
  }

  .sidebar-tags-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px 4px;
  }

  .sidebar-tag-item {
    font-size: 13px;
  }

  .sidebar-empty-hint {
    font-size: 12px;
    color: var(--color-text-muted);
    padding: 4px 8px;
    margin: 0;
  }

  /* Saved views */
  .sidebar-saved-views {
    padding: 4px 8px 8px;
    border-top: 1px solid var(--color-border-subtle);
  }

  .save-view-trigger {
    width: 20px;
    height: 20px;
    font-size: 14px;
    line-height: 1;
  }

  .saved-view-form {
    padding: 4px 8px 8px;
  }

  .saved-view-form input {
    width: 100%;
    height: 28px;
    padding: 4px 8px;
    font-size: 12px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    background: var(--color-bg-input);
    color: var(--color-text-primary);
    box-sizing: border-box;
  }

  .saved-view-form input:focus {
    outline: none;
    border-color: var(--color-accent);
  }

  .sidebar-saved-row {
    display: flex;
    align-items: center;
    gap: 2px;
    width: 100%;
  }

  .sidebar-saved-item {
    flex: 1;
    min-width: 0;
    font-size: 13px;
  }

  .saved-view-delete {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 0;
    opacity: 0;
    transition: opacity var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
  }

  .sidebar-saved-row:hover .saved-view-delete,
  .sidebar-saved-row:focus-within .saved-view-delete {
    opacity: 1;
  }

  .saved-view-delete:hover {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  /* Bottom */
  .sidebar-bottom {
    padding: 8px 12px 12px;
    border-top: 1px solid var(--color-border-subtle);
    display: flex;
    gap: 4px;
    margin-top: auto;
  }

  /* ── Main ────────────────────────────────────────────────────── */
  .hub-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  .hub-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-5);
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .hub-title {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--color-text-primary);
    flex-shrink: 0;
  }

  .hub-header__chips {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
    min-width: 0;
    overflow: hidden;
  }

  .hub-header__spacer {
    flex: 1;
    min-width: 0;
  }

  .hub-add-btn {
    flex-shrink: 0;
    padding: var(--space-1) var(--space-3);
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .tag-filter-bar {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
    padding: var(--space-2) var(--space-5);
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .hub-view-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  /* ── Responsive: compact small-window navigation ─────────────── */
  @media (max-width: 720px) {
    .hub-root {
      flex-direction: column;
    }

    .hub-sidebar {
      width: 100%;
      min-width: 0;
      max-height: 112px;
      flex-direction: column;
      overflow-x: auto;
      overflow-y: hidden;
      border-right: none;
      border-bottom: 1px solid var(--color-border-subtle);
      background: color-mix(in srgb, var(--color-bg-surface) 96%, transparent);
    }

    .hub-main {
      min-height: 0;
    }

    .sidebar-views.view-tabs {
      display: flex;
      flex: 0 0 auto;
      gap: var(--space-1);
      margin: var(--space-1) var(--space-2) 0;
      padding: 3px;
      width: max-content;
      min-width: calc(100% - var(--space-4));
      border-bottom: none;
      border-radius: var(--radius-full);
    }

    .sidebar-views .view-tab {
      flex: 1 0 auto;
      width: auto;
      min-width: 64px;
      height: 30px;
      border-radius: var(--radius-full);
      padding: 0 var(--space-2);
    }

    .view-tab__label {
      display: inline;
      font-size: var(--text-xs);
    }

    .sidebar-sections {
      display: flex;
      gap: var(--space-1);
      padding: var(--space-1) var(--space-2) var(--space-2);
      overflow-x: auto;
      flex: 0 0 auto;
    }

    .sidebar-item {
      width: auto;
      min-width: max-content;
      justify-content: center;
      gap: 4px;
      padding: 5px var(--space-2);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-full);
      background: var(--color-bg-elevated);
      font-size: var(--text-xs);
    }

    .sidebar-item.active {
      border-color: color-mix(in srgb, var(--color-accent) 34%, transparent);
      background: var(--color-accent-soft);
      color: var(--color-accent);
    }

    .sidebar-item-icon {
      width: 14px;
    }

    .sidebar-item-label {
      display: inline;
      max-width: 5em;
    }

    .sidebar-item .count-badge {
      display: inline-flex;
      transform: scale(0.9);
      transform-origin: center;
    }

    .sidebar-groups-section,
    .sidebar-tags-section,
    .sidebar-saved-views,
    .sidebar-bottom {
      display: none;
    }

    .hub-header {
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1);
      padding: var(--space-2);
    }

    .hub-title {
      max-width: 45vw;
      font-size: var(--text-lg);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hub-header__chips {
      order: 3;
      flex-basis: 100%;
      flex-wrap: nowrap;
      overflow-x: auto;
      padding-bottom: 2px;
    }

    .hub-header__spacer {
      flex: 1 1 auto;
    }

    .sticky-open-btn span,
    .hub-add-btn__label {
      display: none;
    }

    .sticky-open-btn,
    .hub-add-btn {
      width: 32px;
      height: 32px;
      padding: 0;
      justify-content: center;
    }

    .tag-filter-bar {
      flex-wrap: nowrap;
      overflow-x: auto;
      padding: var(--space-1) var(--space-2);
      gap: 4px;
    }

    .tag-filter-bar .tag-chip {
      flex: 0 0 auto;
    }

    .hub-view-container {
      min-height: 0;
    }
  }

  @media (max-width: 480px) {
    .hub-sidebar {
      max-height: 104px;
    }

    .sidebar-views .view-tab {
      min-width: 52px;
      padding: 0 7px;
    }

    .view-tab__label,
    .hub-add-btn__label {
      display: none;
    }

    .sidebar-item-label {
      max-width: 4em;
    }

    .hub-title {
      max-width: 36vw;
    }
  }

  @media (min-width: 721px) and (max-width: 920px) {
    .hub-sidebar {
      width: 176px;
      min-width: 176px;
    }

    .sidebar-views {
      margin: var(--space-2);
      padding: var(--space-2);
    }

    .hub-header {
      padding: var(--space-3);
      gap: var(--space-1);
    }

    .hub-title {
      font-size: var(--text-lg);
    }

    .sticky-open-btn span,
    .hub-add-btn__label {
      display: none;
    }

    .sticky-open-btn,
    .hub-add-btn {
      width: 32px;
      height: 32px;
      padding: 0;
      justify-content: center;
    }

    .tag-filter-bar {
      padding: var(--space-2) var(--space-3);
    }
  }
</style>