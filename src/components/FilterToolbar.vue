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

	const activeCount = computed(() => countActiveFilterFields(props.modelValue));

	const toggle = (): void => {
		open.value = !open.value;
	};

	const close = (): void => {
		open.value = false;
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

	document.addEventListener('mousedown', handleDocClick);
	document.addEventListener('keydown', handleEsc);

	onBeforeUnmount(() => {
		document.removeEventListener('mousedown', handleDocClick);
		document.removeEventListener('keydown', handleEsc);
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

		<div v-show="open" ref="popoverRef" class="filter-popover" role="presentation">
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
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: var(--z-popover, 50);
		background: var(--color-bg-elevated, var(--color-bg-base));
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		max-height: 70vh;
		overflow-y: auto;
	}
</style>