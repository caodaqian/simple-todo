const CREDENTIAL_KEYS = {
  feishu: 'jianyue/webhook-credential/feishu',
  dingtalk: 'jianyue/webhook-credential/dingtalk',
}

function credentialKey(platform) {
  const key = CREDENTIAL_KEYS[platform]
  if (!key) throw new Error('不支持的 Webhook 平台')
  return key
}

function requireCryptoStorage(cryptoStorage) {
  if (!cryptoStorage
    || typeof cryptoStorage.getItem !== 'function'
    || typeof cryptoStorage.setItem !== 'function'
    || typeof cryptoStorage.removeItem !== 'function') {
    throw new Error('加密凭据存储不可用')
  }
  return cryptoStorage
}

function normalizeCredential(value) {
  if (!value || typeof value !== 'object' || typeof value.url !== 'string' || !value.url.trim()) return null
  const credential = { url: value.url }
  if (typeof value.secret === 'string' && value.secret.trim()) credential.secret = value.secret
  return credential
}

function endpointLabel(platform, url) {
  try {
    const parsed = new URL(url)
    const pathParts = parsed.pathname.split('/').filter(Boolean)
    const token = parsed.searchParams.get('access_token') || pathParts[pathParts.length - 1]
    if (!token || token.length <= 4) return undefined
    return platform + ' · …' + token.slice(-4)
  } catch {
    return undefined
  }
}

function createWebhookCredentialStore(cryptoStorage) {
  function read(platform) {
    const key = credentialKey(platform)
    const storage = requireCryptoStorage(cryptoStorage)
    try {
      return normalizeCredential(storage.getItem(key))
    } catch {
      throw new Error('加密凭据操作失败')
    }
  }

  function getStatus(platform) {
    const credential = read(platform)
    if (!credential) return { platform, configured: false }
    const label = endpointLabel(platform, credential.url)
    return Object.assign(
      { platform, configured: true },
      label ? { endpointLabel: label } : {},
    )
  }

  function save(platform, input) {
    const key = credentialKey(platform)
    if (!input || typeof input.url !== 'string' || !input.url.trim()) throw new Error('Webhook URL 不能为空')
    const storage = requireCryptoStorage(cryptoStorage)
    const credential = { url: input.url.trim() }
    if (typeof input.secret === 'string' && input.secret.trim()) credential.secret = input.secret
    try {
      storage.setItem(key, credential)
    } catch {
      throw new Error('加密凭据操作失败')
    }
    const label = endpointLabel(platform, credential.url)
    return Object.assign(
      { platform, configured: true },
      label ? { endpointLabel: label } : {},
    )
  }

  function clear(platform) {
    const key = credentialKey(platform)
    const storage = requireCryptoStorage(cryptoStorage)
    try {
      storage.removeItem(key)
    } catch {
      throw new Error('加密凭据操作失败')
    }
  }

  return { getStatus, save, clear, read }
}

module.exports = { createWebhookCredentialStore }