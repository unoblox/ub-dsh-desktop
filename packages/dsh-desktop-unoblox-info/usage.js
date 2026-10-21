/**
 * The usage history behind Settings › Usage: one line per charged unoblox
 * response this computer made (time, conversation, its title, model, charge),
 * appended to a JSON Lines file. unoblox has no usage API, so this is what
 * this computer saw; unoblox.ai/user/usage has every device.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Older records are dropped when the file is next rewritten. */
export const KEEP_DAYS = 400
/** The file is compacted once it holds this many records. */
export const MAX_RECORDS = 100_000
const DAY_MS = 86_400_000

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function paise(value) {
  return Math.round(value * 100) / 100
}

/** The local calendar day of a time, as YYYY-MM-DD (the user's own days). */
export function localDay(time, offsetMinutes = new Date(time).getTimezoneOffset()) {
  return new Date(time - offsetMinutes * 60_000).toISOString().slice(0, 10)
}

function parseLine(line) {
  try {
    const value = JSON.parse(line)
    if (typeof value !== 'object' || value === null) return undefined
    const at = finite(value.at)
    const inr = finite(value.inr)
    if (at === undefined || inr === undefined || inr < 0) return undefined
    return {
      at,
      inr,
      ...(typeof value.session === 'string' ? { session: value.session } : {}),
      ...(typeof value.title === 'string' ? { title: value.title } : {}),
      ...(typeof value.model === 'string' ? { model: value.model } : {}),
      ...(value.estimated === true ? { estimated: true } : {}),
      ...(finite(value.balance) === undefined ? {} : { balance: value.balance })
    }
  } catch {
    return undefined
  }
}

export function createUsageLedger(path, { now = Date.now } = {}) {
  let records
  let writing = Promise.resolve()
  const load = async () => {
    if (records !== undefined) return records
    records = []
    if (path === undefined) return records
    let text = ''
    try {
      text = await readFile(path, 'utf8')
    } catch {
      return records
    }
    const oldest = now() - KEEP_DAYS * DAY_MS
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      const record = parseLine(line)
      if (record !== undefined && record.at >= oldest) records.push(record)
    }
    return records
  }
  const persist = (record) => {
    if (path === undefined) return Promise.resolve()
    writing = writing.catch(() => {}).then(async () => {
      await mkdir(dirname(path), { recursive: true })
      if (records.length > MAX_RECORDS) {
        records = records.slice(-Math.floor(MAX_RECORDS * 0.9))
        const temporary = `${path}.${process.pid}.tmp`
        await writeFile(temporary, records.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8')
        await rename(temporary, path)
      } else {
        await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8')
      }
    })
    return writing
  }
  return {
    /** Record one charged response. A zero charge is kept: it is a free step. */
    async record({ session, title, model, chargedInr, estimated, balanceInr }) {
      const inr = finite(chargedInr)
      if (inr === undefined || inr < 0) return
      const list = await load()
      const entry = {
        at: now(),
        inr,
        ...(typeof session === 'string' ? { session } : {}),
        ...(typeof title === 'string' && title !== '' ? { title: title.slice(0, 120) } : {}),
        ...(typeof model === 'string' ? { model } : {}),
        ...(estimated === true ? { estimated: true } : {}),
        // The balance after this charge, so Settings can show the last one
        // unoblox reported even before this run's first reply.
        ...(finite(balanceInr) === undefined ? {} : { balance: balanceInr })
      }
      list.push(entry)
      await persist(entry)
    },
    /**
     * Totals for today, the last 7 and 30 days, a per-day series for the last
     * `days` days (empty days included), and the top models and
     * conversations over those days. `titles` (session → title) overrides
     * the titles recorded with the charges, which may be older.
     */
    async summary({ days = 30, offsetMinutes, titles } = {}) {
      const list = await load()
      const time = now()
      const offset = offsetMinutes ?? new Date(time).getTimezoneOffset()
      const today = localDay(time, offset)
      const dayList = []
      for (let back = days - 1; back >= 0; back--) dayList.push(localDay(time - back * DAY_MS, offset))
      const inWindow = new Set(dayList)
      const daily = new Map(dayList.map((day) => [day, { inr: 0, steps: 0 }]))
      const byModel = new Map()
      const byConversation = new Map()
      let todayInr = 0
      let week = 0
      let month = 0
      let estimated = false
      let lastBalance
      for (const record of list) {
        if (record.balance !== undefined && (lastBalance === undefined || record.at >= lastBalance.at)) lastBalance = { inr: record.balance, at: record.at }
        const day = localDay(record.at, offset)
        const age = time - record.at
        if (day === today) todayInr += record.inr
        if (age < 7 * DAY_MS) week += record.inr
        if (age < 30 * DAY_MS) month += record.inr
        if (!inWindow.has(day)) continue
        if (record.estimated) estimated = true
        const slot = daily.get(day)
        slot.inr += record.inr
        slot.steps++
        const model = record.model ?? 'unknown'
        const m = byModel.get(model) ?? { model, inr: 0, steps: 0 }
        m.inr += record.inr
        m.steps++
        byModel.set(model, m)
        const key = record.session ?? 'unknown'
        const c = byConversation.get(key) ?? { session: key, inr: 0, steps: 0, last: 0 }
        c.inr += record.inr
        c.steps++
        const title = titles?.get(key) ?? record.title
        if (title !== undefined) c.title = title
        c.last = Math.max(c.last, record.at)
        byConversation.set(key, c)
      }
      const top = (map) => [...map.values()].map((entry) => ({ ...entry, inr: paise(entry.inr) })).sort((a, b) => b.inr - a.inr || b.steps - a.steps).slice(0, 10)
      return {
        todayInr: paise(todayInr),
        weekInr: paise(week),
        monthInr: paise(month),
        estimated,
        days: dayList.map((day) => ({ day, inr: paise(daily.get(day).inr), steps: daily.get(day).steps })),
        byModel: top(byModel),
        byConversation: top(byConversation),
        recorded: list.length,
        lastBalance: lastBalance ?? null
      }
    }
  }
}
