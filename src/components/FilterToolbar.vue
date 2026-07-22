<script setup lang="ts">
	import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { countActiveFilterFields } from '../services/filterUtils';
import type { TaskSearchFilter } from '../types/task';
import AppIcon from './AppIcon.vue';
import FilterPanel from './FilterPanel.vue';

	const props = defineProps<{
		modelValue: TaskSearchFilter;
		availableTags?: string[];
	}>();

	const emit = defineEmits<{
		(e: 'update:modelValue', value: TaskSearchFilter): void;
		(e: 'reset'): void;
	}>();

	const open = ref(false);
	const triggerRef = ref<HTMLElement | null>(null);
	const popoverRef = ref<HTMLElement | null>(null);
	const filterPanelRef = ref<InstanceType<typeof FilterPanel> | null>(null);
	const popoverStyle = ref({ left: '8px', top: '8px', maxHeight: 'calc(100dvh - 16px)' });

	const activeCount = computed(() => countActiveFilterFields(props.modelValue));

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
		if (popoverRef.value && popoverRef.value instanceof Node && popoverRef.value.contains(target)) return;
		// popoverRef 上面是 Vue 组件实例；保险起见再用 $el 兜底
		const el = (popoverRef.value as unknown as { $el?: Node })?.$el;
		if (el && el.contains(target)) return;
		close();
	};

	const handleEsc = (event: KeyboardEvent): void => {
		if (event.key === 'Escape') close();
	};

	const handleViewportChange = (): void => {
		void nextTick(positionPopover);
	};

	document.addEventListener('mousedown', handleDocClick);
	document.addEventListener('keydown', handleEsc);
	window.addEventListener('resize', handleViewportChange);
	window.addEventListener('scroll', handleViewportChange, true);

	onBeforeUnmount(() => {
		document.removeEventListener('mousedown', handleDocClick);
		document.removeEventListener('keydown', handleEsc);
		window.removeEventListener('resize', handleViewportChange);
		window.removeEventListener('scroll', handleViewportChange, true);
	});

	const update = (next: TaskSearchFilter): void => {
		emit('update:modelValue', next);
	};

	const reset = (): void => {
		emit('reset');
	};

	const focusKeywordSearch = (): void => {
		open.value = true;
		void nextTick(() => {
			positionPopover();
			filterPanelRef.value?.focusKeywordInput();
		});
	};

	defineExpose({ focusKeywordSearch });
</script>

<template>
	<div class="filter-toolbar">
		<button
			ref="triggerRef"
			type="button"
			class="filter-trigger btn btn-ghost"
			:class="{ active: open || activeCount > 0 }"
			:aria-expanded="open"
			aria-haspopup="dialog"
			title="筛选条件"
			@click="toggle"
		>
			<AppIcon name="filter" :size="14" />
			<span>筛选</span>
			<span v-if="activeCount > 0" class="filter-badge" aria-label="已应用筛选数量">{{
				activeCount
			}}</span>
			<AppIcon name="chevronDown" :size="12" class="filter-trigger__caret" :class="{ open }" />
		</button>

		<div v-show="open" ref="popoverRef" class="filter-popover" :style="popoverStyle" role="presentation">
			<FilterPanel
ref="filterPanelRef"
				:model-value="modelValue"
				:available-tags="availableTags ?? []"
				@update:model-value="update"
				@reset="reset"
			/>
		</div>
	</div>
</template>

<style scoped>
	.filter-toolbar {
		position: relative;
		display: inline-flex;
	}

	.filter-trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
		height: 30px;
		padding: 0 var(--space-2);
		font-size: var(--text-sm);
	}

	.filter-trigger.active {
		color: var(--color-accent);
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
	}

	.filter-trigger__caret {
		transition: transform var(--transition-fast);
	}

	.filter-trigger__caret.open {
		transform: rotate(180deg);
	}

	.filter-badge {
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

	.filter-popover {
		position: fixed;
		z-index: var(--z-popover, 50);
		background: var(--color-bg-elevated, var(--color-bg-base));
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		overflow-y: auto;
	}
</style>