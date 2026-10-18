// Talks to the Flask API. If the backend isn't running, falls back to a local
// demo store (localStorage) so the UI is fully usable on its own.
import { API_BASE as BASE } from './config.js'

export const CATS = {
  quick_qa: { label: 'Quick Q&A', base_time: 2, complexity: 1 },
  understanding_topic: { label: 'Understanding Topic', base_time: 10, complexity: 3 },
  grading: { label: 'Grading', base_time: 5, complexity: 1 },
  scheduling: { label: 'Scheduling / Logistics', base_time: 3, complexity: 1 },
  research: { label: 'Research', base_time: 15, complexity: 5 },
  personal: { label: 'Personal', base_time: 10, complexity: 3 },
}
// Same formula as priority.py: (base + complexity*3 + students*5) * 2^overflow
// Lateness isn't part of the score. Late questions keep their real score but wait in
// a separate late section at the back, in the order they arrived (see serveOrder).
export const score = (t, n = 1, o = 0) => {
  const c = CATS[t] || CATS.quick_qa
  return (c.base_time + c.complexity * 3 + Math.max(n, 1) * 5) * 2 ** Math.max(o, 0)
}

let live = false
export const isLive = () => live

async function http(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' }, ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  return res.json()
}

// ---- demo store ----
const KEY = 'zh.demo2'
const pad = (n) => String(n).padStart(2, '0')
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
// A local "YYYY-MM-DDTHH:mm" string, h hours from now (what datetime-local inputs and the API use).
export const inHours = (h) => local(new Date(Date.now() + h * 3600000))
// upcoming -> running (opened, or start time passed) -> closed, same as the backend
const stateOf = (h) => (h.closed_at ? 'closed' : h.is_open || local(new Date()) >= h.starts_at ? 'running' : 'upcoming')
const seed = () => {
  const mk = (id, name, sec, q, type, bucket) => ({
    id, student_name: name, class_section: sec, question: q, question_type: type,
    status: 'waiting', created_at: new Date(Date.now() - (10 - id) * 60000).toISOString(),
    bucket_id: bucket, overflow_count: 0, manually_changed: false, priority: 0, late: false, pinned_position: null,
  })
  return {
    next: 10,
    hours: { id: 1, course: 'ICS 32', location: 'ICS 2nd Floor Atrium', starts_at: inHours(1), ends_at: inHours(3), is_open: false, closed_at: null },
    tickets: [
      mk(1, 'Jon', 'Lec A', 'My recursive flatten() returns None for nested lists', 'understanding_topic', 1),
      mk(2, 'Ava', 'Lec A', 'Recursive call result never gets returned', 'understanding_topic', 1),
      mk(3, 'Lena', 'Lec B', 'Why does my recursion base case never stop?', 'understanding_topic', 1),
      mk(4, 'Priya', 'Lec A', 'How do file paths work with open()?', 'quick_qa', 4),
      mk(5, 'Kai', 'Lec B', 'open() cannot find my file path', 'quick_qa', 4),
      mk(6, 'Diego', 'Lec B', 'Generators vs lists, when to use which?', 'understanding_topic', 6),
      mk(7, 'Sam', 'Lec A', 'Why did I lose points on assignment 3?', 'grading', 7),
    ],
  }
}
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || seed() } catch { return seed() } }
const save = (s) => localStorage.setItem(KEY, JSON.stringify(s))
// Same order as the backend (queue_order.py): the main line by score, then the late
// section by arrival. A late question the professor moved up is back in the main line.
const serveOrder = (a, b) =>
  (a.in_late_section - b.in_late_section) ||
  (a.in_late_section ? 0 : b.priority - a.priority) ||
  a.created_at.localeCompare(b.created_at) || a.id - b.id
const decorate = (tickets) => {
  const waiting = tickets.filter((t) => t.status === 'waiting')
  return waiting.map((t) => {
    const n = waiting.filter((m) => m.bucket_id === t.bucket_id).length
    return {
      ...t, student_count: n,
      in_late_section: !!t.late && !t.manually_changed,
      priority: t.manually_changed ? t.priority : score(t.question_type, n, t.overflow_count),
    }
  }).sort(serveOrder).map((t, i) => ({ ...t, position: i + 1 }))
}

export async function probe() {
  try { await http('/health'); live = true } catch { live = false }
  return live
}
export const getCategories = async () => {
  if (live) try { return Object.fromEntries((await http('/categories')).map((c) => [c.id, c])) } catch { /* fall through */ }
  return CATS
}

// The line for ONE session. Pass the id of the session the page is showing so tickets
// from other sessions never leak in. (Live: GET /queue?office_hours_id=N)
export async function getQueue(officeHoursId) {
  if (live) return officeHoursId == null ? [] : http(`/queue?office_hours_id=${officeHoursId}`)
  return decorate(load().tickets)
}

export async function join(p) {
  if (live) {
    const { bucket_id, ...body } = p
    // Joining an existing group uses the buckets route (it keeps the group's place in line,
    // even after the session started). A new question starts its own group in the session
    // the page is showing.
    return bucket_id
      ? http(`/buckets/${bucket_id}/join`, { method: 'POST', body })
      : http('/queue', { method: 'POST', body: { ...body, office_hours_id: body.office_hours_id ?? hoursId ?? undefined } })
  }
  const s = load(), id = s.next++
  // A student joining a group takes on that group's category and lateness, same as the backend.
  const buddy = p.bucket_id != null ? s.tickets.find((t) => t.bucket_id === p.bucket_id) : null
  s.tickets.push({
    id, student_name: p.student_name, class_section: p.class_section, question: p.question ?? buddy?.question,
    question_type: buddy ? buddy.question_type : p.question_type, status: 'waiting', created_at: new Date().toISOString(),
    bucket_id: p.bucket_id ?? id, overflow_count: buddy ? buddy.overflow_count : 0, manually_changed: false, priority: 0,
    late: buddy ? buddy.late : stateOf(s.hours) === 'running', pinned_position: buddy ? buddy.pinned_position ?? null : null,
  })
  save(s); return { id, student_name: p.student_name }
}

// Open groups with a question like this one. Live only (GET /buckets/suggest).
// Returns [{id, title, member_count, similarity, ...}], or null in demo mode so the
// caller can use its own local guess.
export async function suggest(question, questionType, officeHoursId) {
  if (!live) return null
  const qs = new URLSearchParams({ question })
  if (questionType) qs.set('question_type', questionType)
  if (officeHoursId != null) qs.set('office_hours_id', officeHoursId)
  return http(`/buckets/suggest?${qs}`)
}

export async function update(id, patch) {
  if (live) return http(`/queue/${id}`, { method: 'PATCH', body: patch })
  const s = load(); const t = s.tickets.find((x) => x.id === id)
  if (t) Object.assign(t, patch); save(s)
}
// Professor answered a whole group: one call (POST /buckets/:id/resolve).
export async function resolveGroup(bucketId, tickets) {
  if (live && bucketId != null) {
    try { return await http(`/buckets/${bucketId}/resolve`, { method: 'POST' }) } catch (e) {
      if (/already done/.test(e.message)) return // someone else finished it first
      throw e
    }
  }
  await Promise.all(tickets.map((t) => update(t.id, { status: 'done' })))
}
// Student leaves the line without being helped (status "left").
export async function leave(id) {
  if (live) return http(`/queue/${id}/leave`, { method: 'POST' })
  return update(id, { status: 'left' })
}
// Professor drags a group to a spot (1 = top, counted in groups), or unpins it with null.
// Live: POST /buckets/:id/pin {group_position}
export async function pinGroup(bucketId, position) {
  if (live) return http(`/buckets/${bucketId}/pin`, { method: 'POST', body: { group_position: position } })
  const s = load()
  const groups = []
  decorate(s.tickets).forEach((t) => {
    let g = groups.find((x) => x.id === t.bucket_id)
    if (!g) groups.push((g = { id: t.bucket_id, pri: t.priority }))
  })
  const from = groups.findIndex((g) => g.id === bucketId)
  if (from < 0) return
  const [g] = groups.splice(from, 1)
  const mine = s.tickets.filter((t) => t.bucket_id === bucketId && t.status === 'waiting')
  if (position == null) { mine.forEach((t) => { t.pinned_position = null }); return save(s) }
  const at = Math.min(Math.max(position, 1), groups.length + 1) - 1
  const above = groups[at - 1], below = groups[at]
  // Demo shortcut: give the group a score between its new neighbours.
  const pri = above && below ? (above.pri > below.pri ? (above.pri + below.pri) / 2 : below.pri + 0.001) : above ? above.pri - 1 : below ? below.pri + 1 : g.pri
  mine.forEach((t) => { t.priority = pri; t.manually_changed = true; t.pinned_position = position })
  save(s)
}
// ---- office hours ----
// Live: GET /office_hours, POST /office_hours, PATCH /office_hours/:id, POST /office_hours/:id/open|close
let hoursId = null
export async function getSessions() {
  if (!live) { const h = load().hours; return [{ ...h, state: stateOf(h) }] }
  return http('/office_hours') // earliest first; each has state: upcoming | running | closed
}
// The session a class page shows: running, else the next upcoming one, else the latest.
export function bestSession(all, course) {
  const mine = course ? all.filter((x) => x.course === course) : all
  return mine.find((x) => x.state === 'running') || mine.find((x) => x.state === 'upcoming') || mine[mine.length - 1] || null
}
export function pickHours(all, course) {
  const h = bestSession(all, course)
  hoursId = h ? h.id : null
  if (!h) return null
  // Is there a later session of this course to push waiting students into when this one closes?
  const has_next = all.some((x) => x.id !== h.id && x.course === h.course && x.state !== 'closed' && x.starts_at > h.starts_at)
  return { ...h, has_next }
}
export async function createHours(p) {
  if (!live) {
    const s = load()
    if (stateOf(s.hours) !== 'closed') throw new Error('Demo mode keeps one session at a time. Wrap up the current one first.')
    s.hours = { id: (s.hours.id || 1) + 1, course: p.course, location: p.location, starts_at: p.starts_at, ends_at: p.ends_at, is_open: false, closed_at: null }
    save(s); return s.hours
  }
  return http('/office_hours', { method: 'POST', body: p })
}
export async function saveHours(patch) {
  if (!live) { const s = load(); Object.assign(s.hours, patch); save(s); return }
  const { is_open, ...fields } = patch
  if (Object.keys(fields).length) await http(`/office_hours/${hoursId}`, { method: 'PATCH', body: fields })
  if (is_open === true) await http(`/office_hours/${hoursId}/open`, { method: 'POST' })
}
// Returns a short message describing where waiting students went.
export async function wrapUp() {
  if (!live) {
    const s = load()
    // Same as the backend: waiting students count as on time for the next session and
    // get the x2 boost. Professor-set scores skip the formula, so double them directly.
    s.tickets.forEach((t) => {
      if (t.status !== 'waiting') return
      t.overflow_count += 1; t.late = false
      if (t.manually_changed) t.priority *= 2
    })
    s.hours.is_open = false; s.hours.closed_at = local(new Date()); save(s)
    return 'Wrapped up. Waiting students keep their spot with a boost.'
  }
  const r = await http(`/office_hours/${hoursId}/close`, { method: 'POST' })
  if (r.warning) return r.warning
  return `Wrapped up. ${r.moved_count} waiting ${r.moved_count === 1 ? 'student' : 'students'} moved to the next session with a boost.`
}
export const resetDemo = () => { localStorage.removeItem(KEY) }
