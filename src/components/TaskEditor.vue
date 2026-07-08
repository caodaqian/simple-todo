<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { renderMarkdown } from '../services/markdownService';
import { notify } from '../services/notifyService';
import { taskService } from '../services/taskService';
  import { taskWorkflowService } from '../services/taskWorkflowService';
  import { templateService, type CreateTemplateInput } from '../services/templateService';
  import type { RepeatRule, SaveTaskInput, Task, TaskPriority, TaskStatus, TaskTemplate } from '../types/task';
import { getTaskEnd, getTaskStart } from '../types/task';
import AppIcon from './AppIcon.vue';
  import PomodoroStartButton from './PomodoroStartButton.vue';

  type RepeatFormType = '' | RepeatRule['type'];

  interface TaskEditorForm {
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    group: string;
    tags: string[];
    // 截止时间表单字段
    hasDue: boolean;
    allDay: boolean;
    startDate: string; // YYYY-MM-DD
    startTime: string; // HH:mm（非全天）
    hasEndDate: boolean;
    endDate: string;
    endTime: string;
    description: string;
    reminderOffset: number | null;
    repeatType: RepeatFormType;
    repeatInterval: number;
    repeatUntilDate: string;
  }

  const props = defineProps<{
    modelValue: boolean;
    task?: Task | null;
    initialDueDate?: string;
  }>();

  const emit = defineEmits<{
    (event: 'update:modelValue', value: boolean): void;
    (event: 'saved', task: Task): void;
    (event: 'open-task', task: Task): void;
  }>();

  const statusOptions: Array<{ label: string; value: TaskStatus }> = [
    { label: '待办', value: 'todo' },
    { label: '进行中', value: 'doing' },
    { label: '已完成', value: 'done' },
  ];

  const priorityOptions: Array<{ label: string; value: TaskPriority }> = [
    { label: '低', value: 'low' },
    { label: '中', value: 'medium' },
    { label: '高', value: 'high' },
    { label: '紧急', value: 'urgent' },
  ];

  const form = ref<TaskEditorForm>(makeEmptyForm());
  const currentTask = ref<Task | null>(null);
  const parentTask = ref<Task | null>(null);
  const subtasks = ref<Task[]>([]);
  const newSubtaskTitle = ref('');
  const errorMessage = ref('');
  const templates = ref<TaskTemplate[]>([]);
  const selectedTemplateId = ref('');

  // chip 输入相关
  const tagDraft = ref('');
  const tagInputRef = ref<HTMLInputElement | null>(null);
  const showTagSuggest = ref(false);
  const activeTagIndex = ref(-1);
  const groupDraft = ref('');
  const showGroupSuggest = ref(false);
  const activeGroupIndex = ref(-1);

  // 自动保存相关
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let isFlushing = false;
  let lastFlushedSnapshot = '';

  function makeEmptyForm(): TaskEditorForm {
    return {
      title: '',
      status: 'todo',
      priority: 'medium',
      group: '',
      tags: [],
      hasDue: false,
      allDay: false,
      startDate: '',
      startTime: '09:00',
      hasEndDate: false,
      endDate: '',
      endTime: '10:00',
      description: '',
      reminderOffset: null,
      repeatType: '',
      repeatInterval: 1,
      repeatUntilDate: '',
    };
  }

  const isEditMode = computed(() => !!currentTask.value);
  const isChildTask = computed(() => !!currentTask.value?.parentTaskId);

  // ─── Markdown 实时预览（单区域切换 + 防抖） ────────────────
  // 编辑模式与预览模式共用同一区域：聚焦编辑、失焦后自动渲染预览。
  // 渲染使用防抖，避免每次按键都执行 marked + DOMPurify。
  const descEditing = ref(false);
  const descPreviewHtml = ref('');
  const descTextareaRef = ref<HTMLTextAreaElement | null>(null);
  let descRenderTimer: ReturnType<typeof setTimeout> | null = null;
  let descBlurTimer: ReturnType<typeof setTimeout> | null = null;
  const DESC_RENDER_DEBOUNCE_MS = 300;
  const DESC_BLUR_DELAY_MS = 220;

  const computeDescHtml = (): string => {
    if (!form.value.description.trim()) return '';
    return renderMarkdown(form.value.description);
  };

  const flushDescRender = (): void => {
    if (descRenderTimer) {
      clearTimeout(descRenderTimer);
      descRenderTimer = null;
    }
    descPreviewHtml.value = computeDescHtml();
  };

  const scheduleDescRender = (): void => {
    if (descRenderTimer) clearTimeout(descRenderTimer);
    descRenderTimer = setTimeout(() => {
      descRenderTimer = null;
      descPreviewHtml.value = computeDescHtml();
    }, DESC_RENDER_DEBOUNCE_MS);
  };

  const enterDescEditing = async (): Promise<void> => {
    if (descBlurTimer) {
      clearTimeout(descBlurTimer);
      descBlurTimer = null;
    }
    if (descEditing.value) return;
    descEditing.value = true;
    await nextTick();
    descTextareaRef.value?.focus();
  };

  const scheduleLeaveDescEditing = (): void => {
    if (descBlurTimer) clearTimeout(descBlurTimer);
    descBlurTimer = setTimeout(() => {
      descBlurTimer = null;
      // 切回预览前立即刷新一次，确保预览为最新内容
      flushDescRender();
      descEditing.value = false;
    }, DESC_BLUR_DELAY_MS);
  };

  watch(
    () => form.value.description,
    () => {
      if (descEditing.value) {
        scheduleDescRender();
      } else {
        flushDescRender();
      }
    },
  );

  // ─── 截止时间显示与解析 ───────────────────────────────────
  const formatDateInput = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const formatTimeInput = (ts: number): string => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const dateInputToTimestamp = (date: string, time?: string): number => {
    const parts = date.split('-').map((p) => Number.parseInt(p, 10));
    if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) {
      return Number.NaN;
    }
    if (time) {
      const t = time.split(':').map((p) => Number.parseInt(p, 10));
      return new Date(parts[0]!, parts[1]! - 1, parts[2]!, t[0] ?? 0, t[1] ?? 0).getTime();
    }
    return new Date(parts[0]!, parts[1]! - 1, parts[2]!, 0, 0, 0, 0).getTime();
  };

  const handleReminderOffsetChange = (event: Event): void => {
    const value = (event.target as HTMLSelectElement).value;
    form.value.reminderOffset = value === '' ? null : Number(value);
  };

  const refreshTemplates = (): void => {
    templates.value = templateService.list();
  };

  const applySelectedTemplate = (): void => {
    const tpl = templates.value.find((item) => item.id === selectedTemplateId.value);
    if (!tpl) {
      errorMessage.value = '请选择要套用的模板';
      return;
    }

    form.value.title = tpl.title;
    form.value.priority = tpl.priority;
    form.value.group = tpl.group;
    form.value.tags = [...tpl.tags];
    form.value.description = tpl.description;
    form.value.reminderOffset = tpl.reminderOffset !== undefined ? tpl.reminderOffset : null;
    form.value.repeatType = tpl.repeat?.type ?? '';
    form.value.repeatInterval = tpl.repeat?.interval ?? 1;
    form.value.repeatUntilDate = tpl.repeat?.repeatUntil !== undefined ? formatDateInput(tpl.repeat.repeatUntil) : '';
    errorMessage.value = '';
    flushDescRender();
  };

  const saveCurrentAsTemplate = (): void => {
    const name = window.prompt('请输入模板名称')?.trim();
    if (!name) return;

    const f = form.value;
    const input: CreateTemplateInput = {
      name,
      title: f.title.trim() || name,
      priority: f.priority,
      tags: [...f.tags],
      group: f.group.trim(),
      description: f.description,
    };
    if (f.reminderOffset !== null && f.reminderOffset >= 0) {
      input.reminderOffset = f.reminderOffset;
    }
    if (f.repeatType) {
      const repeat: RepeatRule = {
        type: f.repeatType,
        interval: f.repeatInterval > 0 ? f.repeatInterval : 1,
      };
      if (f.repeatUntilDate) {
        const repeatUntil = dateInputToTimestamp(f.repeatUntilDate);
        if (!Number.isNaN(repeatUntil)) repeat.repeatUntil = repeatUntil;
      }
      input.repeat = repeat;
    }

    const tpl = templateService.create(input);
    refreshTemplates();
    selectedTemplateId.value = tpl.id;
    errorMessage.value = '';
    notify('模板保存成功', `“${tpl.name}”已保存`);
  };

  // 截止时间摘要展示在 hero
  const dueSummary = computed<string>(() => {
    if (!form.value.hasDue || !form.value.startDate) return '';
    const startTs = dateInputToTimestamp(form.value.startDate, form.value.allDay ? undefined : form.value.startTime);
    if (Number.isNaN(startTs)) return '';
    const dateStr = new Date(startTs).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    if (form.value.allDay) {
      if (form.value.hasEndDate && form.value.endDate) {
        const endTs = dateInputToTimestamp(form.value.endDate);
        if (!Number.isNaN(endTs)) {
          const endStr = new Date(endTs).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
          return `${dateStr} ~ ${endStr} 全天`;
        }
      }
      return `${dateStr} 全天`;
    }
    const timeStr = form.value.startTime;
    if (form.value.hasEndDate && form.value.endDate) {
      const endTs = dateInputToTimestamp(form.value.endDate, form.value.endTime);
      if (!Number.isNaN(endTs)) {
        const endDateStr = new Date(endTs).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
        return `${dateStr} ${timeStr} ~ ${endDateStr} ${form.value.endTime}`;
      }
    }
    return `${dateStr} ${timeStr}`;
  });

  const statusLabel = (status: TaskStatus): string =>
    statusOptions.find((item) => item.value === status)?.label ?? status;

  const priorityLabel = (priority: TaskPriority): string =>
    priorityOptions.find((item) => item.value === priority)?.label ?? priority;

  const formatTaskDue = (task: Task): string => {
    const start = getTaskStart(task);
    if (start === undefined) return '无截止时间';
    const dateText = new Date(start).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    if (task.allDay) return `${dateText} 全天`;
    return `${dateText} ${formatTimeInput(start)}`;
  };

  const nextStatus = (status: TaskStatus): TaskStatus => {
    if (status === 'todo') return 'doing';
    if (status === 'doing') return 'done';
    return 'todo';
  };

  const makeLocalSubtask = (title: string): Task => {
    const now = Date.now();
    const draft: Task = {
      id: `draft-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      title,
      status: 'todo',
      priority: form.value.priority,
      tags: [...form.value.tags],
      group: form.value.group.trim(),
      description: '',
      subtasks: [],
      createdAt: now,
      updatedAt: now,
    };
    return draft;
  };

  // ─── 自动补全候选 ──────────────────────────────────────
  // ─── 合并的日期+时间输入值（单一 input） ──────────────────
  // 全天 → "YYYY-MM-DD"；非全天 → "YYYY-MM-DDTHH:mm"
  const startInputValue = computed<string>({
    get: () => {
      const f = form.value;
      if (!f.startDate) return '';
      return f.allDay ? f.startDate : `${f.startDate}T${f.startTime || '09:00'}`;
    },
    set: (v: string) => {
      const f = form.value;
      if (!v) { f.startDate = ''; return; }
      if (f.allDay) {
        f.startDate = v;
      } else {
        const [d, t] = v.split('T');
        f.startDate = d ?? '';
        f.startTime = t ?? '09:00';
      }
    },
  });
  const endInputValue = computed<string>({
    get: () => {
      const f = form.value;
      if (!f.endDate) return '';
      return f.allDay ? f.endDate : `${f.endDate}T${f.endTime || '10:00'}`;
    },
    set: (v: string) => {
      const f = form.value;
      if (!v) { f.endDate = ''; return; }
      if (f.allDay) {
        f.endDate = v;
      } else {
        const [d, t] = v.split('T');
        f.endDate = d ?? '';
        f.endTime = t ?? '10:00';
      }
    },
  });

  // 切换全天时同步默认时间值
  watch(
    () => form.value.allDay,
    (now, prev) => {
      if (now === prev) return;
      if (!now) {
        // 全天 → 非全天：补默认起点时间
        if (!form.value.startTime) form.value.startTime = '09:00';
        if (form.value.hasEndDate && !form.value.endTime) form.value.endTime = '10:00';
      }
    },
  );

  const availableTags = computed<string[]>(() => {
    const used = taskService.getAvailableTags();
    return used.filter((t) => !form.value.tags.includes(t));
  });
  const filteredTagSuggest = computed<string[]>(() => {
    const kw = tagDraft.value.trim().toLowerCase();
    if (!kw) return availableTags.value.slice(0, 8);
    return availableTags.value.filter((t) => t.toLowerCase().includes(kw)).slice(0, 8);
  });
  const availableGroups = computed<string[]>(() => {
    const used = taskService.getAvailableGroups();
    return used.filter((g) => g !== form.value.group);
  });
  const filteredGroupSuggest = computed<string[]>(() => {
    const kw = groupDraft.value.trim().toLowerCase();
    if (!kw) return availableGroups.value.slice(0, 8);
    return availableGroups.value.filter((g) => g.toLowerCase().includes(kw)).slice(0, 8);
  });

  // ─── Tag chip 处理 ──────────────────────────────────────
  const commitTag = (): void => {
    const raw = tagDraft.value.trim();
    if (!raw) return;
    // 支持逗号分隔批量
    const pieces = raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    for (const p of pieces) {
      if (!form.value.tags.includes(p)) {
        form.value.tags = [...form.value.tags, p];
      }
    }
    tagDraft.value = '';
    showTagSuggest.value = false;
    activeTagIndex.value = -1;
  };
  const removeTag = (tag: string): void => {
    form.value.tags = form.value.tags.filter((t) => t !== tag);
  };
  const onTagKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault();
      if (activeTagIndex.value >= 0 && filteredTagSuggest.value[activeTagIndex.value]) {
        const pick = filteredTagSuggest.value[activeTagIndex.value]!;
        if (!form.value.tags.includes(pick)) {
          form.value.tags = [...form.value.tags, pick];
        }
        tagDraft.value = '';
        showTagSuggest.value = false;
        activeTagIndex.value = -1;
        return;
      }
      commitTag();
    } else if (e.key === 'Backspace' && tagDraft.value === '' && form.value.tags.length > 0) {
      form.value.tags = form.value.tags.slice(0, -1);
    } else if (e.key === 'ArrowDown' && filteredTagSuggest.value.length > 0) {
      e.preventDefault();
      showTagSuggest.value = true;
      activeTagIndex.value = Math.min(activeTagIndex.value + 1, filteredTagSuggest.value.length - 1);
    } else if (e.key === 'ArrowUp' && filteredTagSuggest.value.length > 0) {
      e.preventDefault();
      activeTagIndex.value = Math.max(activeTagIndex.value - 1, -1);
    } else if (e.key === 'Escape') {
      showTagSuggest.value = false;
      activeTagIndex.value = -1;
    }
  };
  const onTagFocus = (): void => {
    if (filteredTagSuggest.value.length > 0) showTagSuggest.value = true;
  };
  const onTagBlur = (): void => {
    // 失焦延迟以便让 suggestion mousedown 先触发
    window.setTimeout(() => {
      commitTag();
      showTagSuggest.value = false;
      activeTagIndex.value = -1;
    }, 120);
  };
  const pickTagSuggest = (tag: string): void => {
    if (!form.value.tags.includes(tag)) {
      form.value.tags = [...form.value.tags, tag];
    }
    tagDraft.value = '';
    showTagSuggest.value = false;
    activeTagIndex.value = -1;
    tagInputRef.value?.focus();
  };

  // ─── Group chip 处理 ───────────────────────────────────
  const onGroupKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault();
      if (activeGroupIndex.value >= 0 && filteredGroupSuggest.value[activeGroupIndex.value]) {
        form.value.group = filteredGroupSuggest.value[activeGroupIndex.value]!;
        groupDraft.value = '';
        showGroupSuggest.value = false;
        activeGroupIndex.value = -1;
        return;
      }
      if (groupDraft.value.trim()) {
        form.value.group = groupDraft.value.trim();
        groupDraft.value = '';
      }
    } else if (e.key === 'ArrowDown' && filteredGroupSuggest.value.length > 0) {
      e.preventDefault();
      showGroupSuggest.value = true;
      activeGroupIndex.value = Math.min(activeGroupIndex.value + 1, filteredGroupSuggest.value.length - 1);
    } else if (e.key === 'ArrowUp' && filteredGroupSuggest.value.length > 0) {
      e.preventDefault();
      activeGroupIndex.value = Math.max(activeGroupIndex.value - 1, -1);
    } else if (e.key === 'Escape') {
      showGroupSuggest.value = false;
      activeGroupIndex.value = -1;
    }
  };
  const onGroupFocus = (): void => {
    if (filteredGroupSuggest.value.length > 0) showGroupSuggest.value = true;
  };
  const onGroupBlur = (): void => {
    window.setTimeout(() => {
      if (groupDraft.value.trim()) {
        form.value.group = groupDraft.value.trim();
        groupDraft.value = '';
      }
      showGroupSuggest.value = false;
      activeGroupIndex.value = -1;
    }, 120);
  };
  const removeGroup = (): void => {
    form.value.group = '';
  };
  const pickGroupSuggest = (g: string): void => {
    form.value.group = g;
    groupDraft.value = '';
    showGroupSuggest.value = false;
    activeGroupIndex.value = -1;
  };

  // ─── 表单初始化 ──────────────────────────────────────
  const resetForm = (nextTask: Task | null | undefined = props.task): void => {
    const task = nextTask ?? null;
    currentTask.value = task;
    refreshTemplates();
    selectedTemplateId.value = '';

    if (task) {
      parentTask.value = taskService.getParentTask(task);
      const start = getTaskStart(task);
      const end = getTaskEnd(task);
      const hasDue = start !== undefined;
      const allDay = task.allDay === true;
      const hasEnd = end !== undefined && end !== start;
      const repeat = task.repeat;
      form.value = {
        title: task.title,
        status: task.status,
        priority: task.priority,
        group: task.group,
        tags: [...task.tags],
        hasDue,
        allDay,
        startDate: start !== undefined ? formatDateInput(start) : '',
        startTime: start !== undefined && !allDay ? formatTimeInput(start) : '09:00',
        hasEndDate: hasEnd,
        endDate: hasEnd && end !== undefined ? formatDateInput(end) : '',
        endTime: hasEnd && end !== undefined ? formatTimeInput(end) : '10:00',
        description: task.description,
        reminderOffset: task.reminderOffset !== undefined ? task.reminderOffset : null,
        repeatType: repeat ? repeat.type : '',
        repeatInterval: repeat ? repeat.interval : 1,
        repeatUntilDate: repeat?.repeatUntil ? formatDateInput(repeat.repeatUntil) : '',
      };
      subtasks.value = task.parentTaskId ? [] : taskService.getChildTasks(task.id);
    } else {
      parentTask.value = null;
      form.value = makeEmptyForm();
      if (props.initialDueDate) {
        form.value.hasDue = true;
        form.value.allDay = true;
        form.value.startDate = props.initialDueDate;
      }
      subtasks.value = [];
    }

    tagDraft.value = '';
    groupDraft.value = '';
    showTagSuggest.value = false;
    showGroupSuggest.value = false;
    newSubtaskTitle.value = '';
    errorMessage.value = '';
    lastFlushedSnapshot = formSnapshot();
    // 重置描述预览：立即渲染一次，并回到预览模式
    flushDescRender();
    descEditing.value = false;
  };

  watch(
    () => [props.modelValue, props.task, props.initialDueDate] as const,
    ([visible]) => {
      if (visible) {
        resetForm();
      }
    },
    { immediate: true },
  );

  // ─── 表单快照（用于自动保存脏检测） ────────────────────
  function formSnapshot(): string {
    const f = form.value;
    return JSON.stringify({
      title: f.title,
      status: f.status,
      priority: f.priority,
      group: f.group,
      tags: f.tags,
      hasDue: f.hasDue,
      allDay: f.allDay,
      startDate: f.startDate,
      startTime: f.startTime,
      hasEndDate: f.hasEndDate,
      endDate: f.endDate,
      endTime: f.endTime,
      description: f.description,
      reminderOffset: f.reminderOffset,
      repeatType: f.repeatType,
      repeatInterval: f.repeatInterval,
      repeatUntilDate: f.repeatUntilDate,
    });
  }

  const closeEditor = (): void => {
    emit('update:modelValue', false);
  };

  const handleAddSubtask = (): void => {
    const title = newSubtaskTitle.value.trim();
    if (!title) return;
    errorMessage.value = '';
    if (isChildTask.value) return;
    const task = currentTask.value;
    if (!task) {
      subtasks.value = [...subtasks.value, makeLocalSubtask(title)];
      newSubtaskTitle.value = '';
      return;
    }
    const created = taskService.addSubtask(task.id, title);
    if (!created) {
      errorMessage.value = '新增子任务失败，请重试';
      return;
    }
    subtasks.value = taskService.getChildTasks(task.id);
    newSubtaskTitle.value = '';
    lastFlushedSnapshot = formSnapshot(); // 子任务已落库，避免误触发
    emit('saved', task);
  };

  const handleSubtaskStatusChange = (subtask: Task, status: TaskStatus): void => {
    errorMessage.value = '';
    const task = currentTask.value;
    if (!task) {
      subtasks.value = subtasks.value.map((item) =>
        item.id === subtask.id ? { ...item, status, updatedAt: Date.now() } : item,
      );
      return;
    }
    const updated = taskWorkflowService.changeStatus(subtask.id, status);
    if (!updated) {
      errorMessage.value = '更新子任务状态失败，请重试';
      return;
    }
    subtasks.value = subtasks.value.map((item) =>
      item.id === subtask.id ? updated : item,
    );
    lastFlushedSnapshot = formSnapshot();
    emit('saved', task);
  };

  const handleDeleteSubtask = (subtaskId: string): void => {
    errorMessage.value = '';
    const task = currentTask.value;
    if (!task) {
      subtasks.value = subtasks.value.filter((item) => item.id !== subtaskId);
      return;
    }
    const ok = taskService.deleteSubtask(task.id, subtaskId);
    if (!ok) {
      errorMessage.value = '删除子任务失败，请重试';
      return;
    }
    subtasks.value = subtasks.value.filter((item) => item.id !== subtaskId);
    lastFlushedSnapshot = formSnapshot();
    emit('saved', task);
  };

  const openTaskInEditor = (task: Task): void => {
    const latest = taskService.getById(task.id) ?? task;
    resetForm(latest);
    emit('open-task', latest);
  };

  const openParentTask = (): void => {
    if (!parentTask.value) return;
    openTaskInEditor(parentTask.value);
  };

  // ─── 构建保存 payload ──────────────────────────────
  function buildSavePayload(): SaveTaskInput {
    const f = form.value;
    const title = f.title.trim();
    const task = currentTask.value;

    // 仅当 hasDue 设为 true 才写入截止时间；false 时显式置空
    let dueStart: number | undefined;
    let dueEnd: number | undefined;
    let allDayFlag: boolean | undefined;
    if (f.hasDue && f.startDate) {
      dueStart = dateInputToTimestamp(f.startDate, f.allDay ? undefined : f.startTime);
      if (Number.isNaN(dueStart)) dueStart = undefined;
      allDayFlag = f.allDay;
      if (f.hasEndDate && f.endDate) {
        const endTs = dateInputToTimestamp(f.endDate, f.allDay ? undefined : f.endTime);
        if (!Number.isNaN(endTs) && endTs !== dueStart) {
          dueEnd = endTs;
        }
      }
    }

    let repeatRule: RepeatRule | undefined;
    if (f.repeatType) {
      repeatRule = {
        type: f.repeatType,
        interval: f.repeatInterval > 0 ? f.repeatInterval : 1,
      };
      if (f.repeatUntilDate) {
        const repeatUntil = dateInputToTimestamp(f.repeatUntilDate);
        if (!Number.isNaN(repeatUntil)) repeatRule.repeatUntil = repeatUntil;
      }
    }

    const payload: SaveTaskInput = {
      title,
      status: f.status,
      priority: f.priority,
      group: f.group.trim(),
      tags: [...f.tags],
      description: f.description,
      dueStart,
      dueEnd,
      allDay: allDayFlag,
    };
    if (f.reminderOffset !== null && f.reminderOffset >= 0) {
      payload.reminderOffset = f.reminderOffset;
    } else if (task?.reminderOffset !== undefined) {
      Object.assign(payload, { reminderOffset: undefined });
    }
    if (repeatRule) {
      payload.repeat = repeatRule;
    } else if (task?.repeat !== undefined) {
      Object.assign(payload, { repeat: undefined });
    }
    if (task) {
      payload.id = task.id;
      payload.createdAt = task.createdAt;
      payload.updatedAt = task.updatedAt;
    }
    return payload;
  }

  // ─── 自动保存：编辑模式 800ms 防抖 ────────────────────
  const flushSave = (): void => {
    if (isFlushing) return;
    if (!currentTask.value) return; // 新建模式不自动保存
    const title = form.value.title.trim();
    if (!title) return; // 空标题跳过，不创建
    isFlushing = true;
    try {
      const payload = buildSavePayload();
      const saved = taskService.saveTask(payload);
      currentTask.value = saved;
      lastFlushedSnapshot = formSnapshot();
      emit('saved', saved);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '保存失败';
      errorMessage.value = `自动保存失败: ${errMsg}`;
      console.error('Auto save failed:', err);
    } finally {
      isFlushing = false;
    }
  };

  const scheduleAutoSave = (): void => {
    if (!isEditMode.value) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      const cur = formSnapshot();
      if (cur === lastFlushedSnapshot) return;
      flushSave();
    }, 800);
  };

  watch(
    () => formSnapshot(),
    () => scheduleAutoSave(),
  );

  onBeforeUnmount(() => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    if (descRenderTimer) {
      clearTimeout(descRenderTimer);
      descRenderTimer = null;
    }
    if (descBlurTimer) {
      clearTimeout(descBlurTimer);
      descBlurTimer = null;
    }
  });

  // ─── 新建模式：手动创建 ──────────────────────────────
  const handleCreate = (): void => {
    const title = form.value.title.trim();
    if (!title) {
      errorMessage.value = '任务标题不能为空';
      return;
    }
    errorMessage.value = '';
    try {
      const payload = buildSavePayload();
      // 新建不传 id
      const { id: _omit, ...rest } = payload;
      void _omit;
      const saved = taskService.saveTask(rest);
      for (const child of subtasks.value) {
        taskService.saveTask({
          title: child.title,
          status: child.status,
          priority: child.priority,
          tags: [...child.tags],
          group: child.group,
          description: child.description,
          parentTaskId: saved.id,
          ...(child.dueDate === undefined ? {} : { dueDate: child.dueDate }),
          ...(child.dueStart === undefined ? {} : { dueStart: child.dueStart }),
          ...(child.dueEnd === undefined ? {} : { dueEnd: child.dueEnd }),
          ...(child.allDay === undefined ? {} : { allDay: child.allDay }),
        });
      }
      notify('任务创建成功', `"${title}" 已创建`);
      emit('saved', saved);
      closeEditor();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '创建失败';
      errorMessage.value = `创建任务失败: ${errMsg}`;
      console.error('Create failed:', err);
    }
  };

  // ─── 截止时间清空 ──────────────────────────────────
  const clearDue = (): void => {
    form.value.hasDue = false;
    form.value.startDate = '';
    form.value.startTime = '09:00';
    form.value.hasEndDate = false;
    form.value.endDate = '';
    form.value.endTime = '10:00';
  };
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="task-editor-mask" @click.self="closeEditor">
      <dialog open class="task-editor" aria-label="任务编辑器">
        <header class="task-editor-header">
          <div class="task-editor-heading">
            <p class="task-editor-kicker">任务详情</p>
            <h2>{{ isEditMode ? '编辑任务' : '新建任务' }}</h2>
            <p v-if="isEditMode" class="task-editor-subtitle">编辑后自动保存</p>
          </div>
          <div class="task-editor-actions">
            <button type="button" class="btn btn-ghost btn-icon" title="关闭" aria-label="关闭" @click="closeEditor">
              <AppIcon name="x" :size="18" />
            </button>
          </div>
        </header>

        <div class="task-editor-body">
          <section class="editor-hero-column">
            <div class="hero-panel">
              <div class="hero-meta-row">
                <span class="meta-pill" :class="`status-${form.status}`">
                  {{ statusOptions.find((item) => item.value === form.status)?.label }}
                </span>
                <span class="meta-separator"></span>
                <span class="meta-pill" :class="`priority-${form.priority}`">
                  {{ priorityOptions.find((item) => item.value === form.priority)?.label }}优先级
                </span>
                <template v-if="dueSummary">
                  <span class="meta-separator"></span>
                  <span class="meta-text meta-due">{{ dueSummary }}</span>
                </template>
                <template v-if="parentTask">
                  <span class="meta-separator"></span>
                  <button type="button" class="parent-task-link" @click="openParentTask">
                    属于：{{ parentTask.title }}
                  </button>
                </template>
              </div>

              <label class="title-field">
                <span class="field-label">标题</span>
                <input v-model.trim="form.title" type="text" placeholder="请输入任务标题" class="title-input" />
              </label>
            </div>
          </section>

          <aside class="editor-side-column" aria-label="任务属性">
            <section class="side-card template-card">
              <div class="section-heading compact">
                <div>
                  <p class="section-kicker">模板</p>
                  <h3>任务模板</h3>
                </div>
              </div>

              <label class="field-block">
                <span class="field-label">选择模板</span>
                <select v-model="selectedTemplateId" class="template-select" :disabled="templates.length === 0">
                  <option value="">{{ templates.length > 0 ? '请选择模板' : '暂无模板' }}</option>
                  <option v-for="tpl in templates" :key="tpl.id" :value="tpl.id">{{ tpl.name }}</option>
                </select>
              </label>

              <div class="template-action-row">
                <button type="button" class="btn btn-primary" :disabled="!selectedTemplateId"
                  @click="applySelectedTemplate">一键套用</button>
                <button type="button" class="btn btn-ghost" @click="saveCurrentAsTemplate">保存当前为模板</button>
              </div>
              <p class="field-hint">套用模板不会覆盖当前截止时间。</p>
            </section>

            <section class="side-card">
              <div class="section-heading compact">
                <div>
                  <p class="section-kicker">属性</p>
                  <h3>基础信息</h3>
                </div>
              </div>

              <div class="field-grid two-columns">
                <label class="field-block">
                  <span class="field-label">状态</span>
                  <select v-model="form.status">
                    <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
                  </select>
                </label>
                <label class="field-block">
                  <span class="field-label">优先级</span>
                  <select v-model="form.priority">
                    <option v-for="item in priorityOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
                  </select>
                </label>
              </div>
            </section>

            <section class="side-card">
              <div class="section-heading compact">
                <div>
                  <p class="section-kicker">组织方式</p>
                  <h3>分组与标签</h3>
                </div>
              </div>

              <div class="field-block">
                <span class="field-label">分组</span>
                <label class="sr-only" for="task-group-input">任务分组</label>
                <div class="chip-input-group">
                  <span v-if="form.group" class="preview-chip group-chip">
                    {{ form.group }}
                    <button type="button" class="chip-remove" aria-label="移除分组" @click="removeGroup">×</button>
                  </span>
                  <input
                    v-else
id="task-group-input"
                    v-model="groupDraft"
                    type="text"
                    class="chip-input"
                    placeholder="如：工作 / 生活"
                    @keydown="onGroupKeydown"
                    @focus="onGroupFocus"
                    @blur="onGroupBlur"
                  />
                  <ul v-if="showGroupSuggest && filteredGroupSuggest.length > 0" class="chip-suggest">
                    <li
                      v-for="(g, idx) in filteredGroupSuggest"
                      :key="g"
                      :class="{ active: idx === activeGroupIndex }"
                      @mousedown.prevent="pickGroupSuggest(g)"
                    >{{ g }}</li>
                  </ul>
                </div>
              </div>

              <div class="field-block">
                <span class="field-label">标签</span>
                <label class="sr-only" for="task-tag-input">任务标签</label>
                <div class="chip-input-group">
                  <span v-for="tag in form.tags" :key="tag" class="preview-chip tag-chip">
                    #{{ tag }}
                    <button type="button" class="chip-remove" aria-label="移除标签" @click="removeTag(tag)">×</button>
                  </span>
                  <input
id="task-tag-input"
                    ref="tagInputRef"
                    v-model="tagDraft"
                    type="text"
                    class="chip-input"
                    placeholder="Enter 或逗号确认"
                    @keydown="onTagKeydown"
                    @focus="onTagFocus"
                    @blur="onTagBlur"
                  />
                  <ul v-if="showTagSuggest && filteredTagSuggest.length > 0" class="chip-suggest">
                    <li
                      v-for="(t, idx) in filteredTagSuggest"
                      :key="t"
                      :class="{ active: idx === activeTagIndex }"
                      @mousedown.prevent="pickTagSuggest(t)"
                    >{{ t }}</li>
                  </ul>
                </div>
              </div>
            </section>

            <section class="side-card due-card">
              <div class="section-heading compact">
                <div>
                  <p class="section-kicker">时间</p>
                  <h3>截止时间</h3>
                </div>
                <button v-if="form.hasDue" type="button" class="due-clear-btn" title="移除截止时间" @click="clearDue">
                  <AppIcon name="x" :size="13" />
                </button>
              </div>

              <button
                v-if="!form.hasDue"
                type="button"
                class="due-add-btn"
                @click="form.hasDue = true"
              >
                <AppIcon name="plus" :size="14" />
                <span>添加截止时间</span>
              </button>

              <div v-else class="due-editor">
                <div class="due-row">
                  <div class="due-field" :class="{ 'is-all-day': form.allDay }">
                    <AppIcon name="calendarClock" :size="14" class="due-field-icon" />
                    <input
                      :key="form.allDay ? 'start-date' : 'start-dt'"
                      :type="form.allDay ? 'date' : 'datetime-local'"
                      :value="startInputValue"
                      class="due-input"
                      aria-label="起始时间"
                      @input="startInputValue = ($event.target as HTMLInputElement).value"
                    />
                  </div>
                  <button
                    type="button"
                    class="due-day-toggle"
                    :class="{ active: form.allDay }"
                    :title="form.allDay ? '点击恢复时间' : '切换为全天任务'"
                    @click="form.allDay = !form.allDay"
                  >全天</button>
                </div>

                <div v-if="form.hasEndDate" class="due-row">
                  <div class="due-field">
                    <AppIcon name="calendarClock" :size="14" class="due-field-icon" />
                    <input
                      :key="form.allDay ? 'end-date' : 'end-dt'"
                      :type="form.allDay ? 'date' : 'datetime-local'"
                      :value="endInputValue"
                      class="due-input"
                      aria-label="结束时间"
                      @input="endInputValue = ($event.target as HTMLInputElement).value"
                    />
                  </div>
                </div>

                <label class="due-chip-toggle" :class="{ active: form.hasEndDate }">
                  <input type="checkbox" v-model="form.hasEndDate" />
                  <AppIcon name="calendarClock" :size="13" />
                  <span>时间段</span>
                </label>
              </div>
            </section>

            <section class="side-card reminder-card">
              <div class="section-heading compact">
                <div>
                  <p class="section-kicker">提醒</p>
                  <h3>提前提醒</h3>
                </div>
              </div>

              <label class="field-block">
                <span class="field-label">提前时间</span>
                <div class="reminder-select-row">
                  <select
                    :value="form.reminderOffset ?? ''"
                    class="reminder-select"
                    @change="handleReminderOffsetChange"
                  >
                    <option value="">不提醒</option>
                    <option value="0">准时</option>
                    <option value="5">提前 5 分钟</option>
                    <option value="15">提前 15 分钟</option>
                    <option value="30">提前 30 分钟</option>
                    <option value="60">提前 1 小时</option>
                    <option value="120">提前 2 小时</option>
                    <option value="1440">提前 1 天</option>
                  </select>
                </div>
                <p v-if="!form.hasDue" class="field-hint">需先设置截止时间</p>
                <p class="field-hint">插件窗口打开时实时提醒；关闭后会在下次进入时补报。</p>
              </label>
            </section>

            <section class="side-card repeat-card">
              <div class="section-heading compact">
                <div>
                  <p class="section-kicker">重复</p>
                  <h3>重复规则</h3>
                </div>
              </div>

              <label class="field-block">
                <span class="field-label">重复方式</span>
                <select v-model="form.repeatType" class="repeat-type-select">
                  <option value="">不重复</option>
                  <option value="daily">每天</option>
                  <option value="weekly">每周</option>
                  <option value="monthly">每月</option>
                  <option value="custom">自定义间隔</option>
                </select>
              </label>

              <template v-if="form.repeatType">
                <label v-if="form.repeatType === 'custom'" class="field-block">
                  <span class="field-label">间隔天数</span>
                  <input
                    v-model.number="form.repeatInterval"
                    type="number"
                    min="1"
                    max="365"
                    class="interval-input"
                    placeholder="1"
                  />
                </label>

                <label class="field-block">
                  <span class="field-label">结束日期 <span class="field-hint-inline">（选填）</span></span>
                  <input
                    v-model="form.repeatUntilDate"
                    type="date"
                    class="repeat-date-input"
                    aria-label="重复结束日期"
                  />
                </label>
                <p class="field-hint repeat-hint">完成任务后自动生成下一个实例</p>
              </template>
            </section>
          </aside>

          <section class="editor-main-column">

            <section class="content-card desc-card">
              <div class="section-heading tight">
                <div>
                  <p class="section-kicker">内容</p>
                  <h3>描述</h3>
                </div>
                <span class="section-hint">支持 Markdown · 点击预览可编辑</span>
              </div>
              <div class="desc-shell">
                <label class="sr-only" for="task-description-input">任务描述</label>
                <textarea v-if="descEditing" id="task-description-input" ref="descTextareaRef"
                  v-model="form.description" rows="10" placeholder="支持 Markdown 文本输入，停止输入或失焦后自动预览" class="desc-textarea"
                  @focus="enterDescEditing" @blur="scheduleLeaveDescEditing" />
                <div v-else class="desc-preview" :class="{ 'is-empty': !descPreviewHtml }" @click="enterDescEditing">
                  <div v-if="descPreviewHtml" v-html="descPreviewHtml"></div>
                  <p v-else class="desc-empty">点击此处添加描述（支持 Markdown）</p>
                </div>
              </div>
            </section>

            <section class="content-card subtask-card">
              <div class="section-heading tight">
                <div>
                  <p class="section-kicker">执行项</p>
                  <h3>子任务</h3>
                </div>
                <span class="section-count">{{ subtasks.length }} 项</span>
              </div>

              <div v-if="!isChildTask" class="subtask-create-panel">
                <label class="sr-only" for="new-subtask-title-input">输入子任务标题</label>
                <input id="new-subtask-title-input" v-model.trim="newSubtaskTitle" type="text" placeholder="输入子任务标题"
                  @keydown.enter.prevent="handleAddSubtask" />
                <button type="button" class="btn btn-primary" @click="handleAddSubtask">新增</button>
              </div>
              <p v-else class="subtask-context-hint">当前任务是子任务，可从父任务中管理同级执行项。</p>

              <ul v-if="subtasks.length > 0" class="subtask-list">
                <li v-for="subtask in subtasks" :key="subtask.id" class="subtask-item">
                  <fieldset class="subtask-status-group">
                    <legend class="sr-only">设置子任务状态：{{ subtask.title }}</legend>
                    <button v-for="item in statusOptions" :key="item.value" type="button" class="subtask-status-btn"
                      :class="[`status-${item.value}`, { active: subtask.status === item.value }]" :title="item.label"
                      @click="handleSubtaskStatusChange(subtask, item.value)">{{ item.label }}</button>
                  </fieldset>

                  <button type="button" class="subtask-main" :disabled="!currentTask"
                    @click="openTaskInEditor(subtask)">
                    <span class="subtask-title" :class="{ done: subtask.status === 'done' }">{{ subtask.title }}</span>
                    <span class="subtask-meta-row">
                      <span class="subtask-chip"
                        :class="`priority-${subtask.priority}`">{{ priorityLabel(subtask.priority) }}优先级</span>
                      <span class="subtask-chip muted">{{ formatTaskDue(subtask) }}</span>
                      <span v-if="parentTask" class="subtask-chip muted">属于：{{ parentTask.title }}</span>
                    </span>
                  </button>

                  <div class="subtask-actions">
                    <button type="button" class="subtask-cycle-btn" :class="`status-${subtask.status}`"
                      @click="handleSubtaskStatusChange(subtask, nextStatus(subtask.status))">
                      {{ statusLabel(subtask.status) }}
                    </button>
                    <PomodoroStartButton v-if="currentTask" :task="subtask" />
                    <button v-if="currentTask" type="button" class="btn btn-ghost subtask-open"
                      @click="openTaskInEditor(subtask)">打开</button>
                    <button type="button" class="btn btn-danger subtask-delete"
                      @click="handleDeleteSubtask(subtask.id)">删除</button>
                  </div>
                </li>
              </ul>
              <p v-else class="subtask-empty">{{ isChildTask ? '当前子任务没有下级执行项。' : '暂无子任务，先拆出一个最小行动项。' }}</p>
            </section>
          </section>

        </div>

        <footer class="task-editor-footer">
          <p v-if="errorMessage" class="task-editor-footer-error">{{ errorMessage }}</p>
          <p v-else-if="isEditMode" class="task-editor-footer-hint">改动会自动保存</p>
          <button type="button" class="btn btn-ghost" @click="closeEditor">{{ isEditMode ? '完成' : '取消' }}</button>
          <button v-if="!isEditMode" type="button" class="btn btn-primary" @click="handleCreate">创建任务</button>
        </footer>
      </dialog>
    </div>
  </Teleport>
</template>

<style scoped>
  .task-editor-mask {
    position: fixed;
    inset: 0;
    background: var(--mask-medium);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-dialog);
  }

  .task-editor {
    width: min(960px, calc(100vw - var(--space-6)));
    height: min(720px, calc(100vh - var(--space-6)));
    max-height: calc(100vh - var(--space-6));
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-default);
    background: var(--color-bg-panel);
    color: var(--color-text-primary);
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  .task-editor-header {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border-subtle);
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 8%, transparent), transparent 55%),
      var(--color-bg-panel);
  }

  .task-editor-heading {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .task-editor-subtitle {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .task-editor-kicker,
  .section-kicker {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .task-editor-header h2,
  .section-heading h3 {
    margin: 0;
    font-size: var(--text-md);
    color: var(--color-text-primary);
  }

  .task-editor-actions {
    display: flex;
    align-items: center;
  }

  .task-editor-body {
    overflow: auto;
    padding: var(--space-3);
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    grid-template-areas:
      "hero side"
      "main side";
    gap: var(--space-3);
    align-items: start;
    background: linear-gradient(180deg, color-mix(in srgb, var(--color-bg-base) 18%, transparent), transparent 220px);
  }

  .editor-hero-column {
    grid-area: hero;
    min-width: 0;
  }

  .editor-main-column,
  .editor-side-column {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
    /* 不能用 0：在矮窗口下会让 grid 行的自动最小尺寸塌陷为 0，
       导致内容溢出并与相邻区域重叠（元素堆叠）。 */
    min-height: auto;
  }

  .editor-main-column {
    grid-area: main;
  }

  .editor-side-column {
    grid-area: side;
  }

  .hero-panel,
  .content-card,
  .side-card {
    position: relative;
    background: color-mix(in srgb, var(--color-bg-elevated) 92%, transparent);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
  }

  .hero-panel {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 10%, transparent), transparent 55%),
      color-mix(in srgb, var(--color-bg-elevated) 96%, transparent);
  }

  .hero-meta-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .meta-pill {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid transparent;
    font-weight: 600;
    font-size: var(--text-sm);
  }

  .meta-pill.status-todo {
    background: color-mix(in srgb, var(--color-status-todo) 18%, transparent);
    color: var(--color-status-todo);
    border-color: color-mix(in srgb, var(--color-status-todo) 26%, transparent);
  }

  .meta-pill.status-doing {
    background: var(--color-warning-soft);
    color: var(--color-warning);
    border-color: color-mix(in srgb, var(--color-warning) 28%, transparent);
  }

  .meta-pill.status-done {
    background: var(--color-success-soft);
    color: var(--color-success);
    border-color: color-mix(in srgb, var(--color-success) 28%, transparent);
  }

  .meta-pill.priority-low {
    background: color-mix(in srgb, var(--color-priority-low) 18%, transparent);
    color: var(--color-priority-low);
    border-color: color-mix(in srgb, var(--color-priority-low) 30%, transparent);
  }

  .meta-pill.priority-medium {
    background: color-mix(in srgb, var(--color-priority-medium) 18%, transparent);
    color: var(--color-priority-medium);
    border-color: color-mix(in srgb, var(--color-priority-medium) 30%, transparent);
  }

  .meta-pill.priority-high {
    background: color-mix(in srgb, var(--color-priority-high) 18%, transparent);
    color: var(--color-priority-high);
    border-color: color-mix(in srgb, var(--color-priority-high) 30%, transparent);
  }

  .meta-pill.priority-urgent {
    background: color-mix(in srgb, var(--color-priority-urgent) 18%, transparent);
    color: var(--color-priority-urgent);
    border-color: color-mix(in srgb, var(--color-priority-urgent) 30%, transparent);
  }

  .parent-task-link {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid color-mix(in srgb, var(--color-accent) 28%, transparent);
    background: var(--color-accent-soft);
    color: var(--color-accent);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .parent-task-link:hover {
    border-color: var(--color-accent);
  }

  .meta-separator {
    width: 1px;
    height: 18px;
    background: var(--color-border-default);
  }

  .meta-text {
    color: var(--color-text-muted);
  }

  .title-field,
  .field-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--text-base);
    color: var(--color-text-primary);
    min-width: 0;
  }

  .field-label {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    letter-spacing: 0.04em;
  }

  .title-input {
    min-height: 38px;
    padding: 6px var(--space-2);
    font-size: var(--text-lg);
    font-weight: 700;
    line-height: 1.2;
    background: color-mix(in srgb, var(--color-bg-input) 55%, transparent);
    border-color: transparent;
  }

  .title-input:hover,
  .title-input:focus {
    border-color: var(--color-border-default);
  }

  .content-card,
  .side-card {
    padding: var(--space-3);
  }

  .section-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .section-heading.compact {
    margin-bottom: var(--space-2);
  }

  .section-heading.tight {
    margin-bottom: var(--space-2);
    align-items: baseline;
  }

  .section-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .section-count {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  input,
  select,
  textarea {
    font: inherit;
    color: inherit;
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

  input,
  select,
  textarea {
    min-height: 34px;
  }

  .field-grid {
    display: grid;
    gap: var(--space-2);
  }

  .field-grid.two-columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .field-grid.tight {
    gap: var(--space-2);
  }

  /* 描述：单区域切换式实时预览（编辑/预览共用同一区域） */
  .desc-shell {
    display: block;
  }

  .desc-textarea,
  .desc-preview {
    min-height: 220px;
    max-height: min(34vh, 320px);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-bg-input) 92%, transparent);
    border: 1px solid var(--color-border-subtle);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    overflow: auto;
  }

  .desc-textarea {
    resize: vertical;
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    line-height: 1.5;
    width: 100%;
  }

  .desc-preview {
    cursor: text;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .desc-preview:hover {
    border-color: var(--color-border-strong, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-bg-input) 80%, transparent);
  }

  .desc-preview.is-empty {
    display: flex;
    align-items: center;
    justify-content: flex-start;
  }

  .desc-preview .desc-empty {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .desc-preview :deep(h1),
  .desc-preview :deep(h2),
  .desc-preview :deep(h3) {
    margin: 0.5em 0 0.3em;
    font-size: 1.1em;
    color: var(--color-text-primary);
  }

  .desc-preview :deep(p) { margin: 0.3em 0; }
  .desc-preview :deep(ul),
  .desc-preview :deep(ol) { padding-left: 1.5em; margin: 0.3em 0; }
  .desc-preview :deep(code) { background: var(--overlay-medium); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  .desc-preview :deep(pre) { background: var(--overlay-medium); padding: 8px; border-radius: var(--radius-sm); overflow-x: auto; }
  .desc-preview :deep(a) { color: var(--color-accent); text-decoration: none; }
  .desc-preview :deep(blockquote) { border-left: 3px solid var(--color-accent); padding-left: 10px; margin: 0.5em 0; color: var(--color-text-secondary); }

  .subtask-create-panel {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .subtask-create-panel input {
    flex: 1;
  }

  .subtask-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .subtask-item {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-bg-input) 78%, transparent);
    transition: border-color var(--transition-fast), background var(--transition-fast);
  }

  .subtask-item:hover {
    border-color: var(--color-border-default);
    background: color-mix(in srgb, var(--color-bg-hover) 55%, var(--color-bg-input));
  }

  .subtask-status-group,
  .subtask-actions,
  .subtask-meta-row {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .subtask-status-group {
    flex-wrap: nowrap;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .subtask-status-btn,
  .subtask-cycle-btn {
    min-height: 24px;
    padding: 0 7px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-bg-elevated) 90%, transparent);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .subtask-status-btn.active.status-todo,
  .subtask-cycle-btn.status-todo {
    color: var(--color-status-todo);
    border-color: color-mix(in srgb, var(--color-status-todo) 34%, transparent);
    background: color-mix(in srgb, var(--color-status-todo) 14%, transparent);
  }

  .subtask-status-btn.active.status-doing,
  .subtask-cycle-btn.status-doing {
    color: var(--color-status-doing);
    border-color: color-mix(in srgb, var(--color-status-doing) 34%, transparent);
    background: color-mix(in srgb, var(--color-status-doing) 14%, transparent);
  }

  .subtask-status-btn.active.status-done,
  .subtask-cycle-btn.status-done {
    color: var(--color-status-done);
    border-color: color-mix(in srgb, var(--color-status-done) 34%, transparent);
    background: color-mix(in srgb, var(--color-status-done) 14%, transparent);
  }

  .subtask-main {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    min-width: 0;
    border: none;
    background: transparent;
    color: inherit;
    padding: 0;
    text-align: left;
    cursor: pointer;
  }

  .subtask-main:disabled {
    cursor: default;
  }

  .subtask-title {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-primary);
    font-weight: 600;
  }

  .subtask-title.done {
    text-decoration: line-through;
    color: var(--color-text-muted);
  }

  .subtask-chip {
    display: inline-flex;
    align-items: center;
    min-height: 20px;
    padding: 0 6px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-bg-elevated) 74%, transparent);
    border: 1px solid var(--color-border-subtle);
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
  }

  .subtask-chip.priority-low {
    color: var(--color-priority-low);
  }

  .subtask-chip.priority-medium {
    color: var(--color-priority-medium);
  }

  .subtask-chip.priority-high {
    color: var(--color-priority-high);
  }

  .subtask-chip.priority-urgent {
    color: var(--color-priority-urgent);
  }

  .subtask-chip.muted {
    color: var(--color-text-muted);
  }

  .subtask-context-hint {
    margin: 0 0 var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--color-accent-soft);
    color: var(--color-accent);
    font-size: var(--text-sm);
  }

  .subtask-open,
  .subtask-delete {
    min-height: 26px;
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
  }

  .subtask-empty {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: 1px dashed var(--color-border-default);
    background: color-mix(in srgb, var(--color-bg-input) 72%, transparent);
  }

  .error {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--text-sm);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-danger-soft);
    border: 1px solid color-mix(in srgb, var(--color-danger) 24%, transparent);
  }

  .tag-preview-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: var(--space-2);
  }

  /* chip 输入区域 */
  .chip-input-group {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-height: 34px;
    padding: 4px 6px;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-bg-input) 92%, transparent);
    border: 1px solid var(--color-border-subtle);
  }

  .chip-input {
    flex: 1;
    min-width: 80px;
    min-height: 26px;
    padding: 2px 6px;
    border: none;
    background: transparent;
    box-shadow: none;
  }
  .chip-input:focus,
  .chip-input:hover { border: none; background: transparent; }

  .preview-chip {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 8px;
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: 500;
    border: 1px solid transparent;
  }

  .group-chip {
    background: var(--color-group-bg);
    color: var(--color-group-text);
    border-color: var(--color-group-border);
  }

  .tag-chip {
    background: var(--color-tag-bg);
    color: var(--color-tag-text);
    border-color: var(--color-tag-border);
  }

  .chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: 4px;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    background: color-mix(in srgb, currentColor 18%, transparent);
    color: inherit;
    border-radius: var(--radius-full);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }
  .chip-remove:hover { background: color-mix(in srgb, currentColor 32%, transparent); }

  .chip-suggest {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: var(--z-dropdown, 10);
    margin: 4px 0 0;
    padding: 4px 0;
    list-style: none;
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.25));
    max-height: 220px;
    overflow: auto;
  }
  .chip-suggest li {
    padding: 6px 10px;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .chip-suggest li:hover,
  .chip-suggest li.active {
    background: var(--color-accent-soft);
    color: var(--color-accent);
  }

  /* 截止时间 */
  .due-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .due-add-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 8px;
    border: 1px dashed var(--color-border-default);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-bg-input) 60%, transparent);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all var(--transition-fast, 120ms ease);
  }
  .due-add-btn:hover {
    border-color: var(--color-accent);
    color: var(--color-accent);
    background: var(--color-accent-soft);
  }

  .due-editor {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .due-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 0;
  }

  .due-field {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 30px;
    padding: 0 8px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-bg-input) 92%, transparent);
    color: var(--color-text-primary);
    transition: border-color var(--transition-fast, 120ms ease), background var(--transition-fast, 120ms ease);
  }
  .due-field:hover {
    border-color: var(--color-border-default);
    background: color-mix(in srgb, var(--color-bg-input) 70%, var(--color-bg-hover));
  }
  .due-field:focus-within {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent-soft) 35%, var(--color-bg-input));
    box-shadow: var(--ring-focus);
  }
  .due-field.is-all-day {
    background: var(--color-accent-soft);
    border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
    color: var(--color-accent);
  }
  .due-field-icon {
    flex-shrink: 0;
    color: var(--color-text-muted);
  }
  .due-field.is-all-day .due-field-icon {
    color: var(--color-accent);
  }

  .due-input {
    border: none;
    background: transparent;
    color: inherit;
    font-size: var(--text-sm);
    line-height: 1.4;
    min-height: 0;
    padding: 4px 0;
    flex: 1 1 auto;
    min-width: 0;
    /* 让原生日期/时间选择器遵循当前主题配色（重要） */
    color-scheme: light dark;
  }
  [data-theme="mocha"] .due-input { color-scheme: dark; }
  [data-theme="latte"] .due-input,
  :root .due-input { color-scheme: light; }
  .due-input::-webkit-calendar-picker-indicator {
    filter: var(--due-picker-filter, none);
    cursor: pointer;
  }
  [data-theme="mocha"] .due-input::-webkit-calendar-picker-indicator {
    filter: invert(0.85);
  }
  .due-input:focus { outline: none; }

  .due-day-toggle {
    display: inline-flex;
    align-items: center;
    min-height: 30px;
    padding: 0 10px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border-subtle);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
    flex-shrink: 0;
    transition: all var(--transition-fast, 120ms ease);
  }
  .due-day-toggle:hover {
    border-color: var(--color-border-default);
    color: var(--color-text-primary);
  }
  .due-day-toggle.active {
    background: var(--color-accent-soft);
    border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
    color: var(--color-accent);
    font-weight: 600;
  }

  .due-chip-toggle {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 28px;
    padding: 0 10px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border-subtle);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
    user-select: none;
    transition: all var(--transition-fast, 120ms ease);
  }
  .due-chip-toggle:hover {
    border-color: var(--color-border-default);
    color: var(--color-text-primary);
  }
  .due-chip-toggle.active {
    background: var(--color-accent-soft);
    border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
    color: var(--color-accent);
    font-weight: 600;
  }
  .due-chip-toggle input[type="checkbox"] {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    margin: 0;
  }

  .due-clear-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color var(--transition-fast, 120ms ease), background var(--transition-fast, 120ms ease);
  }
  .due-clear-btn:hover {
    color: var(--color-danger);
    background: var(--color-danger-soft);
  }

  .meta-due {
    color: var(--color-text-primary);
    font-weight: 500;
  }

  .summary-card {
    gap: var(--space-4);
  }

  /* ── 提醒 & 重复 cards ─────────────────────────────── */
  .template-action-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .template-action-row .btn {
    flex: 1 1 120px;
  }

  .reminder-select-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .template-select,
  .reminder-select,
  .repeat-type-select,
  .repeat-date-input,
  .interval-input {
    width: 100%;
    padding: var(--space-1) var(--space-2);
    min-height: 34px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    background: var(--color-bg-input);
    color: var(--color-text-primary);
    font-size: var(--text-sm);
  }

  .interval-input {
    max-width: 80px;
  }

  .repeat-date-input {
    color-scheme: light dark;
  }

  [data-theme="mocha"] .repeat-date-input { color-scheme: dark; }
  [data-theme="latte"] .repeat-date-input,
  :root .repeat-date-input { color-scheme: light; }

  .field-hint {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .field-hint-inline {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-weight: normal;
  }

  .repeat-hint {
    margin-top: var(--space-1);
  }

  .task-editor-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    flex-wrap: wrap;
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-bg-elevated);
    box-shadow: 0 -4px 8px color-mix(in srgb, var(--color-bg-base) 50%, transparent);
    flex-shrink: 0;
  }

  .task-editor-footer-error {
    margin: 0;
    margin-right: auto;
    color: var(--color-danger);
    font-size: var(--text-sm);
  }

  .task-editor-footer-hint {
    margin: 0;
    margin-right: auto;
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .desc-preview {
    font-size: var(--text-sm);
    line-height: 1.55;
    color: var(--color-text-primary);
    overflow: auto;
  }

  .subtask-card {
    min-height: 0;
  }

  .subtask-list {
    max-height: min(26vh, 240px);
    overflow: auto;
    padding-right: 2px;
  }

  @media (max-width: 1040px) {
    .task-editor {
      width: calc(100vw - var(--space-4));
      height: calc(100vh - var(--space-4));
      max-height: calc(100vh - var(--space-4));
    }

    .task-editor-body {
      grid-template-columns: 1fr;
      grid-template-areas:
        "hero"
        "side"
        "main";
    }

    .editor-side-column {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-2);
    }

    .due-card,
    .repeat-card {
      grid-column: span 2;
    }

    .desc-textarea,
    .desc-preview {
      min-height: 160px;
      max-height: min(28vh, 260px);
    }
  }

  @media (max-width: 720px) {
    .task-editor-mask {
      align-items: stretch;
      justify-content: stretch;
      padding: 0;
      background: var(--color-bg-base);
    }

    .task-editor {
      width: 100vw;
      height: 100vh;
      max-height: 100vh;
      border: none;
      border-radius: 0;
      box-shadow: none;
    }

    .task-editor-header {
      align-items: center;
      padding: 6px var(--space-2);
      gap: var(--space-2);
      min-height: 44px;
      background: var(--color-bg-elevated);
      position: sticky;
      top: 0;
      z-index: var(--z-sticky);
    }

    .task-editor-heading {
      min-width: 0;
      gap: 0;
    }

    .task-editor-kicker {
      display: none;
    }

    .task-editor-header h2 {
      font-size: var(--text-lg);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .task-editor-subtitle {
      font-size: var(--text-xs);
    }

    .task-editor-body {
      display: grid;
      grid-template-columns: 1fr;
      grid-template-areas:
        "hero"
        "side"
        "main";
      gap: 6px;
      padding: 6px;
      background: var(--color-bg-base);
    }

    .editor-main-column {
      display: flex;
      gap: 6px;
    }

    .editor-hero-column,
    .editor-main-column,
    .editor-side-column {
      width: 100%;
    }

    .hero-panel {
      padding: 8px 10px;
      gap: var(--space-1);
      border-radius: var(--radius-md);
    }

    .editor-side-column {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }

    .content-card,
    .side-card {
      padding: 8px;
      border-radius: var(--radius-md);
      box-shadow: none;
    }

    .side-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-height: 0;
    }

    .hero-meta-row {
      gap: var(--space-1);
      font-size: var(--text-xs);
    }

    .meta-pill {
      min-height: 22px;
      padding: 0 7px;
      font-size: var(--text-xs);
    }

    .meta-separator {
      display: none;
    }

    .title-input {
      min-height: 32px;
      padding: 4px var(--space-1);
      font-size: var(--text-lg);
    }

    .section-heading {
      margin-bottom: 0;
      gap: var(--space-2);
      align-items: center;
    }

    .section-kicker,
    .section-hint {
      display: none;
    }

    .section-heading h3 {
      font-size: var(--text-sm);
    }

    .field-label {
      font-size: 10px;
    }

    input,
    select,
    textarea,
    .reminder-select,
    .repeat-type-select,
    .repeat-date-input,
    .interval-input {
      min-height: 30px;
      font-size: var(--text-sm);
    }

    .field-block {
      gap: 3px;
    }

    .field-grid {
      gap: 6px;
    }

    .field-grid.two-columns {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .desc-textarea,
    .desc-preview {
      min-height: 96px;
      max-height: 160px;
      padding: var(--space-2);
    }

    .subtask-list {
      max-height: 150px;
    }

    .subtask-item {
      grid-template-columns: 1fr;
      align-items: stretch;
      padding: var(--space-1) var(--space-2);
      gap: var(--space-1);
      border-radius: var(--radius-sm);
    }

    .subtask-status-group,
    .subtask-actions {
      justify-content: flex-start;
    }

    .subtask-delete {
      padding: 0 var(--space-2);
      min-height: 28px;
      font-size: var(--text-xs);
    }

    .due-card {
      grid-column: span 2;
    }

    .due-editor {
      gap: var(--space-1);
    }

    .due-row {
      gap: var(--space-1);
    }

    .due-field,
    .due-day-toggle,
    .due-chip-toggle {
      min-height: 28px;
    }

    .chip-input-group {
      min-height: 30px;
      padding: 3px 5px;
    }

    .subtask-create-panel {
      grid-template-columns: 1fr;
      display: grid;
    }

    .task-editor-footer {
      position: sticky;
      bottom: 0;
      z-index: var(--z-sticky);
      flex-direction: row;
      align-items: center;
      padding: var(--space-2);
      gap: var(--space-2);
    }

    .task-editor-footer-error,
    .task-editor-footer-hint {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .task-editor-footer .btn {
      min-height: 32px;
      padding: 0 var(--space-3);
      width: auto;
      flex-shrink: 0;
    }
  }

  @media (max-width: 480px) {
    .editor-side-column {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .due-card {
      grid-column: span 2;
    }

    .task-editor-footer {
      flex-wrap: nowrap;
    }

    .task-editor-footer .btn {
      padding: 0 var(--space-2);
    }
  }
</style>