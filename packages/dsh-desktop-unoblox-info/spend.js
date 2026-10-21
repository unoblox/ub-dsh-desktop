/**
 * What each conversation has spent, from unoblox's own per-response charge
 * (`charged_inr` in the `x-unoblox-freemium` header), and the per-task
 * budget the user set for it.
 *
 * A task is one turn: everything the agent does for one message, including
 * its compactions. A budget stops the next model call of a task that has
 * spent it, and the user decides whether to go on.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const MAX_TRACKED = 200
const RECENT_STEPS = 10
export const MAX_BUDGET_INR = 100_000

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Round to paise, so sums of many small charges stay readable. */
function paise(value) {
  return Math.round(value * 100) / 100
}

export function createSpendTracker({ now = Date.now } = {}) {
  const sessions = new Map()
  const entry = (sessionId) => {
    let current = sessions.get(sessionId)
    if (current === undefined) {
      current = { turn: undefined, taskInr: 0, sessionInr: 0, steps: [], estimated: false }
      sessions.set(sessionId, current)
      while (sessions.size > MAX_TRACKED) sessions.delete(sessions.keys().next().value)
    }
    return current
  }
  return {
    /** A new task (turn) starts: its spend starts at zero. */
    turnStarted(sessionId, turn) {
      if (typeof sessionId !== 'string') return
      const current = entry(sessionId)
      current.turn = turn
      current.taskInr = 0
      current.estimated = false
    },
    /** One model response's charge, as unoblox reported it. */
    charge(sessionId, billing) {
      const charged = finite(billing?.chargedInr)
      if (typeof sessionId !== 'string' || charged === undefined || charged < 0) return
      const current = entry(sessionId)
      current.taskInr = paise(current.taskInr + charged)
      current.sessionInr = paise(current.sessionInr + charged)
      current.steps = [...current.steps, charged].slice(-RECENT_STEPS)
      if (billing.chargedEstimated === true) current.estimated = true
      current.at = now()
    },
    view(sessionId) {
      const current = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined
      if (current === undefined) return undefined
      const steps = current.steps
      return {
        taskInr: current.taskInr,
        sessionInr: current.sessionInr,
        estimated: current.estimated,
        ...(steps.length === 0 ? {} : { stepInr: paise(steps.reduce((sum, value) => sum + value, 0) / steps.length), stepsCounted: steps.length })
      }
    },
    taskSpent(sessionId) {
      return sessions.get(sessionId)?.taskInr ?? 0
    }
  }
}

/** Per-conversation task budgets, kept in one small JSON file. */
export function createBudgetStore(path) {
  const budgets = new Map()
  let writing = Promise.resolve()
  // One shared load: a caller during the first read waits for the file
  // instead of seeing (or saving over it) an empty map.
  let loading
  const load = () => {
    loading ??= (async () => {
      if (path === undefined) return budgets
      try {
        const value = JSON.parse(await readFile(path, 'utf8'))
        for (const [sessionId, inr] of Object.entries(value?.budgets ?? {})) {
          if (finite(inr) !== undefined && inr > 0 && inr <= MAX_BUDGET_INR && !budgets.has(sessionId)) budgets.set(sessionId, inr)
        }
      } catch {
        // No file yet, or an unreadable one: no budgets.
      }
      return budgets
    })()
    return loading
  }
  const save = () => {
    if (path === undefined) return Promise.resolve()
    // The default budget ('*') is kept whatever the number of conversations.
    const kept = [...budgets].filter(([sessionId]) => sessionId !== '*').slice(-MAX_TRACKED)
    if (budgets.has('*')) kept.push(['*', budgets.get('*')])
    const body = `${JSON.stringify({ version: 1, budgets: Object.fromEntries(kept) })}\n`
    writing = writing.catch(() => {}).then(async () => {
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.${process.pid}.tmp`
      await writeFile(temporary, body, 'utf8')
      await rename(temporary, path)
    })
    return writing
  }
  return {
    async get(sessionId) {
      return (await load()).get(sessionId)
    },
    /** Set a budget in rupees, or clear it with null. */
    async set(sessionId, inr) {
      const map = await load()
      if (inr === null) map.delete(sessionId)
      else {
        if (finite(inr) === undefined || inr <= 0 || inr > MAX_BUDGET_INR) throw new RangeError(`budget must be between ₹0.01 and ₹${String(MAX_BUDGET_INR)}`)
        map.delete(sessionId)
        map.set(sessionId, paise(inr))
      }
      await save()
    }
  }
}
