// Pure logic for MCP tool handlers, parameterized by a dbStorage adapter.
// No `window`/`utools` access here — keeps it unit-testable.

// 统一存储键定义。与 src/services/storageKeys.ts 中的 STORAGE_KEYS 保持一致；
// toolHandlers.test.ts 断言四者字符串一致以防键名漂移。
const STORAGE_KEYS = {
	TASKS: 'jianyue.tasks',
	SETTINGS: 'jianyue.settings',
	TEMPLATES: 'jianyue.templates',
	UI_STATE: 'jianyue.uiState',
};

const STORAGE_KEY = STORAGE_KEYS.TASKS;

function readTasksFromDb(dbStorage) {
	try {
		const raw = dbStorage.getItem(STORAGE_KEY);
		if (typeof raw !== 'string') return [];
		return JSON.parse(raw);
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

function formatDate(ts) {
	if (!ts) return undefined;
	return new Date(ts).toISOString();
}

function parseDate(iso) {
	if (!iso) return undefined;
	const ts = new Date(iso).getTime();
	return Number.isNaN(ts) ? undefined : ts;
}

function createTaskHandler(dbStorage, params) {
	const title = params && params.title;
	if (!title || typeof title !== 'string' || !title.trim()) {
		throw new Error('任务标题不能为空');
	}

	const now = Date.now();
	const dueDate = parseDate(params.due_date);
	const reminderOffset = normalizeReminderOffset(params.reminder_offset);
	if (reminderOffset !== undefined && dueDate === undefined) {
		throw new Error('设置提醒需要先有截止日期');
	}
	const repeat = normalizeRepeatRule(params.repeat);
	const task = {
		id: generateId(),
		title: title.trim(),
		status: 'todo',
		dueDate: dueDate,
		priority: params.priority || 'medium',
		tags: Array.isArray(params.tags) ? params.tags : [],
		group: typeof params.group === 'string' ? params.group.trim() : '',
		description: typeof params.description === 'string' ? params.description : '',
		subtasks: [],
		visible: true,
		createdAt: now,
		updatedAt: now,
	};

	if (task.dueDate === undefined) {
		delete task.dueDate;
	}
	if (reminderOffset !== undefined) task.reminderOffset = reminderOffset;
	if (repeat !== undefined) task.repeat = repeat;

	const tasks = readTasksFromDb(dbStorage);
	tasks.push(task);
	writeTasksToDb(dbStorage, tasks);

	return { id: task.id, title: task.title, status: task.status };
}

function listTasksHandler(dbStorage, params) {
	let tasks = readTasksFromDb(dbStorage);
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

	const result = sliced.map(function (t) {
		return {
			id: t.id,
			title: t.title,
			status: t.status,
			priority: t.priority,
			due_date: formatDate(t.dueDate),
			tags: t.tags || [],
		};
	});

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

	task.status = 'done';
	task.updatedAt = Date.now();

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
	const taskId = params && params.task_id;
	if (!taskId) {
		throw new Error('task_id 不能为空');
	}

	const tasks = readTasksFromDb(dbStorage);
	const task = findTaskById(tasks, taskId);
	if (!task) {
		throw new Error('未找到任务: ' + taskId);
	}

	if (params.title !== undefined) task.title = params.title;
	if (params.status !== undefined) task.status = params.status;
	if (params.priority !== undefined) task.priority = params.priority;
	if (params.tags !== undefined) task.tags = params.tags;
	if (params.description !== undefined) task.description = params.description;
	if (params.due_date !== undefined) {
		const parsed = parseDate(params.due_date);
		if (parsed !== undefined) {
			task.dueDate = parsed;
		} else {
			delete task.dueDate;
		}
	}
	if (params.reminder_offset !== undefined) {
		const offset = normalizeReminderOffset(params.reminder_offset);
		if (offset !== undefined && task.dueDate === undefined) {
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
	if (params.repeat !== undefined) {
		const rule = normalizeRepeatRule(params.repeat);
		if (rule === undefined) {
			delete task.repeat;
		} else {
			task.repeat = rule;
		}
	}

	task.updatedAt = Date.now();
	writeTasksToDb(dbStorage, tasks);

	return { id: task.id, title: task.title, status: task.status };
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

	tasks.splice(index, 1);
	writeTasksToDb(dbStorage, tasks);

	return { deleted: true };
}

// ── Subtask handlers ──────────────────────────────────────────────────

function findSubtask(task, subtaskId) {
	return (task.subtasks || []).find(function (s) { return s.id === subtaskId }) || null;
}

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
		completed: false,
		createdAt: now,
		updatedAt: now,
	};
	if (!Array.isArray(task.subtasks)) task.subtasks = [];
	task.subtasks.push(subtask);
	task.updatedAt = now;
	writeTasksToDb(dbStorage, tasks);

	return { task_id: task.id, subtask_id: subtask.id, title: subtask.title, completed: false };
}

function updateSubtaskHandler(dbStorage, params) {
	const taskId = params && params.task_id;
	const subtaskId = params && params.subtask_id;
	if (!taskId) throw new Error('task_id 不能为空');
	if (!subtaskId) throw new Error('subtask_id 不能为空');

	const hasCompleted = params && Object.prototype.hasOwnProperty.call(params, 'completed');
	const hasTitle = params && Object.prototype.hasOwnProperty.call(params, 'title');
	if (!hasCompleted && !hasTitle) {
		throw new Error('至少需要提供 completed 或 title 之一');
	}
	if (hasTitle && (typeof params.title !== 'string' || !params.title.trim())) {
		throw new Error('子任务标题不能为空');
	}

	const tasks = readTasksFromDb(dbStorage);
	const task = findTaskById(tasks, taskId);
	if (!task) throw new Error('未找到任务: ' + taskId);
	const subtask = findSubtask(task, subtaskId);
	if (!subtask) throw new Error('未找到子任务: ' + subtaskId);

	if (hasCompleted) subtask.completed = Boolean(params.completed);
	if (hasTitle) subtask.title = params.title.trim();
	subtask.updatedAt = Date.now();
	task.updatedAt = subtask.updatedAt;
	writeTasksToDb(dbStorage, tasks);

	return { task_id: task.id, subtask_id: subtask.id, completed: subtask.completed, title: subtask.title };
}

function deleteSubtaskHandler(dbStorage, params) {
	const taskId = params && params.task_id;
	const subtaskId = params && params.subtask_id;
	if (!taskId) throw new Error('task_id 不能为空');
	if (!subtaskId) throw new Error('subtask_id 不能为空');

	const tasks = readTasksFromDb(dbStorage);
	const task = findTaskById(tasks, taskId);
	if (!task) throw new Error('未找到任务: ' + taskId);
	const before = (task.subtasks || []).length;
	task.subtasks = (task.subtasks || []).filter(function (s) { return s.id !== subtaskId });
	if (task.subtasks.length === before) throw new Error('未找到子任务: ' + subtaskId);
	task.updatedAt = Date.now();
	writeTasksToDb(dbStorage, tasks);

	return { deleted: true };
}

// ── Search handler (extended filter + sort + paginate) ────────────────

function asArray(value) {
	if (Array.isArray(value)) return value;
	if (value === undefined || value === null) return [];
	return [value];
}

function searchTasksHandler(dbStorage, params) {
	const p = params || {};
	let tasks = readTasksFromDb(dbStorage);

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
			if (t.dueDate === undefined) return includeNoDue;
			if (dueAfter !== undefined && t.dueDate < dueAfter) return false;
			if (dueBefore !== undefined && t.dueDate > dueBefore) return false;
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
			av = a.dueDate === undefined ? Infinity : a.dueDate;
			bv = b.dueDate === undefined ? Infinity : b.dueDate;
		}
		if (av === bv) return 0;
		return order === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
	});

	const total = tasks.length;
	const limit = typeof p.limit === 'number' && p.limit > 0 ? p.limit : 50;
	const offset = typeof p.offset === 'number' && p.offset >= 0 ? p.offset : 0;
	const sliced = tasks.slice(offset, offset + limit);

	const result = sliced.map(function (t) {
		return {
			id: t.id,
			title: t.title,
			status: t.status,
			priority: t.priority,
			due_date: formatDate(t.dueDate),
			tags: t.tags || [],
			group: t.group || '',
			description: t.description || '',
		};
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
	const p = params || {};
	let tasks = readTasksFromDb(dbStorage);
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
		if (t.dueDate === undefined) {
			noDueDate++;
		} else {
			if (t.dueDate >= todayStart && t.dueDate <= todayEnd) dueToday++;
			if (t.dueDate < now && t.status !== 'done') overdue++;
		}
	});

	return {
		total: tasks.length,
		byStatus: byStatus,
		byPriority: byPriority,
		overdue: overdue,
		dueToday: dueToday,
		noDueDate: noDueDate,
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
		title: task.title,
		status: task.status,
		priority: task.priority,
		due_date: formatDate(task.dueDate),
		tags: task.tags || [],
		group: task.group || '',
		description: task.description || '',
		subtasks: (task.subtasks || []).map(function (s) {
			return {
				id: s.id,
				title: s.title,
				completed: Boolean(s.completed),
				created_at: formatDate(s.createdAt),
				updated_at: formatDate(s.updatedAt),
			};
		}),
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
};

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
	const p = params || {};
	const ids = Array.isArray(p.task_ids) ? p.task_ids : [];
	if (ids.length === 0) throw new Error('task_ids 不能为空');
	if (ids.length > BULK_UPDATE_MAX) {
		throw new Error('单次最多更新 ' + BULK_UPDATE_MAX + ' 个任务');
	}
	const hasUpdate = p.status !== undefined || p.priority !== undefined || p.group !== undefined;
	if (!hasUpdate) throw new Error('至少需要提供 status、priority 或 group 之一');

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
		if (p.status !== undefined) task.status = p.status;
		if (p.priority !== undefined) task.priority = p.priority;
		if (p.group !== undefined) task.group = p.group;
		task.updatedAt = now;
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
	deps.showNotification({ title: title.trim(), body: body });
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
	const base = task.dueDate !== undefined ? task.dueDate : (now || Date.now());
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
	if (task.dueDate !== undefined) next.dueDate = nextDue;
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

function toTemplateOutput(tpl) {
	return {
		id: tpl.id,
		name: tpl.name,
		title: tpl.title,
		priority: tpl.priority,
		tags: tpl.tags || [],
		group: tpl.group || '',
		description: tpl.description || '',
		subtasks: tpl.subtasks || [],
		reminder_offset: tpl.reminderOffset,
		repeat: tpl.repeat,
		created_at: formatDate(tpl.createdAt),
		updated_at: formatDate(tpl.updatedAt),
	};
}

function createTemplateHandler(dbStorage, params) {
	const name = params && typeof params.name === 'string' ? params.name.trim() : '';
	if (!name) throw new Error('模板名称不能为空');
	const title = params && typeof params.title === 'string' ? params.title.trim() : '';
	if (!title) throw new Error('模板标题不能为空');
	const priority = params && (params.priority === 'low' || params.priority === 'medium' || params.priority === 'high')
		? params.priority : 'medium';
	const reminderOffset = normalizeReminderOffset(params.reminder_offset);
	const repeat = normalizeRepeatRule(params.repeat);
	const now = Date.now();
	const tpl = {
		id: generateTemplateId(),
		name: name,
		title: title,
		priority: priority,
		tags: Array.isArray(params.tags) ? params.tags : [],
		group: typeof params.group === 'string' ? params.group.trim() : '',
		description: typeof params.description === 'string' ? params.description : '',
		subtasks: Array.isArray(params.subtasks) ? params.subtasks : [],
		createdAt: now,
		updatedAt: now,
	};
	if (reminderOffset !== undefined) tpl.reminderOffset = reminderOffset;
	if (repeat !== undefined) tpl.repeat = repeat;
	const list = readTemplatesFromDb(dbStorage);
	list.push(tpl);
	writeTemplatesToDb(dbStorage, list);
	return { template_id: tpl.id, name: tpl.name };
}

function listTemplatesHandler(dbStorage) {
	const list = readTemplatesFromDb(dbStorage);
	return { templates: list.map(toTemplateOutput) };
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
	const id = params && params.template_id;
	if (!id) throw new Error('template_id 不能为空');
	const list = readTemplatesFromDb(dbStorage);
	const tpl = list.find(function (t) { return t.id === id });
	if (!tpl) throw new Error('未找到模板: ' + id);

	const title = (params.title && typeof params.title === 'string') ? params.title.trim() : tpl.title;
	const tags = Array.isArray(params.tags) ? params.tags : (tpl.tags || []).slice();
	const group = (params.group && typeof params.group === 'string') ? params.group.trim() : (tpl.group || '');
	const dueDate = parseDate(params.due_date);

	const now = Date.now();
	const task = {
		id: generateId(),
		title: title,
		status: 'todo',
		priority: tpl.priority || 'medium',
		tags: tags,
		group: group,
		description: tpl.description || '',
		subtasks: (tpl.subtasks || []).map(function (s) {
			return {
				id: generateId(),
				title: s.title,
				completed: false,
				createdAt: now,
				updatedAt: now,
			};
		}),
		createdAt: now,
		updatedAt: now,
	};
	if (dueDate !== undefined) task.dueDate = dueDate;
	if (tpl.reminderOffset !== undefined) task.reminderOffset = tpl.reminderOffset;
	if (tpl.repeat !== undefined) task.repeat = tpl.repeat;

	const tasks = readTasksFromDb(dbStorage);
	tasks.push(task);
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
	if (task.dueDate === undefined) throw new Error('设置提醒需要先有截止日期');

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
	if (task.dueDate === undefined) return undefined;
	const offset = task.reminderOffset || 0;
	return task.dueDate - offset * MS_PER_MINUTE;
}

function listDueRemindersHandler(dbStorage, params) {
	const p = params || {};
	const now = Date.now();
	const includeOverdue = p.include_overdue !== false;
	let tasks = readTasksFromDb(dbStorage);

	const result = [];
	for (const task of tasks) {
		if (task.status === 'done') continue;
		if (task.remindedAt !== undefined) continue;
		if (task.snoozedUntil !== undefined && task.snoozedUntil > now) continue;

		const reminderAt = computeReminderAtPure(task);
		const dueReminder = reminderAt !== undefined && reminderAt <= now;
		const overdue = includeOverdue && task.dueDate !== undefined && task.dueDate <= now;
		if (!dueReminder && !overdue) continue;

		result.push({
			id: task.id,
			title: task.title,
			status: task.status,
			priority: task.priority,
			due_date: formatDate(task.dueDate),
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
	createTemplateHandler,
	listTemplatesHandler,
	deleteTemplateHandler,
	applyTemplateHandler,
	setReminderHandler,
	snoozeReminderHandler,
	dismissReminderHandler,
	listDueRemindersHandler,
};
