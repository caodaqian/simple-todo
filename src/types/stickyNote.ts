import type { SavedFilterView, TodoView } from './settings';
import type { Task, TaskSearchFilter, TaskSortConfig } from './task';

export type StickyNoteSourceKind = 'current' | 'saved';

export interface StickyNoteSource {
	sourceKind: StickyNoteSourceKind;
	title: string;
	view: TodoView;
	section: string;
	filter: TaskSearchFilter;
	sort?: TaskSortConfig;
	savedViewId?: string;
	updatedAt: number;
}

export interface StickyTaskItem {
	task: Task;
	depth: number;
	parentTitle?: string;
	children: StickyTaskItem[];
	subtaskTotal: number;
	subtaskCompleted: number;
}

export interface StickyTaskGroup {
	key: string;
	title: string;
	tasks: StickyTaskItem[];
}

export type StickyCurrentSourceInput = Omit<StickyNoteSource, 'sourceKind' | 'updatedAt' | 'savedViewId'>;

export type StickySavedView = SavedFilterView;
