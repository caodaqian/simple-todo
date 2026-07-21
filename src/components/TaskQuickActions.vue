<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import type { Task, TaskPriority, TaskStatus } from '../types/task';
import AppIcon from './AppIcon.vue';

type PopoverKind = 'priority' | 'more';

type PopoverPosition = {
	left: number;
	top?: number;
	bottom?: number;
};

const props = withDefaults(defineProps<{
	task: Task;
	allowDelete?: boolean;
	showMore?: boolean;
	popoverZIndex?: string;
}>(), {
	allowDelete: false,
	showMore: true,
	popoverZIndex: 'var(--z-popover)',
});

const emit = defineEmits<{
	(e: 'cycle-status', task: Task): void;
	(e: 'set-priority', task: Task, priority: TaskPriority): void;
	(e: 'toggle-archive', task: Task): void;
	(e: 'delete', task: Task): void;
}>();

const rootRef = ref<HTMLElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const openPopover = ref<PopoverKind | null>(null);
const popoverPosition = ref<PopoverPosition>({ left: 0 });
const popoverStyle = computed<Record<string, string>>(() => {
	const { left, top, bottom } = popoverPosition.value;
	return {
		left: `${left}px`,
		...(top !== undefined ? { top: `${top}px` } : { bottom: `${bottom ?? 0}px` }),
		zIndex: props.popoverZIndex,
	};
});

const priorityOptions: ReadonlyArray<{ value: TaskPriority; label: string }> = [
	{ value: 'low', label: '低' },
	{ value: 'medium', label: '中' },
	{ value: 'high', label: '高' },
	{ value: 'urgent', label: '紧急' },
];

const statusLabels: Record<TaskStatus, string> = {
	todo: '待办',
	doing: '进行中',
	done: '已完成',
};

const statusIcons: Record<TaskStatus, string> = {
	todo: 'circle',
	doing: 'circleDot',
	done: 'checkCircle2',
};

const priorityLabels: Record<TaskPriority, string> = {
	low: '低',
	medium: '中',
	high: '高',
	urgent: '紧急',
};

const priorityIcons: Record<TaskPriority, string> = {
	low: 'bookmark',
	medium: 'flag',
	high: 'star',
	urgent: 'zap',
};

const closePopover = (): void => {
	openPopover.value = null;
	removeCloseListeners();
};

const removeCloseListeners = (): void => {
	document.removeEventListener('pointerdown', handleOutsidePointer);
	document.removeEventListener('keydown', handleKeydown);
	window.removeEventListener('scroll', closePopover, true);
	window.removeEventListener('resize', closePopover);
};

const addCloseListeners = (): void => {
	document.addEventListener('pointerdown', handleOutsidePointer);
	document.addEventListener('keydown', handleKeydown);
	window.addEventListener('scroll', closePopover, true);
	window.addEventListener('resize', closePopover);
};

const handleOutsidePointer = (event: PointerEvent): void => {
	const target = event.target;
	if (!(target instanceof Node)) return;
	if (rootRef.value?.contains(target) || popoverRef.value?.contains(target)) return;
	closePopover();
};

const handleKeydown = (event: KeyboardEvent): void => {
	if (event.key === 'Escape') {
		event.preventDefault();
		closePopover();
	}
};

const togglePopover = async (kind: PopoverKind, target: EventTarget | null): Promise<void> => {
	if (openPopover.value === kind) {
		closePopover();
		return;
	}
	if (!(target instanceof HTMLButtonElement)) return;

	openPopover.value = kind;
	await nextTick();
	const rect = target.getBoundingClientRect();
	const popoverWidth = kind === 'priority' ? 148 : 156;
	const popoverHeight = kind === 'priority' ? 156 : props.allowDelete ? 108 : 72;
	const viewportPadding = 8;
	const left = Math.min(
		Math.max(viewportPadding, rect.right - popoverWidth),
		window.innerWidth - popoverWidth - viewportPadding,
	);
	const opensAbove = rect.bottom + popoverHeight + viewportPadding > window.innerHeight
		&& rect.top - popoverHeight - viewportPadding >= 0;
	popoverPosition.value = opensAbove
		? { left, bottom: window.innerHeight - rect.top + 6 }
		: { left, top: rect.bottom + 6 };
	addCloseListeners();
};

const selectPriority = (priority: TaskPriority): void => {
	emit('set-priority', props.task, priority);
	closePopover();
};

const toggleArchive = (): void => {
	emit('toggle-archive', props.task);
	closePopover();
};

const deleteTask = (): void => {
	emit('delete', props.task);
	closePopover();
};

onBeforeUnmount(removeCloseListeners);
</script>

<template>
	<div ref="rootRef" class="task-quick-actions" @click.stop>
		<button
			type="button"
			class="task-quick-actions__button"
			:class="`task-quick-actions__status--${task.status}`"
			:title="`当前状态：${statusLabels[task.status]}；点击切换状态`"
			:aria-label="`当前状态：${statusLabels[task.status]}；点击切换状态`"
			@click.stop="emit('cycle-status', task)"
		>
			<AppIcon :name="statusIcons[task.status]" :size="16" />
		</button>

		<button
			type="button"
			class="task-quick-actions__button"
			:class="`task-quick-actions__priority--${task.priority}`"
			:title="`当前优先级：${priorityLabels[task.priority]}；选择优先级`"
			:aria-label="`当前优先级：${priorityLabels[task.priority]}；选择优先级`"
			aria-haspopup="menu"
			:aria-expanded="openPopover === 'priority'"
			@click.stop="togglePopover('priority', $event.currentTarget)"
		>
			<AppIcon :name="priorityIcons[task.priority]" :size="16" />
		</button>

		<button
			v-if="showMore"
			type="button"
			class="task-quick-actions__button"
			title="更多任务操作"
			aria-label="更多任务操作"
			aria-haspopup="menu"
			:aria-expanded="openPopover === 'more'"
			@click.stop="togglePopover('more', $event.currentTarget)"
		>
			<AppIcon name="moreHorizontal" :size="16" />
		</button>

		<Teleport to="body">
			<div
				v-if="openPopover === 'priority'"
				ref="popoverRef"
				class="task-quick-actions__popover task-quick-actions__priority-menu"
				:style="popoverStyle"
				role="menu"
				aria-label="选择优先级"
				@click.stop
			>
				<button
					v-for="option in priorityOptions"
					:key="option.value"
					type="button"
					class="task-quick-actions__menu-item"
					:class="`task-quick-actions__priority--${option.value}`"
					role="menuitem"
					:title="`设为${option.label}优先级`"
					:aria-label="`设为${option.label}优先级`"
					@click="selectPriority(option.value)"
				>
					<AppIcon :name="priorityIcons[option.value]" :size="15" />
					<span>{{ option.label }}</span>
				</button>
			</div>

			<div
				v-else-if="openPopover === 'more'"
				ref="popoverRef"
				class="task-quick-actions__popover"
				:style="popoverStyle"
				role="menu"
				aria-label="更多任务操作"
				@click.stop
			>
				<button
					type="button"
					class="task-quick-actions__menu-item"
					role="menuitem"
					:title="task.archivedAt === undefined ? '归档任务' : '恢复归档'"
					:aria-label="task.archivedAt === undefined ? '归档任务' : '恢复归档'"
					@click="toggleArchive"
				>
					<AppIcon :name="task.archivedAt === undefined ? 'archive' : 'archiveRestore'" :size="15" />
					<span>{{ task.archivedAt === undefined ? '归档' : '恢复归档' }}</span>
				</button>
				<button
					v-if="allowDelete"
					type="button"
					class="task-quick-actions__menu-item task-quick-actions__menu-item--danger"
					role="menuitem"
					title="删除任务"
					aria-label="删除任务"
					@click="deleteTask"
				>
					<AppIcon name="trash2" :size="15" />
					<span>删除</span>
				</button>
			</div>
		</Teleport>
	</div>
</template>

<style scoped>
.task-quick-actions {
	display: inline-flex;
	align-items: center;
	gap: 2px;
	flex: 0 0 auto;
	white-space: nowrap;
}

.task-quick-actions__button,
.task-quick-actions__menu-item {
	border: 0;
	font: inherit;
	cursor: pointer;
}

.task-quick-actions__button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	padding: 0;
	border-radius: var(--radius-sm);
	background: transparent;
	color: var(--color-text-secondary);
	transition: color var(--transition-fast), background var(--transition-fast);
}

.task-quick-actions__button:hover,
.task-quick-actions__button[aria-expanded="true"] {
	background: var(--color-bg-hover);
	color: var(--color-text-primary);
}

.task-quick-actions__button:focus-visible,
.task-quick-actions__menu-item:focus-visible {
	outline: none;
	box-shadow: var(--ring-focus);
}

.task-quick-actions__status--todo { color: var(--color-status-todo); }
.task-quick-actions__status--doing { color: var(--color-status-doing); }
.task-quick-actions__status--done { color: var(--color-status-done); }
.task-quick-actions__priority--low { color: var(--color-priority-low); }
.task-quick-actions__priority--medium { color: var(--color-priority-medium); }
.task-quick-actions__priority--high { color: var(--color-priority-high); }
.task-quick-actions__priority--urgent { color: var(--color-priority-urgent); }

.task-quick-actions__priority--low,
.task-quick-actions__priority--medium,
.task-quick-actions__priority--high,
.task-quick-actions__priority--urgent {
	background: color-mix(in srgb, currentColor 12%, transparent);
}

.task-quick-actions__priority--urgent {
	font-weight: 700;
}

.task-quick-actions__popover {
	position: fixed;
	min-width: 148px;
	padding: 4px;
	border: 1px solid var(--color-border-default);
	border-radius: var(--radius-md);
	background: var(--color-bg-elevated);
	box-shadow: var(--shadow-md);
}

.task-quick-actions__priority-menu {
	min-width: 148px;
}

.task-quick-actions__menu-item {
	display: flex;
	align-items: center;
	gap: var(--space-2);
	width: 100%;
	min-height: 32px;
	padding: 0 var(--space-2);
	border-radius: var(--radius-sm);
	background: transparent;
	color: var(--color-text-primary);
	font-size: var(--text-sm);
	text-align: left;
	white-space: nowrap;
}

.task-quick-actions__menu-item:hover {
	background: var(--color-bg-hover);
}

.task-quick-actions__menu-item--danger {
	color: var(--color-danger);
}
</style>
