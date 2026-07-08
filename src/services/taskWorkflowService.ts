import type { Task, TaskStatus } from '../types/task';
import { notifyService } from './notifyService';
import { taskService } from './taskService';

const shouldNotifyDone = (previousStatus: TaskStatus | undefined, nextStatus: TaskStatus): boolean => {
	return previousStatus !== undefined && previousStatus !== 'done' && nextStatus === 'done';
};

const changeStatus = (taskId: string, status: TaskStatus): Task | null => {
	const previous = taskService.getById(taskId);
	const updated = taskService.changeStatus(taskId, status);
	if (updated && shouldNotifyDone(previous?.status, status)) {
		notifyService.notify('任务已完成', updated.title);
	}
	return updated;
};

const bulkUpdateStatus = (taskIds: string[], status: TaskStatus): number => {
	const previousTasks = taskService.getAll();
	const idSet = new Set(taskIds);
	const completedCount = status === 'done'
		? previousTasks.filter((task) => idSet.has(task.id) && task.status !== 'done').length
		: 0;

	const updated = taskService.bulkUpdate(taskIds, { status });
	if (completedCount > 0) {
		notifyService.notify('任务已完成', `已完成 ${completedCount} 项任务`);
	}
	return updated;
};

export const taskWorkflowService = { changeStatus, bulkUpdateStatus };
