import type { Task, TaskStatus } from '../types/task';
import { notifyService } from './notifyService';
import { settingsService } from './settingsService';
import { taskService } from './taskService';
import { webhookDispatchService } from './webhookDispatchService';
import type { WebhookPlatform } from '../types/webhook';

export interface BlockedCompletionInfo {
	parent: Task;
	doingCount: number;
	todoCount: number;
}

const shouldNotifyDone = (previousStatus: TaskStatus | undefined, nextStatus: TaskStatus): boolean => {
	return previousStatus !== undefined && previousStatus !== 'done' && nextStatus === 'done';
};

const WEBHOOK_PLATFORMS: readonly WebhookPlatform[] = ['feishu', 'dingtalk'];

const enqueueCompletedWebhookEvents = (tasks: Task[]): void => {
	const webhooks = settingsService.getSettings().webhooks;
	const platforms = WEBHOOK_PLATFORMS.filter((platform) => {
		const target = webhooks[platform];
		return target.enabled && target.events.includes('task.completed');
	});
	if (platforms.length === 0) return;
	for (const task of tasks) {
		try {
			webhookDispatchService.enqueue(webhookDispatchService.createCompletedEvent(task), platforms);
		} catch {
			console.debug('Unable to enqueue completed task webhook');
		}
	}
	void webhookDispatchService.drain().catch(() => {
		console.debug('Unable to drain completed task webhooks');
	});
};

/**
 * 若父任务因存在未完成直属子任务而无法标记完成，返回其进行中/待办子任务数量供 UI 弹窗展示；
 * 否则返回 null（父任务不存在或没有阻塞的子任务）。
 */
const getBlockedCompletionInfo = (parentTaskId: string): BlockedCompletionInfo | null => {
	const parent = taskService.getById(parentTaskId);
	if (!parent) return null;
	const incompleteChildren = taskService.getIncompleteChildTasks(parentTaskId);
	if (incompleteChildren.length === 0) return null;
	return {
		parent,
		doingCount: incompleteChildren.filter((task) => task.status === 'doing').length,
		todoCount: incompleteChildren.filter((task) => task.status === 'todo').length,
	};
};

const changeStatus = (taskId: string, status: TaskStatus): Task | null => {
	const previous = taskService.getById(taskId);
	if (status === 'done' && taskService.getIncompleteChildTasks(taskId).length > 0) {
		return null;
	}
	const updated = taskService.changeStatus(taskId, status);
	if (updated && shouldNotifyDone(previous?.status, status)) {
		notifyService.notify('任务已完成', updated.title);
		enqueueCompletedWebhookEvents([updated]);
	}
	return updated;
};

const bulkUpdateStatus = (taskIds: string[], status: TaskStatus): number => {
	const previousTasks = taskService.getAll();
	const blockedParentIds = status === 'done'
		? taskIds.filter((taskId) => taskService.getIncompleteChildTasks(taskId).length > 0)
		: [];
	const blockedParentIdSet = new Set(blockedParentIds);
	const updatableTaskIds = taskIds.filter((taskId) => !blockedParentIdSet.has(taskId));
	const idSet = new Set(updatableTaskIds);
	const completedCount = status === 'done'
		? previousTasks.filter((task) => idSet.has(task.id) && task.status !== 'done').length
		: 0;

	const updated = taskService.bulkUpdate(updatableTaskIds, { status });
	if (completedCount > 0) {
		notifyService.notify('任务已完成', `已完成 ${completedCount} 项任务`);
		enqueueCompletedWebhookEvents(updatableTaskIds
			.filter((taskId) => previousTasks.some((task) => task.id === taskId && task.status !== 'done'))
			.map((taskId) => taskService.getById(taskId))
			.filter((task): task is Task => task !== null));
	}
	if (blockedParentIds.length > 0) {
		notifyService.notify('任务未完成', `另有 ${blockedParentIds.length} 项父任务仍有未完成子任务`);
	}
	return updated;
};

export const taskWorkflowService = { changeStatus, bulkUpdateStatus, getBlockedCompletionInfo };
