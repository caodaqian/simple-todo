// Pure logic for MCP tool handlers, parameterized by a dbStorage adapter.
// No `window`/`utools` access here — keeps it unit-testable.

// 统一存储键定义。与 src/services/storageKeys.ts 中的 STORAGE_KEYS 保持一致；
// toolHandlers.test.ts 断言四者字符串一致以防键名漂移。
const STORAGE_KEYS = {
	TASKS: 'jianyue.tasks',
	SETTINGS: 'jianyue.settings',
	TEMPLATES: 'jianyue.templates',
	UI_STATE: 'jianyue.uiState',
	POMODORO: 'jianyue.pomodoro',
	STICKY_NOTE: 'jianyue.stickyNote',
};

const STORAGE_KEY = STORAGE_KEYS.TASKS;

function readTasksFromDb(dbStorage) {
	try {
		const raw = dbStorage.getItem(STORAGE_KEY);
		if (typeof raw !== 'string') return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function writeTasksToDb(dbStorage, tasks) {
	try {
		dbStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
	} catch (e) {
		throw new Error('写入任务数据失败: ' + (e.message || String(e)));
	}
}

function generateId() {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 10);
	return timestamp + '-' + random;
}

function findTaskById(tasks, id) {
	return tasks.find(function (t) { return t.id === id }) || null;
}

function hasOwn(value, key) {
	return !!value && Object.prototype.hasOwnProperty.call(value, key);
}

function omitOptionalNulls(params, fieldNames) {
	const normalized = params && typeof params === 'object' && !Array.isArray(params)
		? Object.assign({}, params)
		: {};
	fieldNames.forEach(function (fieldName) {
		if (normalized[fieldName] === null) delete normalized[fieldName];
	});
	return normalized;
}

function isTaskPriority(value) {
	return value === 'low' || value === 'medium' || value === 'high' || value === 'urgent';
}

function isTaskStatus(value) {
	return value === 'todo' || value === 'doing' || value === 'done';
}

function getDirectChildren(tasks, parentTaskId) {
	return tasks.filter(function (t) { return t.parentTaskId === parentTaskId });
}

function assertValidParentTask(tasks, parentTaskId, selfTaskId) {
	if (parentTaskId === undefined || parentTaskId === null) return undefined;
	if (typeof parentTaskId !== 'string' || !parentTaskId.trim()) {
		throw new Error('parent_task_id 必须为非空字符串或 null');
	}
	if (selfTaskId && parentTaskId === selfTaskId) {
		throw new Error('任务不能设置自己为父任务');
	}
	const parent = findTaskById(tasks, parentTaskId);
	if (!parent) throw new Error('未找到父任务: ' + parentTaskId);
	if (selfTaskId) {
		let current = parent;
		const visited = {};
		while (current) {
			if (current.id === selfTaskId) throw new Error('任务层级不能形成循环');
			if (!current.parentTaskId || visited[current.id]) break;
			visited[current.id] = true;
			current = findTaskById(tasks, current.parentTaskId);
		}
	}
	return parentTaskId;
}

function getTaskStart(task) {
	return task.dueStart !== undefined ? task.dueStart : task.dueDate;
}

function getTaskEnd(task) {
	return task.dueEnd !== undefined ? task.dueEnd : getTaskStart(task);
}

// 单点截止时间：优先 dueEnd；回退 dueStart；再回退旧 dueDate。
// All consumers that need the “截止时间” should use this instead of getTaskStart.
function getTaskDeadline(task) {
	return task.dueEnd !== undefined
		? task.dueEnd
		: (task.dueStart !== undefined ? task.dueStart : task.dueDate);
}

// 将任意两个端点归一化为合法任务时间字段：
//   - 都为空：返回 {}（不写入字段）
//   - 仅一个有值（或两者相等）：作为单点截止，只返回 dueEnd
//   - 两个不同值：按时间升序返回 {dueStart: min, dueEnd: max}
// 调用方按字段是否存在再写入对象，避免 dueStart: undefined 这类副作用。
function normalizeDateRange(start, end) {
	if (start === undefined && end === undefined) return {};
	if (start === undefined) return { dueEnd: end };
	if (end === undefined) return { dueEnd: start };
	if (start === end) return { dueEnd: start };
	return start < end ? { dueStart: start, dueEnd: end } : { dueStart: end, dueEnd: start };
}

function toTaskListOutput(t, subtasks) {
	return {
		id: t.id,
		title: t.title,
		status: t.status,
		priority: t.priority,
		due_start: formatDate(getTaskStart(t)),
		due_end: formatDate(getTaskDeadline(t)),
		all_day: t.allDay === true,
		due_date: formatDate(getTaskDeadline(t)),
		tags: t.tags || [],
		group: t.group || '',
		description: t.description || '',
		parent_task_id: t.parentTaskId,
		subtasks: subtasks || [],
		archived: t.archivedAt !== undefined,
	};
}

function toChildOutput(t) {
	return {
		id: t.id,
		title: t.title,
		status: t.status,
		priority: t.priority,
		due_start: formatDate(getTaskStart(t)),
		due_end: formatDate(getTaskDeadline(t)),
		all_day: t.allDay === true,
	};
}

function formatDate(ts) {
	if (!ts) return undefined;
	return new Date(ts).toISOString();
}

function parseDate(iso) {
	if (!iso) return undefined;
	const ts = new Date(iso).getTime();
	return Number.isNaN(ts) ? undefined : ts;
}

function parseAllDayDate(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
	const parts = value.split('-').map(Number);
	const date = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
	return date.getFullYear() === parts[0] && date.getMonth() === parts[1] - 1 && date.getDate() === parts[2]
		? date.getTime() : undefined;
}

function parseTaskTime(value, allDay) {
	return allDay ? parseAllDayDate(value) : parseDate(value);
}

function applyTaskSchedule(task, params) {
	const hasStart = hasOwn(params, 'due_start');
	const hasEnd = hasOwn(params, 'due_end');
	const hasAllDay = hasOwn(params, 'all_day');
	const hasDate = hasOwn(params, 'due_date');
	const allDay = hasAllDay ? params.all_day === true : task.allDay === true;
	if (hasAllDay && typeof params.all_day !== 'boolean' && params.all_day !== null) {
		throw new Error('all_day 必须是布尔值或 null');
	}
	if (hasAllDay) {
		if (params.all_day === null) delete task.allDay;
		else task.allDay = params.all_day;
	}

	// 收集用户期望的新端点；null 视为清除对应字段
	let nextStart;
	let nextEnd;
	if (hasStart) {
		if (params.due_start === null) nextStart = undefined;
		else {
			const s = parseTaskTime(params.due_start, allDay);
			if (s === undefined) throw new Error('due_start 不是合法日期');
			nextStart = s;
		}
	} else {
		nextStart = task.dueStart;
	}
	if (hasEnd) {
		if (params.due_end === null) nextEnd = undefined;
		else {
			const e = parseTaskTime(params.due_end, allDay);
			if (e === undefined) throw new Error('due_end 不是合法日期');
			nextEnd = e;
		}
	} else if (hasDate) {
		// 旧 due_date 解释为单点截止时间，归并到 dueEnd；解析失败按“清除”处理（保留旧行为）
		if (params.due_date === null) {
			nextEnd = undefined;
		} else {
			const e = parseDate(params.due_date);
			nextEnd = e; // undefined 时即清除
		}
	} else {
		nextEnd = task.dueEnd !== undefined ? task.dueEnd : task.dueDate;
	}

	// 清空旧字段后归一化重写，使倒序自动升序、单点只保留 dueEnd、清除时整体清空
	delete task.dueStart;
	delete task.dueEnd;
	delete task.dueDate;
	const range = normalizeDateRange(nextStart, nextEnd);
	if (range.dueStart !== undefined) task.dueStart = range.dueStart;
	if (range.dueEnd !== undefined) task.dueEnd = range.dueEnd;

	if (hasStart || hasEnd || hasAllDay || hasDate) {
		delete task.remindedAt;
	}
}

function createTaskHandler(dbStorage, params) {
	params = omitOptionalNulls(params, [
		'priority', 'parent_task_id', 'due_start', 'due_end', 'due_date', 'all_day',
		'tags', 'group', 'description', 'reminder_offset', 'repeat',
	]);
	const title = params && params.title;
	if (!title || typeof title !== 'string' || !title.trim()) {
		throw new Error('任务标题不能为空');
	}

	const now = Date.now();
	const allDay = params.all_day === true;
	if (params.all_day !== undefined && typeof params.all_day !== 'boolean') throw new Error('all_day 必须是布尔值');
	// 单点截止优先 due_end；旧 due_date 兼容并解释为单点截止；与 due_start 同时存在时自动按升序归一化
	const parsedStart = params.due_start !== undefined ? parseTaskTime(params.due_start, allDay) : undefined;
	const parsedEnd = params.due_end !== undefined ? parseTaskTime(params.due_end, allDay) : parseDate(params.due_date);
	if (params.due_start !== undefined && parsedStart === undefined) throw new Error('due_start 不是合法日期');
	if (params.due_end !== undefined && parsedEnd === undefined) throw new Error('due_end 不是合法日期');
	const range = normalizeDateRange(parsedStart, parsedEnd);
	const dueStart = range.dueStart;
	const dueEnd = range.dueEnd;
	const reminderOffset = normalizeReminderOffset(params.reminder_offset);
	if (reminderOffset !== undefined && dueStart === undefined && dueEnd === undefined) {
		throw new Error('设置提醒需要先有截止日期');
	}
	const repeat = normalizeRepeatRule(params.repeat);
	const tasks = readTasksFromDb(dbStorage);
	const parentTaskId = assertValidParentTask(tasks, params.parent_task_id);
	const task = {
		id: generateId(),
		title: title.trim(),
		status: 'todo',
		priority: isTaskPriority(params.priority) ? params.priority : 'medium',
		tags: Array.isArray(params.tags) ? params.tags : [],
		group: typeof params.group === 'string' ? params.group.trim() : '',
		description: typeof params.description === 'string' ? params.description : '',
		subtasks: [],
		visible: true,
		createdAt: now,
		updatedAt: now,
	};

	if (dueStart !== undefined) task.dueStart = dueStart;
	if (dueEnd !== undefined) task.dueEnd = dueEnd;
	if (params.all_day === true) task.allDay = true;
	if (parentTaskId !== undefined) task.parentTaskId = parentTaskId;
	if (reminderOffset !== undefined) task.reminderOffset = reminderOffset;
	if (repeat !== undefined) task.repeat = repeat;

	tasks.push(task);
	writeTasksToDb(dbStorage, tasks);

	return { id: task.id, title: task.title, status: task.status, parent_task_id: task.parentTaskId };
}

function listTasksHandler(dbStorage, params) {
	let tasks = readTasksFromDb(dbStorage).filter(function (task) { return task.archivedAt === undefined; });
	const p = params || {};

	if (p.status) {
		tasks = tasks.filter(function (t) { return t.status === p.status });
	}
	if (p.priority) {
		tasks = tasks.filter(function (t) { return t.priority === p.priority });
	}
	if (p.tag) {
		tasks = tasks.filter(function (t) { return Array.isArray(t.tags) && t.tags.indexOf(p.tag) !== -1 });
	}
	if (p.keyword) {
		const kw = String(p.keyword).toLowerCase();
		tasks = tasks.filter(function (t) {
			const title = String(t.title || '').toLowerCase();
			const desc = String(t.description || '').toLowerCase();
			return title.indexOf(kw) !== -1 || desc.indexOf(kw) !== -1;
		});
	}

	const limit = typeof p.limit === 'number' && p.limit > 0 ? p.limit : 20;
	const sliced = tasks.slice(0, limit);

	const result = sliced.map(toTaskListOutput);

	return { tasks: result, total: tasks.length };
}

function completeTaskHandler(dbStorage, params) {
	const taskId = params && params.task_id;
	if (!taskId) {
		throw new Error('task_id 不能为空');
	}

	const tasks = readTasksFromDb(dbStorage);
	const task = findTaskById(tasks, taskId);
	if (!task) {
		throw new Error('未找到任务: ' + taskId);
	}

	const now = Date.now();
	const previousStatus = task.status;
	task.status = 'done';
	task.updatedAt = now;
	if (previousStatus !== 'done') task.completedAt = now;

	// 重复任务：标记完成后自动生成下一实例（参照 src/services/repeatService 口径）
	if (task.repeat && shouldSpawnNextPure(task)) {
		const next = buildNextInstancePure(task);
		// 更新原任务 generatedCount
		task.repeat = next.repeat;
		tasks.push(next);
	}

	writeTasksToDb(dbStorage, tasks);

	return { id: task.id, title: task.title, status: task.status };
}

function updateTaskHandler(dbStorage, params) {
	params = omitOptionalNulls(params, ['title', 'status', 'priority', 'tags', 'group', 'description', 'due_date']);
	const taskId = params && params.task_id;
	if (!taskId) {
		throw new Error('task_id 不能为空');
	}

	const tasks = readTasksFromDb(dbStorage);
	const task = findTaskById(tasks, taskId);
	if (!task) {
		throw new Error('未找到任务: ' + taskId);
	}

	const previousStatus = task.status;
	if (params.title !== undefined) {
		if (typeof params.title !== 'string' || !params.title.trim()) throw new Error('任务标题不能为空');
		task.title = params.title.trim();
	}
	if (params.status !== undefined) {
		if (!isTaskStatus(params.status)) throw new Error('任务状态无效');
		task.status = params.status;
	}
	if (params.priority !== undefined) {
		if (!isTaskPriority(params.priority)) throw new Error('任务优先级无效');
		task.priority = params.priority;
	}
	if (params.tags !== undefined) {
		if (!Array.isArray(params.tags) || params.tags.some(function (tag) { return typeof tag !== 'string' })) {
			throw new Error('tags 必须为字符串数组');
		}
		task.tags = params.tags.slice();
	}
	if (params.group !== undefined) {
		if (typeof params.group !== 'string') throw new Error('group 必须是字符串');
		task.group = params.group.trim();
	}
	if (params.description !== undefined) task.description = params.description;
	if (hasOwn(params, 'parent_task_id')) {
		const parentTaskId = assertValidParentTask(tasks, params.parent_task_id, task.id);
		if (parentTaskId === undefined) delete task.parentTaskId;
		else task.parentTaskId = parentTaskId;
	}
	applyTaskSchedule(task, params);
	if (hasOwn(params, 'reminder_offset')) {
		const offset = normalizeReminderOffset(params.reminder_offset);
		if (offset !== undefined && getTaskDeadline(task) === undefined) {
			throw new Error('设置提醒需要先有截止日期');
		}
		if (offset === undefined) {
			delete task.reminderOffset;
		} else {
			task.reminderOffset = offset;
		}
		// 提醒设置变更后重置 remindedAt
		delete task.remindedAt;
	}
	if (hasOwn(params, 'repeat')) {
		const rule = normalizeRepeatRule(params.repeat);
		if (rule === undefined) {
			delete task.repeat;
		} else {
			task.repeat = rule;
		}
	}
	if (hasOwn(params, 'archived')) {
		if (params.archived === true) task.archivedAt = Date.now();
		else if (params.archived === false || params.archived === null) delete task.archivedAt;
		else throw new Error('archived 必须是布尔值或 null');
	}

	const now = Date.now();
	task.updatedAt = now;
	if (previousStatus !== 'done' && task.status === 'done') task.completedAt = now;
	if (previousStatus === 'done' && task.status !== 'done') delete task.completedAt;
	if (previousStatus !== 'done' && task.status === 'done' && task.repeat && shouldSpawnNextPure(task)) {
		const next = buildNextInstancePure(task);
		task.repeat = next.repeat;
		tasks.push(next);
	}
	writeTasksToDb(dbStorage, tasks);

	return { id: task.id, title: task.title, status: task.status, parent_task_id: task.parentTaskId };
}

function deleteTaskHandler(dbStorage, params) {
	const taskId = params && params.task_id;
	if (!taskId) {
		throw new Error('task_id 不能为空');
	}

	const tasks = readTasksFromDb(dbStorage);
	const index = tasks.findIndex(function (t) { return t.id === taskId });
	if (index === -1) {
		throw new Error('未找到任务: ' + taskId);
	}

	const next = tasks.filter(function (t) { return t.id !== taskId && t.parentTaskId !== taskId });
	writeTasksToDb(dbStorage, next);

	return { deleted: true };
}

// ── Subtask handlers ──────────────────────────────────────────────────

function addSubtaskHandler(dbStorage, params) {
	const taskId = params && params.task_id;
	if (!taskId) throw new Error('task_id 不能为空');
	const title = params && typeof params.title === 'string' ? params.title.trim() : '';
	if (!title) throw new Error('子任务标题不能为空');

	const tasks = readTasksFromDb(dbStorage);
	const task = findTaskById(tasks, taskId);
	if (!task) throw new Error('未找到任务: ' + taskId);

	const now = Date.now();
	const subtask = {
		id: generateId(),
		title: title,
		status: 'todo',
		priority: task.priority || 'medium',
		tags: Array.isArray(task.tags) ? task.tags.slice() : [],
		group: typeof task.group === 'string' ? task.group : '',
		description: '',
		subtasks: [],
		parentTaskId: task.id,
		visible: true,
		createdAt: now,
		updatedAt: now,
	};
	tasks.push(subtask);
	task.updatedAt = now;
	writeTasksToDb(dbStorage, tasks);

	return { task_id: task.id, subtask_id: subtask.id, title: subtask.title, completed: false, status: subtask.status, priority: subtask.priority, parent_task_id: task.id };
}

function updateSubtaskHandler(dbStorage, params) {
	const taskId = params && params.task_id;
	const subtaskId = params && params.subtask_id;
	if (!taskId) throw new Error('task_id 不能为空');
	if (!subtaskId) throw new Error('subtask_id 不能为空');

	const hasCompleted = params && Object.prototype.hasOwnProperty.call(params, 'completed');
	const hasTitle = params && Object.prototype.hasOwnProperty.call(params, 'title');
	const hasStatus = hasOwn(params, 'status');
	const hasPriority = hasOwn(params, 'priority');
	const hasDueDate = hasOwn(params, 'due_date');
	const hasTags = hasOwn(params, 'tags');
	const hasGroup = hasOwn(params, 'group');
	const hasDescription = hasOwn(params, 'description');
	if (!hasCompleted && !hasTitle && !hasStatus && !hasPriority && !hasDueDate && !hasTags && !hasGroup && !hasDescription) {
		throw new Error('至少需要提供 completed、title、status、priority、due_date、tags、group 或 description 之一');
	}
	if (hasTitle && (typeof params.title !== 'string' || !params.title.trim())) {
		throw new Error('子任务标题不能为空');
	}
	if (hasStatus && !isTaskStatus(params.status)) throw new Error('status 必须是 todo/doing/done 之一');
	if (hasPriority && !isTaskPriority(params.priority)) throw new Error('priority 必须是 low/medium/high/urgent 之一');

	const tasks = readTasksFromDb(dbStorage);
	const task = findTaskById(tasks, taskId);
	if (!task) throw new Error('未找到任务: ' + taskId);
	const subtask = tasks.find(function (t) { return t.id === subtaskId && t.parentTaskId === taskId }) || null;
	if (!subtask) throw new Error('未找到子任务: ' + subtaskId);

	const previousStatus = subtask.status;
	if (hasCompleted) subtask.status = Boolean(params.completed) ? 'done' : 'todo';
	if (hasStatus) subtask.status = params.status;
	if (hasTitle) subtask.title = params.title.trim();
	if (hasPriority) subtask.priority = params.priority;
	if (hasDueDate) {
		const parsed = parseDate(params.due_date);
		if (parsed !== undefined) subtask.dueDate = parsed;
		else delete subtask.dueDate;
	}
	if (hasTags) subtask.tags = Array.isArray(params.tags) ? params.tags : [];
	if (hasGroup) subtask.group = typeof params.group === 'string' ? params.group.trim() : '';
	if (hasDescription) subtask.description = typeof params.description === 'string' ? params.description : '';
	const now = Date.now();
	subtask.updatedAt = now;
	if (previousStatus !== 'done' && subtask.status === 'done') subtask.completedAt = now;
	if (previousStatus === 'done' && subtask.status !== 'done') delete subtask.completedAt;
	task.updatedAt = subtask.updatedAt;
	writeTasksToDb(dbStorage, tasks);

	return { task_id: task.id, subtask_id: subtask.id, completed: subtask.status === 'done', status: subtask.status, priority: subtask.priority, title: subtask.title, parent_task_id: task.id };
}

function deleteSubtaskHandler(dbStorage, params) {
	const taskId = params && params.task_id;
	const subtaskId = params && params.subtask_id;
	if (!taskId) throw new Error('task_id 不能为空');
	if (!subtaskId) throw new Error('subtask_id 不能为空');

	const tasks = readTasksFromDb(dbStorage);
	const task = findTaskById(tasks, taskId);
	if (!task) throw new Error('未找到任务: ' + taskId);
	const before = tasks.length;
	const next = tasks.filter(function (t) { return !(t.id === subtaskId && t.parentTaskId === taskId) });
	if (next.length === before) throw new Error('未找到子任务: ' + subtaskId);
	task.updatedAt = Date.now();
	writeTasksToDb(dbStorage, next);

	return { deleted: true };
}

// ── Search handler (extended filter + sort + paginate) ────────────────

function asArray(value) {
	if (Array.isArray(value)) return value;
	if (value === undefined || value === null) return [];
	return [value];
}

function searchTasksHandler(dbStorage, params) {
	const p = omitOptionalNulls(params, [
		'keyword', 'status', 'priority', 'tags', 'tag_match_mode', 'group', 'parent_task_id',
		'root_only', 'archived', 'due_after', 'due_before', 'include_no_due', 'show_completed',
		'sort_by', 'sort_order', 'limit', 'offset',
	]);
	const allTasks = readTasksFromDb(dbStorage);
	let tasks = allTasks;
	if (p.archived === true) tasks = tasks.filter(function (t) { return t.archivedAt !== undefined; });
	else tasks = tasks.filter(function (t) { return t.archivedAt === undefined; });
	if (typeof p.parent_task_id === 'string') tasks = tasks.filter(function (t) { return t.parentTaskId === p.parent_task_id; });
	if (p.root_only === true) tasks = tasks.filter(function (t) { return !t.parentTaskId; });

	const statusFilter = asArray(p.status);
	if (statusFilter.length) {
		tasks = tasks.filter(function (t) { return statusFilter.indexOf(t.status) !== -1 });
	}
	const priorityFilter = asArray(p.priority);
	if (priorityFilter.length) {
		tasks = tasks.filter(function (t) { return priorityFilter.indexOf(t.priority) !== -1 });
	}
	if (p.show_completed === false) {
		tasks = tasks.filter(function (t) { return t.status !== 'done' });
	}
	if (p.group) {
		tasks = tasks.filter(function (t) { return t.group === p.group });
	}
	const tagFilter = asArray(p.tags);
	if (tagFilter.length) {
		const mode = p.tag_match_mode === 'all' ? 'all' : 'any';
		tasks = tasks.filter(function (t) {
			const tags = t.tags || [];
			if (mode === 'all') {
				return tagFilter.every(function (tag) { return tags.indexOf(tag) !== -1 });
			}
			return tagFilter.some(function (tag) { return tags.indexOf(tag) !== -1 });
		});
	}
	if (p.keyword) {
		const kw = String(p.keyword).toLowerCase();
		tasks = tasks.filter(function (t) {
			return String(t.title || '').toLowerCase().indexOf(kw) !== -1
				|| String(t.description || '').toLowerCase().indexOf(kw) !== -1;
		});
	}
	const dueAfter = parseDate(p.due_after);
	const dueBefore = parseDate(p.due_before);
	const hasDateFilter = dueAfter !== undefined || dueBefore !== undefined;
	if (hasDateFilter) {
		const includeNoDue = p.include_no_due === true;
		tasks = tasks.filter(function (t) {
			const deadline = getTaskDeadline(t);
			const start = getTaskStart(t) !== undefined ? getTaskStart(t) : deadline;
			const end = getTaskEnd(t) !== undefined ? getTaskEnd(t) : deadline;
			if (start === undefined) return includeNoDue;
			if (dueAfter !== undefined && (end === undefined || end < dueAfter)) return false;
			if (dueBefore !== undefined && start > dueBefore) return false;
			return true;
		});
	}

	const sortBy = p.sort_by === 'priority' || p.sort_by === 'dueDate' || p.sort_by === 'createdAt' || p.sort_by === 'updatedAt'
		? p.sort_by : 'createdAt';
	const order = p.sort_order === 'asc' ? 'asc' : 'desc';
	const priorityRank = { urgent: 4, high: 3, medium: 2, low: 1 };
	tasks = tasks.slice().sort(function (a, b) {
		let av = a[sortBy];
		let bv = b[sortBy];
		if (sortBy === 'priority') {
			av = priorityRank[a.priority] || 0;
			bv = priorityRank[b.priority] || 0;
		} else if (sortBy === 'dueDate') {
			av = getTaskDeadline(a) === undefined ? Infinity : getTaskDeadline(a);
			bv = getTaskDeadline(b) === undefined ? Infinity : getTaskDeadline(b);
		}
		if (av === bv) return 0;
		return order === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
	});

	const total = tasks.length;
	const limit = typeof p.limit === 'number' && p.limit > 0 ? p.limit : 50;
	const offset = typeof p.offset === 'number' && p.offset >= 0 ? p.offset : 0;
	const sliced = tasks.slice(offset, offset + limit);

	const childTasksByParentId = {};
	allTasks.forEach(function (task) {
		if (task.archivedAt === undefined && p.archived === true) return;
		if (task.archivedAt !== undefined && p.archived !== true) return;
		if (!task.parentTaskId) return;
		if (!childTasksByParentId[task.parentTaskId]) childTasksByParentId[task.parentTaskId] = [];
		childTasksByParentId[task.parentTaskId].push(toChildOutput(task));
	});

	const result = sliced.map(function (task) {
		return toTaskListOutput(task, childTasksByParentId[task.id] || []);
	});

	return { tasks: result, total: total, limit: limit, offset: offset };
}

// ── Overview handler ──────────────────────────────────────────────────

function startOfToday(now) {
	const d = new Date(now);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

function taskOverviewHandler(dbStorage, params) {
	const p = omitOptionalNulls(params, ['group']);
	let tasks = readTasksFromDb(dbStorage).filter(function (task) { return task.archivedAt === undefined; });
	if (p.group) {
		tasks = tasks.filter(function (t) { return t.group === p.group });
	}
	const now = Date.now();
	const todayStart = startOfToday(now);
	const todayEnd = todayStart + 24 * 60 * 60 * 1000 - 1;

	const byStatus = { todo: 0, doing: 0, done: 0 };
	const byPriority = { low: 0, medium: 0, high: 0, urgent: 0 };
	let overdue = 0;
	let dueToday = 0;
	let noDueDate = 0;

	tasks.forEach(function (t) {
		if (byStatus[t.status] !== undefined) byStatus[t.status]++;
		if (byPriority[t.priority] !== undefined) byPriority[t.priority]++;
		const deadline = getTaskDeadline(t);
		if (deadline === undefined) {
			noDueDate++;
		} else {
			if (deadline >= todayStart && deadline <= todayEnd) dueToday++;
			if (deadline < todayStart && t.status !== 'done') overdue++;
		}
	});

	return {
		total: tasks.length,
		byStatus: byStatus,
		byPriority: byPriority,
		overdue: overdue,
		dueToday: dueToday,
		noDueDate: noDueDate,
		tags: countValues(tasks.reduce(function (all, task) { return all.concat(task.tags || []); }, [])),
		groups: countValues(tasks.map(function (task) { return task.group || ''; })),
	};
}

// ── Tags & groups enumeration ─────────────────────────────────────────

function listTagsHandler(dbStorage) {
	const tasks = readTasksFromDb(dbStorage);
	const counts = {};
	tasks.forEach(function (t) {
		(t.tags || []).forEach(function (tag) {
			if (typeof tag !== 'string' || !tag) return;
			counts[tag] = (counts[tag] || 0) + 1;
		});
	});
	const tags = Object.keys(counts).map(function (name) {
		return { name: name, count: counts[name] };
	}).sort(function (a, b) {
		return b.count - a.count || a.name.localeCompare(b.name);
	});
	return { tags: tags };
}

function listGroupsHandler(dbStorage) {
	const tasks = readTasksFromDb(dbStorage);
	const counts = {};
	tasks.forEach(function (t) {
		const g = t.group;
		if (typeof g !== 'string' || !g) return;
		counts[g] = (counts[g] || 0) + 1;
	});
	const groups = Object.keys(counts).map(function (name) {
		return { name: name, count: counts[name] };
	}).sort(function (a, b) {
		return b.count - a.count || a.name.localeCompare(b.name);
	});
	return { groups: groups };
}

// ── Export / import (dependency-injected for testability) ─────────────

function exportTasksHandler(params, deps) {
	const tasks = deps.readTasks();
	const fileName = (params && typeof params.file_name === 'string' && params.file_name.trim())
		? params.file_name.trim()
		: 'jianyue-tasks-' + Date.now() + '.json';
	const filePath = deps.path.join(deps.downloadsDir, fileName);
	deps.fs.writeFileSync(filePath, JSON.stringify(tasks, null, 2), { encoding: 'utf-8' });
	return { filePath: filePath, count: tasks.length };
}

function importTasksHandler(params, deps) {
	const filePath = params && params.file_path;
	if (!filePath || typeof filePath !== 'string') throw new Error('file_path 不能为空');

	let raw;
	try {
		raw = deps.fs.readFileSync(filePath, { encoding: 'utf-8' });
	} catch (e) {
		throw new Error('读取文件失败: ' + (e && e.message ? e.message : String(e)));
	}

	let imported;
	try {
		imported = JSON.parse(raw);
	} catch (e) {
		throw new Error('文件内容不是合法 JSON');
	}
	if (!Array.isArray(imported)) throw new Error('导入文件格式错误：期望 JSON 数组');

	const existing = deps.readTasks();
	const existingIds = {};
	existing.forEach(function (t) { existingIds[t.id] = true });
	let added = 0;
	let invalid = 0;
	const merged = existing.slice();
	for (const item of imported) {
		if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) {
			invalid++;
			continue;
		}
		if (existingIds[item.id]) continue;
		merged.push(item);
		existingIds[item.id] = true;
		added++;
	}
	if (added > 0) deps.saveTasks(merged);
	return { added: added, total: merged.length, invalid: invalid };
}

// ── Single task detail ────────────────────────────────────────────────

function getTaskHandler(dbStorage, params) {
	const taskId = params && params.task_id;
	if (!taskId) throw new Error('task_id 不能为空');
	const tasks = readTasksFromDb(dbStorage);
	const task = findTaskById(tasks, taskId);
	if (!task) throw new Error('未找到任务: ' + taskId);
	return {
		id: task.id,
		parent_task_id: task.parentTaskId,
		title: task.title,
		status: task.status,
		priority: task.priority,
		due_start: formatDate(getTaskStart(task)),
		due_end: formatDate(getTaskDeadline(task)),
		all_day: task.allDay === true,
		due_date: formatDate(getTaskDeadline(task)),
		tags: task.tags || [],
		group: task.group || '',
		description: task.description || '',
		children: getDirectChildren(tasks, task.id).map(toChildOutput),
		archived: task.archivedAt !== undefined,
		reminder_offset: task.reminderOffset,
		repeat: task.repeat,
		created_at: formatDate(task.createdAt),
		updated_at: formatDate(task.updatedAt),
	};
}

// ── Settings read ─────────────────────────────────────────────────────

const SETTINGS_STORAGE_KEY = STORAGE_KEYS.SETTINGS;
const SETTINGS_DEFAULTS = {
	appearanceMode: 'system',
	accentColor: 'mauve',
	showCompleted: false,
	defaultView: 'list',
	notifyEnabled: true,
	pomodoroMinutes: 40,
};

function normalizePomodoroMinutesSetting(value) {
	if (typeof value !== 'number' || !Number.isFinite(value)) return SETTINGS_DEFAULTS.pomodoroMinutes;
	const minutes = Math.trunc(value);
	return minutes >= 1 && minutes <= 240 ? minutes : SETTINGS_DEFAULTS.pomodoroMinutes;
}

function getSettingsHandler(settingsDb) {
	let parsed;
	try {
		const raw = settingsDb.getItem(SETTINGS_STORAGE_KEY);
		parsed = typeof raw === 'string' ? JSON.parse(raw) : null;
	} catch {
		parsed = null;
	}
	if (!parsed || typeof parsed !== 'object') {
		return Object.assign({}, SETTINGS_DEFAULTS);
	}
	return {
		appearanceMode: parsed.appearanceMode === 'light' || parsed.appearanceMode === 'dark' || parsed.appearanceMode === 'system'
			? parsed.appearanceMode : SETTINGS_DEFAULTS.appearanceMode,
		accentColor: typeof parsed.accentColor === 'string' ? parsed.accentColor : SETTINGS_DEFAULTS.accentColor,
		showCompleted: typeof parsed.showCompleted === 'boolean' ? parsed.showCompleted : SETTINGS_DEFAULTS.showCompleted,
		defaultView: parsed.defaultView === 'list' || parsed.defaultView === 'kanban' || parsed.defaultView === 'eisenhower' || parsed.defaultView === 'calendar'
			? parsed.defaultView : SETTINGS_DEFAULTS.defaultView,
		notifyEnabled: typeof parsed.notifyEnabled === 'boolean' ? parsed.notifyEnabled : SETTINGS_DEFAULTS.notifyEnabled,
		pomodoroMinutes: normalizePomodoroMinutesSetting(parsed.pomodoroMinutes),
	};
}

// ── Markdown render (injected marked) ─────────────────────────────────

function renderMarkdownHandler(params, deps) {
	const markdown = params && params.markdown;
	if (typeof markdown !== 'string') throw new Error('markdown 不能为空');
	if (!deps || typeof deps.render !== 'function') throw new Error('marked 渲染器未注入');
	const html = deps.render(markdown);
	return { html: html };
}

// ── Bulk update ───────────────────────────────────────────────────────

const BULK_UPDATE_MAX = 100;

function bulkUpdateHandler(dbStorage, params) {
	const p = omitOptionalNulls(params, ['status', 'priority', 'group', 'archived']);
	const ids = Array.isArray(p.task_ids) ? p.task_ids : [];
	if (ids.length === 0) throw new Error('task_ids 不能为空');
	if (ids.length > BULK_UPDATE_MAX) {
		throw new Error('单次最多更新 ' + BULK_UPDATE_MAX + ' 个任务');
	}
	const hasUpdate = p.status !== undefined || p.priority !== undefined || p.group !== undefined || p.archived !== undefined;
	if (!hasUpdate) throw new Error('至少需要提供 status、priority、group 或 archived 之一');
	if (p.status !== undefined && !isTaskStatus(p.status)) throw new Error('任务状态无效');
	if (p.priority !== undefined && !isTaskPriority(p.priority)) throw new Error('任务优先级无效');
	if (p.group !== undefined && typeof p.group !== 'string') throw new Error('group 必须是字符串');
	if (p.archived !== undefined && typeof p.archived !== 'boolean') throw new Error('archived 必须是布尔值');

	const tasks = readTasksFromDb(dbStorage);
	const byId = {};
	tasks.forEach(function (t) { byId[t.id] = t });
	const notFound = [];
	let updated = 0;
	const now = Date.now();
	ids.forEach(function (id) {
		const task = byId[id];
		if (!task) {
			notFound.push(id);
			return;
		}
		const previousStatus = task.status;
		if (p.status !== undefined) task.status = p.status;
		if (p.priority !== undefined) task.priority = p.priority;
		if (p.group !== undefined) task.group = p.group;
		if (p.archived === true) task.archivedAt = now;
		if (p.archived === false) delete task.archivedAt;
		task.updatedAt = now;
		if (previousStatus !== 'done' && task.status === 'done') task.completedAt = now;
		if (previousStatus === 'done' && task.status !== 'done') delete task.completedAt;
		if (previousStatus !== 'done' && task.status === 'done' && task.repeat && shouldSpawnNextPure(task)) {
			const next = buildNextInstancePure(task, now);
			task.repeat = next.repeat;
			tasks.push(next);
		}
		updated++;
	});
	if (updated > 0) writeTasksToDb(dbStorage, tasks);
	return { updated: updated, not_found: notFound };
}

// ── Notify (injected showNotification, respects settings) ─────────────

function notifyHandler(params, deps) {
	const title = params && params.title;
	if (!title || typeof title !== 'string' || !title.trim()) throw new Error('title 不能为空');
	if (!deps || typeof deps.showNotification !== 'function') throw new Error('showNotification 未注入');
	if (!deps.settingsDb) throw new Error('settingsDb 未注入');

	const settings = getSettingsHandler(deps.settingsDb);
	if (!settings.notifyEnabled) {
		return { notified: false, reason: '通知已关闭' };
	}
	const body = params && typeof params.body === 'string' ? params.body : '';
	deps.showNotification(body ? title.trim() + '：' + body : title.trim(), 'todo');
	return { notified: true };
}

// ── Reminder / repeat / template helpers ──────────────────────────────

const TEMPLATES_STORAGE_KEY = STORAGE_KEYS.TEMPLATES;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const MS_PER_MINUTE = 60 * 1000;

function normalizeReminderOffset(value) {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new Error('reminder_offset 必须为非负数');
	}
	return value;
}

function normalizeRepeatRule(value) {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'object') throw new Error('repeat 必须为对象');
	const type = value.type;
	if (type !== 'daily' && type !== 'weekly' && type !== 'monthly' && type !== 'custom') {
		throw new Error('repeat.type 必须是 daily/weekly/monthly/custom 之一');
	}
	const interval = value.interval;
	if (typeof interval !== 'number' || !Number.isFinite(interval) || interval <= 0) {
		throw new Error('repeat.interval 必须为正数');
	}
	const rule = { type: type, interval: interval };
	if (value.repeat_until !== undefined && value.repeat_until !== null) {
		const until = parseDate(value.repeat_until);
		if (until === undefined) throw new Error('repeat.repeat_until 不是合法日期');
		rule.repeatUntil = until;
	}
	if (value.repeat_count !== undefined && value.repeat_count !== null) {
		if (typeof value.repeat_count !== 'number' || !Number.isFinite(value.repeat_count) || value.repeat_count < 0) {
			throw new Error('repeat.repeat_count 必须为非负数');
		}
		rule.repeatCount = value.repeat_count;
	}
	if (value.generated_count !== undefined && typeof value.generated_count === 'number') {
		rule.generatedCount = value.generated_count;
	}
	return rule;
}

function computeNextDueDate(task, now) {
	const rule = task.repeat;
	if (!rule) throw new Error('任务无重复规则');
	const base = getTaskDeadline(task) !== undefined ? getTaskDeadline(task) : (now || Date.now());
	switch (rule.type) {
		case 'daily':
		case 'custom':
			return base + rule.interval * MS_PER_DAY;
		case 'weekly':
			return base + rule.interval * MS_PER_WEEK;
		case 'monthly': {
			const d = new Date(base);
			d.setMonth(d.getMonth() + rule.interval);
			return d.getTime();
		}
		default:
			return base + rule.interval * MS_PER_DAY;
	}
}

function shouldSpawnNextPure(task, now) {
	const rule = task.repeat;
	if (!rule) return false;
	if (task.status !== 'done') return false;
	const next = computeNextDueDate(task, now);
	if (rule.repeatUntil !== undefined && next > rule.repeatUntil) return false;
	const generated = rule.generatedCount || 0;
	if (rule.repeatCount !== undefined && generated >= rule.repeatCount) return false;
	return true;
}

function buildNextInstancePure(task, now) {
	const rule = task.repeat;
	if (!rule) throw new Error('任务无重复规则');
	const ts = now || Date.now();
	const nextDue = computeNextDueDate(task, ts);
	const nextRepeat = {
		type: rule.type,
		interval: rule.interval,
		generatedCount: (rule.generatedCount || 0) + 1,
	};
	if (rule.repeatUntil !== undefined) nextRepeat.repeatUntil = rule.repeatUntil;
	if (rule.repeatCount !== undefined) nextRepeat.repeatCount = rule.repeatCount;
	const next = {
		id: generateId(),
		title: task.title,
		status: 'todo',
		priority: task.priority,
		tags: (task.tags || []).slice(),
		group: task.group || '',
		description: task.description || '',
		subtasks: (task.subtasks || []).map(function (s) {
			return {
				id: generateId(),
				title: s.title,
				completed: false,
				createdAt: ts,
				updatedAt: ts,
			};
		}),
		createdAt: ts,
		updatedAt: ts,
		repeat: nextRepeat,
	};
	if (task.parentTaskId !== undefined) next.parentTaskId = task.parentTaskId;
	if (task.allDay !== undefined) next.allDay = task.allDay;
	// 时间区间：保持相对跨度；单点：只写 dueEnd。旧 dueDate 被吸收到 dueEnd，不再写 dueDate 字段。
	const baseStart = task.dueStart;
	const baseDeadline = getTaskDeadline(task) !== undefined ? getTaskDeadline(task) : ts;
	if (baseStart !== undefined) {
		const offset = baseDeadline - baseStart;
		next.dueStart = nextDue - offset;
		next.dueEnd = nextDue;
	} else {
		next.dueEnd = nextDue;
	}
	if (task.reminderOffset !== undefined) next.reminderOffset = task.reminderOffset;
	return next;
}

// ── Template handlers (independent storage, dep-injected) ─────────────

function readTemplatesFromDb(dbStorage) {
	try {
		const raw = dbStorage.getItem(TEMPLATES_STORAGE_KEY);
		if (typeof raw !== 'string') return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function writeTemplatesToDb(dbStorage, templates) {
	try {
		dbStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
	} catch (e) {
		throw new Error('写入模板数据失败: ' + (e.message || String(e)));
	}
}

function generateTemplateId() {
	return 'tpl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function normalizeTemplateChildTasks(value, defaults) {
	if (!Array.isArray(value)) return null;
	return value.map(function (child) {
		if (!child || typeof child !== 'object' || Array.isArray(child) || typeof child.title !== 'string' || !child.title.trim()) {
			throw new Error('child_tasks 必须是包含非空 title 的对象数组');
		}
		if (child.priority !== undefined && !isTaskPriority(child.priority)) throw new Error('child_tasks.priority 无效');
		if (child.tags !== undefined && (!Array.isArray(child.tags) || child.tags.some(function (tag) { return typeof tag !== 'string'; }))) {
			throw new Error('child_tasks.tags 必须为字符串数组');
		}
		if (child.group !== undefined && typeof child.group !== 'string') throw new Error('child_tasks.group 必须为字符串');
		if (child.description !== undefined && typeof child.description !== 'string') throw new Error('child_tasks.description 必须为字符串');
		return {
			title: child.title.trim(),
			priority: child.priority === undefined ? defaults.priority : child.priority,
			tags: child.tags === undefined ? defaults.tags.slice() : child.tags.slice(),
			group: child.group === undefined ? defaults.group : child.group.trim(),
			description: child.description === undefined ? '' : child.description,
		};
	});
}

function toTemplateOutput(tpl) {
	return {
		id: tpl.id,
		name: tpl.name,
		title: tpl.title,
		priority: tpl.priority,
		tags: tpl.tags || [],
		group: tpl.group || '',
		description: tpl.description || '',
		children: Array.isArray(tpl.children) ? tpl.children : (tpl.subtasks || []).map(function (subtask) { return subtask.title; }),
		child_tasks: Array.isArray(tpl.childTasks) ? tpl.childTasks : (Array.isArray(tpl.children) ? tpl.children.map(function (title) {
			return { title: title, priority: tpl.priority || 'medium', tags: (tpl.tags || []).slice(), group: tpl.group || '', description: '' };
		}) : []),
		reminder_offset: tpl.reminderOffset,
		created_at: formatDate(tpl.createdAt),
		updated_at: formatDate(tpl.updatedAt),
	};
}

function createTemplateHandler(dbStorage, params) {
	params = omitOptionalNulls(params, [
		'priority', 'tags', 'group', 'description', 'children', 'child_tasks', 'reminder_offset', 'repeat',
	]);
	const name = params && typeof params.name === 'string' ? params.name.trim() : '';
	if (!name) throw new Error('模板名称不能为空');
	const title = params && typeof params.title === 'string' ? params.title.trim() : '';
	if (!title) throw new Error('模板标题不能为空');
	const priority = params && isTaskPriority(params.priority) ? params.priority : 'medium';
	const reminderOffset = normalizeReminderOffset(params.reminder_offset);
	const now = Date.now();
	const tags = Array.isArray(params.tags) ? params.tags : [];
	const group = typeof params.group === 'string' ? params.group.trim() : '';
	const childTasks = params.child_tasks !== undefined
		? normalizeTemplateChildTasks(params.child_tasks, { priority: priority, tags: tags, group: group })
		: (Array.isArray(params.children) ? params.children.filter(function (title) { return typeof title === 'string' && title.trim(); }).map(function (title) {
			return { title: title.trim(), priority: priority, tags: tags.slice(), group: group, description: '' };
		}) : []);
	const tpl = {
		id: generateTemplateId(),
		name: name,
		title: title,
		priority: priority,
		tags: tags,
		group: group,
		description: typeof params.description === 'string' ? params.description : '',
		childTasks: childTasks,
		children: childTasks.map(function (child) { return child.title; }),
		createdAt: now,
		updatedAt: now,
	};
	if (reminderOffset !== undefined) tpl.reminderOffset = reminderOffset;
	const list = readTemplatesFromDb(dbStorage);
	list.push(tpl);
	writeTemplatesToDb(dbStorage, list);
	return { template_id: tpl.id, name: tpl.name };
}

function listTemplatesHandler(dbStorage) {
	const list = readTemplatesFromDb(dbStorage);
	return { templates: list.map(toTemplateOutput) };
}

function updateTemplateHandler(dbStorage, params) {
	params = omitOptionalNulls(params, ['name', 'title', 'priority', 'tags', 'group', 'description', 'children', 'child_tasks']);
	const id = params && params.template_id;
	if (!id) throw new Error('template_id 不能为空');
	const templates = readTemplatesFromDb(dbStorage);
	const template = templates.find(function (item) { return item.id === id; });
	if (!template) throw new Error('未找到模板: ' + id);
	if (hasOwn(params, 'name')) {
		if (typeof params.name !== 'string' || !params.name.trim()) throw new Error('模板名称不能为空');
		template.name = params.name.trim();
	}
	if (hasOwn(params, 'title')) {
		if (typeof params.title !== 'string' || !params.title.trim()) throw new Error('模板标题不能为空');
		template.title = params.title.trim();
	}
	if (hasOwn(params, 'priority')) {
		if (!isTaskPriority(params.priority)) throw new Error('任务优先级无效');
		template.priority = params.priority;
	}
	if (hasOwn(params, 'tags')) {
		if (!Array.isArray(params.tags) || params.tags.some(function (tag) { return typeof tag !== 'string'; })) throw new Error('tags 必须为字符串数组');
		template.tags = params.tags.slice();
	}
	if (hasOwn(params, 'group')) {
		if (typeof params.group !== 'string') throw new Error('group 必须是字符串');
		template.group = params.group.trim();
	}
	if (hasOwn(params, 'description')) template.description = typeof params.description === 'string' ? params.description : '';
	if (hasOwn(params, 'children')) {
		if (!Array.isArray(params.children) || params.children.some(function (title) { return typeof title !== 'string' || !title.trim(); })) throw new Error('children 必须是非空字符串数组');
		template.children = params.children.map(function (title) { return title.trim(); });
		template.childTasks = template.children.map(function (title) {
			return { title: title, priority: template.priority, tags: template.tags.slice(), group: template.group, description: '' };
		});
	}
	if (hasOwn(params, 'child_tasks')) {
		const childTasks = normalizeTemplateChildTasks(params.child_tasks, { priority: template.priority, tags: template.tags, group: template.group });
		template.childTasks = childTasks;
		template.children = childTasks.map(function (child) { return child.title; });
	}
	if (hasOwn(params, 'reminder_offset')) {
		const offset = normalizeReminderOffset(params.reminder_offset);
		if (offset === undefined) delete template.reminderOffset;
		else template.reminderOffset = offset;
	}
	delete template.repeat;
	template.updatedAt = Date.now();
	writeTemplatesToDb(dbStorage, templates);
	return { template_id: template.id, name: template.name };
}

function deleteTemplateHandler(dbStorage, params) {
	const id = params && params.template_id;
	if (!id) throw new Error('template_id 不能为空');
	const list = readTemplatesFromDb(dbStorage);
	const next = list.filter(function (t) { return t.id !== id });
	if (next.length === list.length) throw new Error('未找到模板: ' + id);
	writeTemplatesToDb(dbStorage, next);
	return { deleted: true };
}

function applyTemplateHandler(dbStorage, params) {
	params = omitOptionalNulls(params, ['title', 'priority', 'tags', 'group', 'description', 'child_tasks', 'due_start', 'due_end', 'due_date', 'all_day']);
	const id = params && params.template_id;
	if (!id) throw new Error('template_id 不能为空');
	const list = readTemplatesFromDb(dbStorage);
	const tpl = list.find(function (t) { return t.id === id });
	if (!tpl) throw new Error('未找到模板: ' + id);

	const title = (params.title && typeof params.title === 'string') ? params.title.trim() : tpl.title;
	const priority = params.priority === undefined ? (tpl.priority || 'medium') : params.priority;
	if (!isTaskPriority(priority)) throw new Error('任务优先级无效');
	const tags = Array.isArray(params.tags) ? params.tags : (tpl.tags || []).slice();
	const group = (params.group && typeof params.group === 'string') ? params.group.trim() : (tpl.group || '');
	const description = typeof params.description === 'string' ? params.description : (tpl.description || '');
	const allDay = params.all_day === true;
	// 单点截止优先 due_end；旧 due_date 兼容并解释为单点截止；与 due_start 同时存在时自动按升序归一化
	const parsedStart = params.due_start !== undefined ? parseTaskTime(params.due_start, allDay) : undefined;
	const parsedEnd = params.due_end !== undefined ? parseTaskTime(params.due_end, allDay) : parseDate(params.due_date);
	if (params.due_start !== undefined && parsedStart === undefined) throw new Error('due_start 不是合法日期');
	if (params.due_end !== undefined && parsedEnd === undefined) throw new Error('due_end 不是合法日期');
	const range = normalizeDateRange(parsedStart, parsedEnd);
	const dueStart = range.dueStart;
	const dueEnd = range.dueEnd;

	const now = Date.now();
	const task = {
		id: generateId(),
		title: title,
		status: 'todo',
		priority: priority,
		tags: tags,
		group: group,
		description: description,
		subtasks: [],
		createdAt: now,
		updatedAt: now,
	};
	if (dueStart !== undefined) task.dueStart = dueStart;
	if (dueEnd !== undefined) task.dueEnd = dueEnd;
	if (params.all_day === true) task.allDay = true;
	const reminderOffset = hasOwn(params, 'reminder_offset')
		? normalizeReminderOffset(params.reminder_offset)
		: tpl.reminderOffset;
	if (reminderOffset !== undefined) {
		if (dueStart === undefined && dueEnd === undefined) throw new Error('设置提醒需要先有截止日期');
		task.reminderOffset = reminderOffset;
	}

	const tasks = readTasksFromDb(dbStorage);
	tasks.push(task);
	const childTasks = params.child_tasks !== undefined
		? normalizeTemplateChildTasks(params.child_tasks, { priority: priority, tags: tags, group: group })
		: (Array.isArray(tpl.childTasks) ? tpl.childTasks : (Array.isArray(tpl.children) ? tpl.children.map(function (title) {
		return { title: title, priority: task.priority, tags: task.tags, group: task.group, description: '' };
		}) : (tpl.subtasks || []).map(function (subtask) { return { title: subtask.title, priority: task.priority, tags: task.tags, group: task.group, description: '' }; })));
	childTasks.forEach(function (child) {
		if (!child || typeof child.title !== 'string' || !child.title.trim()) return;
		tasks.push({
			id: generateId(), title: child.title.trim(), status: 'todo', priority: isTaskPriority(child.priority) ? child.priority : task.priority,
			tags: Array.isArray(child.tags) ? child.tags.slice() : task.tags.slice(), group: typeof child.group === 'string' ? child.group : task.group, description: typeof child.description === 'string' ? child.description : '', subtasks: [], parentTaskId: task.id,
			createdAt: now, updatedAt: now,
		});
	});
	writeTasksToDb(dbStorage, tasks);

	return { task_id: task.id, title: task.title };
}

// ── Reminder management handlers ──────────────────────────────────────

function setReminderHandler(dbStorage, params) {
	const taskId = params && params.task_id;
	if (!taskId) throw new Error('task_id 不能为空');
	const offset = normalizeReminderOffset(params.reminder_offset);

	const tasks = readTasksFromDb(dbStorage);
	const task = findTaskById(tasks, taskId);
	if (!task) throw new Error('未找到任务: ' + taskId);
	if (getTaskDeadline(task) === undefined) throw new Error('设置提醒需要先有截止日期');

	if (offset === undefined) {
		delete task.reminderOffset;
	} else {
		task.reminderOffset = offset;
	}
	delete task.remindedAt;
	task.updatedAt = Date.now();
	writeTasksToDb(dbStorage, tasks);
	return { task_id: task.id, reminder_offset: task.reminderOffset };
}

function snoozeReminderHandler(dbStorage, params) {
	const taskId = params && params.task_id;
	if (!taskId) throw new Error('task_id 不能为空');
	const minutes = params && params.minutes;
	if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) {
		throw new Error('minutes 必须为正数');
	}

	const tasks = readTasksFromDb(dbStorage);
	const task = findTaskById(tasks, taskId);
	if (!task) throw new Error('未找到任务: ' + taskId);

	task.snoozedUntil = Date.now() + minutes * MS_PER_MINUTE;
	// snooze 期间视为未提醒：清除 remindedAt 以便到点再触发
	delete task.remindedAt;
	task.updatedAt = Date.now();
	writeTasksToDb(dbStorage, tasks);
	return { task_id: task.id, snoozed_until: formatDate(task.snoozedUntil) };
}

function acknowledgeReminderHandler(dbStorage, params) {
	const taskId = params && params.task_id;
	if (!taskId) throw new Error('task_id 不能为空');
	const tasks = readTasksFromDb(dbStorage);
	const task = findTaskById(tasks, taskId);
	if (!task) throw new Error('未找到任务: ' + taskId);
	task.remindedAt = Date.now();
	task.updatedAt = task.remindedAt;
	writeTasksToDb(dbStorage, tasks);
	return { task_id: task.id, acknowledged: true };
}

function dismissReminderHandler(dbStorage, params) {
	const taskId = params && params.task_id;
	if (!taskId) throw new Error('task_id 不能为空');

	const tasks = readTasksFromDb(dbStorage);
	const task = findTaskById(tasks, taskId);
	if (!task) throw new Error('未找到任务: ' + taskId);

	delete task.reminderOffset;
	delete task.remindedAt;
	delete task.snoozedUntil;
	task.updatedAt = Date.now();
	writeTasksToDb(dbStorage, tasks);
	return { task_id: task.id, dismissed: true };
}

// ── List due reminders (read-only query) ──────────────────────────────

function computeReminderAtPure(task) {
	const deadline = getTaskDeadline(task);
	if (deadline === undefined) return undefined;
	const offset = task.reminderOffset || 0;
	return deadline - offset * MS_PER_MINUTE;
}

function listDueRemindersHandler(dbStorage, params) {
	const p = omitOptionalNulls(params, ['include_overdue', 'limit']);
	const now = Date.now();
	const includeOverdue = p.include_overdue !== false;
	let tasks = readTasksFromDb(dbStorage);

	const result = [];
	for (const task of tasks) {
		if (task.archivedAt !== undefined) continue;
		if (task.status === 'done') continue;
		if (task.remindedAt !== undefined) continue;
		if (task.snoozedUntil !== undefined && task.snoozedUntil > now) continue;

		const reminderAt = computeReminderAtPure(task);
		const dueReminder = reminderAt !== undefined && reminderAt <= now;
		const overdue = includeOverdue && getTaskDeadline(task) !== undefined && getTaskDeadline(task) <= now;
		if (!dueReminder && !overdue) continue;

		result.push({
			id: task.id,
			title: task.title,
			status: task.status,
			priority: task.priority,
			due_start: formatDate(getTaskStart(task)),
			due_end: formatDate(getTaskDeadline(task)),
			due_date: formatDate(getTaskDeadline(task)),
			reminder_at: formatDate(reminderAt),
			snoozed_until: formatDate(task.snoozedUntil),
		});
	}

	result.sort(function (a, b) {
		const aAt = a.reminder_at ? new Date(a.reminder_at).getTime() : Infinity;
		const bAt = b.reminder_at ? new Date(b.reminder_at).getTime() : Infinity;
		return aAt - bAt;
	});

	const limit = typeof p.limit === 'number' && p.limit > 0 ? p.limit : 50;
	const sliced = result.slice(0, limit);
	return { reminders: sliced, total: result.length };
}

function countValues(values) {
	const counts = {};
	values.forEach(function (value) {
		if (typeof value !== 'string' || !value.trim()) return;
		const key = value.trim();
		counts[key] = (counts[key] || 0) + 1;
	});
	return Object.keys(counts).map(function (name) { return { name: name, count: counts[name] }; }).sort(function (a, b) {
		return b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN');
	});
}

function getReviewHandler(dbStorage) {
	const tasks = readTasksFromDb(dbStorage);
	const visible = tasks.filter(function (task) { return task.archivedAt === undefined; });
	const now = Date.now();
	const today = startOfToday(now);
	const weekEnd = today + 7 * MS_PER_DAY - 1;
	const byStatus = { todo: 0, doing: 0, done: 0 };
	const byPriority = { low: 0, medium: 0, high: 0, urgent: 0 };
	let overdue = 0;
	let dueNextSevenDays = 0;
	let noDueDate = 0;
	visible.forEach(function (task) {
		if (byStatus[task.status] !== undefined) byStatus[task.status]++;
		if (byPriority[task.priority] !== undefined) byPriority[task.priority]++;
		const deadline = getTaskDeadline(task);
		if (deadline === undefined) noDueDate++;
		else if (task.status !== 'done' && deadline >= today && deadline <= weekEnd) dueNextSevenDays++;
		if (task.status !== 'done' && deadline !== undefined && deadline < today) overdue++;
	});
	let history = [];
	try {
		const raw = dbStorage.getItem('jianyue.pomodoro.history');
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : [];
		history = Array.isArray(parsed) ? parsed : [];
	} catch { history = []; }
	const sevenDaysAgo = today - 6 * MS_PER_DAY;
	const focusMinutes = history.reduce(function (sum, session) {
		return sum + (session && session.status === 'finished' && typeof session.durationMinutes === 'number' && typeof session.endsAt === 'number' && session.endsAt >= sevenDaysAgo && session.endsAt <= now ? session.durationMinutes : 0);
	}, 0);
	const active = byStatus.todo + byStatus.doing;
	const completed = byStatus.done;
	const percent = function (part, total) { return total ? Math.round(part * 100 / total) : 0; };
	const trend = [];
	for (let day = 6; day >= 0; day--) {
		const point = today - day * MS_PER_DAY;
		const date = new Date(point);
		trend.push({
			date: String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'),
			count: visible.filter(function (task) { return task.status === 'done' && startOfToday(task.completedAt ?? task.updatedAt) === point; }).length,
		});
	}
	return {
		total: visible.length, active: active, completed: completed, archived: tasks.length - visible.length,
		completion_rate: percent(completed, visible.length), overdue: overdue, delay_rate: percent(overdue, active),
		due_next_seven_days: dueNextSevenDays, no_due_date: noDueDate, focus_minutes: focusMinutes,
		by_status: byStatus, by_priority: byPriority,
		top_groups: countValues(visible.map(function (task) { return task.group || ''; })).slice(0, 5),
		top_tags: countValues(visible.reduce(function (all, task) { return all.concat(task.tags || []); }, [])).slice(0, 5),
		completion_trend: trend,
	};
}

function suggestOrganizationHandler(dbStorage, params) {
	const now = params && typeof params.now === 'number' ? params.now : Date.now();
	const tomorrow = new Date(now);
	tomorrow.setDate(tomorrow.getDate() + 1);
	tomorrow.setHours(0, 0, 0, 0);
	const changes = [];
	let skipped = 0;
	readTasksFromDb(dbStorage).forEach(function (task) {
		if (task.archivedAt !== undefined || task.status === 'done') { skipped++; return; }
		const text = String(task.title || '') + ' ' + String(task.description || '');
		const patch = {};
		const reasons = [];
		if (task.priority === 'medium') {
			if (/(紧急|马上|立刻|今天|线上|阻塞|critical|urgent|asap)/i.test(text)) { patch.priority = 'urgent'; reasons.push('识别优先级：urgent'); }
			else if (/(重要|本周|高优|发布|截止|评审|high)/i.test(text)) { patch.priority = 'high'; reasons.push('识别优先级：high'); }
			else if (/(有空|以后|低优|可选|low)/i.test(text)) { patch.priority = 'low'; reasons.push('识别优先级：low'); }
		}
		if (!String(task.group || '').trim()) {
			if (/(需求|评审|迭代|发布|上线|项目|会议|同步|沟通|复盘|周会|站会|bug|缺陷|报错|修复)/i.test(text)) { patch.group = '工作'; reasons.push('补充分组：工作'); }
			else if (/(学习|阅读|课程|读书|研究|调研)/i.test(text)) { patch.group = '学习'; reasons.push('补充分组：学习'); }
			else if (/(运动|健身|跑步|体检|医生|健康|买|采购|缴费|快递|家务|做饭)/i.test(text)) { patch.group = '生活'; reasons.push('补充分组：生活'); }
		}
		if ((!task.tags || task.tags.length === 0) && /(项目|评审|发布|上线)/i.test(text)) { patch.tags = ['项目']; reasons.push('补充标签：项目'); }
		if (getTaskDeadline(task) === undefined && /明天/.test(text)) {
			patch.due_end = String(tomorrow.getFullYear()) + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrow.getDate()).padStart(2, '0');
			patch.all_day = true;
			reasons.push('识别截止日期');
		}
		if (Object.keys(patch).length) changes.push({ task_id: task.id, title: task.title, patch: patch, reasons: reasons });
		else skipped++;
	});
	return { changes: changes, skipped: skipped };
}

module.exports = {
	STORAGE_KEYS,
	STORAGE_KEY,
	SETTINGS_STORAGE_KEY,
	TEMPLATES_STORAGE_KEY,
	SETTINGS_DEFAULTS,
	BULK_UPDATE_MAX,
	readTasksFromDb,
	writeTasksToDb,
	generateId,
	findTaskById,
	formatDate,
	parseDate,
	createTaskHandler,
	listTasksHandler,
	completeTaskHandler,
	updateTaskHandler,
	deleteTaskHandler,
	addSubtaskHandler,
	updateSubtaskHandler,
	deleteSubtaskHandler,
	searchTasksHandler,
	taskOverviewHandler,
	listTagsHandler,
	listGroupsHandler,
	exportTasksHandler,
	importTasksHandler,
	getTaskHandler,
	getSettingsHandler,
	renderMarkdownHandler,
	bulkUpdateHandler,
	notifyHandler,
	// reminder / repeat / template
	normalizeReminderOffset,
	normalizeRepeatRule,
	shouldSpawnNextPure,
	buildNextInstancePure,
	getTaskDeadline,
	normalizeDateRange,
	createTemplateHandler,
	listTemplatesHandler,
	deleteTemplateHandler,
	applyTemplateHandler,
	updateTemplateHandler,
	setReminderHandler,
	snoozeReminderHandler,
	dismissReminderHandler,
	acknowledgeReminderHandler,
	listDueRemindersHandler,
	getReviewHandler,
	suggestOrganizationHandler,
};
