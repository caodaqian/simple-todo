import type { Task } from '../types/task';

export interface CompletedTaskListItem {
	task: Task;
	depth: number;
	parentTitle?: string;
}

export type CompletedTaskListRow =
	| { kind: 'task'; item: CompletedTaskListItem }
	| { kind: 'parent-context'; parent: Task; children: CompletedTaskListItem[] };

export const buildCompletedListRows = (
	allTasks: Task[],
	visibleTasks: Task[],
): CompletedTaskListRow[] => {
	const taskById = new Map(allTasks.map((task) => [task.id, task]));
	const rows: CompletedTaskListRow[] = [];
	const parentContextRows = new Map<string, Extract<CompletedTaskListRow, { kind: 'parent-context' }>>();

	for (const task of visibleTasks) {
		const parent = task.parentTaskId ? taskById.get(task.parentTaskId) : undefined;
		if (parent && parent.status !== 'done') {
			let row = parentContextRows.get(parent.id);
			if (!row) {
				row = { kind: 'parent-context', parent, children: [] };
				parentContextRows.set(parent.id, row);
				rows.push(row);
			}
			row.children.push({ task, depth: 1, parentTitle: parent.title });
			continue;
		}

		if (parent) {
			rows.push({ kind: 'task', item: { task, depth: 1, parentTitle: parent.title } });
			continue;
		}

		rows.push({
			kind: 'task',
			item: task.parentTaskId
				? { task, depth: 0, parentTitle: '原父任务已不存在' }
				: { task, depth: 0 },
		});
	}

	return rows;
};
