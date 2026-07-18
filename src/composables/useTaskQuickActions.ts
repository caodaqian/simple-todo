import { taskService } from '../services/taskService';
import type { Task, TaskPriority, TaskStatus } from '../types/task';
import { useCompletionBlockedModal } from './useCompletionBlockedModal';

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
	todo: 'doing',
	doing: 'done',
	done: 'todo',
};

export const getNextTaskStatus = (status: TaskStatus): TaskStatus => NEXT_STATUS[status];

export function useTaskQuickActions(refresh: () => void): {
	cycleStatus: (task: Task) => Task | null;
	setStatus: (task: Task, status: TaskStatus) => Task | null;
	setPriority: (task: Task, priority: TaskPriority) => Task | null;
	toggleArchive: (task: Task) => Task | null;
	blockedInfo: ReturnType<typeof useCompletionBlockedModal>['blockedInfo'];
	dismissBlockedModal: ReturnType<typeof useCompletionBlockedModal>['dismissBlockedModal'];
} {
	const { blockedInfo, guardedChangeStatus, dismissBlockedModal } = useCompletionBlockedModal();

	const setStatus = (task: Task, status: TaskStatus): Task | null => {
		const updated = guardedChangeStatus(task.id, status);
		if (updated) refresh();
		return updated;
	};

	const cycleStatus = (task: Task): Task | null => setStatus(task, getNextTaskStatus(task.status));

	const setPriority = (task: Task, priority: TaskPriority): Task | null => {
		const updated = taskService.update(task.id, { priority });
		if (updated) refresh();
		return updated;
	};

	const toggleArchive = (task: Task): Task | null => {
		const updated = task.archivedAt === undefined
			? taskService.archive(task.id)
			: taskService.unarchive(task.id);
		if (updated) refresh();
		return updated;
	};

	return {
		cycleStatus,
		setStatus,
		setPriority,
		toggleArchive,
		blockedInfo,
		dismissBlockedModal,
	};
}
