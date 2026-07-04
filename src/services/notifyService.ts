import type { Task } from '../types/task';
import { getTaskDateRules, isTaskDueToday, isTaskOverdue } from './searchService';
import { settingsService } from './settingsService';

interface UtoolsNotification {
	showNotification(opts: { title: string; body: string }): void;
}

interface UtoolsLike {
	showNotification?: UtoolsNotification['showNotification'];
}

const getUtoolsNotification = (): UtoolsLike['showNotification'] | null => {
	try {
		const maybeWindow = window as Window & { utools?: UtoolsLike };
		return maybeWindow.utools?.showNotification ?? null;
	} catch {
		return null;
	}
};

export const notify = (title: string, body: string): void => {
	const settings = settingsService.getSettings();
	if (!settings.notifyEnabled) {
		return;
	}

	const showNotification = getUtoolsNotification();
	if (!showNotification) {
		return;
	}

	try {
		showNotification({ title, body });
	} catch {
		// Notification failure should not affect main flow
		console.debug('Unable to show utools notification');
	}
};

export const summarizeOnEnter = (tasks: Task[]): void => {
	const rules = getTaskDateRules();
	const todayCount = tasks.filter((task) => task.status !== 'done' && isTaskDueToday(task, rules)).length;
	const overdueCount = tasks.filter((task) => isTaskOverdue(task, rules)).length;

	if (todayCount === 0 && overdueCount === 0) {
		return;
	}

	notify('简悦清单', `今天 ${todayCount} 项 · 已过期 ${overdueCount} 项`);
};

export const notifyService = { notify, summarizeOnEnter };
