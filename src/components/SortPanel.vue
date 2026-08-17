<script setup lang="ts">
import { computed } from 'vue';
import { DEFAULT_TASK_SORT_CONFIG } from '../services/filterUtils';
import type { TaskSortConfig, TaskSortField, TaskSortOrder } from '../types/task';
import AppIcon from './AppIcon.vue';

const props = defineProps<{
  modelValue: TaskSortConfig;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: TaskSortConfig): void;
  (event: 'reset'): void;
}>();

const MAX_RULES = 3;

const fieldOptions: ReadonlyArray<{ value: TaskSortField; label: string }> = [
  { value: 'priority', label: '优先级' },
  { value: 'dueDate', label: '截止日期' },
  { value: 'status', label: '任务状态' },
  { value: 'group', label: '分组' },
  { value: 'tags', label: '标签' },
  { value: 'createdAt', label: '创建时间' },
  { value: 'updatedAt', label: '更新时间' },
];

const orderLabels: Record<TaskSortField, Record<TaskSortOrder, string>> = {
  priority: { asc: '低 → 高', desc: '高 → 低' },
  dueDate: { asc: '最早 → 最晚', desc: '最晚 → 最早' },
  status: { asc: '待办 → 完成', desc: '完成 → 待办' },
  group: { asc: 'A → Z', desc: 'Z → A' },
  tags: { asc: 'A → Z', desc: 'Z → A' },
  createdAt: { asc: '最早 → 最新', desc: '最新 → 最早' },
  updatedAt: { asc: '最早 → 最新', desc: '最新 → 最早' },
};

const rules = computed(() => props.modelValue);

const cloneRules = (value: TaskSortConfig): TaskSortConfig => value.map((rule) => ({ ...rule }));

const availableFields = (index: number): ReadonlyArray<{ value: TaskSortField; label: string }> => {
  const used = new Set(rules.value.filter((_, ruleIndex) => ruleIndex !== index).map((rule) => rule.field));
  return fieldOptions.filter((option) => !used.has(option.value) || option.value === rules.value[index]?.field);
};

const updateRules = (next: TaskSortConfig): void => {
  emit('update:modelValue', cloneRules(next));
};

const updateField = (index: number, field: TaskSortField): void => {
  const next = cloneRules(rules.value);
  const current = next[index];
  if (!current) return;
  next[index] = { field, order: current.order };
  updateRules(next);
};

const toggleOrder = (index: number): void => {
  const next = cloneRules(rules.value);
  const current = next[index];
  if (!current) return;
  next[index] = { ...current, order: current.order === 'asc' ? 'desc' : 'asc' };
  updateRules(next);
};

const removeRule = (index: number): void => {
  if (rules.value.length <= 1) return;
  updateRules(rules.value.filter((_, ruleIndex) => ruleIndex !== index));
};

const addRule = (): void => {
  if (rules.value.length >= MAX_RULES) return;
  const available = availableFields(-1).find((option) => !rules.value.some((rule) => rule.field === option.value));
  if (!available) return;
  updateRules([...rules.value, { field: available.value, order: 'asc' }]);
};

const moveRule = (index: number, offset: number): void => {
  const targetIndex = index + offset;
  if (targetIndex < 0 || targetIndex >= rules.value.length) return;
  const next = cloneRules(rules.value);
  const [moved] = next.splice(index, 1);
  if (!moved) return;
  next.splice(targetIndex, 0, moved);
  updateRules(next);
};

const handleDragStart = (event: DragEvent, index: number): void => {
  event.dataTransfer?.setData('text/plain', String(index));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
};

const handleDrop = (event: DragEvent, targetIndex: number): void => {
  event.preventDefault();
  const sourceIndex = Number(event.dataTransfer?.getData('text/plain'));
  if (!Number.isInteger(sourceIndex) || sourceIndex === targetIndex) return;
  const next = cloneRules(rules.value);
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) return;
  next.splice(targetIndex, 0, moved);
  updateRules(next);
};

const reset = (): void => {
  emit('reset');
  emit('update:modelValue', cloneRules(DEFAULT_TASK_SORT_CONFIG));
};
</script>

<template>
  <div class="sort-panel" role="dialog" aria-modal="true" aria-labelledby="sort-panel-title">
    <header class="sort-panel__header">
      <div>
        <h2 id="sort-panel-title">排序任务</h2>
        <p>按规则顺序逐级比较，越靠前优先级越高</p>
      </div>
      <span class="sort-panel__count">{{ rules.length }}/{{ MAX_RULES }}</span>
    </header>

    <div class="sort-panel__rules">
      <div
        v-for="(rule, index) in rules"
        :key="`${rule.field}-${index}`"
        class="sort-rule"
        draggable="true"
        @dragstart="handleDragStart($event, index)"
        @dragover.prevent
        @drop="handleDrop($event, index)"
      >
        <span class="sort-rule__handle" aria-hidden="true">
          <AppIcon name="gripVertical" :size="16" />
        </span>
        <span class="sort-rule__index">{{ index + 1 }}</span>
        <select
          class="sort-rule__field"
          :aria-label="`第 ${index + 1} 条排序字段`"
          :value="rule.field"
          @change="updateField(index, ($event.target as HTMLSelectElement).value as TaskSortField)"
        >
          <option v-for="option in availableFields(index)" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <button
          type="button"
          class="sort-rule__direction"
          :aria-label="`${fieldOptions.find((option) => option.value === rule.field)?.label}：${orderLabels[rule.field][rule.order]}`"
          :title="orderLabels[rule.field][rule.order]"
          @click="toggleOrder(index)"
        >
          <AppIcon :name="rule.order === 'asc' ? 'arrowUp' : 'arrowDown'" :size="14" />
          <span>{{ orderLabels[rule.field][rule.order] }}</span>
        </button>
        <div class="sort-rule__actions">
          <button type="button" class="sort-rule__move" :disabled="index === 0" :aria-label="`第 ${index + 1} 条上移`" title="上移" @click="moveRule(index, -1)">
            <AppIcon name="arrowUp" :size="14" />
          </button>
          <button type="button" class="sort-rule__move" :disabled="index === rules.length - 1" :aria-label="`第 ${index + 1} 条下移`" title="下移" @click="moveRule(index, 1)">
            <AppIcon name="arrowDown" :size="14" />
          </button>
          <button type="button" class="sort-rule__remove" :disabled="rules.length <= 1" :aria-label="`删除第 ${index + 1} 条排序条件`" title="删除" @click="removeRule(index)">
            <AppIcon name="x" :size="14" />
          </button>
        </div>
      </div>
    </div>

    <div class="sort-panel__footer">
      <button type="button" class="btn btn-ghost btn-sm" title="添加排序条件" :disabled="rules.length >= MAX_RULES" @click="addRule">
        <AppIcon name="plus" :size="14" />
        <span>添加排序条件</span>
      </button>
      <button type="button" class="btn btn-ghost btn-sm" title="恢复默认" @click="reset">
        <AppIcon name="rotateCcw" :size="14" />
        <span>恢复默认</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sort-panel {
  width: min(430px, calc(100vw - 32px));
  padding: var(--space-4);
  color: var(--color-text-primary);
}

.sort-panel__header,
.sort-panel__footer,
.sort-rule,
.sort-rule__actions,
.sort-rule__direction {
  display: flex;
  align-items: center;
}

.sort-panel__header {
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.sort-panel__header h2 {
  margin: 0;
  font-size: var(--text-md);
}

.sort-panel__header p {
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.sort-panel__count {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  white-space: nowrap;
}

.sort-panel__rules {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.sort-rule {
  gap: var(--space-1);
  min-height: 38px;
  padding: var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-bg-surface);
}

.sort-rule:focus-within,
.sort-rule:hover {
  border-color: var(--color-accent);
}

.sort-rule__handle,
.sort-rule__move,
.sort-rule__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
}

.sort-rule__move,
.sort-rule__remove {
  cursor: pointer;
}

.sort-rule__index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-full);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-size: var(--text-xs);
  font-weight: 600;
  flex-shrink: 0;
}

.sort-rule__field {
  min-width: 92px;
  flex: 1;
  height: 30px;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-bg-input);
  color: var(--color-text-primary);
  font-size: var(--text-sm);
}

.sort-rule__direction {
  gap: 3px;
  min-width: 88px;
  height: 30px;
  padding: 0 var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-bg-input);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 11px;
  white-space: nowrap;
}

.sort-rule__actions {
  gap: 0;
}

.sort-rule__move:disabled,
.sort-rule__remove:disabled,
.sort-panel__footer button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.sort-rule__move:hover:not(:disabled),
.sort-rule__remove:hover:not(:disabled) {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.sort-panel__footer {
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

@media (max-width: 560px) {
  .sort-rule__direction {
    min-width: 34px;
    width: 34px;
    padding: 0;
  }

  .sort-rule__direction span {
    display: none;
  }
}
</style>
