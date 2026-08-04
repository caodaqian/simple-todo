import { onUnmounted } from 'vue';
import { notifyService } from '../services/notifyService';
import {
	computeReminderAt,
	getDueReminders,
	getMissedReminders,
} from '../services/reminderService';
import { settingsService } from '../services/settingsService';
import { taskService } from '../services/taskService';
import { webhookDispatchService } from '../services/webhookDispatchService';
import type { Task } from '../types/task';
import type { WebhookPlatform } from '../types/webhook';

const CHECK_INTERVAL_MS = 30_000;
const CATCHUP_BATCH_THRESHOLD = 5;

const TASKS_CHANGED_EVENT = 'jianyue:tasks-changed';
const WEBHOOK_PLATFORMS: readonly WebhookPlatform[] = ['feishu', 'dingtalk'];

const getDueWebhookPlatforms = (): WebhookPlatform[] => {
	const settings = settingsService.getSettings().webhooks;
	return WEBHOOK_PLATFORMS.filter((platform) => {
		const target = settings[platform];
		return target.enabled && target.events.includes('task.due');
	});
};

const enqueueDueWebhookEvents = (tasks: Task[]): void => {
	const platforms = getDueWebhookPlatforms();
	if (platforms.length === 0) return;
	for (const task of tasks) {
		const reminderAt = computeReminderAt(task);
		if (reminderAt === undefined) continue;
		try {
			const event = webhookDispatchService.createDueEvent(task, reminderAt);
			webhookDispatchService.enqueue(event, platforms);
		} catch {
			console.debug('Unable to enqueue webhook reminder');
		}
	}
};

const drainWebhookOutbox = (): void => {
	void webhookDispatchService.drain().catch(() => {
		console.debug('Unable to drain webhook reminders');
	});
};

/**
 * 标记任务已提醒（写 remindedAt），并派发 tasks-changed 事件刷新视图。
 */
const markReminded = (tasks: Task[]): void => {
	if (tasks.length === 0) return;
	const now = Date.now();
	for (const task of tasks) {
		taskService.update(task.id, { remindedAt: now });
	}
	window.dispatchEvent(new CustomEvent(TASKS_CHANGED_EVENT));
};

/**
 * 窗口打开期间的实时轮询：每 30s 扫描 getDueReminders，
 * 逐条触发系统通知并标记 remindedAt。
 */
const startRealtimePolling = (): (() => void) => {
	const tick = (): void => {
		const tasks = taskService.getAll();
		const due = getDueReminders(tasks);
		if (due.length > 0) {
			enqueueDueWebhookEvents(due);
			for (const task of due) {
				notifyService.notify('简悦清单提醒', task.title);
			}
			markReminded(due);
		}
		drainWebhookOutbox();
	};
	tick(); // 立即跑一次（含 mount/onPluginEnter 后的首次扫描）
	const timer = window.setInterval(tick, CHECK_INTERVAL_MS);
	return () => window.clearInterval(timer);
};

/**
 * 进入插件时的补报：扫描漏掉的提醒（含未设 reminderOffset 的逾期任务）。
 * 超过阈值时汇总成一条通知，否则逐条。最后全部标记 remindedAt。
 */
export const catchUpReminders = (): void => {
	const tasks = taskService.getAll();
	const missed = getMissedReminders(tasks);
	if (missed.length > 0) {
		enqueueDueWebhookEvents(missed);
		if (missed.length > CATCHUP_BATCH_THRESHOLD) {
			notifyService.notify('简悦清单', `你有 ${missed.length} 条漏掉的提醒`);
		} else {
			for (const task of missed) {
				notifyService.notify('简悦清单提醒', task.title);
			}
		}
		markReminded(missed);
	}
	drainWebhookOutbox();
};

/**
 * 组合式入口：在组件 onMounted 调用。启动实时轮询，onUnmounted 自动清理。
 */
export const useReminderScheduler = (): void => {
	const stop = startRealtimePolling();
	onUnmounted(() => {
		stop();
	});
};
