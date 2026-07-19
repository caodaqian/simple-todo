<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { taskService } from '../services/taskService';
import { templateService } from '../services/templateService';
import type { TaskPriority, TaskTemplate } from '../types/task';
import AppIcon from './AppIcon.vue';

const props = defineProps<{
  modelValue: boolean;
  mode: 'select' | 'manage';
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'select', templateId: string): void;
}>();

const query = ref('');
const templates = ref<TaskTemplate[]>([]);
const editingTemplateId = ref<string | null>(null);
const templateName = ref('');
const templateTitle = ref('');
const templatePriority = ref<TaskPriority>('medium');
const templateGroup = ref('');
const templateTags = ref<string[]>([]);
const tagDraft = ref('');
const groupDraft = ref('');
const showTagSuggest = ref(false);
const showGroupSuggest = ref(false);
const templateDescription = ref('');
const editorError = ref('');

const refresh = (): void => {
  templates.value = templateService.list();
};

const filteredTemplates = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase();
  if (!keyword) return templates.value;
  return templates.value.filter((template) => [template.name, template.title, template.group, ...template.tags]
    .some((value) => value.toLocaleLowerCase().includes(keyword)));
});

const availableTags = computed(() => [...new Set([
  ...taskService.getAll().flatMap((task) => task.tags),
  ...templates.value.flatMap((template) => template.tags),
])].sort((a, b) => a.localeCompare(b, 'zh-CN')));

const availableGroups = computed(() => [...new Set([
  ...taskService.getAll().map((task) => task.group),
  ...templates.value.map((template) => template.group),
].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')));

const filteredTagSuggest = computed(() => {
  const keyword = tagDraft.value.trim().toLocaleLowerCase();
  return availableTags.value.filter((tag) => !templateTags.value.includes(tag) && (!keyword || tag.toLocaleLowerCase().includes(keyword))).slice(0, 6);
});

const filteredGroupSuggest = computed(() => {
  const keyword = groupDraft.value.trim().toLocaleLowerCase();
  return availableGroups.value.filter((group) => !keyword || group.toLocaleLowerCase().includes(keyword)).slice(0, 6);
});

const close = (): void => emit('update:modelValue', false);

const select = (templateId: string): void => {
  emit('select', templateId);
  close();
};

const remove = (template: TaskTemplate): void => {
  if (!window.confirm(`删除模板“${template.name}”？此操作不会删除已创建的任务。`)) return;
  templateService.delete(template.id);
  refresh();
};

const closeEditor = (): void => {
  editingTemplateId.value = null;
  editorError.value = '';
};

const beginCreate = (): void => {
  editingTemplateId.value = '';
  templateName.value = '';
  templateTitle.value = '';
  templatePriority.value = 'medium';
  templateGroup.value = '';
  templateTags.value = [];
  tagDraft.value = '';
  groupDraft.value = '';
  templateDescription.value = '';
  editorError.value = '';
};

const beginEdit = (template: TaskTemplate): void => {
  editingTemplateId.value = template.id;
  templateName.value = template.name;
  templateTitle.value = template.title;
  templatePriority.value = template.priority;
  templateGroup.value = template.group;
  templateTags.value = [...template.tags];
  tagDraft.value = '';
  groupDraft.value = '';
  templateDescription.value = template.description;
  editorError.value = '';
};

const addTag = (): void => {
  const tag = tagDraft.value.trim();
  if (tag && !templateTags.value.includes(tag)) templateTags.value.push(tag);
  tagDraft.value = '';
  showTagSuggest.value = false;
};

const removeTag = (tag: string): void => {
  templateTags.value = templateTags.value.filter((item) => item !== tag);
};

const commitGroup = (): void => {
  const group = groupDraft.value.trim();
  if (group) templateGroup.value = group;
  groupDraft.value = '';
  showGroupSuggest.value = false;
};

const saveTemplate = (): void => {
  const name = templateName.value.trim();
  if (!name) {
    editorError.value = '请填写模板名称';
    return;
  }
  const input = {
    name,
    title: templateTitle.value.trim() || name,
    priority: templatePriority.value,
    group: templateGroup.value.trim(),
    tags: [...templateTags.value],
    description: templateDescription.value,
  };
  if (editingTemplateId.value) {
    const updated = templateService.update(editingTemplateId.value, input);
    if (!updated) {
      editorError.value = '模板已被其他设备修改，请关闭后刷新重试';
      return;
    }
  } else {
    templateService.create(input);
  }
  refresh();
  closeEditor();
};

const duplicate = (template: TaskTemplate): void => {
  templateService.create({
    name: `${template.name} 副本`, title: template.title, priority: template.priority,
    tags: template.tags, group: template.group, description: template.description,
    childTasks: template.childTasks,
    ...(template.reminderOffset === undefined ? {} : { reminderOffset: template.reminderOffset }),
  });
  refresh();
};

const show = computed(() => props.modelValue);

const activate = (): void => {
  refresh();
};

onMounted(() => window.addEventListener('jianyue:templates-changed', refresh));
onBeforeUnmount(() => window.removeEventListener('jianyue:templates-changed', refresh));
watch(() => props.modelValue, (visible) => {
  if (visible) refresh();
});

defineExpose({ activate });
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="template-library-mask" @click.self="close">
      <section class="template-library" role="dialog" aria-modal="true" aria-label="任务模板">
        <header class="template-library__header">
          <div>
            <p class="template-library__eyebrow">可复用任务方案</p>
            <h2>{{ mode === 'select' ? '从模板创建' : '管理模板' }}</h2>
            <p>模板保存内容与步骤；日期请在本次创建时设置。</p>
          </div>
          <button type="button" class="btn btn-ghost btn-icon" aria-label="关闭模板库" @click="close">
            <AppIcon name="x" :size="18" />
          </button>
        </header>

        <div v-if="mode === 'manage'" class="template-library__toolbar">
          <button type="button" class="btn btn-primary" @click="beginCreate">
            <AppIcon name="plus" :size="16" /> 新建模板
          </button>
        </div>

        <label class="template-library__search">
          <AppIcon name="filter" :size="16" />
          <input v-model="query" type="search" placeholder="搜索模板、标签或分组" autofocus />
        </label>

        <div v-if="filteredTemplates.length" class="template-library__list">
          <article v-for="template in filteredTemplates" :key="template.id" class="template-card">
            <div class="template-card__main">
              <strong>{{ template.name }}</strong>
              <span>{{ template.title }}</span>
              <small>
                {{ template.childTasks.length }} 个步骤
                <template v-if="template.group"> · {{ template.group }}</template>
              </small>
            </div>
            <div class="template-card__actions">
              <button type="button" class="btn btn-primary" @click="select(template.id)">
                {{ mode === 'select' ? '使用模板' : '试用' }}
              </button>
              <button v-if="mode === 'manage'" type="button" class="btn btn-ghost btn-icon" :aria-label="`删除模板 ${template.name}`" @click="remove(template)">
                <AppIcon name="trash2" :size="16" />
              </button>
              <button v-if="mode === 'manage'" type="button" class="btn btn-ghost" @click="beginEdit(template)">编辑</button>
              <button v-if="mode === 'manage'" type="button" class="btn btn-ghost" @click="duplicate(template)">复制</button>
            </div>
          </article>
        </div>

        <div v-else class="template-library__empty">
          <AppIcon name="listTree" :size="28" />
          <strong>{{ query ? '没有匹配的模板' : '还没有任务模板' }}</strong>
          <p>先编辑一个主任务，再将它保存为模板；其直接子任务会一并保留。</p>
        </div>

        <div v-if="editingTemplateId !== null" class="template-editor-mask" @click.self="closeEditor">
          <form class="template-editor" @submit.prevent="saveTemplate">
            <h3>{{ editingTemplateId ? '编辑模板' : '新建模板' }}</h3>
            <label>模板名称<input v-model="templateName" maxlength="80" /></label>
            <label>任务标题（可选）<input v-model="templateTitle" maxlength="200" :placeholder="templateName || '留空时使用模板名称'" /></label>
            <div class="template-editor__row">
              <label>优先级<select v-model="templatePriority"><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="urgent">紧急</option></select></label>
              <label class="template-editor__suggest-field">分组
                <span v-if="templateGroup" class="template-editor__group-chip">{{ templateGroup }}<button type="button" aria-label="清除分组" @click="templateGroup = ''">×</button></span>
                <input v-else v-model="groupDraft" maxlength="80" placeholder="输入或选择分组" @focus="showGroupSuggest = true" @keydown.enter.prevent="commitGroup" @blur="commitGroup" />
                <ul v-if="showGroupSuggest && filteredGroupSuggest.length" class="template-editor__suggestions">
                  <li v-for="group in filteredGroupSuggest" :key="group"><button type="button" @mousedown.prevent="templateGroup = group; groupDraft = ''; showGroupSuggest = false">{{ group }}</button></li>
                </ul>
              </label>
            </div>
            <label class="template-editor__suggest-field">标签
              <span class="template-editor__tag-box">
                <span v-for="tag in templateTags" :key="tag" class="template-editor__tag-chip">#{{ tag }}<button type="button" :aria-label="`移除标签 ${tag}`" @click="removeTag(tag)">×</button></span>
                <input v-model="tagDraft" maxlength="80" placeholder="输入后按 Enter" @focus="showTagSuggest = true" @keydown.enter.prevent="addTag" @keydown.,.prevent="addTag" @blur="addTag" />
              </span>
              <ul v-if="showTagSuggest && filteredTagSuggest.length" class="template-editor__suggestions">
                <li v-for="tag in filteredTagSuggest" :key="tag"><button type="button" @mousedown.prevent="tagDraft = tag; addTag()">#{{ tag }}</button></li>
              </ul>
            </label>
            <label>描述<textarea v-model="templateDescription" rows="4" maxlength="5000" /></label>
            <p v-if="editorError" class="template-editor__error">{{ editorError }}</p>
            <footer><button type="button" class="btn btn-ghost" @click="closeEditor">取消</button><button type="submit" class="btn btn-primary">保存</button></footer>
          </form>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.template-library-mask { position: fixed; inset: 0; z-index: var(--z-modal); display: grid; place-items: center; padding: var(--space-5); background: var(--mask-medium); }
.template-library { width: min(640px, 100%); max-height: min(720px, 90vh); overflow: auto; padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); box-shadow: var(--shadow-lg); }
.template-library__header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
.template-library__header h2, .template-library__header p { margin: 0; }
.template-library__header p:last-child { margin-top: var(--space-1); color: var(--color-text-muted); font-size: var(--font-size-sm); }
.template-library__eyebrow { color: var(--color-accent); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); letter-spacing: .08em; text-transform: uppercase; }
.template-library__search { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-5) 0 var(--space-3); padding: 0 var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.template-library__toolbar { display: flex; justify-content: flex-end; margin-top: var(--space-3); }
.template-library__search input { width: 100%; min-width: 0; border: 0; outline: 0; padding: var(--space-3) 0; background: transparent; color: inherit; }
.template-library__list { display: grid; gap: var(--space-2); }
.template-card { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); }
.template-card__main { min-width: 0; display: grid; gap: 2px; }
.template-card__main span { overflow: hidden; color: var(--color-text-muted); text-overflow: ellipsis; white-space: nowrap; }
.template-card__main small { color: var(--color-text-muted); }
.template-card__actions { display: flex; gap: var(--space-2); flex-shrink: 0; }
.template-library__empty { display: grid; justify-items: center; gap: var(--space-2); padding: var(--space-8) var(--space-4); text-align: center; color: var(--color-text-muted); }
.template-library__empty p { max-width: 360px; margin: 0; font-size: var(--font-size-sm); }
.template-editor-mask { position: absolute; inset: 0; z-index: 1; display: grid; place-items: center; padding: var(--space-4); background: var(--mask-medium); }
.template-editor { width: min(480px, 100%); display: grid; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); box-shadow: var(--shadow-lg); }
.template-editor h3 { margin: 0; }
.template-editor label { display: grid; gap: var(--space-1); color: var(--color-text-muted); font-size: var(--font-size-sm); }
.template-editor input, .template-editor select, .template-editor textarea { width: 100%; border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-2); background: var(--color-bg); color: var(--color-text); font: inherit; }
.template-editor textarea { resize: vertical; }
.template-editor__row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
.template-editor__suggest-field { position: relative; }
.template-editor__tag-box { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); min-height: 40px; padding: var(--space-1); border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-bg); }
.template-editor__tag-box input { flex: 1 1 120px; min-width: 0; border: 0; padding: var(--space-1); outline: 0; }
.template-editor__tag-chip, .template-editor__group-chip { display: inline-flex; align-items: center; gap: 2px; padding: 2px var(--space-2); border-radius: var(--radius-full); background: var(--color-accent-soft); color: var(--color-accent); }
.template-editor__tag-chip button, .template-editor__group-chip button { padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.template-editor__suggestions { position: absolute; z-index: 2; top: calc(100% + 2px); left: 0; right: 0; margin: 0; padding: var(--space-1); list-style: none; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-bg-elevated); box-shadow: var(--shadow-md); }
.template-editor__suggestions button { width: 100%; border: 0; border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2); background: transparent; color: var(--color-text); text-align: left; cursor: pointer; }
.template-editor__suggestions button:hover { background: var(--color-bg-hover); }
.template-editor__error { margin: 0; color: var(--color-danger); font-size: var(--font-size-sm); }
.template-editor footer { display: flex; justify-content: flex-end; gap: var(--space-2); }
@media (max-width: 560px) { .template-library-mask { padding: var(--space-3); } .template-library { padding: var(--space-4); } .template-card { align-items: flex-start; flex-direction: column; } .template-card__actions { width: 100%; } .template-card__actions .btn-primary { flex: 1; } }
</style>
