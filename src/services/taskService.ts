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
	'parentTaskId' | 'dueDate' | 'dueStart' | 'dueEnd' | 'allDay' | 'completedAt' | 'reminderOffset' | 'remindedAt' | 'snoozedUntil' | 'repeat' | 'archivedAt'
> & {
	parentTaskId: string | undefined;
	dueDate: number | undefined;
	dueStart?: number | undefined;
	dueEnd?: number | undefined;
	allDay?: boolean | undefined;
	completedAt?: number | undefined;
	reminderOffset?: number | undefined;
	remindedAt?: number | undefined;
	snoozedUntil?: number | undefined;
	repeat?: RepeatRule | undefined;
	archivedAt?: number | undefined;
};

type TaskSubtaskCompat = Task & Pick<Subtask, 'completed'>;

export type AddSubtaskOverrides = Partial<Pick<
	CreateTaskInput,
	'priority' | 'tags' | 'group' | 'dueStart' | 'dueEnd' | 'allDay'
>>;

const hasOwn = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);

const buildTask = (task: TaskDraft): Task => {
	const { parentTaskId, dueDate, dueStart, dueEnd, allDay, completedAt, reminderOffset, remindedAt, snoozedUntil, repeat, archivedAt, ...rest } = task;
	const result: Task = { ...rest } as Task;
	if (parentTaskId !== undefined) result.parentTaskId = parentTaskId;
	if (dueDate !== undefined) result.dueDate = dueDate;
	if (dueStart !== undefined) result.dueStart = dueStart;
	if (dueEnd !== undefined) result.dueEnd = dueEnd;
	if (allDay !== undefined) result.allDay = allDay;
	if (completedAt !== undefined) result.completedAt = completedAt;
	if (reminderOffset !== undefined) result.reminderOffset = reminderOffset;
	if (remindedAt !== undefined) result.remindedAt = remindedAt;
	if (snoozedUntil !== undefined) result.snoozedUntil = snoozedUntil;
	if (repeat !== undefined) result.repeat = repeat;
	if (archivedAt !== undefined) result.archivedAt = archivedAt;
	return result;
};

const toTask = (value: unknown): Task | null => {
	if (!isObjectRecord(value)) {
		return null;
	}

	const {
		id,
		parentTaskId,
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
		completedAt,
		reminderOffset,
		remindedAt,
		snoozedUntil,
		repeat,
		archivedAt,
	} = value;

	if (typeof id !== 'string' || id.length === 0) return null;
	if (parentTaskId !== undefined && (typeof parentTaskId !== 'string' || parentTaskId.length === 0)) return null;
	if (typeof title !== 'string') return null;
	if (!isTaskStatus(status)) return null;
	if (dueDate !== undefined && !isTimestamp(dueDate)) return null;
	if (dueStart !== undefined && !isTimestamp(dueStart)) return null;
	if (dueEnd !== undefined && !isTimestamp(dueEnd)) return null;
	if (allDay !== undefined && typeof allDay !== 'boolean') return null;
	if (priority !== 'low' && priority !== 'medium' && priority !== 'high' && priority !== 'urgent') return null;
	if (!Array.isArray(tags)) return null;
	if (typeof group !== 'string') return null;
	if (typeof description !== 'string') return null;
	if (!Array.isArray(subtasks)) return null;
	if (!isTimestamp(createdAt) || !isTimestamp(updatedAt)) return null;
	if (completedAt !== undefined && !isTimestamp(completedAt)) return null;
	if (reminderOffset !== undefined && (typeof reminderOffset !== 'number' || !Number.isFinite(reminderOffset) || reminderOffset < 0)) {
		return null;
	}
	if (remindedAt !== undefined && !isTimestamp(remindedAt)) return null;
	if (snoozedUntil !== undefined && !isTimestamp(snoozedUntil)) return null;
	if (archivedAt !== undefined && !isTimestamp(archivedAt)) return null;
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
		parentTaskId,
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
		...(completedAt !== undefined ? { completedAt } : {}),
		...(dueStart !== undefined ? { dueStart } : {}),
		...(dueEnd !== undefined ? { dueEnd } : {}),
		...(allDay !== undefined ? { allDay } : {}),
		...(reminderOffset !== undefined ? { reminderOffset } : {}),
		...(remindedAt !== undefined ? { remindedAt } : {}),
		...(snoozedUntil !== undefined ? { snoozedUntil } : {}),
		...(repeatRule !== undefined ? { repeat: repeatRule } : {}),
		...(archivedAt !== undefined ? { archivedAt } : {}),
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

interface TaskBackup {
	createdAt: number;
	tasks: Task[];
}

const parseTaskBackup = (raw: string): TaskBackup | null => {
	const parsed = safeJsonParse(raw);
	if (!isObjectRecord(parsed) || !isTimestamp(parsed.createdAt) || !Array.isArray(parsed.tasks)) {
		return null;
	}

	const tasks: Task[] = [];
	for (const item of parsed.tasks) {
		const task = toTask(item);
		if (!task) {
			return null;
		}
		tasks.push(task);
	}

	return { createdAt: parsed.createdAt, tasks };
};

const cloneSubtasks = (subtasks: Subtask[] = []): Subtask[] => subtasks.map((subtask) => ({ ...subtask }));

const cloneTask = (task: Task): Task => ({
	...task,
	tags: [...task.tags],
	subtasks: cloneSubtasks(task.subtasks),
});

const withArchivedState = (task: Task, archivedAt: number | undefined, now: number): Task => {
	const next: Task = {
		...task,
		tags: [...task.tags],
		subtasks: cloneSubtasks(task.subtasks),
		updatedAt: now,
	};
	if (archivedAt === undefined) {
		Reflect.deleteProperty(next, 'archivedAt');
	} else {
		next.archivedAt = archivedAt;
	}
	return next;
};

const getArchiveCascadeIds = (tasks: Task[], taskIds: Iterable<string>): Set<string> => {
	const existingIds = new Set(tasks.map((task) => task.id));
	const ids = new Set<string>();
	for (const taskId of taskIds) {
		if (existingIds.has(taskId)) {
			ids.add(taskId);
		}
	}

	for (const task of tasks) {
		if (task.parentTaskId && ids.has(task.parentTaskId)) {
			ids.add(task.id);
		}
	}
	return ids;
};

const migrateLegacySubtasks = (tasks: Task[]): { tasks: Task[]; migrated: boolean } => {
	let migrated = false;
	const nextTasks: Task[] = [];

	for (const task of tasks) {
		if (task.subtasks.length === 0) {
			nextTasks.push(cloneTask(task));
			continue;
		}

		migrated = true;
		nextTasks.push({
			...task,
			tags: [...task.tags],
			subtasks: [],
		});

		for (const subtask of task.subtasks) {
			nextTasks.push(buildTask({
				id: subtask.id,
				parentTaskId: task.id,
				title: subtask.title,
				status: subtask.completed ? 'done' : 'todo',
				dueDate: undefined,
				priority: task.priority,
				tags: [...task.tags],
				group: task.group,
				description: '',
				subtasks: [],
				createdAt: subtask.createdAt,
				updatedAt: subtask.updatedAt,
			}));
		}
	}

	return { tasks: nextTasks, migrated };
};

const generateTaskId = (): string => {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 10);
	return `${timestamp}-${random}`;
};

const toSavePayload = (input: SaveTaskInput, now: number, existing?: Task): Task => {
	const parentTaskId = hasOwn(input, 'parentTaskId')
		? input.parentTaskId
		: existing?.parentTaskId;
	const dueDate = hasOwn(input, 'dueDate')
		? input.dueDate
		: existing?.dueDate;
	const dueStart = hasOwn(input, 'dueStart')
		? input.dueStart
		: existing?.dueStart;
	const dueEnd = hasOwn(input, 'dueEnd')
		? input.dueEnd
		: existing?.dueEnd;
	const allDay = hasOwn(input, 'allDay')
		? input.allDay
		: existing?.allDay;
	const archivedAt = hasOwn(input, 'archivedAt')
		? input.archivedAt
		: existing?.archivedAt;
	const completedAt = input.status === 'done'
		? existing?.status !== 'done'
			? now
			: existing.completedAt
		: undefined;

	// remindedAt: 输入显式提供则用输入（含 undefined 重置），否则若关键字段（due*/reminderOffset）变更则重置
	const inputHasRemindedAt = hasOwn(input, 'remindedAt');
	const inputHasReminderOffset = hasOwn(input, 'reminderOffset');
	const inputHasDueDate = hasOwn(input, 'dueDate');
	const inputHasDueStart = hasOwn(input, 'dueStart');
	const inputHasDueEnd = hasOwn(input, 'dueEnd');
	const reminderOrDueChanged = inputHasReminderOffset || inputHasDueDate || inputHasDueStart || inputHasDueEnd;
	const remindedAt = inputHasRemindedAt
		? input.remindedAt
		: reminderOrDueChanged
			? undefined
			: existing?.remindedAt;

	const payload: TaskDraft = {
		id: input.id ?? existing?.id ?? generateTaskId(),
		parentTaskId,
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
	if (completedAt !== undefined) payload.completedAt = completedAt;
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
	const inputHasRepeat = hasOwn(input, 'repeat');
	if (inputHasRepeat && input.repeat !== undefined) payload.repeat = input.repeat;
	else if (!inputHasRepeat && existing?.repeat !== undefined) payload.repeat = existing.repeat;
	if (archivedAt !== undefined) payload.archivedAt = archivedAt;
	return buildTask(payload);
};

class TaskService {
	private readonly storageKey = STORAGE_KEYS.TASKS;
	private readonly backupStorageKey = STORAGE_KEYS.TASKS_BACKUP;

	private memoryTasks: Task[] = [];
	private memoryBackup: string | null = null;

	getAll(): Task[] {
		const raw = this.readFromStorage();

		if (raw === null) {
			const migration = migrateLegacySubtasks(this.memoryTasks);
			if (migration.migrated) {
				this.memoryTasks = migration.tasks;
			}
			return [...migration.tasks];
		}

		const migration = migrateLegacySubtasks(parseTasks(raw));
		this.memoryTasks = migration.tasks;
		if (migration.migrated) {
			this.saveAll(migration.tasks);
		}
		return [...migration.tasks];
	}

	getById(taskId: string): Task | null {
		const task = this.getAll().find((item) => item.id === taskId);
		return task ?? null;
	}

	getChildTasks(parentTaskId: string): Task[] {
		return this.getAll().filter((task) => task.parentTaskId === parentTaskId);
	}

	getIncompleteChildTasks(parentTaskId: string): Task[] {
		return this.getChildTasks(parentTaskId).filter((task) => task.status !== 'done');
	}

	getParentTask(task: Task): Task | null {
		if (!task.parentTaskId) {
			return null;
		}
		return this.getById(task.parentTaskId);
	}

	getTasksInParentOrder(tasks: Task[] = this.getAll()): Task[] {
		const source = tasks.map(cloneTask);
		const taskIds = new Set(source.map((task) => task.id));
		const childTasksByParent = new Map<string, Task[]>();
		const appendedIds = new Set<string>();
		const ordered: Task[] = [];

		for (const task of source) {
			if (!task.parentTaskId) {
				continue;
			}
			const siblings = childTasksByParent.get(task.parentTaskId) ?? [];
			siblings.push(task);
			childTasksByParent.set(task.parentTaskId, siblings);
		}

		for (const task of source) {
			if (task.parentTaskId) {
				continue;
			}
			ordered.push(task);
			appendedIds.add(task.id);
			for (const child of childTasksByParent.get(task.id) ?? []) {
				ordered.push(child);
				appendedIds.add(child.id);
			}
		}

		for (const task of source) {
			if (!task.parentTaskId || appendedIds.has(task.id) || taskIds.has(task.parentTaskId)) {
				continue;
			}
			ordered.push(task);
			appendedIds.add(task.id);
		}

		return ordered;
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
			if (existing.status !== 'doing' && next.status === 'doing') {
				this.promoteParentIfTodo(next.parentTaskId);
			}
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
			...(hasOwn(updates, 'parentTaskId')
				? { parentTaskId: updates.parentTaskId }
				: current.parentTaskId === undefined
					? {}
					: { parentTaskId: current.parentTaskId }),
			...(hasOwn(updates, 'dueDate')
				? { dueDate: updates.dueDate }
				: current.dueDate === undefined
					? {}
					: { dueDate: current.dueDate }),
			...(hasOwn(updates, 'dueStart')
				? { dueStart: updates.dueStart }
				: current.dueStart === undefined
					? {}
					: { dueStart: current.dueStart }),
			...(hasOwn(updates, 'dueEnd')
				? { dueEnd: updates.dueEnd }
				: current.dueEnd === undefined
					? {}
					: { dueEnd: current.dueEnd }),
			...(hasOwn(updates, 'allDay')
				? { allDay: updates.allDay }
				: current.allDay === undefined
					? {}
					: { allDay: current.allDay }),
			...(hasOwn(updates, 'reminderOffset')
				? { reminderOffset: updates.reminderOffset }
				: current.reminderOffset === undefined
					? {}
					: { reminderOffset: current.reminderOffset }),
			...(hasOwn(updates, 'remindedAt')
				? { remindedAt: updates.remindedAt }
				: {}),
			...(hasOwn(updates, 'snoozedUntil')
				? { snoozedUntil: updates.snoozedUntil }
				: current.snoozedUntil === undefined
					? {}
					: { snoozedUntil: current.snoozedUntil }),
			...(hasOwn(updates, 'repeat')
				? { repeat: updates.repeat }
				: current.repeat === undefined
					? {}
					: { repeat: current.repeat }),
			...(hasOwn(updates, 'archivedAt')
				? { archivedAt: updates.archivedAt }
				: current.archivedAt === undefined
					? {}
					: { archivedAt: current.archivedAt }),
		};
		return this.saveTask(updateInput);
	}

	archive(taskId: string): Task | null {
		return this.setArchived(taskId, Date.now());
	}

	unarchive(taskId: string): Task | null {
		return this.setArchived(taskId, undefined);
	}

	bulkArchive(taskIds: string[]): number {
		return this.bulkSetArchived(taskIds, Date.now());
	}

	bulkUnarchive(taskIds: string[]): number {
		return this.bulkSetArchived(taskIds, undefined);
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
				...cloneTask(task),
			});
			existingIds.add(task.id);
			importedCount += 1;
		}

		if (importedCount > 0) {
			this.saveBackup(currentTasks);
			this.saveAll(nextTasks);
		}

		return { importedCount, duplicateCount, invalidCount };
	}

	replaceAll(tasks: Task[]): void {
		this.saveBackup(this.getAll());
		this.saveAll(tasks.map(cloneTask));
	}

	hasBackup(): boolean {
		return this.readBackup() !== null;
	}

	restoreLatestBackup(): boolean {
		const backup = this.readBackup();
		if (!backup) {
			return false;
		}

		this.saveAll(backup.tasks.map(cloneTask));
		return true;
	}

	delete(taskId: string): boolean {
		const tasks = this.getAll();
		const next = tasks.filter((task) => task.id !== taskId && task.parentTaskId !== taskId);

		if (next.length === tasks.length) {
			return false;
		}

		this.saveBackup(tasks);
		this.saveAll(next);
		return true;
	}

	addSubtask(taskId: string, title: string, overrides?: AddSubtaskOverrides): TaskSubtaskCompat | null {
		const task = this.getById(taskId);
		if (!task) {
			return null;
		}

		const child = this.saveTask({
			title,
			status: 'todo',
			priority: overrides?.priority ?? task.priority,
			tags: overrides?.tags ?? [...task.tags],
			group: overrides?.group ?? task.group,
			dueStart: overrides?.dueStart,
			dueEnd: overrides?.dueEnd,
			allDay: overrides?.allDay,
			description: '',
			subtasks: [],
			parentTaskId: task.id,
		});

		return { ...child, completed: false };
	}

	updateSubtask(taskId: string, subtaskId: string, completed: boolean): boolean {
		const child = this.getAll().find((task) => task.id === subtaskId && task.parentTaskId === taskId);
		if (!child) {
			return false;
		}

		return this.update(child.id, { status: completed ? 'done' : 'todo' }) !== null;
	}

	deleteSubtask(taskId: string, subtaskId: string): boolean {
		const tasks = this.getAll();
		if (!tasks.some((task) => task.id === subtaskId && task.parentTaskId === taskId)) {
			return false;
		}

		this.saveAll(tasks.filter((task) => task.id !== subtaskId));
		return true;
	}

	changeStatus(taskId: string, status: TaskStatus): Task | null {
		if (status === 'done' && this.getIncompleteChildTasks(taskId).length > 0) {
			return null;
		}
		const updated = this.update(taskId, { status });
		if (updated && status === 'done' && updated.repeat) {
			this.maybeSpawnNextInstance(updated);
		}
		return updated;
	}

	/**
	 * 直属子任务进入 doing 时，若父任务仍是 todo，自动提升为 doing。
	 * 不影响 done/doing 父任务，不递归到更上层。
	 */
	private promoteParentIfTodo(parentTaskId: string | undefined): void {
		if (!parentTaskId) return;
		const tasks = this.getAll();
		const parentIndex = tasks.findIndex((task) => task.id === parentTaskId);
		if (parentIndex === -1) return;
		const parent = tasks[parentIndex]!;
		if (parent.status !== 'todo') return;
		tasks[parentIndex] = {
			...parent,
			tags: [...parent.tags],
			subtasks: cloneSubtasks(parent.subtasks),
			status: 'doing',
			updatedAt: Date.now(),
		};
		this.saveAll(tasks);
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
		const blockedParentIds = updates.status === 'done'
			? new Set(tasks
				.filter((task) => idSet.has(task.id) && tasks.some((child) => child.parentTaskId === task.id && child.status !== 'done'))
				.map((task) => task.id))
			: new Set<string>();
		let count = 0;

		const existingTasks = tasks.slice();
		for (const task of existingTasks) {
			const i = tasks.findIndex((candidate) => candidate.id === task.id);
			if (i === -1) {
				continue;
			}
			if (!idSet.has(task.id) || blockedParentIds.has(task.id)) {
				continue;
			}

			const updated: Task = {
				...task,
				...(updates.status !== undefined ? { status: updates.status } : {}),
				...(updates.priority !== undefined ? { priority: updates.priority } : {}),
				...(updates.group !== undefined ? { group: updates.group } : {}),
				tags: [...task.tags],
				subtasks: cloneSubtasks(task.subtasks),
				updatedAt: now,
			};
			if (updated.status !== 'done') {
				Reflect.deleteProperty(updated, 'completedAt');
			} else if (task.status !== 'done') {
				updated.completedAt = now;
			}
			tasks[i] = updated;
			if (task.status !== 'done' && updated.status === 'done' && updated.repeat && shouldSpawnNext(updated)) {
				const next = buildNextInstance(updated);
				if (next.repeat !== undefined) {
					tasks[i] = { ...updated, repeat: next.repeat };
				}
				tasks.push(next);
			}
			if (task.status !== 'doing' && updated.status === 'doing' && updated.parentTaskId) {
				const parentIndex = tasks.findIndex((candidate) => candidate.id === updated.parentTaskId);
				const parent = parentIndex === -1 ? undefined : tasks[parentIndex];
				if (parent && parent.status === 'todo') {
					tasks[parentIndex] = {
						...parent,
						tags: [...parent.tags],
						subtasks: cloneSubtasks(parent.subtasks),
						status: 'doing',
						updatedAt: now,
					};
				}
			}
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
			this.saveBackup(tasks);
			this.saveAll(next);
		}

		return removed;
	}

	private setArchived(taskId: string, archivedAt: number | undefined): Task | null {
		const tasks = this.getAll();
		const index = tasks.findIndex((task) => task.id === taskId);
		if (index === -1) {
			return null;
		}

		const now = Date.now();
		const cascadeIds = getArchiveCascadeIds(tasks, [taskId]);
		for (let i = 0; i < tasks.length; i += 1) {
			const task = tasks[i];
			if (task && cascadeIds.has(task.id)) {
				tasks[i] = withArchivedState(task, archivedAt, now);
			}
		}
		this.saveAll(tasks);
		return tasks[index] ?? null;
	}

	private bulkSetArchived(taskIds: string[], archivedAt: number | undefined): number {
		if (taskIds.length === 0) {
			return 0;
		}

		const tasks = this.getAll();
		const idSet = getArchiveCascadeIds(tasks, taskIds);
		const now = Date.now();
		let count = 0;

		for (let i = 0; i < tasks.length; i += 1) {
			const task = tasks[i];
			if (!task || !idSet.has(task.id)) {
				continue;
			}

			const next = withArchivedState(task, archivedAt, now);
			tasks[i] = next;
			count += 1;
		}

		if (count > 0) {
			this.saveAll(tasks);
		}

		return count;
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
		return this.readStorage(this.storageKey);
	}

	private readStorage(key: string): string | null {
		const dbStorage = this.getDbStorage();
		if (!dbStorage) {
			return key === this.backupStorageKey ? this.memoryBackup : null;
		}

		try {
			const value = dbStorage.getItem(key);
			return typeof value === 'string' ? value : null;
		} catch {
			return null;
		}
	}

	private readBackup(): TaskBackup | null {
		const raw = this.readStorage(this.backupStorageKey);
		return raw === null ? null : parseTaskBackup(raw);
	}

	private saveBackup(tasks: Task[]): void {
		const backup = JSON.stringify({
			createdAt: Date.now(),
			tasks: tasks.map(cloneTask),
		});
		this.memoryBackup = backup;

		const dbStorage = this.getDbStorage();
		if (!dbStorage) {
			return;
		}

		try {
			dbStorage.setItem(this.backupStorageKey, backup);
		} catch {
			// Gracefully fall back to memory storage when dbStorage fails.
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
