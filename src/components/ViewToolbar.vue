<script setup lang="ts">
import type { Slot } from 'vue';

defineSlots<{
  left?: Slot;
  actions?: Slot;
}>();
</script>

<template>
  <div class="view-toolbar">
    <div class="view-toolbar__left">
      <slot name="left" />
    </div>
    <div class="view-toolbar__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.view-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 44px;
  padding: var(--space-2) var(--space-5);
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-bg-base);
}
.view-toolbar__left {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.view-toolbar__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}
</style>
