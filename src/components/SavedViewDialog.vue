<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { TodoView } from '../types/settings';
import type { TaskSearchFilter, TaskSortOption } from '../types/task';
import AppIcon from './AppIcon.vue';
import FilterPanel from './FilterPanel.vue';

const props = defineProps<{
	modelValue: boolean;
	view: TodoView;
	initialName: string;
	initialFilter: TaskSearchFilter;
	initialSort: TaskSortOption;
	availableTags?: string[];
	availableGroups?: string[];
}>();

const emit = defineEmits<{
	(event: 'update:modelValue', value: boolean): void;
	(event: 'save', payload: { name: string; filter: TaskSearchFilter; sort: TaskSortOption }): void;
}>();

const viewLabels: Record<TodoView, string> = {
	list: '列表',
	kanban: '看板',
	eisenhower: '四象限',
	calendar: '日历',
};

const nameInputRef = ref<HTMLInputElement | null>(null);
const nameDraft = ref('');
const filterDraft = ref<TaskSearchFilter>({});
const sortDraft = ref<TaskSortOption>({ field: 'dueDate' });

const cloneFilter = (filter: TaskSearchFilter): TaskSearchFilter => ({
	...filter,
	...(filter.tags === undefined ? {} : { tags: [...filter.tags] }),
	...(Array.isArray(filter.status) ? { status: [...filter.status] } : {}),
	...(Array.isArray(filter.priority) ? { priority: [...filter.priority] } : {}),
	...(filter.dateRange === undefined ? {} : { dateRange: { ...filter.dateRange } }),
	...(filter.dateRule === undefined ? {} : {
		dateRule: filter.dateRule.preset === 'custom'
			? { ...filter.dateRule }
			: { ...filter.dateRule },
	}),
});

const resetDraft = async (): Promise<void> => {
	nameDraft.value = props.initialName;
	filterDraft.value = cloneFilter(props.initialFilter);
	sortDraft.value = { ...props.initialSort };
	await nextTick();
	nameInputRef.value?.focus();
};

const close = (): void => {
	emit('update:modelValue', false);
};

const save = (): void => {
	const name = nameDraft.value.trim();
	if (!name) return;
	emit('save', {
		name,
		filter: cloneFilter(filterDraft.value),
		sort: { ...sortDraft.value },
	});
	close();
};

const handleEscape = (event: KeyboardEvent): void => {
	if (!props.modelValue || event.key !== 'Escape') return;
	event.preventDefault();
	close();
};

watch(
	() => props.modelValue,
	(visible, previousVisible) => {
		if (visible && !previousVisible) void resetDraft();
	},
);

onMounted(() => {
	document.addEventListener('keydown', handleEscape);
	if (props.modelValue) void resetDraft();
});

onBeforeUnmount(() => {
	document.removeEventListener('keydown', handleEscape);
});
</script>

<template>
	<Teleport to="body">
		<div v-if="modelValue" class="saved-view-dialog-mask" @click.self="close">
			<dialog open class="saved-view-dialog" aria-modal="true" aria-labelledby="saved-view-dialog-title">
				<header class="saved-view-dialog__header">
					<div>
						<h2 id="saved-view-dialog-title">保存当前视图</h2>
						<p>将保存为当前{{ viewLabels[view] }}视图</p>
					</div>
					<button type="button" class="btn btn-ghost btn-icon" aria-label="关闭" title="关闭" @click="close">
						<AppIcon name="x" :size="18" />
					</button>
				</header>

				<div class="saved-view-dialog__body">
					<label class="saved-view-dialog__name-field">
						<span>视图名称</span>
						<input
							ref="nameInputRef"
							v-model="nameDraft"
							name="saved-view-name"
							type="text"
							placeholder="输入视图名称"
						/>
					</label>
					<FilterPanel
						v-model="filterDraft"
						:available-tags="availableTags ?? []"
						:available-groups="availableGroups ?? []"
						@reset="filterDraft = {}"
					/>
				</div>

				<footer class="saved-view-dialog__footer">
					<button type="button" class="btn btn-ghost" @click="close">取消</button>
					<button type="button" class="btn btn-primary" :disabled="!nameDraft.trim()" @click="save">保存</button>
				</footer>
			</dialog>
		</div>
	</Teleport>
</template>

<style scoped>
.saved-view-dialog-mask {
	position: fixed;
	inset: 0;
	display: grid;
	place-items: center;
	padding: var(--space-4);
	background: color-mix(in srgb, var(--color-bg-base) 52%, transparent);
	z-index: var(--z-modal);
}

.saved-view-dialog {
	width: min(100%, 460px);
	max-height: min(760px, calc(100vh - var(--space-8)));
	margin: 0;
	padding: 0;
	border: 1px solid var(--color-border-default);
	border-radius: var(--radius-lg);
	background: var(--color-bg-elevated);
	color: var(--color-text-primary);
	box-shadow: var(--shadow-lg);
	overflow: hidden;
}

.saved-view-dialog__header,
.saved-view-dialog__footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-3);
	padding: var(--space-4);
}

.saved-view-dialog__header {
	border-bottom: 1px solid var(--color-border-subtle);
}

.saved-view-dialog__header h2 {
	margin: 0;
	font-size: var(--text-lg);
}

.saved-view-dialog__header p {
	margin: var(--space-1) 0 0;
	font-size: var(--text-sm);
	color: var(--color-text-secondary);
}

.saved-view-dialog__body {
	max-height: calc(100vh - 240px);
	overflow-y: auto;
}

.saved-view-dialog__name-field {
	display: flex;
	flex-direction: column;
	gap: var(--space-1);
	padding: var(--space-4) var(--space-4) 0;
	font-size: var(--text-sm);
	font-weight: 500;
	color: var(--color-text-secondary);
}

.saved-view-dialog__name-field input {
	height: 34px;
	padding: 4px 8px;
	border: 1px solid var(--color-border-default);
	border-radius: var(--radius-sm);
	background: var(--color-bg-input);
	color: var(--color-text-primary);
	font: inherit;
}

.saved-view-dialog__name-field input:focus {
	outline: none;
	border-color: var(--color-accent);
	box-shadow: 0 0 0 2px var(--color-accent-soft);
}

.saved-view-dialog__body :deep(.filter-panel) {
	max-width: none;
	padding-top: var(--space-3);
}

.saved-view-dialog__footer {
	justify-content: flex-end;
	border-top: 1px solid var(--color-border-subtle);
}
</style>
