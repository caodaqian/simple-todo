import { beforeEach, describe, expect, it } from 'vitest';
import type { SavedFilterView } from '../types/settings';
import { stickyNoteService } from './stickyNoteService';

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

describe('stickyNoteService', () => {
	const dbStorage = new MockDbStorage();

	beforeEach(() => {
		dbStorage.clear();
		window.utools = { ...(window.utools ?? {}), dbStorage } as typeof window.utools;
	});

	it('saves and reads current view source with filter and sort', () => {
		const source = stickyNoteService.buildSourceFromCurrent({
			title: '今天',
			view: 'kanban',
			section: 'today',
			filter: { status: ['todo', 'doing'], tags: ['work'] },
			sort: { field: 'priority', order: 'desc' },
		});

		stickyNoteService.saveSource(source);
		const restored = stickyNoteService.getSource();

		expect(restored.title).toBe('今天');
		expect(restored.view).toBe('kanban');
		expect(restored.filter.tags).toEqual(['work']);
		expect(restored.sort).toEqual({ field: 'priority', order: 'desc' });
	});

	it('builds source from saved view', () => {
		const savedView: SavedFilterView = {
			id: 'view-1',
			name: '前端看板',
			view: 'kanban',
			section: 'tag:frontend',
			filter: { tags: ['frontend'] },
			sort: { field: 'updatedAt', order: 'desc' },
		};

		const source = stickyNoteService.buildSourceFromSaved(savedView);

		expect(source.sourceKind).toBe('saved');
		expect(source.savedViewId).toBe('view-1');
		expect(source.title).toBe('前端看板');
		expect(source.filter.tags).toEqual(['frontend']);
	});

	it('returns default source for invalid stored JSON', () => {
		dbStorage.setItem('jianyue.stickyNote', '{bad json');
		expect(stickyNoteService.getSource().sourceKind).toBe('current');
		expect(stickyNoteService.getSource().view).toBe('list');
	});
});
