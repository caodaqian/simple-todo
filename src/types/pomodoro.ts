export type PomodoroStatus = 'running' | 'finished';

export interface PomodoroSession {
	id: string;
	taskId: string;
	taskTitle: string;
	subtaskId?: string;
	subtaskTitle?: string;
	startedAt: number;
	durationMinutes: number;
	endsAt: number;
	status: PomodoroStatus;
	notifiedAt?: number;
}
