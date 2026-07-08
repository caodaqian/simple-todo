import type { PomodoroSession, PomodoroStatus } from '../types/pomodoro';
import type { Subtask, Task } from '../types/task';
import { STORAGE_KEYS } from './storageKeys';

interface UtoolsDbStorage {
	getItem(key: string): unknown;
	setItem(key: string, value: string): unknown;
	removeItem(key: string): unknown;
}

interface UtoolsLike {
	dbStorage?: UtoolsDbStorage;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === 'object' && value !== null;
};

const isTimestamp = (value: unknown): value is number => {
	return typeof value === 'number' && Number.isFinite(value);
};

const isPomodoroStatus = (value: unknown): value is PomodoroStatus => {
	return value === 'running' || value === 'finished';
};

const toPomodoroSession = (value: unknown): PomodoroSession | null => {
	if (!isObjectRecord(value)) return null;
	const { id, taskId, taskTitle, subtaskId, subtaskTitle, startedAt, durationMinutes, endsAt, status, notifiedAt } = value;
	if (typeof id !== 'string' || id.length === 0) return null;
	if (typeof taskId !== 'string' || taskId.length === 0) return null;
	if (typeof taskTitle !== 'string') return null;
	if (subtaskId !== undefined && typeof subtaskId !== 'string') return null;
	if (subtaskTitle !== undefined && typeof subtaskTitle !== 'string') return null;
	if (!isTimestamp(startedAt)) return null;
	if (typeof durationMinutes !== 'number' || !Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
	if (!isTimestamp(endsAt)) return null;
	if (!isPomodoroStatus(status)) return null;
	if (notifiedAt !== undefined && !isTimestamp(notifiedAt)) return null;

	const session: PomodoroSession = {
		id,
		taskId,
		taskTitle,
		startedAt,
		durationMinutes,
		endsAt,
		status,
	};
	if (notifiedAt !== undefined) session.notifiedAt = notifiedAt;
	if (subtaskId !== undefined) session.subtaskId = subtaskId;
	if (subtaskTitle !== undefined) session.subtaskTitle = subtaskTitle;
	return session;
};

const generateSessionId = (): string => {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 10);
	return `pomodoro-${timestamp}-${random}`;
};

class PomodoroService {
	private readonly storageKey = STORAGE_KEYS.POMODORO;
	private readonly historyStorageKey = STORAGE_KEYS.POMODORO_HISTORY;

	private memorySession: PomodoroSession | null = null;
	private memoryHistory: PomodoroSession[] = [];

	getSession(): PomodoroSession | null {
		const stored = this.readFromStorage();
		if (stored.kind === 'unavailable') {
			return this.memorySession ? { ...this.memorySession } : null;
		}
		if (stored.raw === null) {
			this.memorySession = null;
			return null;
		}

		try {
			const session = toPomodoroSession(JSON.parse(stored.raw));
			this.memorySession = session;
			return session ? { ...session } : null;
		} catch {
			this.memorySession = null;
			return null;
		}
	}

	startForTask(task: Pick<Task, 'id' | 'title'>, durationMinutes: number, now = Date.now()): PomodoroSession {
		return this.startSession({ taskId: task.id, taskTitle: task.title }, durationMinutes, now);
	}

	startForSubtask(task: Pick<Task, 'id' | 'title'>, subtask: Pick<Subtask, 'id' | 'title'>, durationMinutes: number, now = Date.now()): PomodoroSession {
		return this.startSession({
			taskId: task.id,
			taskTitle: task.title,
			subtaskId: subtask.id,
			subtaskTitle: subtask.title,
		}, durationMinutes, now);
	}

	private startSession(target: { taskId: string; taskTitle: string; subtaskId?: string; subtaskTitle?: string }, durationMinutes: number, now: number): PomodoroSession {
		const current = this.getSession();
		if (current?.status === 'running' && current.endsAt > now) {
			throw new Error('已有番茄钟进行中');
		}

		const minutes = this.normalizeDuration(durationMinutes);
		const session: PomodoroSession = {
			id: generateSessionId(),
			taskId: target.taskId,
			taskTitle: target.taskTitle,
			startedAt: now,
			durationMinutes: minutes,
			endsAt: now + minutes * 60 * 1000,
			status: 'running',
		};
		if (target.subtaskId !== undefined) session.subtaskId = target.subtaskId;
		if (target.subtaskTitle !== undefined) session.subtaskTitle = target.subtaskTitle;
		this.saveSession(session);
		return { ...session };
	}

	stop(): void {
		this.memorySession = null;
		const dbStorage = this.getDbStorage();
		if (!dbStorage) return;
		try {
			dbStorage.removeItem(this.storageKey);
		} catch {
			// Ignore storage cleanup failures.
		}
	}

	getRemainingMs(session: Pick<PomodoroSession, 'endsAt'>, now = Date.now()): number {
		return Math.max(0, session.endsAt - now);
	}

	getHistory(): PomodoroSession[] {
		const stored = this.readRaw(this.historyStorageKey);
		if (stored.kind === 'unavailable') {
			return this.memoryHistory.map((session) => ({ ...session }));
		}
		if (stored.raw === null) {
			this.memoryHistory = [];
			return [];
		}

		try {
			const parsed = JSON.parse(stored.raw);
			if (!Array.isArray(parsed)) {
				this.memoryHistory = [];
				return [];
			}
			const history = parsed
				.map(toPomodoroSession)
				.filter((session): session is PomodoroSession => session !== null && session.status === 'finished');
			this.memoryHistory = history;
			return history.map((session) => ({ ...session }));
		} catch {
			this.memoryHistory = [];
			return [];
		}
	}

	markExpired(now = Date.now()): PomodoroSession | null {
		const session = this.getSession();
		if (!session || session.status !== 'running' || session.endsAt > now) {
			return null;
		}

		const expired: PomodoroSession = {
			...session,
			status: 'finished',
			notifiedAt: now,
		};
		this.saveSession(expired);
		this.appendHistory(expired);
		return { ...expired };
	}

	private normalizeDuration(value: number): number {
		if (!Number.isFinite(value) || value <= 0) {
			throw new Error('番茄钟时长必须为正数');
		}
		return Math.trunc(value);
	}

	private saveSession(session: PomodoroSession): void {
		this.memorySession = { ...session };
		const dbStorage = this.getDbStorage();
		if (!dbStorage) return;
		try {
			dbStorage.setItem(this.storageKey, JSON.stringify(session));
		} catch {
			// Gracefully keep memory state when dbStorage fails.
		}
	}

	private appendHistory(session: PomodoroSession): void {
		const history = this.getHistory();
		if (history.some((item) => item.id === session.id)) return;
		const next = [...history, { ...session }].slice(-200);
		this.memoryHistory = next.map((item) => ({ ...item }));
		const dbStorage = this.getDbStorage();
		if (!dbStorage) return;
		try {
			dbStorage.setItem(this.historyStorageKey, JSON.stringify(next));
		} catch {
			// Keep memory history when dbStorage fails.
		}
	}

	private getDbStorage(): UtoolsDbStorage | null {
		try {
			const maybeWindow = window as Window & { utools?: UtoolsLike };
			return maybeWindow.utools?.dbStorage ?? null;
		} catch {
			return null;
		}
	}

	private readFromStorage(): { kind: 'unavailable' } | { kind: 'available'; raw: string | null } {
		return this.readRaw(this.storageKey);
	}

	private readRaw(key: string): { kind: 'unavailable' } | { kind: 'available'; raw: string | null } {
		const dbStorage = this.getDbStorage();
		if (!dbStorage) return { kind: 'unavailable' };
		try {
			const value = dbStorage.getItem(key);
			return { kind: 'available', raw: typeof value === 'string' ? value : null };
		} catch {
			return { kind: 'available', raw: null };
		}
	}
}

export const pomodoroService = new PomodoroService();
