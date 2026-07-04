<script lang="ts" setup>
  import { useTheme } from './composables/useTheme';
  useTheme();

  import { onMounted, ref } from 'vue';
  import TodoHub from './views/TodoHub/index.vue';

  interface UtoolsAction {
    code?: string;
  }

  interface UtoolsLike {
    onPluginEnter?: (callback: (action: UtoolsAction) => void) => void;
    onPluginOut?: (callback: () => void) => void;
  }

  const route = ref('todo');
  const enterAction = ref<UtoolsAction>({});

  onMounted(() => {
    const utools = (window as Window & { utools?: UtoolsLike }).utools;
    if (!utools) {
      return;
    }

    utools.onPluginEnter?.((action) => {
      route.value = action.code ?? 'todo';
      enterAction.value = action;
      console.log('onPluginEnter', action);
      console.log('route', route.value);
    });

    utools.onPluginOut?.(() => {
      route.value = '';
    });
  });
</script>

<template>
  <TodoHub></TodoHub>
</template>

<style scoped></style>