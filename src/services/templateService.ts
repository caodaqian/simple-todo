import type {
	CreateTaskInput,
	Subtask,
	Task,
	TaskTemplate,
} from '../types/task';
import { STORAGE_KEYS } from './storageKeys';
import { taskService } from './taskService';

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

const isTimestamp = (value: unknown): value is number => {
	return typeof value === 'number' && Number.isFinite(value);
};

const generateSubtaskId = (): string => {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 10);
	return `sub-${timestamp}-${random}`;
};

const cloneSubtasksWithNewIds = (subtasks: Subtask[] = [], now: number = Date.now()): Subtask[] =>
	subtasks.map((s) => ({
		id: generateSubtaskId(),
		title: s.title,
		completed: false,
		createdAt: now,
		updatedAt: now,
	}));

const cloneSubtasks = (subtasks: Subtask[] = []): Subtask[] =>
	subtasks.map((s) => ({ ...s }));

const generateTemplateId = (): string => {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 10);
	return `tpl-${timestamp}-${random}`;
};

const toTemplate = (value: unknown): TaskTemplate | null => {
	if (!isObjectRecord(value)) return null;
	const {
		id, name, title, priority, tags, group, description, subtasks,
		reminderOffset, repeat, createdAt, updatedAt,
	} = value;
	if (typeof id !== 'string' || id.length === 0) return null;
	if (typeof name !== 'string') return null;
	if (typeof title !== 'string') return null;
	if (priority !== 'low' && priority !== 'medium' && priority !== 'high' && priority !== 'urgent') return null;
	if (!Array.isArray(tags)) return null;
	if (typeof group !== 'string') return null;
	if (typeof description !== 'string') return null;
	if (!Array.isArray(subtasks)) return null;
	if (!isTimestamp(createdAt) || !isTimestamp(updatedAt)) return null;
	if (reminderOffset !== undefined && (typeof reminderOffset !== 'number' || !Number.isFinite(reminderOffset) || reminderOffset < 0)) {
		return null;
	}

	const normalizedTags: string[] = [];
	for (const tag of tags) {
		if (typeof tag !== 'string') return null;
		normalizedTags.push(tag);
	}

	const normalizedSubtasks: Subtask[] = [];
	for (const subtask of subtasks) {
		if (!isObjectRecord(subtask)) return null;
		const {
			id: subId, title: subTitle, completed, createdAt: subC, updatedAt: subU,
		} = subtask;
		if (typeof subId !== 'string' || subId.length === 0) return null;
		if (typeof subTitle !== 'string') return null;
		if (typeof completed !== 'boolean') return null;
		if (!isTimestamp(subC) || !isTimestamp(subU)) return null;
		normalizedSubtasks.push({ id: subId, title: subTitle, completed, createdAt: subC, updatedAt: subU });
	}

	// repeat 校验复用宽松规则
	let repeatRule: TaskTemplate['repeat'];
	if (repeat !== undefined && isObjectRecord(repeat)) {
		const r = repeat as Record<string, unknown>;
		if (
			(r.type === 'daily' || r.type === 'weekly' || r.type === 'monthly' || r.type === 'custom')
			&& typeof r.interval === 'number' && r.interval > 0
		) {
			repeatRule = {
				type: r.type,
				interval: r.interval,
				...(isTimestamp(r.repeatUntil) ? { repeatUntil: r.repeatUntil } : {}),
				...(typeof r.repeatCount === 'number' && Number.isFinite(r.repeatCount) ? { repeatCount: r.repeatCount } : {}),
			};
		}
	}

	return {
		id, name, title, priority,
		tags: normalizedTags, group, description,
		subtasks: normalizedSubtasks,
		createdAt, updatedAt,
		...(reminderOffset !== undefined ? { reminderOffset } : {}),
		...(repeatRule !== undefined ? { repeat: repeatRule } : {}),
	};
};

export interface CreateTemplateInput {
	name: string;
	title: string;
	priority: TaskTemplate['priority'];
	tags?: string[];
	group?: string;
	description?: string;
	subtasks?: Subtask[];
	reminderOffset?: number;
	repeat?: TaskTemplate['repeat'];
}

export interface ApplyTemplateOverrides {
	title?: string;
	dueDate?: number;
	tags?: string[];
	group?: string;
}

class TemplateService {
	private readonly storageKey = STORAGE_KEYS.TEMPLATES;

	private memoryTemplates: TaskTemplate[] = [];

	private readFromStorage(): string | null {
		const utools = (window as Window & UtoolsLike).utools;
		return (utools?.dbStorage?.getItem(this.storageKey) as string | null) ?? null;
	}

	private saveToStorage(templates: TaskTemplate[]): void {
		const utools = (window as Window & UtoolsLike).utools;
		utools?.dbStorage?.setItem(this.storageKey, JSON.stringify(templates));
	}

	list(): TaskTemplate[] {
		const raw = this.readFromStorage();
		if (raw === null) return [...this.memoryTemplates];
		try {
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [...this.memoryTemplates];
			const templates: TaskTemplate[] = [];
			for (const item of parsed) {
				const tpl = toTemplate(item);
				if (tpl) templates.push(tpl);
			}
			this.memoryTemplates = templates;
			return [...templates];
		} catch {
			return [...this.memoryTemplates];
		}
	}

	getById(id: string): TaskTemplate | null {
		return this.list().find((t) => t.id === id) ?? null;
	}

	create(input: CreateTemplateInput): TaskTemplate {
		const now = Date.now();
		const tpl: TaskTemplate = {
			id: generateTemplateId(),
			name: input.name,
			title: input.title,
			priority: input.priority,
			tags: input.tags ? [...input.tags] : [],
			group: input.group ?? '',
			description: input.description ?? '',
			subtasks: cloneSubtasks(input.subtasks),
			createdAt: now,
			updatedAt: now,
			...(input.reminderOffset !== undefined ? { reminderOffset: input.reminderOffset } : {}),
			...(input.repeat !== undefined ? { repeat: input.repeat } : {}),
		};
		const list = this.list();
		list.push(tpl);
		this.saveToStorage(list);
		this.memoryTemplates = list;
		return tpl;
	}

	update(id: string, patch: Partial<CreateTemplateInput>): TaskTemplate | null {
		const list = this.list();
		const idx = list.findIndex((t) => t.id === id);
		if (idx === -1) return null;
		const current = list[idx]!;
		const now = Date.now();
		const next: TaskTemplate = {
			...current,
			name: patch.name ?? current.name,
			title: patch.title ?? current.title,
			priority: patch.priority ?? current.priority,
			tags: patch.tags ? [...patch.tags] : [...current.tags],
			group: patch.group ?? current.group,
			description: patch.description ?? current.description,
			subtasks: patch.subtasks ? cloneSubtasks(patch.subtasks) : cloneSubtasks(current.subtasks),
			updatedAt: now,
			...(patch.reminderOffset !== undefined ? { reminderOffset: patch.reminderOffset } : {}),
			...(patch.repeat !== undefined ? { repeat: patch.repeat } : {}),
		};
		list[idx] = next;
		this.saveToStorage(list);
		this.memoryTemplates = list;
		return next;
	}

	delete(id: string): boolean {
		const list = this.list();
		const next = list.filter((t) => t.id !== id);
		if (next.length === list.length) return false;
		this.saveToStorage(next);
		this.memoryTemplates = next;
		return true;
	}

	/**
	 * 从模板创建一个新任务，应用 overrides 覆盖 title/dueDate/tags/group。
	 * 返回新建的 Task。
	 */
	applyTemplate(templateId: string, overrides: ApplyTemplateOverrides = {}): Task {
		const tpl = this.getById(templateId);
		if (!tpl) {
			throw new Error('未找到模板: ' + templateId);
		}
		const input: CreateTaskInput = {
			title: overrides.title ?? tpl.title,
			status: 'todo',
			priority: tpl.priority,
			tags: overrides.tags ? [...overrides.tags] : [...tpl.tags],
			group: overrides.group ?? tpl.group,
			description: tpl.description,
			subtasks: cloneSubtasksWithNewIds(tpl.subtasks),
			...(overrides.dueDate !== undefined ? { dueDate: overrides.dueDate } : {}),
			...(tpl.reminderOffset !== undefined ? { reminderOffset: tpl.reminderOffset } : {}),
			...(tpl.repeat !== undefined ? { repeat: tpl.repeat } : {}),
		};
		return taskService.create(input);
	}
}

export const templateService = new TemplateService();
