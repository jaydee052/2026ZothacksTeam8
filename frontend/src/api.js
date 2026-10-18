// Talks to the Flask API. If the backend isn't running, falls back to a local
// demo store (localStorage) so the UI is fully usable on its own.
import { ANTEATER_TERM, API_BASE as BASE } from './config.js'

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
// Used only when the backend isn't running. It starts with no sessions; each session
// scheduled in the app starts with the sample questions below.
const KEY = 'zh.demo3'
const pad = (n) => String(n).padStart(2, '0')
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
// A local "YYYY-MM-DDTHH:mm" string, h hours from now (what datetime-local inputs and the API use).
export const inHours = (h) => local(new Date(Date.now() + h * 3600000))
// upcoming -> running (opened, or start time passed) -> closed, same as the backend
const stateOf = (h) => (h.closed_at ? 'closed' : h.is_open || local(new Date()) >= h.starts_at ? 'running' : 'upcoming')
const seed = () => ({ next: 1, nextHours: 1, sessions: [], tickets: [] })
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || seed() } catch { return seed() } }
const save = (s) => localStorage.setItem(KEY, JSON.stringify(s))
// Every new session starts with MIN_GROUPS of these, so the line is never empty in a demo.
// Same list as backend/sample_questions.py; change both together. [question, category, [[name, section], ...]]
const MIN_GROUPS = 4
const SAMPLE_QUESTIONS = [
  ['Can you walk through how recursion builds up the call stack?', 'understanding_topic', [['Alex Kim', 'Lec A']]],
  ['Why did I lose points on the hidden test cases for the last homework?', 'grading', [['Priya Shah', 'Lec A'], ['Marcus Chen', 'Lec B']]],
  ['Is the midterm open notes?', 'quick_qa', [['Sam Rivera', 'Lec B']]],
  ['How can I get involved in undergraduate research in this area?', 'research', [['Chris Patel', 'Lec A']]],
  ['Can I switch my discussion section to the Friday one?', 'scheduling', [['Taylor Nguyen', 'Lec A']]],
]
function addSamples(s, office_hours_id) {
  for (const [question, question_type, students] of SAMPLE_QUESTIONS.slice(0, MIN_GROUPS)) {
    const bucket_id = s.next
    for (const [student_name, class_section] of students) {
      s.tickets.push({
        id: s.next++, office_hours_id, student_name, class_section, question, question_type, status: 'waiting',
        created_at: new Date().toISOString(), bucket_id, overflow_count: 0, manually_changed: false, priority: 0,
        late: false, pinned_position: null,
      })
    }
  }
}
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

// ---- Anteater data (asked directly, not through our backend) ----
const ANTEATER = 'https://anteaterapi.com/v2/rest'
async function anteater(path, params = {}) {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${ANTEATER}${path}${qs ? `?${qs}` : ''}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Anteater API returned ${res.status}`)
  return (await res.json()).data
}
const clock = (t) => (t ? `${pad(t.hour)}:${pad(t.minute)}` : null)
const bldgs = (b) => (b || []).map((x) => x.trim()).filter((x) => x && x !== 'TBA').join(', ') || null
const meetingOf = (m) => (m.timeIsTBA
  ? { tba: true, days: null, start: null, end: null, location: null }
  : { tba: false, days: m.days, start: clock(m.startTime), end: clock(m.endTime), location: bldgs(m.bldg) })
// One WebSoc section flattened together with its course (same shape the backend used).
const sectionOf = (course, s) => ({
  section_code: s.sectionCode, section_type: s.sectionType, section_num: s.sectionNum,
  course_id: course.courseId, department: course.deptCode, course_number: course.courseNumber, course_title: course.courseTitle,
  instructors: (s.instructors || []).filter((n) => n !== 'STAFF'),
  meetings: (s.meetings || []).map(meetingOf),
  enrolled: Number(s.numCurrentlyEnrolled?.totalEnrolled || 0), capacity: Number(s.maxCapacity || 0), status: s.status,
  year: ANTEATER_TERM.year, quarter: ANTEATER_TERM.quarter,
})
function* websocCourses(data) {
  for (const school of data?.schools ?? []) for (const dept of school.departments) for (const course of dept.courses) yield course
}

// One label per course, used everywhere: office hours are saved under it, and a
// student's class matches a professor's session by it. "COMPSCI 161".
export const courseLabel = (x) => `${x.department} ${x.course_number}`

// Look up each of the student's section codes (CRNs) on Anteater.
// Returns { sections, failed }; a code Anteater doesn't know ends up in failed.
export async function loadEnrollment(crns) {
  const results = await Promise.allSettled(crns.map((sectionCodes) => anteater('/websoc', { ...ANTEATER_TERM, sectionCodes })))
  if (results.length && results.every((r) => r.status === 'rejected')) throw results[0].reason // Anteater unreachable: let the page retry
  const sections = [], failed = []
  results.forEach((r, i) => {
    let found = null
    if (r.status === 'fulfilled') {
      for (const course of websocCourses(r.value)) {
        const s = course.sections.find((x) => x.sectionCode === crns[i] && !x.isCancelled)
        if (s) found = sectionOf(course, s)
      }
    }
    if (found) sections.push(found)
    else failed.push(`${crns[i]}: ${r.status === 'rejected' ? r.reason.message : `no section in ${ANTEATER_TERM.quarter} ${ANTEATER_TERM.year}`}`)
  })
  return { sections, failed }
}
// Group a student's sections into classes: [{ course, title, sections: [...] }].
export function classesOf(sections) {
  const map = new Map()
  sections.forEach((s) => {
    const course = courseLabel(s)
    const c = map.get(course) || { course, title: s.course_title, sections: [] }
    c.sections.push(s); map.set(course, c)
  })
  return [...map.values()]
}
// A professor's profile and the courses they lecture this term. Independent study,
// seminars and thesis units are left out: only courses with a lecture they teach.
export async function loadProfessor(ucinetid) {
  const profile = await anteater(`/instructors/${encodeURIComponent(ucinetid)}`)
  if (!profile) throw new Error(`no instructor with UCInetID ${ucinetid}`)
  // WebSoc lists instructors as "SHINDLER, M.". Search by last name, then keep only
  // sections naming one of this professor's exact names.
  const names = new Set(profile.shortenedNames)
  const websocName = [...names].find((n) => n.includes(',')) || profile.name.split(' ').pop()
  const data = await anteater('/websoc', { ...ANTEATER_TERM, instructorName: websocName.split(',')[0].trim() })
  const courses = []
  for (const course of websocCourses(data)) {
    const mine = course.sections.filter((s) => !s.isCancelled && (s.instructors || []).some((n) => names.has(n)))
    if (!mine.some((s) => s.sectionType === 'Lec')) continue
    const entry = {
      course_id: course.courseId, department: course.deptCode, course_number: course.courseNumber, course_title: course.courseTitle,
      sections: course.sections.filter((s) => !s.isCancelled).map((s) => sectionOf(course, s)),
    }
    courses.push({ ...entry, course: courseLabel(entry) })
  }
  return {
    ucinetid: profile.ucinetid, name: profile.name, title: profile.title, email: profile.email, department: profile.department,
    year: ANTEATER_TERM.year, quarter: ANTEATER_TERM.quarter, courses,
  }
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
  if (officeHoursId == null) return []
  if (live) return http(`/queue?office_hours_id=${officeHoursId}`)
  return decorate(load().tickets.filter((t) => t.office_hours_id === officeHoursId))
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
  const session = s.sessions.find((x) => x.id === (p.office_hours_id ?? hoursId))
  if (!session) throw new Error('There are no office hours to join.')
  // A student joining a group takes on that group's category and lateness, same as the backend.
  const buddy = p.bucket_id != null ? s.tickets.find((t) => t.bucket_id === p.bucket_id) : null
  s.tickets.push({
    id, office_hours_id: session.id, student_name: p.student_name, class_section: p.class_section, question: p.question ?? buddy?.question,
    question_type: buddy ? buddy.question_type : p.question_type, status: 'waiting', created_at: new Date().toISOString(),
    bucket_id: p.bucket_id ?? id, overflow_count: buddy ? buddy.overflow_count : 0, manually_changed: false, priority: 0,
    late: buddy ? buddy.late : stateOf(session) === 'running', pinned_position: buddy ? buddy.pinned_position ?? null : null,
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
  const home = s.tickets.find((t) => t.bucket_id === bucketId)?.office_hours_id
  decorate(s.tickets.filter((t) => t.office_hours_id === home)).forEach((t) => {
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
  if (!live) {
    const s = load()
    return s.sessions.map((h) => ({ ...h, state: stateOf(h), waiting_count: s.tickets.filter((t) => t.office_hours_id === h.id && t.status === 'waiting').length }))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  }
  return http('/office_hours') // earliest first; each has state: upcoming | running | closed
}
// The session a class page shows: running, else the next upcoming one, else the latest.
export function bestSession(all, course) {
  const mine = course ? all.filter((x) => x.course === course) : all
  return mine.find((x) => x.state === 'running') || mine.find((x) => x.state === 'upcoming') || mine[mine.length - 1] || null
}
export function pickHours(all, course) {
  const h = course ? bestSession(all, course) : null // no course: a dashboard, no single line to show
  hoursId = h ? h.id : null
  if (!h) return null
  // Is there a later session of this course to push waiting students into when this one closes?
  const has_next = all.some((x) => x.id !== h.id && x.course === h.course && x.state !== 'closed' && x.starts_at > h.starts_at)
  return { ...h, has_next }
}
export async function createHours(p) {
  if (!live) {
    const s = load()
    const clash = s.sessions.find((x) => x.course === p.course && !x.closed_at && x.starts_at < p.ends_at && x.ends_at > p.starts_at)
    if (clash) throw new Error(`overlaps another ${p.course} session (${clash.starts_at} to ${clash.ends_at}, ${clash.location})`)
    const h = { id: s.nextHours++, course: p.course, location: p.location, starts_at: p.starts_at, ends_at: p.ends_at, is_open: false, closed_at: null }
    s.sessions.push(h); addSamples(s, h.id); save(s); return h
  }
  return http('/office_hours', { method: 'POST', body: p })
}
export async function saveHours(patch) {
  if (!live) { const s = load(); Object.assign(s.sessions.find((x) => x.id === hoursId) || {}, patch); save(s); return }
  const { is_open, ...fields } = patch
  if (Object.keys(fields).length) await http(`/office_hours/${hoursId}`, { method: 'PATCH', body: fields })
  if (is_open === true) await http(`/office_hours/${hoursId}/open`, { method: 'POST' })
}
// Returns a short message describing where waiting students went.
export async function wrapUp() {
  if (!live) {
    const s = load()
    const h = s.sessions.find((x) => x.id === hoursId)
    if (!h) return 'Nothing to wrap up.'
    const next = s.sessions.find((x) => x.id !== h.id && x.course === h.course && !x.closed_at && x.starts_at > h.starts_at)
    // Same as the backend: waiting students move to the next session of the course, count
    // as on time there and get the x2 boost. Professor-set scores skip the formula, so
    // double them directly. With no next session they stay put.
    let moved = 0
    if (next) s.tickets.forEach((t) => {
      if (t.status !== 'waiting' || t.office_hours_id !== h.id) return
      t.office_hours_id = next.id; t.overflow_count += 1; t.late = false; moved++
      if (t.manually_changed) t.priority *= 2
    })
    h.is_open = false; h.closed_at = local(new Date()); save(s)
    return next ? `Wrapped up. ${moved} waiting ${moved === 1 ? 'student' : 'students'} moved to the next session with a boost.` : 'Wrapped up.'
  }
  const r = await http(`/office_hours/${hoursId}/close`, { method: 'POST' })
  if (r.warning) return r.warning
  return `Wrapped up. ${r.moved_count} waiting ${r.moved_count === 1 ? 'student' : 'students'} moved to the next session with a boost.`
}
export const resetDemo = () => { localStorage.removeItem(KEY) }
