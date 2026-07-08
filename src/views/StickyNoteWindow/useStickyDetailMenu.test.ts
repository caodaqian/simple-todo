import { describe, expect, it, vi } from 'vitest';
import { useStickyDetailMenu } from './useStickyDetailMenu';

describe('useStickyDetailMenu', () => {
	it('opens details from the context menu and prevents the browser menu', () => {
		const menu = useStickyDetailMenu();
		const preventDefault = vi.fn();

		menu.openFromContextMenu({ preventDefault } as unknown as MouseEvent, 'task-1');

		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(menu.activeTaskId.value).toBe('task-1');
	});

	it('closes details with Escape only', () => {
		const menu = useStickyDetailMenu();
		menu.open('task-1');

		menu.closeOnEscape({ key: 'Enter' } as KeyboardEvent);
		expect(menu.activeTaskId.value).toBe('task-1');

		menu.closeOnEscape({ key: 'Escape' } as KeyboardEvent);
		expect(menu.activeTaskId.value).toBeNull();
	});

	it('closes the active detail card explicitly', () => {
		const menu = useStickyDetailMenu();
		menu.open('task-1');

		menu.close();

		expect(menu.activeTaskId.value).toBeNull();
	});
});
