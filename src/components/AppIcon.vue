<script setup lang="ts">
import {
    AlarmClock,
    Archive,
    ArchiveRestore,
    Bookmark,
    Calendar,
    CalendarClock,
    Check,
    CheckCircle2,
    ChevronDown, ChevronLeft, ChevronRight,
    Circle, CircleDot,
    Clock,
    Filter,
    Flag,
    Folder,
    Grid2x2,
    Hash,
    Inbox,
    Info,
    LayoutGrid,
    List,
    ListTree,
    MoreHorizontal,
    Pencil,
    Pin,
    Play,
    Plus,
    RotateCcw,
    Settings,
    Square,
    Star,
    Sun,
    Timer,
    Trash2,
    X,
} from 'lucide-vue-next';
import { computed, type Component } from 'vue';

defineOptions({ name: 'AppIcon', inheritAttrs: false });

const props = withDefaults(defineProps<{
  name: string;
  size?: number;
  strokeWidth?: number;
  color?: string;
}>(), {
  size: 16,
  strokeWidth: 1.75,
});

const ICON_MAP: Record<string, Component> = {
  list: List,
  layoutGrid: LayoutGrid,
  grid2x2: Grid2x2,
  calendar: Calendar,
  sun: Sun,
  clock: Clock,
  alarmClock: AlarmClock,
  archive: Archive,
  archiveRestore: ArchiveRestore,
  inbox: Inbox,
  check: Check,
  circle: Circle,
  circleDot: CircleDot,
  checkCircle2: CheckCircle2,
  play: Play,
  plus: Plus,
  settings: Settings,
  x: X,
  trash2: Trash2,
  pencil: Pencil,
  pin: Pin,
  moreHorizontal: MoreHorizontal,
  hash: Hash,
  folder: Folder,
  bookmark: Bookmark,
  calendarClock: CalendarClock,
  listTree: ListTree,
  flag: Flag,
  info: Info,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  rotateCcw: RotateCcw,
  star: Star,
  filter: Filter,
  timer: Timer,
  square: Square,
};

const warned = new Set<string>();

const iconComp = computed<Component>(() => {
  const c = ICON_MAP[props.name];
  if (!c) {
    if (!warned.has(props.name)) {
      warned.add(props.name);
      // eslint-disable-next-line no-console
      console.warn(`[AppIcon] Unknown icon "${props.name}", falling back to Circle`);
    }
    return Circle;
  }
  return c;
});
</script>

<template>
  <component
    :is="iconComp"
    :size="size"
    :stroke-width="strokeWidth"
    :color="color"
    v-bind="$attrs"
  />
</template>
