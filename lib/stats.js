// 本地会话日志 → token 用量 → 人民币花费。
// 只读本机 DSH 会话日志（sessionPersistence / sessionQuery 两个官方服务），
// 不联网、不读凭据、不碰消息正文。

import { costOf, isDeepseekModel, priceAt } from './pricing.js'

const MAX_SESSIONS = 300
const CONCURRENCY = 4
const REFRESH_MIN_MS = 5000
const CACHE_TTL_MS = 45000

const dayFormat = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })
const monthFormat = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit' })

export const dayKey = (timeMs) => dayFormat.format(new Date(timeMs))
export const monthKey = (timeMs) => monthFormat.format(new Date(timeMs))

/** 最近 n 天的日期串（含今天，本地时区）。 */
export function lastDays(n) {
  const now = new Date()
  const out = []
  for (let back = n - 1; back >= 0; back -= 1) {
    out.push(dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back).getTime()))
  }
  return out
}

function emptyUsage() {
  return { cost: 0, calls: 0, input: 0, cacheRead: 0, output: 0 }
}

function addInto(bucket, cost, usage) {
  bucket.cost += cost
  bucket.calls += 1
  bucket.input += usage.inputTokens ?? 0
  bucket.cacheRead += usage.cacheReadTokens ?? 0
  bucket.output += usage.outputTokens ?? 0
}

function emptySession() {
  return { days: new Map(), models: new Map(), turns: new Map(), messages: new Map(), cost: 0, calls: 0 }
}

/** 把一份会话日志折叠成 天/模型/回合/消息 四层花费。 */
export function foldEvents(events) {
  const data = emptySession()
  if (!Array.isArray(events)) return data
  for (const event of events) {
    if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') continue
    const usage = event.data?.usage
    if (usage === null || typeof usage !== 'object') continue
    const model = event.data?.message?.source?.model
    if (!isDeepseekModel(model)) continue
    const time = typeof event.time === 'number' ? event.time : Date.now()
    const cost = costOf(usage, priceAt(model, time))

    const day = dayKey(time)
    if (!data.days.has(day)) data.days.set(day, emptyUsage())
    addInto(data.days.get(day), cost, usage)

    const modelKey = String(model)
    if (!data.models.has(modelKey)) data.models.set(modelKey, emptyUsage())
    addInto(data.models.get(modelKey), cost, usage)

    const turn = event.data?.turn
    if (turn !== undefined && turn !== null) data.turns.set(String(turn), (data.turns.get(String(turn)) ?? 0) + cost)

    const messageId = event.data?.message?.id
    if (typeof messageId === 'string' && messageId !== '') {
      data.messages.set(messageId, { cost, usage })
    }

    data.cost += cost
    data.calls += 1
  }
  return data
}

async function pool(items, limit, worker) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

/** 账本：按会话缓存日志解析结果，按 revision 判断是否需要重读。 */
export function createLedger(getPersistence, getSessionQuery) {
  const sessions = new Map()
  let summary = null
  let summaryAt = 0
  let inflight = null

  async function loadSession(persistence, id) {
    let stat
    try {
      stat = await persistence.stat(id)
    } catch {
      return null
    }
    const revision = stat?.revision
    if (revision === undefined || revision === null) return null
    const cached = sessions.get(id)
    if (cached !== undefined && cached.revision === revision) return cached.data
    let handle
    try {
      handle = await persistence.open(id, 'read')
      const slice = await handle.read(0, Number.MAX_SAFE_INTEGER)
      const data = foldEvents(slice?.events)
      sessions.set(id, { revision, data })
      return data
    } catch {
      return cached?.data ?? null
    } finally {
      if (handle !== undefined && typeof handle.close === 'function') {
        try {
          await handle.close()
        } catch {
          // 句柄关闭失败不影响统计
        }
      }
    }
  }

  async function scan() {
    const persistence = getPersistence()
    const query = getSessionQuery()
    if (persistence === undefined || persistence === null || typeof persistence.stat !== 'function'
      || query === undefined || query === null || typeof query.listSessions !== 'function') {
      return { available: false, ids: [] }
    }
    let records = []
    try {
      records = await query.listSessions()
    } catch {
      records = []
    }
    const ids = []
    for (const record of Array.isArray(records) ? records : []) {
      const id = record?.header?.id ?? (typeof record?.id === 'string' ? record.id : undefined)
      if (typeof id === 'string' && id !== '' && !ids.includes(id)) ids.push(id)
    }
    const picked = ids.slice(0, MAX_SESSIONS)
    await pool(picked, CONCURRENCY, (id) => loadSession(persistence, id))
    // 删除已不存在的会话缓存
    for (const key of sessions.keys()) if (!picked.includes(key)) sessions.delete(key)
    return { available: true, ids: picked }
  }

  function aggregate(ids) {
    const today = dayKey(Date.now())
    const month = monthKey(Date.now())
    const weekDays = lastDays(7)
    const out = {
      today: emptyUsage(),
      month: emptyUsage(),
      week: weekDays.map((day) => ({ day, usage: emptyUsage() })),
      models: new Map(),
      total: emptyUsage(),
      sessions: new Map(),
    }
    for (const id of ids) {
      const record = sessions.get(id)
      if (record === undefined) continue
      const data = record.data
      for (const [day, usage] of data.days) {
        const todayBucket = out.today
        if (day === today) {
          todayBucket.cost += usage.cost
          todayBucket.calls += usage.calls
        }
        if (day.startsWith(month)) {
          out.month.cost += usage.cost
          out.month.calls += usage.calls
        }
        const weekBucket = out.week.find((item) => item.day === day)
        if (weekBucket !== undefined) {
          weekBucket.usage.cost += usage.cost
          weekBucket.usage.calls += usage.calls
        }
      }
      for (const [model, usage] of data.models) {
        if (!out.models.has(model)) out.models.set(model, emptyUsage())
        const bucket = out.models.get(model)
        bucket.cost += usage.cost
        bucket.calls += usage.calls
        bucket.input += usage.input
        bucket.cacheRead += usage.cacheRead
        bucket.output += usage.output
      }
      out.total.cost += data.cost
      out.total.calls += data.calls
      out.sessions.set(id, data)
    }
    return out
  }

  /** 读取（或复用缓存）全部会话汇总。首次可能慢，之后只 stat 变化过的日志。 */
  async function refresh() {
    if (inflight !== null) return inflight
    if (summary !== null && Date.now() - summaryAt < CACHE_TTL_MS) return summary
    if (summary !== null && Date.now() - summaryAt < REFRESH_MIN_MS) return summary
    inflight = scan()
      .then((result) => {
        summary = { ...aggregate(result.ids), available: result.available, at: Date.now() }
        summaryAt = Date.now()
        return summary
      })
      .catch(() => ({ available: false, at: Date.now() }))
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  /** 不改变缓存的即时查询：用于点按「这条花费」这类一次性请求。 */
  async function peekSession(sessionId) {
    const persistence = getPersistence()
    if (persistence === undefined || persistence === null || typeof persistence.stat !== 'function') return null
    const data = await loadSession(persistence, sessionId)
    return data ?? null
  }

  function cached() {
    return summary
  }

  function invalidate() {
    summary = null
    summaryAt = 0
  }

  return { refresh, peekSession, cached, invalidate }
}
