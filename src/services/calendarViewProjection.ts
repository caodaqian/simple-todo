import { getTaskEnd, getTaskStart, type Task } from '../types/task';

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

const toDateKey = (timestamp: number): string => {
	const date = new Date(timestamp);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const formatTime = (timestamp: number): string => {
	const date = new Date(timestamp);
	return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

export const buildCalendarRangeSegments = (
	tasks: Task[],
	visibleDateKeys: string[],
): Map<string, CalendarRangeSegment[]> => {
	const segmentsByDate = new Map(visibleDateKeys.map((key) => [key, [] as CalendarRangeSegment[]]));
	const indexedKeys = new Map(visibleDateKeys.map((key, index) => [key, index]));

	for (const task of tasks) {
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
