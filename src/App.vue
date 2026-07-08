<script lang="ts" setup>
  import { useTheme } from './composables/useTheme';
  import { useWindowPreferences } from './composables/useWindowPreferences';
  useTheme();
  const { applyMainWindowHeight } = useWindowPreferences();

  import { onMounted } from 'vue';
  import StickyNoteWindow from './views/StickyNoteWindow/index.vue';
  import TodoHub from './views/TodoHub/index.vue';

  interface UtoolsLike {
    onPluginEnter?: (callback: () => void) => void;
  }

  const windowMode = new URLSearchParams(window.location.search).get('window');
  const hasStickyInit = (): boolean => {
    try {
      const raw = window.sessionStorage.getItem('jianyue.sticky.init');
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { type?: unknown };
      return parsed.type === 'sticky-note';
    } catch {
      return false;
    }
  };
  const isStickyWindow = windowMode === 'sticky-note' || hasStickyInit();
  onMounted(() => {
    const utools = (window as Window & { utools?: UtoolsLike }).utools;
    if (!utools) {
      return;
    }

    utools.onPluginEnter?.(() => {
      applyMainWindowHeight();
    });
  });
</script>

<template>
  <StickyNoteWindow v-if="isStickyWindow" />
  <TodoHub v-else />
</template>

<style scoped></style>