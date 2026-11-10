// dsh-go 原生插件「账本」：把本机会话日志里的 token 用量按 DeepSeek 官方价目
// 折成人民币，在输入框上方常驻一行「今日」，点开是一份花费账本。
// 纯本地：不联网、不读凭据、不碰消息正文。

import { createLedger, dayKey, lastDays } from './stats.js'

export const name = 'dsh-go-cost-ledger'

const STRIP_INTERVAL_MS = 60_000
const PANEL_INTERVAL_MS = 30_000
const TURN_INTERVAL_MS = 15_000

function money(cost) {
  if (!Number.isFinite(cost) || cost <= 0) return '¥0'
  if (cost < 0.001) return '¥0.001'
  if (cost < 0.01) return `¥${cost.toFixed(3)}`
  if (cost < 100) return `¥${cost.toFixed(2)}`
  return `¥${cost.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

function tokenText(tokens) {
  const value = Number.isFinite(tokens) ? tokens : 0
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

function shortDay(day) {
  return day.slice(5)
}

function panelData(summary, scope) {
  if (summary === null || summary === undefined) {
    return {
      ready: false,
      note: '正在统计本机日志…',
      today: { text: '—' },
      month: { text: '—' },
      sessionText: '',
      week: { days: lastDays(7).map(shortDay), values: lastDays(7).map(() => 0) },
      models: { rows: [] },
      total: { text: '—' },
    }
  }
  if (summary.available !== true) {
    return {
      ready: false,
      note: '这台主机上读不到会话日志，暂时算不了花费。',
      today: { text: '—' },
      month: { text: '—' },
      sessionText: '',
      week: { days: lastDays(7).map(shortDay), values: lastDays(7).map(() => 0) },
      models: { rows: [] },
      total: { text: '—' },
    }
  }
  const today = summary.today ?? { cost: 0, calls: 0 }
  const month = summary.month ?? { cost: 0, calls: 0 }
  const total = summary.total ?? { cost: 0, calls: 0 }
  const sessions = summary.sessions ?? new Map()
  const sessionId = scope?.sessionId
  const mine = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined
  const sessionText = mine === undefined
    ? '这个会话还没有可计费的 DeepSeek 回复'
    : `本次会话 ${money(mine.cost)} · ${mine.calls} 次调用`

  const week = Array.isArray(summary.week) ? summary.week : []
  const modelRows = [...(summary.models ?? new Map()).entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 6)
    .map(([model, usage]) => [model, `${usage.calls} 次`, money(usage.cost)])

  return {
    ready: true,
    note: '按 DeepSeek 官方价目估算（含峰谷价），只计本机日志里的 DeepSeek 模型。',
    today: { text: money(today.cost), caption: `${today.calls} 次调用` },
    month: { text: money(month.cost), caption: `${month.calls} 次调用` },
    sessionText,
    week: { days: week.map((item) => shortDay(item.day)), values: week.map((item) => Number(item.usage.cost.toFixed(4))) },
    models: { rows: modelRows },
    total: { text: money(total.cost), caption: `累计 ${total.calls} 次调用` },
  }
}

const panelView = {
  type: 'stack',
  children: [
    { type: 'row', children: [
      { type: 'metric', label: '今日', value: { $: 'data.today.text' }, caption: { $: 'data.today.caption' } },
      { type: 'metric', label: '本月', value: { $: 'data.month.text' }, caption: { $: 'data.month.caption' } },
    ] },
    { type: 'text', text: { $: 'data.sessionText' }, tone: 'muted' },
    { type: 'chart', kind: 'bar', categories: { $: 'data.week.days' }, series: [{ name: '花费', values: { $: 'data.week.values' } }], unit: '元', caption: '最近 7 天' },
    { type: 'table', columns: ['模型', '调用', '花费'], rows: { $: 'data.models.rows' } },
    { type: 'keyValue', items: [['累计', { $: 'data.total.text' }]] },
    { type: 'callout', text: { $: 'data.note' }, tone: 'info' },
    { type: 'actions', items: [{ label: '重新统计', action: 'refresh', style: 'plain' }] },
  ],
}

export function apply(ctx) {
  const ledger = createLedger(
    () => ctx.get('sessionPersistence'),
    () => ctx.get('sessionQuery'),
  )

  ctx.inject(['dshGo'], (ctx) => {
    // 输入框上方常驻「今日 ¥x」；点按打开账本。
    ctx.dshGo.strip('today', (scope, emit) => {
      let alive = true
      const push = async () => {
        const summary = await ledger.refresh()
        if (!alive) return
        const text = summary?.available === true
          ? `今日 ${money(summary.today?.cost ?? 0)}`
          : '今日 —'
        emit({ text })
      }
      push()
      const timer = setInterval(push, STRIP_INTERVAL_MS)
      return () => {
        alive = false
        clearInterval(timer)
      }
    })

    // 账本面板：今日 / 本月 / 本次会话 / 最近 7 天 / 分模型。
    ctx.dshGo.panel('ledger', {
      view: panelView,
      data: (scope, emit) => {
        let alive = true
        const push = async () => {
          const summary = await ledger.refresh()
          if (!alive) return
          emit(panelData(summary, scope))
        }
        push()
        const timer = setInterval(push, PANEL_INTERVAL_MS)
        return () => {
          alive = false
          clearInterval(timer)
        }
      },
      actions: {
        refresh: () => {
          ledger.invalidate()
          return { refresh: true, toast: '正在重新统计' }
        },
      },
    })

    // 每轮回复的脚注：本轮花了多少。
    ctx.dshGo.turnNote('turnCost', async (scope, emit) => {
      const sessionId = scope?.sessionId
      if (typeof sessionId !== 'string' || sessionId === '') {
        emit({})
        return () => {}
      }
      let alive = true
      const push = async () => {
        const data = await ledger.peekSession(sessionId)
        if (!alive || data === null) return
        const notes = {}
        for (const [turn, cost] of data.turns) {
          notes[turn] = { text: `本轮 ${money(cost)}`, tone: 'muted' }
        }
        emit(notes)
      }
      await push()
      const timer = setInterval(push, TURN_INTERVAL_MS)
      return () => {
        alive = false
        clearInterval(timer)
      }
    })

    // 长按助手回复：这条回复花了多少。
    ctx.dshGo.on('msgCost', async (scope) => {
      const sessionId = scope?.sessionId
      const messageId = scope?.messageId
      if (typeof sessionId !== 'string' || typeof messageId !== 'string') {
        return { toast: '拿不到这条消息' }
      }
      const data = await ledger.peekSession(sessionId)
      const hit = data?.messages?.get(messageId)
      if (hit === undefined) return { toast: '这条不是 DeepSeek 模型的回复' }
      return {
        toast: `这条 ${money(hit.cost)}（入 ${tokenText(hit.usage.inputTokens)} · 出 ${tokenText(hit.usage.outputTokens)}）`,
      }
    })
  })
}
