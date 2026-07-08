<script setup lang="ts">
import { usePomodoroTimer } from '../composables/usePomodoroTimer';
import AppIcon from './AppIcon.vue';

const { session, remainingLabel, isRunning, stop } = usePomodoroTimer();
</script>

<template>
  <div v-if="session" class="pomodoro-pill" :class="{ 'pomodoro-pill--finished': !isRunning }">
    <AppIcon name="timer" :size="14" />
    <span class="pomodoro-pill__title">{{ session.taskTitle }}</span>
    <span class="pomodoro-pill__time">{{ isRunning ? remainingLabel : '已结束' }}</span>
    <button type="button" class="pomodoro-pill__stop" title="停止番茄钟" aria-label="停止番茄钟" @click="stop">
      <AppIcon name="square" :size="12" />
    </button>
  </div>
</template>

<style scoped>
.pomodoro-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 220px;
  height: 30px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  border: 1px solid color-mix(in srgb, var(--color-accent) 28%, transparent);
  font-size: var(--text-sm);
  flex-shrink: 0;
}

.pomodoro-pill--finished {
  background: var(--color-success-soft);
  color: var(--color-success);
  border-color: color-mix(in srgb, var(--color-success) 28%, transparent);
}

.pomodoro-pill__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pomodoro-pill__time {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  flex-shrink: 0;
}

.pomodoro-pill__stop {
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: currentColor;
  border-radius: var(--radius-full);
  -webkit-app-region: no-drag;
}

.pomodoro-pill__stop:hover {
  background: var(--color-bg-hover);
}
</style>
