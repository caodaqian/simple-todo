<script setup lang="ts">
	import { computed, ref } from 'vue';
import {
    PRIORITY_OPTIONS,
    STATUS_OPTIONS,
    TAG_MATCH_MODE_OPTIONS,
    buildDateRange,
    dateToTimestampEnd,
    dateToTimestampStart,
    mergePatch,
    timestampToDateInput,
    toggleArrayValue,
} from '../services/filterUtils';
import type { TagMatchMode, TaskPriority, TaskSearchFilter, TaskStatus } from '../types/task';
import AppIcon from './AppIcon.vue';

	const props = defineProps<{
		modelValue: TaskSearchFilter;
		availableTags?: string[];
	}>();

	const emit = defineEmits<{
		(e: 'update:modelValue', value: TaskSearchFilter): void;
		(e: 'reset'): void;
	}>();

	const priorityLabels: Record<TaskPriority, string> = {
		low: '低',
		medium: '中',
		high: '高',
		urgent: '紧急',
	};

	const statusLabels: Record<TaskStatus, string> = {
		todo: '待办',
		doing: '进行中',
		done: '已完成',
	};

	const matchModeLabels: Record<TagMatchMode, string> = {
		any: '任一',
		all: '全部',
	};

	const keyword = computed<string>({
		get: () => props.modelValue.keyword ?? '',
		set: (v) => emit('update:modelValue', mergePatch(props.modelValue, { keyword: v.trim() ? v : undefined })),
	});
	const keywordInputRef = ref<HTMLInputElement | null>(null);

	const focusKeywordInput = (): void => {
		keywordInputRef.value?.focus();
		keywordInputRef.value?.select();
	};

	defineExpose({ focusKeywordInput });
	const isPrioritySelected = (p: TaskPriority): boolean =>
		Array.isArray(props.modelValue.priority) && props.modelValue.priority.includes(p);

	const isStatusSelected = (s: TaskStatus): boolean =>
		Array.isArray(props.modelValue.status) && props.modelValue.status.includes(s);

	const togglePriority = (p: TaskPriority): void => {
		const arr = toggleArrayValue(props.modelValue.priority as TaskPriority[] | undefined, p) as
			| TaskPriority[]
			| undefined;
		// 单选与多选手感一致：始终保持数组形式以便继续追加
		emit('update:modelValue', mergePatch(props.modelValue, { priority: arr }));
	};

	const toggleStatus = (s: TaskStatus): void => {
		const arr = toggleArrayValue(props.modelValue.status as TaskStatus[] | undefined, s) as
			| TaskStatus[]
			| undefined;
		emit('update:modelValue', mergePatch(props.modelValue, { status: arr }));
	};

	const matchMode = computed<TagMatchMode>({
		get: () => props.modelValue.tagMatchMode ?? 'any',
		set: (m) => emit('update:modelValue', mergePatch(props.modelValue, { tagMatchMode: m })),
	});

	const tagSet = computed<Set<string>>(() => new Set(props.modelValue.tags ?? []));

	const toggleTag = (tag: string): void => {
		const arr = toggleArrayValue(props.modelValue.tags, tag);
		emit(
			'update:modelValue',
			arr
				? mergePatch(props.modelValue, { tags: arr })
				: mergePatch(props.modelValue, { tags: undefined, tagMatchMode: undefined }),
		);
	};

	const dateStartIso = computed<string>({
		get: () => timestampToDateInput(props.modelValue.dateRange?.start),
		set: (iso) => {
			const end = props.modelValue.dateRange?.end;
			const start = dateToTimestampStart(iso);
			emit('update:modelValue', mergePatch(props.modelValue, { dateRange: buildDateRange(start, end) }));
		},
	});

	const dateEndIso = computed<string>({
		get: () => timestampToDateInput(props.modelValue.dateRange?.end),
		set: (iso) => {
			const start = props.modelValue.dateRange?.start;
			const end = dateToTimestampEnd(iso);
			emit('update:modelValue', mergePatch(props.modelValue, { dateRange: buildDateRange(start, end) }));
		},
	});

	const clearDateRange = (): void => {
		if (props.modelValue.dateRange === undefined) return;
		emit('update:modelValue', mergePatch(props.modelValue, { dateRange: undefined }));
	};

	const showCompleted = computed<boolean>({
		get: () => props.modelValue.showCompleted === true,
		set: (v) => emit('update:modelValue', mergePatch(props.modelValue, { showCompleted: v || undefined })),
	});

	const handleReset = (): void => {
		emit('reset');
	};
</script>

<template>
	<div class="filter-panel" role="dialog" aria-label="筛选条件">
		<!-- 关键词 -->
		<div class="filter-row">
			<label class="filter-row__label">关键词</label>
			<div class="filter-row__control">
				<input ref="keywordInputRef" v-model="keyword" type="text" class="filter-input"
					placeholder="按标题或描述搜索" />
				<button v-if="keyword" type="button" class="filter-clear-btn" title="清除关键词"
					@click="keyword = ''">
					<AppIcon name="x" :size="12" />
				</button>
			</div>
		</div>

		<!-- 优先级 -->
		<div class="filter-row">
			<span class="filter-row__label">优先级</span>
			<div class="filter-row__control chip-group">
				<button v-for="p in PRIORITY_OPTIONS" :key="p" type="button" class="chip"
					:class="[`chip--priority-${p}`, { 'chip--active': isPrioritySelected(p) }]"
					@click="togglePriority(p)">
					{{ priorityLabels[p] }}
				</button>
			</div>
		</div>

		<!-- 状态 -->
		<div class="filter-row">
			<span class="filter-row__label">状态</span>
			<div class="filter-row__control chip-group">
				<button v-for="s in STATUS_OPTIONS" :key="s" type="button" class="chip"
					:class="[`chip--status-${s}`, { 'chip--active': isStatusSelected(s) }]"
					@click="toggleStatus(s)">
					{{ statusLabels[s] }}
				</button>
			</div>
		</div>

		<!-- 日期范围 -->
		<div class="filter-row">
			<span class="filter-row__label">截止日期</span>
			<div class="filter-row__control date-range">
				<input v-model="dateStartIso" type="date" class="filter-input date-input" />
				<span class="date-range__sep">—</span>
				<input v-model="dateEndIso" type="date" class="filter-input date-input" />
				<button v-if="modelValue.dateRange" type="button" class="filter-clear-btn inline"
					title="清除日期范围" @click="clearDateRange">
					<AppIcon name="x" :size="12" />
				</button>
			</div>
		</div>

		<!-- 标签匹配模式 + 标签多选 -->
		<div class="filter-row">
			<span class="filter-row__label">标签匹配</span>
			<div class="filter-row__control column">
				<div class="match-mode-toggle">
					<button v-for="m in TAG_MATCH_MODE_OPTIONS" :key="m" type="button" class="chip"
						:class="{ 'chip--active': matchMode === m }"
						:disabled="(modelValue.tags?.length ?? 0) === 0"
						:title="(modelValue.tags?.length ?? 0) === 0 ? '请先选择标签' : matchModeLabels[m]"
						@click="matchMode = m">
						{{ matchModeLabels[m] }}
					</button>
				</div>
				<div v-if="(availableTags?.length ?? 0) > 0" class="chip-group tag-pool">
					<button v-for="tag in availableTags" :key="tag" type="button"
						class="chip chip--tag" :class="{ 'chip--active': tagSet.has(tag) }"
						@click="toggleTag(tag)">
						#{{ tag }}
					</button>
				</div>
				<p v-else class="filter-hint">尚无标签，可在任务中创建后回到这里筛选</p>
			</div>
		</div>

		<!-- 显示已完成开关 -->
		<div class="filter-row">
			<span class="filter-row__label">已完成任务</span>
			<div class="filter-row__control">
				<label class="switch">
					<input v-model="showCompleted" type="checkbox" />
					<span class="switch__track" />
					<span class="switch__label">{{ showCompleted ? '显示' : '隐藏' }}</span>
				</label>
			</div>
		</div>

		<!-- 操作 -->
		<div class="filter-row filter-row--actions">
			<button type="button" class="btn btn-ghost btn-sm" @click="handleReset">
				<AppIcon name="rotateCcw" :size="14" />
				<span>重置全部</span>
			</button>
		</div>
	</div>
</template>

<style scoped>
	.filter-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		min-width: 280px;
		max-width: 360px;
	}

	.filter-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.filter-row__label {
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
		font-weight: 500;
	}

	.filter-row__control {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex-wrap: wrap;
	}

	.filter-row__control.column {
		flex-direction: column;
		align-items: stretch;
	}

	.filter-row--actions {
		flex-direction: row;
		justify-content: flex-end;
		border-top: 1px solid var(--color-border-subtle);
		padding-top: var(--space-3);
	}

	.filter-input {
		flex: 1;
		min-width: 0;
		height: 30px;
		padding: 4px 8px;
		font-size: var(--text-sm);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-sm);
		background: var(--color-bg-input);
		color: var(--color-text-primary);
		box-sizing: border-box;
	}

	.filter-input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px var(--color-accent-soft);
	}

	.date-input {
		flex: 0 0 auto;
		width: auto;
	}

	.date-range__sep {
		color: var(--color-text-muted);
	}

	.chip-group {
		gap: var(--space-1);
	}

	.tag-pool {
		max-height: 120px;
		overflow-y: auto;
	}

	.match-mode-toggle {
		display: flex;
		gap: var(--space-1);
	}

	.match-mode-toggle .chip:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.filter-clear-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border-radius: var(--radius-full);
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		flex-shrink: 0;
	}

	.filter-clear-btn.inline {
		margin-left: var(--space-1);
	}

	.filter-clear-btn:hover {
		background: var(--color-bg-hover);
		color: var(--color-text-primary);
	}

	.filter-hint {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
	}

	.btn-sm {
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-sm);
	}

	.switch {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
		user-select: none;
	}

	.switch input {
		display: none;
	}

	.switch__track {
		width: 32px;
		height: 18px;
		border-radius: var(--radius-full);
		background: var(--color-border-default);
		position: relative;
		transition: background var(--transition-fast);
	}

	.switch__track::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: var(--radius-full);
		background: var(--color-text-invert, #fff);
		transition: transform var(--transition-fast);
	}

	.switch input:checked+.switch__track {
		background: var(--color-accent);
	}

	.switch input:checked+.switch__track::after {
		transform: translateX(14px);
	}

	.switch__label {
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}
</style>