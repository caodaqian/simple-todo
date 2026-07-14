<script setup lang="ts">
import type { BlockedCompletionInfo } from '../services/taskWorkflowService';
import AppIcon from './AppIcon.vue';

defineProps<{
  info: BlockedCompletionInfo;
}>();

const emit = defineEmits<{
  (event: 'cancel'): void;
  (event: 'view-children'): void;
}>();
</script>

<template>
  <Teleport to="body">
    <div class="completion-blocked-mask" @click.self="emit('cancel')">
      <dialog open class="completion-blocked-dialog" aria-label="任务无法完成">
        <header class="completion-blocked-header">
          <span class="completion-blocked-icon" aria-hidden="true">
            <AppIcon name="info" :size="18" />
          </span>
          <h2>暂时无法完成任务</h2>
        </header>

        <p class="completion-blocked-body">
          “{{ info.parent.title }}”仍有未完成子任务。
        </p>

        <div class="completion-blocked-stats">
          <span v-if="info.doingCount > 0" class="completion-blocked-stat">进行中 {{ info.doingCount }} 项</span>
          <span v-if="info.doingCount > 0 && info.todoCount > 0" class="completion-blocked-dot" aria-hidden="true">·</span>
          <span v-if="info.todoCount > 0" class="completion-blocked-stat">待办 {{ info.todoCount }} 项</span>
        </div>

        <footer class="completion-blocked-footer">
          <button type="button" class="btn btn-ghost" @click="emit('cancel')">取消</button>
          <button type="button" class="btn btn-primary" @click="emit('view-children')">查看未完成子任务</button>
        </footer>
      </dialog>
    </div>
  </Teleport>
</template>

<style scoped>
  .completion-blocked-mask {
    position: fixed;
    inset: 0;
    background: var(--mask-medium);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-dialog);
  }

  .completion-blocked-dialog {
    width: min(360px, calc(100vw - var(--space-6)));
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-default);
    background: var(--color-bg-panel);
    color: var(--color-text-primary);
    padding: var(--space-4);
    box-shadow: var(--shadow-lg);
  }

  .completion-blocked-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .completion-blocked-header h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  .completion-blocked-icon {
    display: inline-flex;
    color: var(--color-accent);
  }

  .completion-blocked-body {
    margin: 0 0 var(--space-2);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .completion-blocked-stats {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-bottom: var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .completion-blocked-dot {
    opacity: 0.6;
  }

  .completion-blocked-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
