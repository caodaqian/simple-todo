const crypto = require('node:crypto')
const dns = require('node:dns').promises
const net = require('node:net')

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'User-Agent': 'JianYueTodo/1.0',
}

function isNonPublicIpv4(address) {
  const parts = address.split('.').map(Number)
  return parts[0] === 0
    || parts[0] === 10
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 0 && parts[2] === 0)
    || (parts[0] === 192 && parts[1] === 0 && parts[2] === 2)
    || (parts[0] === 192 && parts[1] === 88 && parts[2] === 99)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))
    || (parts[0] === 198 && parts[1] === 51 && parts[2] === 100)
    || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113)
    || parts[0] >= 224
}

function parseIpv6(address) {
  let normalized = address.toLowerCase().split('%', 1)[0]
  const lastColon = normalized.lastIndexOf(':')
  const ipv4Tail = normalized.slice(lastColon + 1)
  if (net.isIP(ipv4Tail) === 4) {
    const parts = ipv4Tail.split('.').map(Number)
    normalized = `${normalized.slice(0, lastColon)}:${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`
  }

  const halves = normalized.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null
  const groups = [...left, ...Array(missing).fill('0'), ...right]
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null
  return groups.map((group) => Number.parseInt(group, 16))
}

function isNonPublicIpv6(address) {
  const groups = parseIpv6(address)
  if (!groups) return true
  const [first, second, third, fourth, fifth, sixth, seventh, eighth] = groups
  const isUnspecified = groups.every((group) => group === 0)
  const isLoopback = groups.slice(0, 7).every((group) => group === 0) && eighth === 1
  const isIpv4Compatible = groups.slice(0, 6).every((group) => group === 0)
  const isIpv4Mapped = groups.slice(0, 5).every((group) => group === 0) && sixth === 0xffff
  return isUnspecified
    || isLoopback
    || isIpv4Compatible
    || isIpv4Mapped
    || (first & 0xfe00) === 0xfc00
    || (first & 0xffc0) === 0xfe80
    || (first & 0xffc0) === 0xfec0
    || (first & 0xff00) === 0xff00
    || (first === 0x0064 && second === 0xff9b && third === 0x0001)
    || (first === 0x0100 && second === 0 && third === 0 && fourth === 0)
    || (first === 0x2001 && second === 0x0002)
    || (first === 0x2001 && second === 0x0db8)
    || (first === 0x2001 && (second & 0xfff0) === 0x0010)
    || (first === 0x2001 && (second & 0xfff0) === 0x0020)
    || (first === 0x2002)
    || (first === 0 && second === 0 && third === 0 && fourth === 0 && fifth === 0 && sixth === 0 && (seventh !== 0 || eighth !== 0))
}

function isNonPublicIp(address) {
  const version = net.isIP(address)
  if (version === 4) return isNonPublicIpv4(address)
  if (version === 6) return isNonPublicIpv6(address)
  return true
}

function hasExplicitPort(value) {
  const match = String(value).match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)
  if (!match) return false
  const authority = match[1].slice(match[1].lastIndexOf('@') + 1)
  if (authority.startsWith('[')) return authority.slice(authority.indexOf(']') + 1).startsWith(':')
  return authority.includes(':')
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
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || hasExplicitPort(value) || parsed.hash) {
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
  if (!normalized.length || normalized.some((record) => !record || isNonPublicIp(record.address))) {
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
