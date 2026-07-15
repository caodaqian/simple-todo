<script setup lang="ts">
	import { computed, nextTick, onUnmounted, ref, watch, type CSSProperties } from 'vue';
import { parseDateFromText } from '../composables/useDateParser';
import { useImeGuard } from '../composables/useImeGuard';
import { taskService } from '../services/taskService';
import type { CreateTaskInput, TaskPriority } from '../types/task';

	const props = withDefaults(defineProps<{
		placeholder?: string;
		submitLabel?: string;
	}>(), {
		placeholder: '输入任务标题，!优先级 ~分组 #标签',
		submitLabel: '',
	});

	const emit = defineEmits<{
		(event: 'create', payload: CreateTaskInput, attributes: SmartInputAttributes): void;
	}>();

	const rawInput = ref('');
	const inputRef = ref<HTMLInputElement | null>(null);
	const isFocused = ref(false);
	const { onCompositionStart, onCompositionEnd, shouldIgnoreKeydown } = useImeGuard();

	/* ── Parser ───────────────────────────────────────────────────── */
	const PRIORITY_MAP: Record<string, TaskPriority> = {
		urgent: 'urgent', u: 'urgent', '紧急': 'urgent',
		high: 'high', h: 'high', '高': 'high',
		medium: 'medium', m: 'medium', '中': 'medium',
		low: 'low', l: 'low', '低': 'low',
	};

	interface ParsedResult {
		title: string;
		priority: TaskPriority;
		group: string;
		tags: string[];
		dueStart?: number | undefined;
		allDay?: boolean | undefined;
		hasAttributes: boolean;
		hasPriority: boolean;
		hasGroup: boolean;
		hasTags: boolean;
		hasSchedule: boolean;
	}

	interface SmartInputAttributes {
		priority: boolean;
		group: boolean;
		tags: boolean;
		schedule: boolean;
	}

	const parseInput = (raw: string): ParsedResult => {
		const { cleanedText, dueStart, allDay } = parseDateFromText(raw);
		let text = cleanedText.trim();

		// Extract priority: !high, !h, !高 etc.
		let priority: TaskPriority = 'medium';
		let hasPriority = false;
		const priorityMatch = text.match(/!([^\s]+)/);
		if (priorityMatch) {
			const key = priorityMatch[1]!.toLowerCase();
			if (PRIORITY_MAP[key]) {
				priority = PRIORITY_MAP[key];
				hasPriority = true;
				text = text.replace(priorityMatch[0], '').trim();
			}
		}

		// Extract group: ~group-name
		let group = '';
		const groupMatch = text.match(/~([^\s]+)/);
		const hasGroup = !!groupMatch;
		if (groupMatch) {
			group = groupMatch[1]!;
			text = text.replace(groupMatch[0], '').trim();
		}

		// Extract tags: #tag1 #tag2
		const tags: string[] = [];
		const tagMatches = text.matchAll(/#([^\s]+)/g);
		for (const match of tagMatches) {
			tags.push(match[1]!);
		}
		text = text.replace(/#[^\s]+/g, '').trim();

		return {
			title: text,
			priority,
			group,
			tags,
			dueStart,
			allDay,
			hasAttributes: hasPriority || hasGroup || tags.length > 0 || dueStart !== undefined,
			hasPriority,
			hasGroup,
			hasTags: tags.length > 0,
			hasSchedule: dueStart !== undefined,
		};
	};

	const parsed = computed<ParsedResult>(() => parseInput(rawInput.value));

	const priorityLabel = (p: TaskPriority): string => {
		return p === 'urgent' ? '紧急' : p === 'high' ? '高' : p === 'medium' ? '中' : '低';
	};

	const priorityClass = (p: TaskPriority): string => {
		return p === 'urgent' ? 'priority-urgent' : p === 'high' ? 'priority-high' : p === 'medium' ? 'priority-medium' : 'priority-low';
	};

	/* ── Suggestions ──────────────────────────────────────────────── */
	type SuggestionType = 'priority' | 'group' | 'tag';

	interface Suggestion {
		type: SuggestionType;
		value: string;
		label: string;
		prefix: string;
	}

	const showSuggestions = ref(false);
	const suggestions = ref<Suggestion[]>([]);
	const activeIndex = ref(0);

	/* ── Dropdown anchoring (Teleport + fixed positioning) ────────── */
	const dropdownRef = ref<HTMLDivElement | null>(null);
	const dropdownStyle = ref<CSSProperties>({});

	const updateDropdownPosition = (): void => {
		const el = inputRef.value;
		if (!el || !showSuggestions.value) return;
		const rect = el.getBoundingClientRect();
		const estHeight = 232;
		const viewportH = window.innerHeight;
		const top = rect.bottom + 4 + estHeight > viewportH
			? Math.max(8, rect.top - 4 - estHeight)
			: rect.bottom + 4;
		dropdownStyle.value = {
			position: 'fixed',
			top: `${top}px`,
			left: `${rect.left}px`,
			width: `${rect.width}px`,
		};
	};

	const onPointerDownOutside = (e: PointerEvent): void => {
		const t = e.target as Node | null;
		if (t && dropdownRef.value?.contains(t)) return;
		if (t && inputRef.value?.contains(t)) return;
		showSuggestions.value = false;
	};

	const removeListeners = (): void => {
		window.removeEventListener('scroll', updateDropdownPosition, true);
		window.removeEventListener('resize', updateDropdownPosition);
		window.removeEventListener('pointerdown', onPointerDownOutside);
	};

	watch(showSuggestions, (open) => {
		if (open) {
			updateDropdownPosition();
			window.addEventListener('scroll', updateDropdownPosition, true);
			window.addEventListener('resize', updateDropdownPosition);
			window.addEventListener('pointerdown', onPointerDownOutside);
		} else {
			removeListeners();
		}
	});

	watch(isFocused, (focused) => {
		if (focused && showSuggestions.value) nextTick(updateDropdownPosition);
	});

	onUnmounted(removeListeners);

	const getAvailableTags = (): string[] => {
		const tasks = taskService.getAll();
		const set = new Set<string>();
		for (const t of tasks) {
			for (const tag of t.tags) {
				if (tag.trim()) set.add(tag.trim());
			}
		}
		return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
	};

	const getAvailableGroups = (): string[] => {
		const tasks = taskService.getAll();
		const set = new Set<string>();
		for (const t of tasks) {
			if (t.group.trim()) set.add(t.group.trim());
		}
		return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
	};

	const updateSuggestions = (): void => {
		const el = inputRef.value;
		if (!el) return;

		const cursor = el.selectionStart ?? rawInput.value.length;
		const textBeforeCursor = rawInput.value.slice(0, cursor);

		const lastBang = textBeforeCursor.lastIndexOf('!');
		const lastTilde = textBeforeCursor.lastIndexOf('~');
		const lastHash = textBeforeCursor.lastIndexOf('#');
		const maxIndex = Math.max(lastBang, lastTilde, lastHash);

		if (maxIndex === -1) {
			showSuggestions.value = false;
			return;
		}

		const tokenText = textBeforeCursor.slice(maxIndex + 1);
		if (tokenText.includes(' ')) {
			showSuggestions.value = false;
			return;
		}

		const prefix = textBeforeCursor[maxIndex] as '!' | '~' | '#';
		const query = tokenText.toLowerCase();

		let items: Suggestion[] = [];
		if (prefix === '!') {
			items = [
				{ type: 'priority', value: '紧急', label: '紧急优先级', prefix: '!' },
				{ type: 'priority', value: '高', label: '高优先级', prefix: '!' },
				{ type: 'priority', value: '中', label: '中优先级', prefix: '!' },
				{ type: 'priority', value: '低', label: '低优先级', prefix: '!' },
			];
		} else if (prefix === '~') {
			items = getAvailableGroups().map(g => ({ type: 'group', value: g, label: g, prefix: '~' }));
		} else if (prefix === '#') {
			items = getAvailableTags().map(t => ({ type: 'tag', value: t, label: t, prefix: '#' }));
		}

		if (query) {
			items = items.filter(
				item => item.value.toLowerCase().includes(query) || item.label.toLowerCase().includes(query),
			);
		}

		suggestions.value = items;
		showSuggestions.value = items.length > 0;
		activeIndex.value = 0;
		nextTick(updateDropdownPosition);
	};

	const applySuggestion = (index: number): void => {
		const el = inputRef.value;
		if (!el) return;

		const suggestion = suggestions.value[index];
		if (!suggestion) return;

		const cursor = el.selectionStart ?? rawInput.value.length;
		const textBeforeCursor = rawInput.value.slice(0, cursor);

		const lastBang = textBeforeCursor.lastIndexOf('!');
		const lastTilde = textBeforeCursor.lastIndexOf('~');
		const lastHash = textBeforeCursor.lastIndexOf('#');
		const maxIndex = Math.max(lastBang, lastTilde, lastHash);

		const beforeToken = rawInput.value.slice(0, maxIndex);
		const afterCursor = rawInput.value.slice(cursor);

		const newValue = beforeToken + suggestion.prefix + suggestion.value + ' ' + afterCursor;
		rawInput.value = newValue;
		showSuggestions.value = false;

		const newCursor = maxIndex + suggestion.prefix.length + suggestion.value.length + 1;
		nextTick(() => {
			el.selectionStart = el.selectionEnd = newCursor;
			el.focus();
		});
	};

	const submit = (): void => {
		if (!parsed.value.title.trim()) return;

		const payload: CreateTaskInput = {
			title: parsed.value.title,
			status: 'todo',
			priority: parsed.value.priority,
			group: parsed.value.group,
			tags: parsed.value.tags,
			description: '',
		};

		if (parsed.value.dueStart !== undefined) {
			payload.dueStart = parsed.value.dueStart;
			if (parsed.value.allDay) payload.allDay = true;
		}

		emit('create', payload, {
			priority: parsed.value.hasPriority,
			group: parsed.value.hasGroup,
			tags: parsed.value.hasTags,
			schedule: parsed.value.hasSchedule,
		});
		rawInput.value = '';
		showSuggestions.value = false;
	};

	const handleKeydown = (e: KeyboardEvent): void => {
		if (shouldIgnoreKeydown(e)) return;

		if (showSuggestions.value && suggestions.value.length > 0) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				activeIndex.value = (activeIndex.value + 1) % suggestions.value.length;
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				activeIndex.value = (activeIndex.value - 1 + suggestions.value.length) % suggestions.value.length;
				return;
			}
			if (e.key === 'Tab' || e.key === 'Enter') {
				e.preventDefault();
				applySuggestion(activeIndex.value);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				showSuggestions.value = false;
				return;
			}
		}

		if (e.key === 'Enter' && parsed.value.title.trim()) {
			e.preventDefault();
			submit();
		}
	};

	const suggestionTypeClass = (type: SuggestionType): string => {
		return type === 'priority' ? 'smart-input-suggestion-priority' : type === 'group' ? 'smart-input-suggestion-group' : 'smart-input-suggestion-tag';
	};

	const suggestionTypeLabel = (type: SuggestionType): string => {
		return type === 'priority' ? '优先级' : type === 'group' ? '分组' : '标签';
	};

	const priorityText = computed(() => `!${priorityLabel(parsed.value.priority)}`);
	const showPriorityChip = computed(() => parsed.value.priority !== 'medium' || rawInput.value.includes('!'));
</script>

<template>
	<div class="smart-input-wrapper" :class="{ 'smart-input-wrapper--focused': isFocused }">
		<div v-if="parsed.hasAttributes" class="smart-input-chips">
			<span v-if="showPriorityChip" class="inline-chip" :class="priorityClass(parsed.priority)">
				{{ priorityText }}
			</span>
			<span v-if="parsed.group" class="inline-chip inline-chip--group">
				~{{ parsed.group }}
			</span>
			<span v-for="tag in parsed.tags" :key="tag" class="inline-chip inline-chip--tag">
				#{{ tag }}
			</span>
		</div>
		<div class="smart-input-row">
			<input ref="inputRef" v-model="rawInput" class="smart-input" type="text"
				:placeholder="props.placeholder" @input="updateSuggestions" @keydown="handleKeydown"
				@compositionstart="onCompositionStart" @compositionend="onCompositionEnd"
				@click="updateSuggestions" @focus="isFocused = true" @blur="isFocused = false" />
			<button v-if="props.submitLabel" type="button" class="smart-input-submit" @click="submit">
				{{ props.submitLabel }}
			</button>
		</div>
		<!-- Suggestion dropdown (teleported to body to escape overflow ancestors) -->
		<Teleport to="body">
			<div v-if="showSuggestions" ref="dropdownRef" class="smart-input-dropdown"
				:style="dropdownStyle">
				<div v-for="(s, i) in suggestions" :key="s.type + s.value"
					class="smart-input-suggestion-item"
					:class="{ active: i === activeIndex, [suggestionTypeClass(s.type)]: true }"
					@mousedown.prevent="applySuggestion(i)">
					<span class="smart-input-suggestion-prefix">{{ s.prefix }}</span>
					<span class="smart-input-suggestion-value">{{ s.value }}</span>
					<span
						class="smart-input-suggestion-type">{{ suggestionTypeLabel(s.type) }}</span>
				</div>
			</div>
		</Teleport>
	</div>
</template>

<style scoped>
	.smart-input-wrapper {
		flex: 1;
		display: flex;
		flex-direction: column;
		position: relative;
		gap: 6px;
		padding: 8px;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-input) 72%, transparent);
		transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
	}

	.smart-input-wrapper--focused {
		border-color: var(--color-border-focus);
		background: color-mix(in srgb, var(--color-bg-panel) 88%, transparent);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 20%, transparent);
	}

	.smart-input-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		min-height: 22px;
	}

	.smart-input {
		flex: 1;
		height: 36px;
		font: inherit;
		font-size: 13px;
		color: var(--color-text-primary);
		background: var(--color-bg-input);
		border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
		border-radius: var(--radius-sm);
		padding: 6px 10px;
		outline: none;
		transition: border-color 0.15s;
		width: 100%;
		box-sizing: border-box;
	}

	.smart-input-row {
		display: flex;
		gap: 8px;
	}

	.smart-input-submit {
		flex: 0 0 auto;
		padding: 0 14px;
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-sm);
		background: var(--color-primary);
		color: var(--color-text-inverse);
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}

	.smart-input-submit:hover {
		background: var(--color-primary-hover);
	}

	.smart-input:focus {
		border-color: var(--color-primary);
	}

	.inline-chip {
		display: inline-flex;
		align-items: center;
		padding: 4px 10px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 600;
		line-height: 1;
		border: 1px solid transparent;
	}

	.inline-chip.priority-urgent {
		background: color-mix(in srgb, var(--color-priority-urgent) 18%, transparent);
		color: var(--color-priority-urgent);
		border-color: color-mix(in srgb, var(--color-priority-urgent) 35%, transparent);
	}

	.inline-chip.priority-high {
		background: color-mix(in srgb, var(--color-danger) 18%, transparent);
		color: var(--color-danger-hover);
		border-color: color-mix(in srgb, var(--color-danger) 35%, transparent);
	}

	.inline-chip.priority-medium {
		background: color-mix(in srgb, var(--color-warning) 18%, transparent);
		color: var(--color-warning-hover);
		border-color: color-mix(in srgb, var(--color-warning) 35%, transparent);
	}

	.inline-chip.priority-low {
		background: color-mix(in srgb, var(--color-success) 18%, transparent);
		color: var(--color-success-hover);
		border-color: color-mix(in srgb, var(--color-success) 35%, transparent);
	}

	.inline-chip--group {
		background: color-mix(in srgb, var(--color-primary) 18%, transparent);
		color: var(--color-primary-hover);
		border-color: color-mix(in srgb, var(--color-primary) 35%, transparent);
	}

	.inline-chip--tag {
		background: color-mix(in srgb, var(--color-tag-bg) 90%, transparent);
		color: var(--color-tag-text);
		border-color: var(--color-tag-border);
	}
</style>

<!-- Non-scoped styles for the teleported dropdown (escapes component DOM tree) -->
<style>
	.smart-input-dropdown {
		position: fixed;
		z-index: var(--z-popover);
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-md);
		max-height: 220px;
		overflow-y: auto;
		padding: var(--space-1);
		box-sizing: border-box;
	}

	.smart-input-suggestion-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: 13px;
		transition: background var(--transition-fast);
	}

	.smart-input-suggestion-item:hover,
	.smart-input-suggestion-item.active {
		background: var(--color-bg-hover);
	}

	.smart-input-suggestion-prefix {
		font-weight: 600;
		width: 16px;
		text-align: center;
		flex-shrink: 0;
	}

	.smart-input-suggestion-value {
		flex: 1;
		color: var(--color-text-primary);
	}

	.smart-input-suggestion-type {
		font-size: 11px;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.smart-input-suggestion-item.smart-input-suggestion-priority .smart-input-suggestion-prefix {
		color: var(--color-priority-high);
	}

	.smart-input-suggestion-item.smart-input-suggestion-group .smart-input-suggestion-prefix {
		color: var(--color-accent);
	}

	.smart-input-suggestion-item.smart-input-suggestion-tag .smart-input-suggestion-prefix {
		color: var(--color-tag-text);
	}
</style>