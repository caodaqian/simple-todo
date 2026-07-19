import { settingsService } from './settingsService';

interface UtoolsNotification {
	showNotification(body: string, clickFeatureCode?: string): void;
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
		showNotification(body ? `${title}：${body}` : title, 'todo');
	} catch {
		// Notification failure should not affect main flow
		console.debug('Unable to show utools notification');
	}
};

export const notifyService = { notify };
