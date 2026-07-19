import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../types/settings';
import { notifyService } from './notifyService';
import { settingsService } from './settingsService';

class MockDbStorage {
	private store = new Map<string, string>();

	getItem<T = unknown>(key: string): T {
		return (this.store.get(key) ?? null) as T;
	}

	setItem(key: string, value: string): void {
		this.store.set(key, value);
	}

	removeItem(key: string): void {
		this.store.delete(key);
	}

	clear(): void {
		this.store.clear();
	}
}

describe('notifyService.notify', () => {
	const dbStorage = new MockDbStorage();
	const showNotification = vi.fn();

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-22T10:00:00+08:00'));
		dbStorage.clear();
		showNotification.mockReset();
		window.utools = {
			...(window.utools ?? {}),
			dbStorage,
			showNotification,
		} as unknown as typeof window.utools;
		settingsService.saveSettings({ ...DEFAULT_SETTINGS, notifyEnabled: true });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('uses official uTools notification signature with click feature code', () => {
		notifyService.notify('任务已完成', '写测试');
		expect(showNotification).toHaveBeenCalledTimes(1);
		expect(showNotification).toHaveBeenCalledWith('任务已完成：写测试', 'todo');
	});

	it('does not throw when showNotification fails', () => {
		showNotification.mockImplementation(() => {
			throw new Error('notification failed');
		});
		expect(() => notifyService.notify('任务已完成', '写测试')).not.toThrow();
	});

	it('respects notifyEnabled = false', () => {
		settingsService.saveSettings({ ...DEFAULT_SETTINGS, notifyEnabled: false });
		notifyService.notify('任务已完成', '写测试');
		expect(showNotification).not.toHaveBeenCalled();
	});
});
