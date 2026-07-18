import { getTaskEnd, getTaskStart, type Task, type TaskPriority } from '../types/task';

export type CalendarRangePosition = 'start' | 'middle' | 'end' | 'single';

export interface CalendarRangeSegment {
	task: Task;
	position: CalendarRangePosition;
	opensSegment: boolean;
	closesSegment: boolean;
	title?: string;
	startLabel?: string;
	endLabel?: string;
}

const priorityRank: Record<TaskPriority, number> = {
	urgent: 0,
	high: 1,
	medium: 2,
	low: 3,
};

const toDateKey = (timestamp: number): string => {
	const date = new Date(timestamp);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const formatTime = (timestamp: number): string => {
	const date = new Date(timestamp);
	return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const compareTasks = (left: Task, right: Task): number => {
	const priorityDifference = priorityRank[left.priority] - priorityRank[right.priority];
	if (priorityDifference !== 0) return priorityDifference;
	const startDifference = (getTaskStart(left) ?? 0) - (getTaskStart(right) ?? 0);
	if (startDifference !== 0) return startDifference;
	return left.title.localeCompare(right.title, 'zh-CN');
};

export const buildCalendarRangeSegments = (
	tasks: Task[],
	visibleDateKeys: string[],
): Map<string, CalendarRangeSegment[]> => {
	const segmentsByDate = new Map(visibleDateKeys.map((key) => [key, [] as CalendarRangeSegment[]]));
	const indexedKeys = new Map(visibleDateKeys.map((key, index) => [key, index]));

	for (const task of [...tasks].sort(compareTasks)) {
		const start = getTaskStart(task);
		const end = getTaskEnd(task);
		if (end === undefined) continue;
		const rangeStart = start ?? end;

		const startKey = toDateKey(Math.min(rangeStart, end));
		const endKey = toDateKey(Math.max(rangeStart, end));
		const coveredKeys = visibleDateKeys.filter((key) => key >= startKey && key <= endKey);

		for (const key of coveredKeys) {
			const index = indexedKeys.get(key)!;
			const isStart = key === startKey;
			const isEnd = key === endKey;
			const isSingle = isStart && isEnd;
			const position: CalendarRangePosition = isSingle ? 'single' : isStart ? 'start' : isEnd ? 'end' : 'middle';
			const isFirstVisible = key === coveredKeys[0];
			const isLastVisible = key === coveredKeys[coveredKeys.length - 1];
			const opensSegment = isFirstVisible || index % 7 === 0;
			const closesSegment = isLastVisible || index % 7 === 6;
			const endLabel = isEnd ? (task.allDay ? '全天' : `截止 ${formatTime(Math.max(rangeStart, end))}`) : undefined;

			segmentsByDate.get(key)!.push({
				task,
				position,
				opensSegment,
				closesSegment,
				...(isStart && !isSingle ? { title: task.title } : {}),
				...(isStart && !isSingle && !task.allDay ? { startLabel: formatTime(Math.min(rangeStart, end)) } : {}),
				...(endLabel ? { endLabel } : {}),
			});
		}
	}

	return segmentsByDate;
};
