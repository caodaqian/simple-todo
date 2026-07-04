import type {
	CreateTaskInput,
	RepeatRule,
	RepeatType,
	SaveTaskInput,
	Subtask,
	Task,
	TaskImportResult,
	TaskStatus,
	UpdateTaskInput,
} from '../types/task';
import { buildNextInstance, shouldSpawnNext } from './repeatService';
import { STORAGE_KEYS } from './storageKeys';

interface UtoolsDbStorage {
	getItem(key: string): unknown;
	setItem(key: string, value: string): unknown;
}

interface UtoolsLike {
	dbStorage?: UtoolsDbStorage;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === 'object' && value !== null;
};

const isTaskStatus = (value: unknown): value is TaskStatus => {
	return value === 'todo' || value === 'doing' || value === 'done';
};

const isTimestamp = (value: unknown): value is number => {
	return typeof value === 'number' && Number.isFinite(value);
};

const isRepeatType = (value: unknown): value is RepeatType => {
	return value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'custom';
};

const toRepeatRule = (value: unknown): RepeatRule | undefined => {
	if (!isObjectRecord(value)) return undefined;
	if (!isRepeatType(value.type)) return undefined;
	if (typeof value.interval !== 'number' || !Number.isFinite(value.interval) || value.interval <= 0) {
		return undefined;
	}
	const rule: RepeatRule = { type: value.type, interval: value.interval };
	if (isTimestamp(value.repeatUntil)) rule.repeatUntil = value.repeatUntil;
	if (typeof value.repeatCount === 'number' && Number.isFinite(value.repeatCount)) {
		rule.repeatCount = value.repeatCount;
	}
	if (typeof value.generatedCount === 'number' && Number.isFinite(value.generatedCount)) {
		rule.generatedCount = value.generatedCount;
	}
	return rule;
};

type TaskDraft = Omit<
	Task,
	'dueDate' | 'dueStart' | 'dueEnd' | 'allDay' | 'reminderOffset' | 'remindedAt' | 'snoozedUntil' | 'repeat'
> & {
	dueDate: number | undefined;
	dueStart?: number | undefined;
	dueEnd?: number | undefined;
	allDay?: boolean | undefined;
	reminderOffset?: number | undefined;
	remindedAt?: number | undefined;
	snoozedUntil?: number | undefined;
	repeat?: RepeatRule | undefined;
};

const buildTask = (task: TaskDraft): Task => {
	const { dueDate, dueStart, dueEnd, allDay, reminderOffset, remindedAt, snoozedUntil, repeat, ...rest } = task;
	const result: Task = { ...rest } as Task;
	if (dueDate !== undefined) result.dueDate = dueDate;
	if (dueStart !== undefined) result.dueStart = dueStart;
	if (dueEnd !== undefined) result.dueEnd = dueEnd;
	if (allDay !== undefined) result.allDay = allDay;
	if (reminderOffset !== undefined) result.reminderOffset = reminderOffset;
	if (remindedAt !== undefined) result.remindedAt = remindedAt;
	if (snoozedUntil !== undefined) result.snoozedUntil = snoozedUntil;
	if (repeat !== undefined) result.repeat = repeat;
	return result;
};

const toTask = (value: unknown): Task | null => {
	if (!isObjectRecord(value)) {
		return null;
	}

	const {
		id,
		title,
		status,
		dueDate,
		dueStart,
		dueEnd,
		allDay,
		priority,
		tags,
		group,
		description,
		subtasks,
		createdAt,
		updatedAt,
		reminderOffset,
		remindedAt,
		snoozedUntil,
		repeat,
	} = value;

	if (typeof id !== 'string' || id.length === 0) return null;
	if (typeof title !== 'string') return null;
	if (!isTaskStatus(status)) return null;
	if (dueDate !== undefined && !isTimestamp(dueDate)) return null;
	if (dueStart !== undefined && !isTimestamp(dueStart)) return null;
	if (dueEnd !== undefined && !isTimestamp(dueEnd)) return null;
	if (allDay !== undefined && typeof allDay !== 'boolean') return null;
	if (priority !== 'low' && priority !== 'medium' && priority !== 'high') return null;
	if (!Array.isArray(tags)) return null;
	if (typeof group !== 'string') return null;
	if (typeof description !== 'string') return null;
	if (!Array.isArray(subtasks)) return null;
	if (!isTimestamp(createdAt) || !isTimestamp(updatedAt)) return null;
	if (reminderOffset !== undefined && (typeof reminderOffset !== 'number' || !Number.isFinite(reminderOffset) || reminderOffset < 0)) {
		return null;
	}
	if (remindedAt !== undefined && !isTimestamp(remindedAt)) return null;
	if (snoozedUntil !== undefined && !isTimestamp(snoozedUntil)) return null;
	const repeatRule = repeat !== undefined ? toRepeatRule(repeat) : undefined;

	const normalizedTags: string[] = [];
	for (const tag of tags) {
		if (typeof tag !== 'string') return null;
		normalizedTags.push(tag);
	}

	const normalizedSubtasks: Subtask[] = [];
	for (const subtask of subtasks) {
		if (!isObjectRecord(subtask)) return null;

		const {
			id: subtaskId,
			title: subtaskTitle,
			completed,
			createdAt: subtaskCreatedAt,
			updatedAt: subtaskUpdatedAt,
		} = subtask;

		if (typeof subtaskId !== 'string' || subtaskId.length === 0) return null;
		if (typeof subtaskTitle !== 'string') return null;
		if (typeof completed !== 'boolean') return null;
		if (!isTimestamp(subtaskCreatedAt) || !isTimestamp(subtaskUpdatedAt)) return null;

		normalizedSubtasks.push({
			id: subtaskId,
			title: subtaskTitle,
			completed,
			createdAt: subtaskCreatedAt,
			updatedAt: subtaskUpdatedAt,
		});
	}

	return buildTask({
		id,
		title,
		status,
		dueDate,
		priority,
		tags: normalizedTags,
		group,
		description,
		subtasks: normalizedSubtasks,
		createdAt,
		updatedAt,
		...(dueStart !== undefined ? { dueStart } : {}),
		...(dueEnd !== undefined ? { dueEnd } : {}),
		...(allDay !== undefined ? { allDay } : {}),
		...(reminderOffset !== undefined ? { reminderOffset } : {}),
		...(remindedAt !== undefined ? { remindedAt } : {}),
		...(snoozedUntil !== undefined ? { snoozedUntil } : {}),
		...(repeatRule !== undefined ? { repeat: repeatRule } : {}),
	});
};

/**
 * 安全解析 JSON 字符串，如果解析失败则返回 null 并记录错误
 */
const safeJsonParse = (raw: unknown): unknown => {
	if (typeof raw !== 'string') {
		return null;
	}

	try {
		return JSON.parse(raw);
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : 'Unknown JSON parse error';
		console.error(`JSON parse error: ${errorMsg}`, raw);
		return null;
	}
};

const parseTasks = (raw: string): Task[] => {
	try {
		const parsed = safeJsonParse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}

		const tasks: Task[] = [];
		for (const item of parsed) {
			const task = toTask(item);
			if (task) {
				tasks.push(task);
			}
		}
		return tasks;
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : 'Unknown error during task parsing';
		console.error(`Task parsing failed: ${errorMsg}`);
		return [];
	}
};

const cloneSubtasks = (subtasks: Subtask[] = []): Subtask[] => subtasks.map((subtask) => ({ ...subtask }));

const generateTaskId = (): string => {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 10);
	return `${timestamp}-${random}`;
};

const toSavePayload = (input: SaveTaskInput, now: number, existing?: Task): Task => {
	const dueDate = Object.prototype.hasOwnProperty.call(input, 'dueDate')
		? input.dueDate
		: existing?.dueDate;
	const dueStart = Object.prototype.hasOwnProperty.call(input, 'dueStart')
		? input.dueStart
		: existing?.dueStart;
	const dueEnd = Object.prototype.hasOwnProperty.call(input, 'dueEnd')
		? input.dueEnd
		: existing?.dueEnd;
	const allDay = Object.prototype.hasOwnProperty.call(input, 'allDay')
		? input.allDay
		: existing?.allDay;

	// remindedAt: 输入显式提供则用输入（含 undefined 重置），否则若关键字段（due*/reminderOffset）变更则重置
	const inputHasRemindedAt = Object.prototype.hasOwnProperty.call(input, 'remindedAt');
	const inputHasReminderOffset = Object.prototype.hasOwnProperty.call(input, 'reminderOffset');
	const inputHasDueDate = Object.prototype.hasOwnProperty.call(input, 'dueDate');
	const inputHasDueStart = Object.prototype.hasOwnProperty.call(input, 'dueStart');
	const inputHasDueEnd = Object.prototype.hasOwnProperty.call(input, 'dueEnd');
	const reminderOrDueChanged = inputHasReminderOffset || inputHasDueDate || inputHasDueStart || inputHasDueEnd;
	const remindedAt = inputHasRemindedAt
		? input.remindedAt
		: reminderOrDueChanged
			? undefined
			: existing?.remindedAt;

	const payload: TaskDraft = {
		id: input.id ?? existing?.id ?? generateTaskId(),
		title: input.title,
		status: input.status,
		dueDate,
		priority: input.priority,
		tags: [...input.tags],
		group: input.group,
		description: input.description,
		subtasks: cloneSubtasks(input.subtasks ?? existing?.subtasks ?? []),
		createdAt: existing?.createdAt ?? input.createdAt ?? now,
		updatedAt: existing ? now : input.updatedAt ?? now,
	};
	if (dueStart !== undefined) payload.dueStart = dueStart;
	if (dueEnd !== undefined) payload.dueEnd = dueEnd;
	if (allDay !== undefined) payload.allDay = allDay;
	if (inputHasReminderOffset && input.reminderOffset !== undefined) {
		payload.reminderOffset = input.reminderOffset;
	} else if (inputHasReminderOffset && input.reminderOffset === undefined) {
		// 显式清除
	} else if (existing?.reminderOffset !== undefined) {
		payload.reminderOffset = existing.reminderOffset;
	}
	if (remindedAt !== undefined) payload.remindedAt = remindedAt;
	if (input.snoozedUntil !== undefined) payload.snoozedUntil = input.snoozedUntil;
	else if (existing?.snoozedUntil !== undefined) payload.snoozedUntil = existing.snoozedUntil;
	const inputHasRepeat = Object.prototype.hasOwnProperty.call(input, 'repeat');
	if (inputHasRepeat && input.repeat !== undefined) payload.repeat = input.repeat;
	else if (!inputHasRepeat && existing?.repeat !== undefined) payload.repeat = existing.repeat;
	return buildTask(payload);
};

class TaskService {
	private readonly storageKey = STORAGE_KEYS.TASKS;

	private memoryTasks: Task[] = [];

	getAll(): Task[] {
		const raw = this.readFromStorage();

		if (raw === null) {
			return [...this.memoryTasks];
		}

		const tasks = parseTasks(raw);
		this.memoryTasks = tasks;
		return [...tasks];
	}

	getById(taskId: string): Task | null {
		const task = this.getAll().find((item) => item.id === taskId);
		return task ?? null;
	}

	/** 聚合所有任务用过的标签，按出现频次降序、名称升序稳定排序 */
	getAvailableTags(): string[] {
		const counter = new Map<string, number>();
		for (const task of this.getAll()) {
			for (const tag of task.tags) {
				const key = tag.trim();
				if (!key) continue;
				counter.set(key, (counter.get(key) ?? 0) + 1);
			}
		}
		return [...counter.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([name]) => name);
	}

	/** 聚合所有任务用过的分组，按出现频次降序、名称升序稳定排序 */
	getAvailableGroups(): string[] {
		const counter = new Map<string, number>();
		for (const task of this.getAll()) {
			const key = task.group.trim();
			if (!key) continue;
			counter.set(key, (counter.get(key) ?? 0) + 1);
		}
		return [...counter.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([name]) => name);
	}

	create(input: CreateTaskInput): Task {
		return this.saveTask(input);
	}

	saveTask(input: SaveTaskInput): Task {
		const now = Date.now();
		const tasks = this.getAll();

		if (input.id) {
			const index = tasks.findIndex((task) => task.id === input.id);
			if (index === -1) {
				throw new Error('任务不存在');
			}

			const existing = tasks[index]!;
			const next = toSavePayload(input, now, existing);
			tasks[index] = next;
			this.saveAll(tasks);
			return next;
		}

		const created = toSavePayload(input, now);
		tasks.push(created);
		this.saveAll(tasks);
		return created;
	}

	update(taskId: string, updates: UpdateTaskInput): Task | null {
		const tasks = this.getAll();
		const index = tasks.findIndex((task) => task.id === taskId);

		if (index === -1) {
			return null;
		}

		const current = tasks[index]!;
		const updateInput: SaveTaskInput = {
			id: current.id,
			title: updates.title ?? current.title,
			status: updates.status ?? current.status,
			priority: updates.priority ?? current.priority,
			tags: updates.tags ? [...updates.tags] : [...current.tags],
			group: updates.group ?? current.group,
			description: updates.description ?? current.description,
			subtasks: updates.subtasks ? cloneSubtasks(updates.subtasks) : cloneSubtasks(current.subtasks),
			createdAt: current.createdAt,
			updatedAt: current.updatedAt,
			...(Object.prototype.hasOwnProperty.call(updates, 'dueDate')
				? { dueDate: updates.dueDate }
				: current.dueDate === undefined
					? {}
					: { dueDate: current.dueDate }),
			...(Object.prototype.hasOwnProperty.call(updates, 'dueStart')
				? { dueStart: updates.dueStart }
				: current.dueStart === undefined
					? {}
					: { dueStart: current.dueStart }),
			...(Object.prototype.hasOwnProperty.call(updates, 'dueEnd')
				? { dueEnd: updates.dueEnd }
				: current.dueEnd === undefined
					? {}
					: { dueEnd: current.dueEnd }),
			...(Object.prototype.hasOwnProperty.call(updates, 'allDay')
				? { allDay: updates.allDay }
				: current.allDay === undefined
					? {}
					: { allDay: current.allDay }),
			...(Object.prototype.hasOwnProperty.call(updates, 'reminderOffset')
				? { reminderOffset: updates.reminderOffset }
				: current.reminderOffset === undefined
					? {}
					: { reminderOffset: current.reminderOffset }),
			...(Object.prototype.hasOwnProperty.call(updates, 'remindedAt')
				? { remindedAt: updates.remindedAt }
				: {}),
			...(Object.prototype.hasOwnProperty.call(updates, 'snoozedUntil')
				? { snoozedUntil: updates.snoozedUntil }
				: current.snoozedUntil === undefined
					? {}
					: { snoozedUntil: current.snoozedUntil }),
			...(Object.prototype.hasOwnProperty.call(updates, 'repeat')
				? { repeat: updates.repeat }
				: current.repeat === undefined
					? {}
					: { repeat: current.repeat }),
		};
		return this.saveTask(updateInput);
	}

	exportTasks(): string {
		return JSON.stringify(this.getAll(), null, 2);
	}

	importTasks(raw: string): TaskImportResult {
		const parsed = safeJsonParse(raw);
		if (!Array.isArray(parsed)) {
			return { importedCount: 0, duplicateCount: 0, invalidCount: 1 };
		}

		const currentTasks = this.getAll();
		const nextTasks = [...currentTasks];
		const existingIds = new Set(currentTasks.map((task) => task.id));
		let importedCount = 0;
		let duplicateCount = 0;
		let invalidCount = 0;

		for (const item of parsed) {
			const task = toTask(item);
			if (!task) {
				invalidCount += 1;
				continue;
			}

			if (existingIds.has(task.id)) {
				duplicateCount += 1;
				continue;
			}

			nextTasks.push({
				...task,
				tags: [...task.tags],
				subtasks: cloneSubtasks(task.subtasks),
			});
			existingIds.add(task.id);
			importedCount += 1;
		}

		if (importedCount > 0) {
			this.saveAll(nextTasks);
		}

		return { importedCount, duplicateCount, invalidCount };
	}

	replaceAll(tasks: Task[]): void {
		this.saveAll(tasks.map((task) => ({ ...task, tags: [...task.tags], subtasks: cloneSubtasks(task.subtasks) })));
	}

	delete(taskId: string): boolean {
		const tasks = this.getAll();
		const next = tasks.filter((task) => task.id !== taskId);

		if (next.length === tasks.length) {
			return false;
		}

		this.saveAll(next);
		return true;
	}

	addSubtask(taskId: string, title: string): Subtask | null {
		const task = this.getById(taskId);
		if (!task) {
			return null;
		}

		const now = Date.now();
		const subtask: Subtask = {
			id: generateTaskId(),
			title,
			completed: false,
			createdAt: now,
			updatedAt: now,
		};

		const updated = this.update(taskId, {
			subtasks: [...task.subtasks, subtask],
		});

		return updated ? subtask : null;
	}

	updateSubtask(taskId: string, subtaskId: string, completed: boolean): boolean {
		const task = this.getById(taskId);
		if (!task) {
			return false;
		}

		let found = false;
		const now = Date.now();

		const subtasks = task.subtasks.map((subtask) => {
			if (subtask.id !== subtaskId) {
				return subtask;
			}

			found = true;
			return {
				...subtask,
				completed,
				updatedAt: now,
			};
		});

		if (!found) {
			return false;
		}

		return this.update(taskId, { subtasks }) !== null;
	}

	deleteSubtask(taskId: string, subtaskId: string): boolean {
		const task = this.getById(taskId);
		if (!task) {
			return false;
		}

		const subtasks = task.subtasks.filter((subtask) => subtask.id !== subtaskId);

		if (subtasks.length === task.subtasks.length) {
			return false;
		}

		return this.update(taskId, { subtasks }) !== null;
	}

	changeStatus(taskId: string, status: TaskStatus): Task | null {
		const updated = this.update(taskId, { status });
		if (updated && status === 'done' && updated.repeat) {
			this.maybeSpawnNextInstance(updated);
		}
		return updated;
	}

	/**
	 * 若任务标记 done 且 repeat 规则未达结束条件，生成下一实例并写入存储。
	 * 不返回值（调用方已持有原任务的 done 状态）。
	 */
	private maybeSpawnNextInstance(task: Task): void {
		if (!shouldSpawnNext(task)) return;
		const next = buildNextInstance(task);
		const tasks = this.getAll();
		// 重新读取以避免与 update 写入的副本冲突
		const idx = tasks.findIndex((t) => t.id === task.id);
		if (idx !== -1 && next.repeat !== undefined) {
			tasks[idx] = { ...tasks[idx]!, repeat: next.repeat };
		}
		tasks.push(next);
		this.saveAll(tasks);
	}

	bulkUpdate(
		taskIds: string[],
		updates: Pick<UpdateTaskInput, 'status' | 'priority' | 'group'>,
	): number {
		if (taskIds.length === 0) {
			return 0;
		}

		const idSet = new Set(taskIds);
		const now = Date.now();
		const tasks = this.getAll();
		let count = 0;

		for (let i = 0; i < tasks.length; i += 1) {
			const task = tasks[i];
			if (!task || !idSet.has(task.id)) {
				continue;
			}

			tasks[i] = {
				...task,
				...(updates.status !== undefined ? { status: updates.status } : {}),
				...(updates.priority !== undefined ? { priority: updates.priority } : {}),
				...(updates.group !== undefined ? { group: updates.group } : {}),
				tags: [...task.tags],
				subtasks: cloneSubtasks(task.subtasks),
				updatedAt: now,
			};
			count += 1;
		}

		if (count > 0) {
			this.saveAll(tasks);
		}

		return count;
	}

	bulkDelete(taskIds: string[]): number {
		if (taskIds.length === 0) {
			return 0;
		}

		const idSet = new Set(taskIds);
		const tasks = this.getAll();
		const next = tasks.filter((task) => !idSet.has(task.id));
		const removed = tasks.length - next.length;

		if (removed > 0) {
			this.saveAll(next);
		}

		return removed;
	}

	private getDbStorage(): UtoolsDbStorage | null {
		try {
			const maybeWindow = window as Window & { utools?: UtoolsLike };
			if (!maybeWindow.utools?.dbStorage) {
				return null;
			}
			return maybeWindow.utools.dbStorage;
		} catch {
			return null;
		}
	}

	private readFromStorage(): string | null {
		const dbStorage = this.getDbStorage();
		if (!dbStorage) {
			return null;
		}

		try {
			const value = dbStorage.getItem(this.storageKey);
			return typeof value === 'string' ? value : null;
		} catch {
			return null;
		}
	}

	private saveAll(tasks: Task[]): void {
		this.memoryTasks = [...tasks];

		const dbStorage = this.getDbStorage();
		if (!dbStorage) {
			return;
		}

		try {
			dbStorage.setItem(this.storageKey, JSON.stringify(tasks));
		} catch {
			// Gracefully fall back to memory storage when dbStorage fails.
		}
	}

}

export const taskService = new TaskService();
