<script setup lang="ts">
import { computed, ref } from 'vue';
import { pomodoroService } from '../services/pomodoroService';
import { settingsService } from '../services/settingsService';
import type { Subtask, Task } from '../types/task';
import AppIcon from './AppIcon.vue';

const props = defineProps<{
  task: Task;
  subtask?: Subtask;
}>();

const emit = defineEmits<{
  (event: 'started'): void;
}>();

const error = ref('');
const session = ref(pomodoroService.getSession());

const isSameRunningTarget = computed(() => {
  if (session.value?.status !== 'running') return false;
  if (props.subtask) {
    return session.value.taskId === props.task.id && session.value.subtaskId === props.subtask.id;
  }
  return session.value.taskId === props.task.id && !session.value.subtaskId;
});

const isDisabled = computed(() => {
  if (props.task.status === 'done') return true;
  if (props.subtask?.completed) return true;
  return !!(session.value?.status === 'running' && !isSameRunningTarget.value);
});

const title = computed(() => {
  if (props.task.status === 'done') return '已完成任务不能启动番茄钟';
  if (props.subtask?.completed) return '已完成子任务不能启动番茄钟';
  if (isSameRunningTarget.value) return props.subtask ? '此子任务番茄钟进行中' : '此任务番茄钟进行中';
  if (session.value?.status === 'running') return '已有其他番茄钟进行中';
  return props.subtask ? '启动子任务番茄钟' : '启动番茄钟';
});

const handleStart = (): void => {
  if (isDisabled.value) return;
  try {
    error.value = '';
    if (props.subtask) {
      pomodoroService.startForSubtask(props.task, props.subtask, settingsService.getSettings().pomodoroMinutes);
    } else {
      pomodoroService.startForTask(props.task, settingsService.getSettings().pomodoroMinutes);
    }
    session.value = pomodoroService.getSession();
    emit('started');
  } catch (err) {
    error.value = err instanceof Error ? err.message : '番茄钟启动失败';
  }
};
</script>

<template>
  <button type="button" class="btn-icon pomodoro-start" :disabled="isDisabled" :title="error || title"
    :aria-label="title" @click.stop="handleStart">
    <AppIcon name="timer" :size="14" />
  </button>
</template>

<style scoped>
.pomodoro-start {
  color: var(--color-text-secondary);
}

.pomodoro-start:not(:disabled):hover {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}
</style>
