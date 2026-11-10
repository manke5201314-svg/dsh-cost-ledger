// DeepSeek 官方价目表（人民币/百万 token）与峰谷判断。
// 价目表移植自 dsh-session-cost（MIT，Lzh3070），本身移植自 dsh-deepseek-quota（MIT）。
// 只用于本地估算：不联网、不读凭据。

const DEFAULT_TIMEZONE = 'Asia/Shanghai'
const DEFAULT_PEAK_WINDOWS = [[9, 12], [14, 18]]
const ZERO_UNIT = Object.freeze({ cny: Object.freeze({ input: 0, cacheRead: 0, output: 0 }) })

export const POLICIES = [
  {
    since: '2025-02-09T00:00:00+08:00',
    label: 'deepseek-chat / deepseek-reasoner 标准价',
    prices: {
      'deepseek-chat': { cny: { input: 2, cacheRead: 0.5, output: 8 } },
      'deepseek-reasoner': { cny: { input: 4, cacheRead: 1, output: 16 } },
      '*': { cny: { input: 2, cacheRead: 0.5, output: 8 } },
    },
  },
  {
    since: '2026-05-22T00:00:00+08:00',
    label: 'V4 系列永久降价 75%',
    prices: {
      'deepseek-v4-flash': { cny: { input: 1, cacheRead: 0.02, output: 2 } },
      'deepseek-v4-pro': { cny: { input: 3, cacheRead: 0.025, output: 6 } },
      '*': { cny: { input: 1, cacheRead: 0.02, output: 2 } },
    },
  },
  {
    since: '2026-08-17T00:00:00+08:00',
    label: '峰谷价：峰时 09:00-12:00 / 14:00-18:00（北京时间），谷时半价',
    peak: {
      'deepseek-v4-flash': { cny: { input: 3, cacheRead: 0.1, output: 9 } },
      'deepseek-v4-pro': { cny: { input: 9, cacheRead: 0.3, output: 27 } },
      '*': { cny: { input: 3, cacheRead: 0.1, output: 9 } },
    },
    offPeak: {
      'deepseek-v4-flash': { cny: { input: 1.5, cacheRead: 0.05, output: 4.5 } },
      'deepseek-v4-pro': { cny: { input: 4.5, cacheRead: 0.15, output: 13.5 } },
      '*': { cny: { input: 1.5, cacheRead: 0.05, output: 4.5 } },
    },
  },
]

const policyTimes = POLICIES.map((policy) => Date.parse(policy.since))

function isPeak(timeMs) {
  let hour = -1
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_TIMEZONE,
      hour12: false,
      hour: 'numeric',
    }).formatToParts(new Date(timeMs))
    hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0') % 24
  } catch {
    hour = -1
  }
  return DEFAULT_PEAK_WINDOWS.some(([start, end]) => hour >= start && hour < end)
}

function priceFor(model, table) {
  return table[model] ?? table['*'] ?? ZERO_UNIT
}

/** 某个模型在某个时刻的单价（人民币/百万 token）。 */
export function priceAt(model, timeMs) {
  const peak = isPeak(timeMs)
  let winner = POLICIES[0]
  let baseTable
  for (let index = POLICIES.length - 1; index >= 0; index -= 1) {
    if (timeMs < policyTimes[index]) continue
    const policy = POLICIES[index]
    const table = policy.peak !== undefined ? (peak ? policy.peak : policy.offPeak) : policy.prices
    if (table[model] !== undefined) {
      winner = policy
      baseTable = table
      break
    }
  }
  if (baseTable === undefined) {
    const last = POLICIES[POLICIES.length - 1]
    baseTable = last.peak !== undefined ? (peak ? last.peak : last.offPeak) : last.prices
  }
  const unit = priceFor(model, baseTable)
  return unit.cny ?? ZERO_UNIT.cny
}

/** 把一次 usage 折算成人民币。input 是未命中缓存输入，cacheRead 是命中缓存输入。 */
export function costOf(usage, unit) {
  const input = usage.inputTokens ?? 0
  const cacheRead = usage.cacheReadTokens ?? 0
  const output = usage.outputTokens ?? 0
  return (input * unit.input + cacheRead * unit.cacheRead + output * unit.output) / 1e6
}

/** 是否 DeepSeek 模型（只有它们按这套价目计费）。 */
export function isDeepseekModel(model) {
  return typeof model === 'string' && model.toLowerCase().startsWith('deepseek')
}
