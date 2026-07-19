import type {
	CreateTaskInput,
	Subtask,
	Task,
	TaskTemplate,
	TaskTemplateChild,
} from '../types/task';
import { createDocumentStore, type DocumentRecord, type DocumentStore } from './documentStore';
import { STORAGE_KEYS } from './storageKeys';
import { taskService } from './taskService';

interface UtoolsDbStorage {
	getItem(key: string): unknown;
	setItem(key: string, value: string): unknown;
	removeItem?(key: string): unknown;
}

interface UtoolsLike {
	db?: UtoolsDb;
	dbStorage?: UtoolsDbStorage;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === 'object' && value !== null;
};

const isTimestamp = (value: unknown): value is number => {
	return typeof value === 'number' && Number.isFinite(value);
};

const cloneSubtasks = (subtasks: Subtask[] = []): Subtask[] =>
	subtasks.map((s) => ({ ...s }));

const cloneChildTasks = (children: TaskTemplateChild[] = []): TaskTemplateChild[] =>
	children.map((child) => ({ ...child, tags: [...child.tags] }));

const isPriority = (value: unknown): value is TaskTemplateChild['priority'] =>
	value === 'low' || value === 'medium' || value === 'high' || value === 'urgent';

const toChildTask = (value: unknown, defaults: Pick<TaskTemplateChild, 'priority' | 'tags' | 'group'>): TaskTemplateChild | null => {
	if (!isObjectRecord(value) || typeof value.title !== 'string' || !value.title.trim()) return null;
	if (value.priority !== undefined && !isPriority(value.priority)) return null;
	if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string'))) return null;
	if (value.group !== undefined && typeof value.group !== 'string') return null;
	if (value.description !== undefined && typeof value.description !== 'string') return null;
	return {
		title: value.title.trim(),
		priority: value.priority ?? defaults.priority,
		tags: value.tags === undefined ? [...defaults.tags] : [...value.tags],
		group: value.group ?? defaults.group,
		description: value.description ?? '',
	};
};

const generateTemplateId = (): string => {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 10);
	return `tpl-${timestamp}-${random}`;
};

const toTemplate = (value: unknown): TaskTemplate | null => {
	if (!isObjectRecord(value)) return null;
	const {
		id, name, title, priority, tags, group, description, subtasks, children, childTasks,
		reminderOffset, createdAt, updatedAt,
	} = value;
	if (typeof id !== 'string' || id.length === 0) return null;
	if (typeof name !== 'string') return null;
	if (typeof title !== 'string') return null;
	if (!isPriority(priority)) return null;
	if (!Array.isArray(tags)) return null;
	if (typeof group !== 'string') return null;
	if (typeof description !== 'string') return null;
	if (!Array.isArray(subtasks) && !Array.isArray(children) && !Array.isArray(childTasks)) return null;
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
	for (const subtask of Array.isArray(subtasks) ? subtasks : []) {
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
	const childDefaults = { priority, tags: normalizedTags, group };
	const normalizedChildTasks: TaskTemplateChild[] = [];
	if (Array.isArray(childTasks)) {
		for (const child of childTasks) {
			const normalized = toChildTask(child, childDefaults);
			if (!normalized) return null;
			normalizedChildTasks.push(normalized);
		}
	} else if (Array.isArray(children)) {
		for (const child of children) {
			if (typeof child !== 'string' || !child.trim()) return null;
			normalizedChildTasks.push({ title: child.trim(), priority, tags: [...normalizedTags], group, description: '' });
		}
	} else {
		for (const subtask of normalizedSubtasks) {
			normalizedChildTasks.push({ title: subtask.title, priority, tags: [...normalizedTags], group, description: '' });
		}
	}

	return {
		id, name, title, priority,
		tags: normalizedTags, group, description,
		subtasks: normalizedSubtasks,
		childTasks: normalizedChildTasks,
		children: normalizedChildTasks.map((child) => child.title),
		createdAt, updatedAt,
		...(reminderOffset !== undefined ? { reminderOffset } : {}),
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
	children?: string[];
	childTasks?: TaskTemplateChild[];
	reminderOffset?: number | null;
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
	private readonly templateDocumentPrefix = STORAGE_KEYS.TEMPLATE_DOCUMENT_PREFIX;

	private memoryTemplates: TaskTemplate[] = [];
	private nativeTemplateBaseline = new Map<string, DocumentRecord<TaskTemplate>>();

	private readFromStorage(): string | null {
		const utools = (window as Window & UtoolsLike).utools;
		return (utools?.dbStorage?.getItem(this.storageKey) as string | null) ?? null;
	}

	private saveToStorage(templates: TaskTemplate[]): void {
		const utools = (window as Window & UtoolsLike).utools;
		utools?.dbStorage?.setItem(this.storageKey, JSON.stringify(templates));
	}

	private getDocumentStore(): DocumentStore<TaskTemplate> | null {
		try {
			return (window as Window & { utools?: UtoolsLike }).utools?.db === undefined
				? null
				: createDocumentStore<TaskTemplate>();
		} catch {
			return null;
		}
	}

	private getDocumentId(id: string): string {
		return `${this.templateDocumentPrefix}${id}`;
	}

	private cloneTemplate(template: TaskTemplate): TaskTemplate {
		return {
			...template,
			tags: [...template.tags],
			subtasks: cloneSubtasks(template.subtasks),
			childTasks: cloneChildTasks(template.childTasks),
			...(template.children === undefined ? {} : { children: [...template.children] }),
		};
	}

	list(): TaskTemplate[] {
		const documentStore = this.getDocumentStore();
		if (documentStore) {
			const legacy = this.readLegacyTemplates();
			for (const template of legacy) {
				if (documentStore.get(this.getDocumentId(template.id)) !== null) continue;
				const result = documentStore.write({ _id: this.getDocumentId(template.id), data: this.cloneTemplate(template) });
				if (result.status !== 'ok' && result.status !== 'conflict') {
					throw new Error(result.message ?? '迁移模板数据失败');
				}
			}
			if (legacy.length > 0) this.clearLegacyTemplates();
			const templates: TaskTemplate[] = [];
			const baseline = new Map<string, DocumentRecord<TaskTemplate>>();
			for (const document of documentStore.list(this.templateDocumentPrefix)) {
				const template = toTemplate(document.data);
				if (!template) continue;
				templates.push(template);
				baseline.set(template.id, { _id: document._id, ...(document._rev === undefined ? {} : { _rev: document._rev }), data: this.cloneTemplate(template) });
			}
			this.nativeTemplateBaseline = baseline;
			this.memoryTemplates = templates.map((template) => this.cloneTemplate(template));
			return templates.map((template) => this.cloneTemplate(template));
		}

		this.nativeTemplateBaseline.clear();
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
			return templates.map((template) => this.cloneTemplate(template));
		} catch {
			return [...this.memoryTemplates];
		}
	}

	getById(id: string): TaskTemplate | null {
		return this.list().find((t) => t.id === id) ?? null;
	}

	private readLegacyTemplates(): TaskTemplate[] {
		const raw = this.readFromStorage();
		if (raw === null) return [];
		try {
			const parsed: unknown = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [];
			return parsed.map(toTemplate).filter((template): template is TaskTemplate => template !== null);
		} catch {
			return [];
		}
	}

	private clearLegacyTemplates(): void {
		try {
			(window as Window & UtoolsLike).utools?.dbStorage?.removeItem?.(this.storageKey);
		} catch {
			// Native documents remain authoritative if legacy cleanup cannot run.
		}
	}

	create(input: CreateTemplateInput): TaskTemplate {
		const now = Date.now();
		const name = input.name.trim();
		const title = input.title.trim() || name;
		const tpl: TaskTemplate = {
			id: generateTemplateId(),
			name,
			title,
			priority: input.priority,
			tags: input.tags ? [...input.tags] : [],
			group: input.group ?? '',
			description: input.description ?? '',
			subtasks: cloneSubtasks(input.subtasks),
			childTasks: input.childTasks
				? cloneChildTasks(input.childTasks)
				: (input.children ?? (input.subtasks ?? []).map((subtask) => subtask.title)).map((title) => ({
					title, priority: input.priority, tags: input.tags ? [...input.tags] : [], group: input.group ?? '', description: '',
				})),
			children: input.childTasks
				? input.childTasks.map((child) => child.title)
				: input.children ? [...input.children] : (input.subtasks ?? []).map((subtask) => subtask.title),
			createdAt: now,
			updatedAt: now,
			...(typeof input.reminderOffset === 'number' ? { reminderOffset: input.reminderOffset } : {}),
		};
		const documentStore = this.getDocumentStore();
		if (documentStore) {
			const result = documentStore.write({ _id: this.getDocumentId(tpl.id), data: this.cloneTemplate(tpl) });
			if (result.status !== 'ok') throw new Error(result.message ?? '保存模板失败');
			this.nativeTemplateBaseline.set(tpl.id, { _id: this.getDocumentId(tpl.id), ...(result.rev === undefined ? {} : { _rev: result.rev }), data: this.cloneTemplate(tpl) });
			this.memoryTemplates = [...this.memoryTemplates, this.cloneTemplate(tpl)];
			return this.cloneTemplate(tpl);
		}
		const list = this.list();
		list.push(tpl);
		this.saveToStorage(list);
		this.memoryTemplates = list;
		return this.cloneTemplate(tpl);
	}

	update(id: string, patch: Partial<CreateTemplateInput>): TaskTemplate | null {
		const current = this.getById(id);
		if (current === null) return null;
		const now = Date.now();
		const nextName = patch.name ?? current.name;
		const nextTitle = patch.title === undefined ? current.title : (patch.title.trim() || nextName);
		const { reminderOffset: currentReminderOffset, ...currentWithoutReminderOffset } = current;
		const next: TaskTemplate = {
			...currentWithoutReminderOffset,
			name: nextName,
			title: nextTitle,
			priority: patch.priority ?? current.priority,
			tags: patch.tags ? [...patch.tags] : [...current.tags],
			group: patch.group ?? current.group,
			description: patch.description ?? current.description,
			subtasks: patch.subtasks ? cloneSubtasks(patch.subtasks) : cloneSubtasks(current.subtasks),
			childTasks: patch.childTasks !== undefined
				? cloneChildTasks(patch.childTasks)
				: patch.children !== undefined
					? patch.children.map((title) => ({ title, priority: current.priority, tags: [...current.tags], group: current.group, description: '' }))
					: cloneChildTasks(current.childTasks),
			children: patch.childTasks !== undefined
				? patch.childTasks.map((child) => child.title)
				: patch.children !== undefined ? [...patch.children] : [...(current.children ?? current.childTasks.map((child) => child.title))],
			updatedAt: now,
			...(patch.reminderOffset === undefined
				? (currentReminderOffset === undefined ? {} : { reminderOffset: currentReminderOffset })
				: (patch.reminderOffset === null ? {} : { reminderOffset: patch.reminderOffset })),
		};
		const documentStore = this.getDocumentStore();
		if (documentStore) {
			const baseline = this.nativeTemplateBaseline.get(id);
			const result = documentStore.write({
				_id: this.getDocumentId(id),
				...(baseline?._rev === undefined ? {} : { _rev: baseline._rev }),
				data: this.cloneTemplate(next),
			});
			if (result.status !== 'ok') return null;
			this.nativeTemplateBaseline.set(id, { _id: this.getDocumentId(id), ...(result.rev === undefined ? {} : { _rev: result.rev }), data: this.cloneTemplate(next) });
			this.memoryTemplates = this.memoryTemplates.map((template) => template.id === id ? this.cloneTemplate(next) : template);
			return this.cloneTemplate(next);
		}
		const list = this.list();
		const idx = list.findIndex((template) => template.id === id);
		if (idx === -1) return null;
		list[idx] = next;
		this.saveToStorage(list);
		this.memoryTemplates = list;
		return next;
	}

	delete(id: string): boolean {
		const documentStore = this.getDocumentStore();
		if (documentStore) {
			const current = this.getById(id);
			if (!current) return false;
			const baseline = this.nativeTemplateBaseline.get(id);
			const result = documentStore.remove({ _id: this.getDocumentId(id), ...(baseline?._rev === undefined ? {} : { _rev: baseline._rev }) });
			if (result.status !== 'ok') return false;
			this.nativeTemplateBaseline.delete(id);
			this.memoryTemplates = this.memoryTemplates.filter((template) => template.id !== id);
			return true;
		}
		const list = this.list();
		const next = list.filter((t) => t.id !== id);
		if (next.length === list.length) return false;
		this.saveToStorage(next);
		this.memoryTemplates = next;
		return true;
	}

	buildDraft(templateId: string): { task: CreateTaskInput; children: CreateTaskInput[] } {
		const template = this.getById(templateId);
		if (!template) throw new Error(`未找到模板: ${templateId}`);
		const task: CreateTaskInput = {
			title: template.title,
			status: 'todo',
			priority: template.priority,
			tags: [...template.tags],
			group: template.group,
			description: template.description,
			subtasks: [],
			...(template.reminderOffset === undefined ? {} : { reminderOffset: template.reminderOffset }),
		};
		return {
			task,
			children: template.childTasks.map((child) => ({
				title: child.title,
				status: 'todo',
				priority: child.priority,
				tags: [...child.tags],
				group: child.group,
				description: child.description,
				subtasks: [],
			})),
		};
	}

	createFromTask(name: string, task: Task, children: Task[]): TaskTemplate {
		return this.create({
			name,
			title: task.title,
			priority: task.priority,
			tags: [...task.tags],
			group: task.group,
			description: task.description,
			childTasks: children.map((child) => ({
				title: child.title,
				priority: child.priority,
				tags: [...child.tags],
				group: child.group,
				description: child.description,
			})),
			...(task.reminderOffset === undefined ? {} : { reminderOffset: task.reminderOffset }),
		});
	}

	/**
	 * 从模板创建一个新任务，应用 overrides 覆盖 title/dueDate/tags/group。
	 * 返回新建的 Task。
	 */
	applyTemplate(templateId: string, overrides: ApplyTemplateOverrides = {}): Task {
		const draft = this.buildDraft(templateId);
		const input: CreateTaskInput = {
			...draft.task,
			title: overrides.title ?? draft.task.title,
			status: 'todo',
			tags: overrides.tags ? [...overrides.tags] : [...draft.task.tags],
			group: overrides.group ?? draft.task.group,
			subtasks: [],
			...(overrides.dueDate !== undefined ? { dueDate: overrides.dueDate } : {}),
		};
		const task = taskService.create(input);
		for (const child of draft.children) {
			taskService.create({
				...child,
				status: 'todo',
				subtasks: [],
				parentTaskId: task.id,
			});
		}
		return task;
	}
}

export const templateService = new TemplateService();
