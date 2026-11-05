/**
 * offpeak — a one-line status-bar badge for the model in use.
 *
 * Two sources, in this order:
 *  1. A built-in snapshot for providers whose own API bills by time of day
 *     (DeepSeek direct / opencode-go, Z.ai GLM Coding Plan).
 *  2. OpenRouter's public model list, which publishes the same idea as
 *     `pricing.overrides[]` with `utc_days` / `utc_start` / `utc_end`
 *     (minutes after midnight, UTC). It covers models the snapshot does not,
 *     e.g. MiniMax M3.1 Flash (half price 15:00–01:00 UTC) and Tencent Hy3.
 *
 * Snapshot verified 2026-11-01; OpenRouter prices are live and cached 10 min.
 */
import { PALETTE_AREA, STATUSBAR_AREAS, host, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useMemo, useState } from 'react'

const ID = 'offpeak'

// Wording for the chip. Change one place to rename the two states.
const LABELS = {
  full: 'peak',
  half: 'discount'
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models'
const OPENROUTER_TTL_MS = 10 * 60 * 1000

// Providers whose own API bills by time of day.
const SCHEDULES = {
  deepseek: {
    label: 'DeepSeek',
    tz: 'UTC',
    days: [1, 2, 3, 4, 5],
    windows: [[60, 240], [360, 600]], // 01:00–04:00 and 06:00–10:00 UTC
    models: {
      flash: { name: 'V4.1 Flash', peak: [0.30, 1.20], off: [0.15, 0.60] },
      pro: { name: 'V4 Pro', peak: [1.32, 3.96], off: [0.66, 1.98] }
    },
    unit: 'per 1M tokens'
  },
  glm: {
    label: 'GLM',
    tz: 'Asia/Shanghai',
    days: [1, 2, 3, 4, 5],
    windows: [[840, 1080]], // 14:00–18:00 Shanghai
    models: {},
    unit: 'points'
  }
}

// Endpoints that charge one price all day: no clock to follow.
const FLAT_ENDPOINTS = ['opencode-zen', 'zen']

const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
const UTC_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const formatters = new Map()

function formatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(
      tz,
      new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      })
    )
  }
  return formatters.get(tz)
}

function isPeak(schedule, instant) {
  const parts = formatter(schedule.tz).formatToParts(instant)
  const get = type => (parts.find(part => part.type === type) || {}).value
  const weekday = WEEKDAY[get('weekday')] || 0
  if (!schedule.days.includes(weekday)) return false
  const minutes = Number(get('hour')) * 60 + Number(get('minute'))
  return schedule.windows.some(([start, end]) => minutes >= start && minutes < end)
}

function nextChange(schedule, now) {
  const current = isPeak(schedule, now)
  let probe = new Date(Math.floor(now.getTime() / 60000) * 60000)
  for (let step = 0; step < 8 * 24 * 12; step += 1) {
    probe = new Date(probe.getTime() + 5 * 60000)
    if (isPeak(schedule, probe) !== current) return { at: probe, becomesPeak: !current }
  }
  return null
}

function shortWait(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000))
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`
}

function scheduleFor(model) {
  if (!model) return null
  const slug = String(model).toLowerCase()
  const key = Object.keys(SCHEDULES).find(name => slug.includes(name))
  return key ? SCHEDULES[key] : null
}

function rateFor(schedule, model) {
  if (!schedule || !schedule.models) return null
  const slug = String(model || '').toLowerCase()
  const key = Object.keys(schedule.models).find(name => slug.includes(name))
  return key ? schedule.models[key] : null
}

function money(pair) {
  return `$${pair[0].toFixed(2)} in / $${pair[1].toFixed(2)} out`
}

function clockLabel(instant) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(instant)
}

// ---------------------------------------------------------------- OpenRouter

function isAliasId(id) {
  return typeof id === 'string' && id.startsWith('~')
}

function hasClock(entry) {
  const overrides = (entry && entry.pricing && entry.pricing.overrides) || []
  return overrides.some(item => 'utc_start' in item || 'utc_days' in item)
}

function entryFor(models, model) {
  if (!models || !models.length || !model) return null
  const slug = String(model).toLowerCase()
  const bare = slug.split('/').pop()
  const candidates = models.filter(entry => !isAliasId(entry.id) && entry.id.toLowerCase().includes(bare))
  if (!candidates.length) return null
  return candidates.find(hasClock) || candidates[0]
}

// OpenRouter encodes clock bounds as HHMM integers in UTC (100 = 01:00,
// 1500 = 15:00, 0 = midnight), not as minutes after midnight.
function hhmm(value) {
  const number = Number(value)
  return Math.floor(number / 100) * 60 + (number % 100)
}

function priceAt(entry, instant) {
  const pricing = entry.pricing || {}
  const minute = instant.getUTCHours() * 60 + instant.getUTCMinutes()
  const day = UTC_DAYS[instant.getUTCDay()]
  for (const override of pricing.overrides || []) {
    if (override.utc_days && !override.utc_days.includes(day)) continue
    if (override.min_prompt_tokens && override.utc_start === undefined) continue
    if (override.utc_start === undefined) {
      return { prompt: Number(override.prompt), completion: Number(override.completion) }
    }
    const start = hhmm(override.utc_start)
    const end = hhmm(override.utc_end)
    const inside = end > start ? minute >= start && minute < end : minute >= start || minute < end
    if (inside) {
      return { prompt: Number(override.prompt), completion: Number(override.completion) }
    }
  }
  return { prompt: Number(pricing.prompt), completion: Number(pricing.completion) }
}

function signature(price) {
  return `${price.prompt}|${price.completion}`
}

function cheapestAndDearest(entry) {
  const base = new Date('2026-01-05T00:00:00Z') // a Monday, enough for a weekly sweep
  const seen = new Map()
  for (let step = 0; step < 7 * 24 * 2; step += 1) {
    const price = priceAt(entry, new Date(base.getTime() + step * 30 * 60000))
    seen.set(signature(price), price)
  }
  const values = [...seen.values()].sort((a, b) => a.prompt - b.prompt)
  return { cheapest: values[0], dearest: values[values.length - 1] }
}

function liveState(entry, now) {
  const price = priceAt(entry, now)
  const { cheapest, dearest } = cheapestAndDearest(entry)
  if (signature(cheapest) === signature(dearest)) return null // flat, nothing to report
  const discounted = signature(price) === signature(cheapest)
  let probe = new Date(Math.floor(now.getTime() / 60000) * 60000)
  let change = null
  for (let step = 0; step < 8 * 24 * 12; step += 1) {
    probe = new Date(probe.getTime() + 5 * 60000)
    if (signature(priceAt(entry, probe)) !== signature(price)) {
      change = { at: probe, price: priceAt(entry, probe) }
      break
    }
  }
  const perM = pair => [pair.prompt * 1e6, pair.completion * 1e6]
  return {
    discounted,
    now: perM(price),
    next: change ? perM(change.price) : null,
    at: change ? change.at : null,
    nextDiscounted: change ? signature(change.price) === signature(cheapest) : null
  }
}

// -------------------------------------------------------------------- badge

function useOpenRouter() {
  const [models, setModels] = useState(null)
  useEffect(() => {
    let alive = true
    const load = () => {
      fetch(OPENROUTER_URL)
        .then(response => (response.ok ? response.json() : null))
        .then(payload => {
          if (alive && payload && Array.isArray(payload.data)) setModels(payload.data)
        })
        .catch(() => {})
    }
    load()
    const timer = setInterval(load, OPENROUTER_TTL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return models
}

function buildTooltip({ schedule, rate, endpoint, peak, change, now, flat, live, entry }) {
  const lines = []
  const title = schedule
    ? `${schedule.label}${rate ? ` ${rate.name}` : ''}`
    : entry
      ? entry.name || entry.id
      : ''
  lines.push(`${title}${endpoint ? ` — ${endpoint}` : ''}`)

  if (flat && rate) {
    lines.push(`Flat rate all day on this endpoint: ${money(rate.peak)} ${schedule.unit}`)
    lines.push('No clock here — time windows only apply to DeepSeek direct and opencode-go.')
    return lines.join('\n')
  }

  if (live) {
    lines.push(
      `Now: ${money(live.now)} per 1M tokens (${live.discounted ? LABELS.half : LABELS.full})`
    )
    if (live.at) {
      lines.push(
        `At ${clockLabel(live.at)} (in ${shortWait(live.at.getTime() - now.getTime())}): ` +
          `${money(live.next)} (${live.nextDiscounted ? LABELS.half : LABELS.full})`
      )
    }
    lines.push('Prices read from OpenRouter, live.')
    return lines.join('\n')
  }

  if (rate) {
    lines.push(`Now: ${money(peak ? rate.peak : rate.off)} ${schedule.unit} (${peak ? LABELS.full : LABELS.half})`)
  }
  if (change) {
    const next = change.becomesPeak ? rate?.peak : rate?.off
    const label = change.becomesPeak ? LABELS.full : LABELS.half
    lines.push(
      `At ${clockLabel(change.at)} (in ${shortWait(change.at.getTime() - now.getTime())}): ` +
        (next ? `${money(next)} (${label})` : label)
    )
  }
  if (!endpoint) lines.push('Endpoint unknown — showing DeepSeek list prices.')
  return lines.join('\n')
}

function Badge() {
  const model = useValue(host.state.model)
  const [now, setNow] = useState(() => new Date())
  const [endpoint, setEndpoint] = useState('')
  const models = useOpenRouter()

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let alive = true
    host
      .request('config.get', { key: 'provider' })
      .then(result => {
        if (alive && result && result.provider) setEndpoint(String(result.provider))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [model])

  const schedule = scheduleFor(model)
  const entry = useMemo(() => entryFor(models, model), [models, model])
  const flat = FLAT_ENDPOINTS.includes(endpoint)
  // Live OpenRouter prices only when OpenRouter is the endpoint, or when the
  // snapshot knows nothing about this model — never to contradict a known
  // endpoint that does not bill by the clock (e.g. OpenCode Zen).
  const liveSource =
    entry && hasClock(entry) && !flat && (endpoint.includes('openrouter') || !schedule)
  const live = liveSource ? liveState(entry, now) : null

  if (!live && !schedule) return null

  const rate = rateFor(schedule, model)
  const peak = schedule ? isPeak(schedule, now) : false
  const change = schedule ? nextChange(schedule, now) : null
  const discounted = live ? live.discounted : !peak
  const when = live && live.at ? live.at : change ? change.at : null

  return jsxs('span', {
    className: 'inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] text-(--ui-text-tertiary)',
    title: buildTooltip({ schedule, rate, endpoint, peak, change, now, flat, live, entry }),
    children: [
      jsx('span', {
        className: 'inline-block h-1.5 w-1.5 rounded-full',
        style: { backgroundColor: discounted ? 'var(--ui-accent)' : 'var(--ui-warning)' }
      }),
      jsx('span', {
        className: discounted ? 'text-(--ui-accent)' : 'text-(--ui-warning)',
        children: discounted ? LABELS.half : LABELS.full
      }),
      when &&
        !flat &&
        jsx('span', {
          className: 'text-(--ui-text-quaternary)',
          children: `· ${shortWait(when.getTime() - now.getTime())}`
        })
    ].filter(Boolean)
  })
}

function stateLine() {
  const model = host.state.model.get()
  const schedule = scheduleFor(model)
  if (!schedule) return `No time-based pricing known for ${model || 'the current model'}.`
  const peak = isPeak(schedule, new Date())
  const change = nextChange(schedule, new Date())
  return (
    `${schedule.label}: ${peak ? LABELS.full : LABELS.half}` +
    (change ? ` · ${change.becomesPeak ? LABELS.full : LABELS.half} in ${shortWait(change.at.getTime() - Date.now())}` : '')
  )
}

// Exported for the smoke test only.
export { LABELS, buildTooltip, entryFor, hasClock, isPeak, liveState, nextChange, priceAt, rateFor, scheduleFor }

export default {
  id: ID,
  name: 'Off-peak badge',
  register(ctx) {
    ctx.register({
      id: 'badge',
      area: STATUSBAR_AREAS.right,
      order: 100,
      render: () => jsx(Badge, {})
    })
    ctx.register({
      id: 'status-command',
      area: PALETTE_AREA,
      data: {
        id: 'offpeak-state',
        action: 'offpeak.state',
        label: 'Off-peak: pricing window for this model',
        keywords: ['deepseek', 'peak', 'off-peak', 'pricing', 'price'],
        run: () => host.notify({ kind: 'info', message: stateLine() })
      }
    })
  }
}
