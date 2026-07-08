import { parseDateFromText } from '../composables/useDateParser';
import type { Task, TaskPriority, UpdateTaskInput } from '../types/task';

export interface SmartOrganizationChange {
	taskId: string;
	title: string;
	patch: UpdateTaskInput;
	reasons: string[];
}

export interface SmartOrganizationPlan {
	changes: SmartOrganizationChange[];
	skipped: number;
}

interface SmartOrganizationOptions {
	now?: number;
}

const KEYWORD_RULES: Array<{ tags: string[]; group: string; pattern: RegExp }> = [
	{ pattern: /(bug|缺陷|报错|修复|崩溃|异常|线上|错误)/i, group: '工作', tags: ['开发', '缺陷'] },
	{ pattern: /(需求|评审|迭代|发布|上线|项目)/i, group: '工作', tags: ['项目'] },
	{ pattern: /(会议|同步|沟通|复盘|周会|站会)/i, group: '工作', tags: ['会议'] },
	{ pattern: /(学习|阅读|课程|读书|研究|调研)/i, group: '学习', tags: ['学习'] },
	{ pattern: /(运动|健身|跑步|体检|医生|健康)/i, group: '生活', tags: ['健康'] },
	{ pattern: /(买|采购|缴费|快递|家务|做饭)/i, group: '生活', tags: ['生活'] },
];

const PRIORITY_RULES: Array<{ priority: TaskPriority; pattern: RegExp }> = [
	{ priority: 'urgent', pattern: /(紧急|马上|立刻|今天|线上|阻塞|critical|urgent|asap)/i },
	{ priority: 'high', pattern: /(重要|本周|高优|发布|截止|评审|high)/i },
	{ priority: 'low', pattern: /(有空|以后|低优|可选|low)/i },
];

const toDayStart = (timestamp: number): number => {
	const date = new Date(timestamp);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
};

const inferPriority = (text: string): TaskPriority | undefined => {
	for (const rule of PRIORITY_RULES) {
		if (rule.pattern.test(text)) return rule.priority;
	}
	return undefined;
};

const inferKeywordMetadata = (text: string): { group?: string; tags: string[] } => {
	const tags = new Set<string>();
	let group: string | undefined;
	for (const rule of KEYWORD_RULES) {
		if (!rule.pattern.test(text)) continue;
		group ??= rule.group;
		for (const tag of rule.tags) tags.add(tag);
	}
	return { ...(group !== undefined ? { group } : {}), tags: [...tags] };
};

const addUniqueTags = (current: string[], suggested: string[]): string[] => {
	const normalized = new Set(current.map((tag) => tag.trim()).filter(Boolean));
	for (const tag of suggested) {
		const trimmed = tag.trim();
		if (trimmed) normalized.add(trimmed);
	}
	return [...normalized];
};

const hasPatch = (patch: UpdateTaskInput): boolean => Object.keys(patch).length > 0;

export const suggestTaskOrganization = (task: Task, options: SmartOrganizationOptions = {}): SmartOrganizationChange | null => {
	if (task.archivedAt !== undefined || task.status === 'done') return null;

	const text = `${task.title} ${task.description}`;
	const patch: UpdateTaskInput = {};
	const reasons: string[] = [];

	if (task.priority === 'medium') {
		const priority = inferPriority(text);
		if (priority && priority !== task.priority) {
			patch.priority = priority;
			reasons.push(`识别优先级：${priority}`);
		}
	}

	const metadata = inferKeywordMetadata(text);
	if (!task.group.trim() && metadata.group) {
		patch.group = metadata.group;
		reasons.push(`补充分组：${metadata.group}`);
	}
	const nextTags = task.tags.length === 0 ? addUniqueTags(task.tags, metadata.tags) : [...task.tags];
	if (task.tags.length === 0 && nextTags.length > 0) {
		patch.tags = nextTags;
		reasons.push(`补充标签：${metadata.tags.join('、')}`);
	}

	if (task.dueStart === undefined && task.dueDate === undefined) {
		const parsed = parseDateFromText(task.title, options.now);
		if (parsed.dueStart !== undefined) {
			patch.dueStart = parsed.allDay ? toDayStart(parsed.dueStart) : parsed.dueStart;
			patch.allDay = parsed.allDay ?? false;
			reasons.push('识别截止日期');
		}
	}

	if (!hasPatch(patch)) return null;
	return { taskId: task.id, title: task.title, patch, reasons };
};

export const buildSmartOrganizationPlan = (tasks: Task[], options: SmartOrganizationOptions = {}): SmartOrganizationPlan => {
	const changes: SmartOrganizationChange[] = [];
	let skipped = 0;
	for (const task of tasks) {
		const change = suggestTaskOrganization(task, options);
		if (change) {
			changes.push(change);
		} else {
			skipped += 1;
		}
	}
	return { changes, skipped };
};
