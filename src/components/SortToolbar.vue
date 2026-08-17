<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { DEFAULT_TASK_SORT_CONFIG } from '../services/filterUtils';
import type { TaskSortConfig, TaskSortField } from '../types/task';
import AppIcon from './AppIcon.vue';
import SortPanel from './SortPanel.vue';

const props = defineProps<{
  modelValue: TaskSortConfig;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: TaskSortConfig): void;
  (event: 'reset'): void;
}>();

const open = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const popoverStyle = ref({ left: '8px', top: '8px', maxHeight: 'calc(100dvh - 16px)' });

const fieldLabels: Record<TaskSortField, string> = {
  priority: '优先级',
  dueDate: '截止日期',
  status: '状态',
  group: '分组',
  tags: '标签',
  createdAt: '创建时间',
  updatedAt: '更新时间',
};

const rules = computed(() => props.modelValue);
const isDefault = computed(() => JSON.stringify(props.modelValue) === JSON.stringify(DEFAULT_TASK_SORT_CONFIG));
const summary = computed(() => props.modelValue.map((rule) => `${fieldLabels[rule.field]} ${rule.order === 'asc' ? '↑' : '↓'}`).join(' · '));

const toggle = (): void => {
  if (open.value) {
    close();
    return;
  }
  open.value = true;
  void nextTick(positionPopover);
};

const close = (): void => {
  open.value = false;
};

const positionPopover = (): void => {
  const trigger = triggerRef.value;
  const popover = popoverRef.value;
  if (!open.value || !trigger || !popover) return;

  const padding = 8;
  const gap = 6;
  const triggerRect = trigger.getBoundingClientRect();
  const popoverWidth = popover.offsetWidth;
  const popoverHeight = popover.offsetHeight;
  const availableBelow = window.innerHeight - triggerRect.bottom - gap - padding;
  const availableAbove = triggerRect.top - gap - padding;
  const openAbove = availableBelow < Math.min(popoverHeight, 320) && availableAbove > availableBelow;
  const availableHeight = Math.max(160, openAbove ? availableAbove : availableBelow);
  const height = Math.min(popoverHeight, availableHeight);
  const top = openAbove
    ? Math.max(padding, triggerRect.top - gap - height)
    : Math.min(triggerRect.bottom + gap, window.innerHeight - padding - height);
  const left = Math.min(
    Math.max(padding, triggerRect.right - popoverWidth),
    window.innerWidth - padding - popoverWidth,
  );

  popoverStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    maxHeight: `${availableHeight}px`,
  };
};

const handleDocClick = (event: MouseEvent): void => {
  if (!open.value) return;
  const target = event.target as Node | null;
  if (triggerRef.value?.contains(target)) return;
  if (popoverRef.value?.contains(target)) return;
  close();
};

const handleEsc = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') close();
};

const handleViewportChange = (): void => {
  void nextTick(positionPopover);
};

const update = (next: TaskSortConfig): void => {
  emit('update:modelValue', next);
};

const reset = (): void => {
  emit('reset');
  emit('update:modelValue', DEFAULT_TASK_SORT_CONFIG.map((rule) => ({ ...rule })));
};

onMounted(() => {
  document.addEventListener('mousedown', handleDocClick);
  document.addEventListener('keydown', handleEsc);
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('scroll', handleViewportChange, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleDocClick);
  document.removeEventListener('keydown', handleEsc);
  window.removeEventListener('resize', handleViewportChange);
  window.removeEventListener('scroll', handleViewportChange, true);
});
</script>

<template>
  <div class="sort-toolbar">
    <button
      ref="triggerRef"
      type="button"
      class="sort-trigger btn btn-ghost"
      :class="{ active: open || !isDefault }"
      :aria-expanded="open"
      aria-haspopup="dialog"
      title="排序任务"
      @click="toggle"
    >
      <AppIcon name="arrowDownUp" :size="14" />
      <span>排序</span>
      <span v-if="!isDefault" class="sort-badge" aria-label="已设置排序条件">{{ rules.length }}</span>
      <AppIcon name="chevronDown" :size="12" class="sort-trigger__caret" :class="{ open }" />
    </button>

    <div v-show="open" ref="popoverRef" class="sort-popover" :style="popoverStyle">
      <SortPanel :model-value="modelValue" @update:model-value="update" @reset="reset" />
      <p class="sort-summary" :title="summary">当前：{{ summary }}</p>
    </div>
  </div>
</template>

<style scoped>
.sort-toolbar {
  position: relative;
  display: inline-flex;
}

.sort-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
  height: 30px;
  padding: 0 var(--space-2);
  font-size: var(--text-sm);
}

.sort-trigger.active {
  color: var(--color-accent);
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.sort-trigger__caret {
  transition: transform var(--transition-fast);
}

.sort-trigger__caret.open {
  transform: rotate(180deg);
}

.sort-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--color-accent);
  color: var(--color-text-on-accent, #fff);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}

.sort-popover {
  position: fixed;
  z-index: var(--z-popover, 50);
  overflow-y: auto;
  background: var(--color-bg-elevated, var(--color-bg-base));
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.sort-summary {
  margin: 0;
  padding: 0 var(--space-4) var(--space-3);
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
