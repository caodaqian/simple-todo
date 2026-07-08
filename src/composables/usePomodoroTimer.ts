import { computed, onUnmounted, ref, type ComputedRef, type Ref } from 'vue';
import { notifyService } from '../services/notifyService';
import { pomodoroService } from '../services/pomodoroService';
import type { PomodoroSession } from '../types/pomodoro';

const POMODORO_TICK_MS = 1_000;

export const notifyExpiredPomodoro = (now = Date.now()): boolean => {
	const expired = pomodoroService.markExpired(now);
	if (!expired) return false;
	const title = expired.subtaskTitle ? `${expired.taskTitle} / ${expired.subtaskTitle}` : expired.taskTitle;
	notifyService.notify('番茄钟结束', title);
	return true;
};

export const formatRemainingTime = (remainingMs: number): string => {
	const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const usePomodoroTimer = (): {
	session: Ref<PomodoroSession | null>;
	remainingMs: ComputedRef<number>;
	remainingLabel: ComputedRef<string>;
	isRunning: ComputedRef<boolean>;
	refresh: () => void;
	stop: () => void;
} => {
	const session = ref<PomodoroSession | null>(pomodoroService.getSession());
	const now = ref(Date.now());

	const refresh = (): void => {
		now.value = Date.now();
		notifyExpiredPomodoro(now.value);
		session.value = pomodoroService.getSession();
	};

	const stop = (): void => {
		pomodoroService.stop();
		refresh();
	};

	const remainingMs = computed(() => {
		return session.value?.status === 'running'
			? pomodoroService.getRemainingMs(session.value, now.value)
			: 0;
	});
	const remainingLabel = computed(() => formatRemainingTime(remainingMs.value));
	const isRunning = computed(() => session.value?.status === 'running' && remainingMs.value > 0);

	refresh();
	const timer = window.setInterval(refresh, POMODORO_TICK_MS);
	onUnmounted(() => {
		window.clearInterval(timer);
	});

	return { session, remainingMs, remainingLabel, isRunning, refresh, stop };
};
