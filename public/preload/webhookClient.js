const crypto = require('node:crypto')
const dns = require('node:dns').promises
const net = require('node:net')

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'User-Agent': 'JianYueTodo/1.0',
}

function isPrivateIp(address) {
  const version = net.isIP(address)
  if (version === 4) {
    const parts = address.split('.').map(Number)
    return parts[0] === 0
      || parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || parts[0] >= 224
  }
  if (version === 6) {
    const normalized = address.toLowerCase()
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe8')
      || normalized.startsWith('fe9')
      || normalized.startsWith('fea')
      || normalized.startsWith('feb')
  }
  return true
}

function assertPlatform(platform) {
  if (platform !== 'feishu' && platform !== 'dingtalk') throw new Error('不支持的机器人平台')
}

function parsePlatformUrl(platform, value) {
  assertPlatform(platform)
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Webhook 地址无效')
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hash) {
    throw new Error('Webhook 地址无效')
  }
  if (net.isIP(parsed.hostname) || parsed.hostname === 'localhost') throw new Error('Webhook 地址无效')

  if (platform === 'feishu') {
    if (parsed.hostname !== 'open.feishu.cn'
      || !/^\/open-apis\/bot\/v2\/hook\/[^/]+$/.test(parsed.pathname)
      || parsed.search) {
      throw new Error('飞书 Webhook 地址无效')
    }
  } else {
    const keys = Array.from(parsed.searchParams.keys())
    if (parsed.hostname !== 'oapi.dingtalk.com'
      || parsed.pathname !== '/robot/send'
      || keys.length !== 1
      || keys[0] !== 'access_token'
      || !parsed.searchParams.get('access_token')) {
      throw new Error('钉钉 Webhook 地址无效')
    }
  }
  return parsed
}

async function validateWebhookUrl(platform, value, deps) {
  const parsed = parsePlatformUrl(platform, value)
  const lookup = deps && deps.lookup ? deps.lookup : dns.lookup
  let records
  try {
    records = await lookup(parsed.hostname, { all: true, verbatim: true })
  } catch {
    throw new Error('Webhook 域名解析失败')
  }
  const normalized = Array.isArray(records) ? records : [records]
  if (!normalized.length || normalized.some((record) => !record || isPrivateIp(record.address))) {
    throw new Error('Webhook 地址无效')
  }
  return parsed
}

function normalizeField(value, maxLength) {
  return String(value || '').replace(/\r\n?/g, '\n').trim().slice(0, maxLength)
}

function formatWebhookMessage(input) {
  return {
    title: normalizeField(input && input.title, 80),
    text: normalizeField(input && input.text, 4000),
  }
}

function buildWebhookRequest(platform, credentials, message, now) {
  assertPlatform(platform)
  const formatted = formatWebhookMessage(message)
  const parsed = parsePlatformUrl(platform, credentials.url)
  const timestampMs = Number.isFinite(now) ? now : Date.now()
  let payload

  if (platform === 'feishu') {
    payload = { msg_type: 'text', content: { text: formatted.text } }
    if (credentials.secret) {
      const timestamp = Math.floor(timestampMs / 1000)
      const key = `${timestamp}\n${credentials.secret}`
      payload = {
        timestamp,
        sign: crypto.createHmac('sha256', key).update(Buffer.alloc(0)).digest('base64'),
        ...payload,
      }
    }
  } else {
    if (credentials.secret) {
      const stringToSign = `${timestampMs}\n${credentials.secret}`
      const sign = crypto.createHmac('sha256', credentials.secret).update(stringToSign).digest('base64')
      parsed.searchParams.set('timestamp', String(timestampMs))
      parsed.searchParams.set('sign', sign)
    }
    payload = {
      msgtype: 'markdown',
      markdown: { title: formatted.title, text: formatted.text },
    }
  }

  return { url: parsed.href, body: JSON.stringify(payload), headers: { ...HEADERS } }
}

module.exports = { buildWebhookRequest, formatWebhookMessage, validateWebhookUrl }
