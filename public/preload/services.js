const fs = require('node:fs')
const path = require('node:path')
let ipcRenderer = null
try {
  ipcRenderer = require('electron').ipcRenderer
} catch {
  ipcRenderer = null
}
const {
  STORAGE_KEY,
  TEMPLATES_STORAGE_KEY,
  readTasksFromDb: readTasksFromDbPure,
  writeTasksToDb: writeTasksToDbPure,
  createTaskHandler,
  updateTaskHandler,
  deleteTaskHandler,
  searchTasksHandler,
  taskOverviewHandler,
  getTaskHandler,
  bulkUpdateHandler,
  createTemplateHandler,
  listTemplatesHandler,
  updateTemplateHandler,
  deleteTemplateHandler,
  applyTemplateHandler,
  snoozeReminderHandler,
  acknowledgeReminderHandler,
  listDueRemindersHandler,
  getReviewHandler,
  suggestOrganizationHandler,
} = require('./toolHandlers')
const { fetchPageTitle } = require('./linkTitle')
const { createWebhookCredentialStore } = require('./webhookCredentials')
const webhookClient = require('./webhookClient')

const webhookCredentialStore = createWebhookCredentialStore(window.utools && window.utools.dbCryptoStorage)

// ── 原生 db 文档适配 ──────────────────────────────────────────────────
// 任务与模板一实体一文档，避免 dbStorage 单个数组文档的大小和同步冲突问题。
const DOCUMENT_COLLECTIONS = {
  [STORAGE_KEY]: { prefix: 'jianyue/task/' },
  [TEMPLATES_STORAGE_KEY]: { prefix: 'jianyue/template/' },
}

function nativeDb() {
  const candidate = window.utools && window.utools.db
  return candidate && typeof candidate.get === 'function' && typeof candidate.put === 'function' && typeof candidate.remove === 'function' && typeof candidate.allDocs === 'function'
    ? candidate
    : null
}

function nativeDocuments(store, prefix) {
  const documents = store.allDocs(prefix)
  return Array.isArray(documents) ? documents.filter(function (document) { return document && typeof document._id === 'string' && document._id.indexOf(prefix) === 0 }) : []
}

function ensureNativeMigration(store, storage, key, collection) {
  const existing = nativeDocuments(store, collection.prefix)
  if (existing.length) return existing
  const raw = storage.getItem(key)
  if (typeof raw !== 'string') return existing
  let legacy
  try { legacy = JSON.parse(raw) } catch { return existing }
  if (!Array.isArray(legacy)) return existing
  legacy.forEach(function (entity) {
    if (!entity || typeof entity.id !== 'string' || !entity.id) return
    const result = store.put({ _id: collection.prefix + entity.id, data: entity })
    if (!result || result.ok !== true) throw new Error('迁移数据失败: ' + (result && (result.message || result.name) || 'unknown'))
  })
  if (typeof storage.removeItem === 'function') storage.removeItem(key)
  return nativeDocuments(store, collection.prefix)
}

function readNativeCollection(store, storage, key, collection) {
  return ensureNativeMigration(store, storage, key, collection).map(function (document) { return document.data }).filter(function (entity) {
    return entity && typeof entity.id === 'string'
  })
}

function writeNativeCollection(store, storage, key, collection, value) {
  let entities
  try { entities = JSON.parse(value) } catch { throw new Error('写入数据失败：JSON 格式无效') }
  if (!Array.isArray(entities)) throw new Error('写入数据失败：必须为数组')
  const existing = new Map(nativeDocuments(store, collection.prefix).map(function (document) { return [document._id, document] }))
  const expectedIds = new Set()
  entities.forEach(function (entity) {
    if (!entity || typeof entity.id !== 'string' || !entity.id) throw new Error('写入数据失败：实体缺少 id')
    const id = collection.prefix + entity.id
    expectedIds.add(id)
    const current = existing.get(id)
    if (current && JSON.stringify(current.data) === JSON.stringify(entity)) return
    const result = store.put(Object.assign({ _id: id, data: entity }, current && current._rev ? { _rev: current._rev } : {}))
    if (!result || result.ok !== true) throw new Error('写入数据失败: ' + (result && (result.message || result.name) || 'unknown'))
  })
  existing.forEach(function (document, id) {
    if (expectedIds.has(id)) return
    const result = store.remove({ _id: document._id, _rev: document._rev })
    if (!result || result.ok !== true) throw new Error('删除数据失败: ' + (result && (result.message || result.name) || 'unknown'))
  })
  if (typeof storage.removeItem === 'function') storage.removeItem(key)
}

function db() {
  const storage = window.utools.dbStorage
  const store = nativeDb()
  return {
    getItem(key) {
      const collection = DOCUMENT_COLLECTIONS[key]
      return store && collection ? JSON.stringify(readNativeCollection(store, storage, key, collection)) : storage.getItem(key)
    },
    setItem(key, value) {
      const collection = DOCUMENT_COLLECTIONS[key]
      if (store && collection) writeNativeCollection(store, storage, key, collection, value)
      else storage.setItem(key, value)
    },
  }
}

function readTasksFromDb() {
  return readTasksFromDbPure(db())
}

function writeTasksToDb(tasks) {
  return writeTasksToDbPure(db(), tasks)
}

// Notify renderer that task store changed so it can refresh.
function notifyTasksChanged() {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('jianyue:tasks-changed'))
    }
  } catch {
    /* ignore — notification is best-effort */
  }
}

function notifyTemplatesChanged() {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('jianyue:templates-changed'))
    }
  } catch {
    /* ignore — notification is best-effort */
  }
}

if (ipcRenderer) {
  ipcRenderer.on('jianyue:tasks-changed', function () {
    notifyTasksChanged()
  })
}

// Wrap a write-tool so it notifies the renderer on success.
function withNotify(handler, notifyChanged) {
  return async function (params) {
    const result = handler(db(), params)
    const notifier = notifyChanged || notifyTasksChanged
    notifier()
    return result
  }
}

// ── window.services (file/node capabilities) ─────────────────────────
window.services = {

  webhooks: {
    async getStatuses() {
      return ['feishu', 'dingtalk'].map(function (platform) {
        return webhookCredentialStore.getStatus(platform)
      })
    },
    async saveCredentials(platform, input) {
      return webhookCredentialStore.save(platform, input)
    },
    async clearCredentials(platform) {
      webhookCredentialStore.clear(platform)
    },
    async testCredentials(platform) {
      const credentials = webhookCredentialStore.read(platform)
      if (!credentials) return { ok: false, errorCode: 'invalid_credentials' }
      return webhookClient.sendWebhook(platform, credentials, {
        title: '简悦清单',
        text: '简悦清单机器人通知测试',
      })
    },
  },

  // 获取安全外部网页的 <title>，失败时返回空字符串
  fetchPageTitle,

  // 读文件
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  // 文本写入到下载目录
  writeTextFile(text) {
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
  writeImageFile(base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.' + matchs[1])
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  },
  // 导出所有任务为 JSON 文件
  exportTasks() {
    const tasks = readTasksFromDb()
    const filePath = path.join(window.utools.getPath('downloads'), 'jianyue-tasks-' + Date.now() + '.json')
    fs.writeFileSync(filePath, JSON.stringify(tasks, null, 2), { encoding: 'utf-8' })
    return { filePath, count: tasks.length }
  },
  // 从 JSON 文件导入任务
  importTasks(filePath) {
    const raw = fs.readFileSync(filePath, { encoding: 'utf-8' })
    const imported = JSON.parse(raw)
    if (!Array.isArray(imported)) {
      throw new Error('导入文件格式错误：期望 JSON 数组')
    }
    const existing = readTasksFromDb()
    const existingIds = new Set(existing.map(function (t) { return t.id }))
    let added = 0
    for (const item of imported) {
      if (item && item.id && !existingIds.has(item.id)) {
        existing.push(item)
        existingIds.add(item.id)
        added++
      }
    }
    writeTasksToDb(existing)
    notifyTasksChanged()
    return { added, total: existing.length }
  },
  __STORAGE_KEY__: STORAGE_KEY,
}

// ── MCP Tool Registration ─────────────────────────────────────────────
// Must be at top level, NOT inside onPluginEnter (AI Agent calls don't trigger onPluginEnter).
window.utools.registerTool('todo_create_task', withNotify(createTaskHandler))
window.utools.registerTool('todo_update_task', withNotify(updateTaskHandler))
window.utools.registerTool('todo_delete_task', withNotify(deleteTaskHandler))
window.utools.registerTool('todo_search_tasks', async function (params) {
  return searchTasksHandler(db(), params)
})
window.utools.registerTool('todo_get_task', async function (params) {
  return getTaskHandler(db(), params)
})
window.utools.registerTool('todo_get_overview', async function (params) {
  return taskOverviewHandler(db(), params)
})
window.utools.registerTool('todo_bulk_update', withNotify(bulkUpdateHandler))
window.utools.registerTool('todo_get_review', async function () {
  return getReviewHandler(db())
})
window.utools.registerTool('todo_suggest_organization', async function (params) {
  return suggestOrganizationHandler(db(), params)
})
window.utools.registerTool('todo_create_template', withNotify(function (params) {
  return createTemplateHandler(db(), params)
}, notifyTemplatesChanged))
window.utools.registerTool('todo_list_templates', async function () {
  return listTemplatesHandler(db())
})
window.utools.registerTool('todo_update_template', withNotify(function (params) {
  return updateTemplateHandler(db(), params)
}, notifyTemplatesChanged))
window.utools.registerTool('todo_delete_template', withNotify(function (params) {
  return deleteTemplateHandler(db(), params)
}, notifyTemplatesChanged))
window.utools.registerTool('todo_apply_template', withNotify(function (params) {
  return applyTemplateHandler(db(), params)
}))
window.utools.registerTool('todo_snooze_reminder', withNotify(snoozeReminderHandler))
window.utools.registerTool('todo_acknowledge_reminder', withNotify(acknowledgeReminderHandler))
window.utools.registerTool('todo_list_due_reminders', async function (params) {
  return listDueRemindersHandler(db(), params)
})
