import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api.js'
import { CURRENT_PROFESSOR, STUDENTS } from './config.js'

const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const useStored = (k, d) => {
  const [v, setV] = useState(() => ls(k, d))
  useEffect(() => { localStorage.setItem(k, JSON.stringify(v)) }, [k, v])
  return [v, setV]
}
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0] || 'th')
const when = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
const words = (s) => s.toLowerCase().match(/[a-z]{4,}/g) || []
const PALETTE = 6 // class colors cc-0 .. cc-5 in App.css
const to12 = (hhmm) => {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`
}
// "MWF · 10:00am–10:50am · DBH 1100" for a section that came from Anteater.
const meetingText = (s) => {
  const m = (s.meetings || []).find((x) => !x.tba)
  if (!m) return 'Time TBA'
  return [m.days, `${to12(m.start)}–${to12(m.end)}`, m.location].filter(Boolean).join(' · ')
}
const sectionName = (s) => `${s.section_type} ${s.section_num}` // "Lec A", "Dis 1"

// Tickets sharing a bucket are one "conversation".
function groupUp(queue, cats) {
  const map = new Map()
  queue.forEach((t) => {
    const g = map.get(t.bucket_id) || { id: t.bucket_id, tickets: [], priority: 0 }
    g.tickets.push(t); g.priority = Math.max(g.priority, t.priority); map.set(t.bucket_id, g)
  })
  // The queue already arrives in serving order (main line by score, then the late section
  // by arrival), so groups keep that order. Don't re-sort by score here.
  return [...map.values()].map((g) => {
    const times = g.tickets.map((t) => cats[t.question_type]?.base_time ?? 3)
    return { ...g, title: g.tickets[0].question, type: g.tickets[0].question_type, mins: Math.max(...times), solo: times.reduce((a, b) => a + b, 0) }
  })
}
// In the late section at the back: joined after the session started, and not moved up.
const isLate = (g) => g.tickets.every((t) => t.in_late_section)
const isPinned = (g) => g.tickets.some((t) => t.pinned_position != null)

// ---- class colors: each class keeps the color it was given first ----
const Colors = createContext(() => 0)
// "Jordan + 5 others". Hover shows everyone; tap/click opens the full list.
function Names({ tickets }) {
  const [open, setOpen] = useState(false)
  const first = tickets[0].student_name
  const rest = tickets.length - 1
  if (rest === 0) return <span>{first}</span>
  const full = tickets.map((t) => t.student_name).join(', ')
  return (
    <>
      <button type="button" className="names" title={full} aria-expanded={open} onClick={() => setOpen(!open)}>
        {first} + {rest} {rest === 1 ? 'other' : 'others'}
      </button>
      {open && <span className="namelist"> ({full})</span>}
    </>
  )
}

// Anteater data (classes, professor courses). Kept in localStorage so a reload still
// shows the last answer while the backend is starting; retries until it gets one.
function useLoaded(key, load) {
  const [data, setData] = useStored(key, null)
  const [error, setError] = useState(null)
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    let dead = false, timer
    const go = async () => {
      try { const d = await loadRef.current(); if (!dead) { setData(d); setError(null) } } catch (e) {
        if (!dead) { setError(e.message); timer = setTimeout(go, 5000) }
      }
    }
    go()
    return () => { dead = true; clearTimeout(timer) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return [data, error]
}

// Keeps the line for ONE course in step with the backend. With no course (the dashboards)
// it still tracks every session, so the cards can show who is waiting.
function useQueue(course) {
  const [state, setState] = useState({ queue: [], cats: api.CATS, hours: null, sessions: [], live: false, ready: false })
  const tick = useRef(0)
  const seq = useRef(0)
  const courseRef = useRef(course)
  courseRef.current = course
  const refresh = useCallback(async () => {
    const mine = ++seq.current
    try {
      // Backend started after the page loaded? Look for it every few refreshes.
      if (!api.isLive() && tick.current++ % 3 === 0 && await api.probe()) {
        const cats = await api.getCategories()
        setState((s) => ({ ...s, cats }))
      }
      const sessions = await api.getSessions()
      const hours = api.pickHours(sessions, course)
      const queue = await api.getQueue(hours?.id) // only the session being shown
      // The page moved to another class, or a newer refresh started meanwhile: its answer wins.
      if (courseRef.current !== course || mine !== seq.current) return
      setState((s) => ({ ...s, queue, hours, sessions, live: api.isLive(), ready: true }))
    } catch { /* keep last data */ }
  }, [course])
  useEffect(() => { setState((s) => (s.ready ? { ...s, ready: false, queue: [], hours: null } : s)) }, [course])
  useEffect(() => {
    let id, dead = false
    api.probe().then(async () => {
      const cats = await api.getCategories()
      if (dead) return
      setState((s) => ({ ...s, cats })); refresh(); id = setInterval(refresh, 2500)
    })
    // Catch up straight away when the tab comes back, or another tab changed the demo data.
    const wake = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('storage', refresh)
    return () => {
      dead = true; clearInterval(id)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('storage', refresh)
    }
  }, [refresh])
  return [state, refresh]
}

// ---- Pages by address, so each one can sit in its own tab for a split-screen demo ----
//   /student/1, /student/2 ...   one page per student in STUDENTS (config.js)
//   /professor                   the professor
// Anything else (like "/") shows the first student. Like the real app, a page never
// links to another role: the nav bar has no student/professor switch.
const pathOf = (r) => (r.role === 'professor' ? '/professor' : `/student/${r.studentId}`)
function readRoute() {
  const m = window.location.pathname.match(/^\/(student|professor)(?:\/(\d+))?\/?$/)
  const id = Number(m?.[2])
  return {
    role: m?.[1] === 'professor' ? 'professor' : 'student',
    studentId: STUDENTS.some((x) => x.id === id) ? id : STUDENTS[0].id,
  }
}

export default function Root() {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    if (window.location.pathname !== pathOf(route)) window.history.replaceState(null, '', pathOf(route))
    const onBack = () => setRoute(readRoute())
    window.addEventListener('popstate', onBack)
    return () => window.removeEventListener('popstate', onBack)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const student = STUDENTS.find((x) => x.id === route.studentId)
  // A fresh App per page, so each profile loads and keeps its own classes and questions.
  return <App key={pathOf(route)} role={route.role} student={student} />
}

// Light or dark: the saved choice, else the device's setting.
const systemTheme = () => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
const clock = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
// Category color (cc-0 .. cc-5), fixed by the category's place in the list.
const catColor = (type, cats) => Math.max(0, Object.keys(cats).indexOf(type)) % PALETTE
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

function App({ role, student }) {
  const [theme, setTheme] = useStored('zh.theme', systemTheme())
  const [view, setView] = useState('home') // student: home | class | profile.  professor: home | course
  const [toast, setToast] = useState(null) // a message, or { msg, undo } for an undoable action
  const topRef = useRef(null)
  const [lastClass, setLastClass] = useStored(`zh.class.${student.id}`, null)
  const [proClass, setProClass] = useStored('zh.proclass', null)
  const [colors, setColors] = useStored('zh.colors', {})

  // Everything about classes comes from the Anteater API, through our backend.
  const [enrollment, enrollError] = useLoaded(`zh.enrolled.${student.id}`, () => api.loadEnrollment(student.crns))
  const [prof, profError] = useLoaded('zh.prof', () => api.loadProfessor(CURRENT_PROFESSOR.ucinetid))
  // Classes the student added in Profile (backend, or this browser in demo mode).
  const [added, setAdded] = useState([])
  const sections = useMemo(() => {
    const base = enrollment?.sections ?? []
    const have = new Set(base.map((x) => x.section_code))
    return [...base, ...added.filter((x) => !have.has(x.section_code)).map((x) => ({ ...x, added: true }))]
  }, [enrollment, added])
  const classes = useMemo(() => api.classesOf(sections), [sections])
  const proCourses = prof?.courses ?? []
  const proCourseLabels = proCourses.map((c) => c.course)

  const cur = classes.some((c) => c.course === lastClass) ? lastClass : null
  const curProClass = proCourseLabels.includes(proClass) ? proClass : null
  const me = { id: student.id, name: student.name, section: (classes.find((c) => c.course === cur)?.sections ?? []).map(sectionName).join(', ') }

  const active = role === 'student' ? (view === 'class' ? cur : null) : (view === 'course' ? curProClass : null)
  const [{ queue, cats, hours, sessions, live, ready }, refresh] = useQueue(active)
  const groups = useMemo(() => groupUp(queue, cats), [queue, cats])

  // Give every class a color the first time we see it, in order, and remember it.
  const known = [...classes.map((c) => c.course), ...proCourseLabels].join('|')
  useEffect(() => {
    const missing = known.split('|').filter((c) => c && colors[c] === undefined)
    if (missing.length) setColors((prev) => {
      const next = { ...prev }
      missing.forEach((c) => { if (next[c] === undefined) next[c] = Object.keys(next).length % PALETTE })
      return next
    })
  }, [known]) // eslint-disable-line react-hooks/exhaustive-deps
  const colorOf = useCallback((c) => colors[c] ?? 0, [colors])
  const loadAdded = useCallback(async () => {
    try { setAdded(await api.getAddedSections(student.id)) } catch { /* keep what we have */ }
  }, [student.id])
  useEffect(() => { if (role === 'student' && ready) loadAdded() }, [role, ready, live, loadAdded])
  const addClass = async (code) => { const s = await api.addSection(student.id, code); await loadAdded(); setToast(`Added ${api.courseLabel(s)}.`) }
  const removeClass = (code) => act(async () => { await api.removeSection(student.id, code); await loadAdded() }, 'Class removed.')
  // Demo mode (no backend): make sure every class has a line to show.
  useEffect(() => { if (ready && !live && known && api.ensureDemoSessions(known.split('|'))) refresh() }, [ready, live, known, sessions]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.undo ? 7000 : 3500)
    return () => clearTimeout(t)
  }, [toast])
  // The page header is sticky; other sticky things sit just under it, so share its height.
  useEffect(() => {
    const el = topRef.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--top-h', `${el.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Run an action, then show its message (a string, a function of the result, or
  // { msg, undo }) and refresh. Errors show as the message instead.
  const act = async (fn, ok) => {
    try { const r = await fn(); if (ok) setToast(typeof ok === 'function' ? ok(r) : ok); await refresh() } catch (e) { setToast(e.message) }
  }
  const undo = () => { const u = toast?.undo; setToast(null); if (u) act(u, 'Back in line.') }
  const openClass = (c) => { setLastClass(c); setView('class') }
  const openCourse = (c) => { setProClass(c); setView('course') }
  const goHome = () => setView('home')
  // Which page is really showing (a class page with no class falls back to home).
  const onHome = role === 'professor' ? !(view === 'course' && curProClass) : !(view === 'profile' || (view === 'class' && cur))

  const studentProps = { queue, groups, cats, hours, act, live, ready, me, course: cur, go: setView }
  const state = hours && (hours.state === 'running' ? 'is open' : hours.state === 'upcoming' ? `starts ${when(hours.starts_at)}` : 'has ended')

  return (
    <Colors.Provider value={colorOf}>
      <header className="top" ref={topRef}>
        <button className="logo" aria-current={onHome ? 'page' : undefined} onClick={goHome}>zot hours</button>
        <div className="top-right">
          {!live && ready && <><span className="demo-tag" title="Backend not reachable, using local demo data">Demo data</span><Sep /></>}
          {hours && <><span className={`cc cc-${colorOf(hours.course)} status ${hours.state}`}><i aria-hidden="true" />{hours.course} {state}</span><Sep /></>}
          {role === 'student' && <><button className="navbtn" aria-current={view === 'profile' ? 'page' : undefined} onClick={() => setView('profile')}>Profile</button><Sep /></>}
          <button className="navbtn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </header>
      <main className="shell">
        {!onHome && <Back go={goHome} label={role === 'professor' ? 'All courses' : 'All classes'} />}
        {role === 'professor' ? (
          view === 'course' && curProClass ? (
            <Professor {...{ groups, queue, cats, hours, act, live, ready, courses: proCourseLabels, course: curProClass, info: proCourses.find((c) => c.course === curProClass), setProClass: openCourse }} />
          ) : (
            <ProHome {...{ prof, profError, sessions, openCourse }} />
          )
        ) : view === 'profile' ? (
          <Profile {...{ me, classes, enrollment, enrollError, addClass, removeClass }} />
        ) : view === 'class' && cur ? (
          <Student {...studentProps} />
        ) : (
          <StudentHome {...{ classes, enrollment, enrollError, sessions, openClass }} />
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          <span>{toast.msg ?? toast}</span>
          {toast.undo && <button type="button" onClick={undo}>Undo</button>}
        </div>
      )}
    </Colors.Provider>
  )
}

// Thin vertical line between items in the nav bar.
function Sep() {
  return <span className="vsep" aria-hidden="true" />
}

// ---- icons: one 2px stroke set ----
function Icon({ name, size = 18 }) {
  const paths = {
    back: <path d="M15 18l-6-6 6-6" />,
    grip: <><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" /></>,
    check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`icon-${name}`}>
      {paths[name]}
    </svg>
  )
}

// Open padlock = free to move by score. Closed padlock = held in its spot.
function LockIcon({ locked }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" fill={locked ? 'currentColor' : 'none'} />
      <path d={locked ? 'M8 11V8a4 4 0 0 1 8 0v3' : 'M8 11V8a4 4 0 0 1 7.5-1.5'} />
    </svg>
  )
}

// "← All classes" / "← All courses": top left of every page below the home pages.
function Back({ go, label }) {
  return <button className="back" onClick={go}><Icon name="back" size={16} />{label}</button>
}

// A ticket: colored head band, body, then a perforated tear line and the stub below it.
// Everything in zot hours that stands for a place in line, a class or a course is one of these.
function Ticket({ color, head, children, stub, className = '', ...rest }) {
  return (
    <article className={`ticket cc cc-${color} ${className}`} {...rest}>
      {head && <div className="ticket-head">{head}</div>}
      <div className="ticket-body">{children}</div>
      {stub && <><div className="perf" aria-hidden="true" /><div className="ticket-stub">{stub}</div></>}
    </article>
  )
}

function sessionLine(sessions, course) {
  const s = api.bestSession(sessions, course)
  if (!s) return 'No sessions yet'
  const waiting = s.waiting_count != null ? ` · ${s.waiting_count} waiting` : ''
  if (s.state === 'running') return `Open now · ${s.location}${waiting}`
  if (s.state === 'upcoming') return `Next: ${when(s.starts_at)} · ${s.location}${waiting}`
  return 'Last session ended'
}

function Status({ enrollment, enrollError, what }) {
  if (enrollment) return null
  return (
    <div className="notice" role="status">
      <h2>{enrollError ? `Couldn't load ${what}` : `Loading ${what}…`}</h2>
      {enrollError && <p>{enrollError}. Retrying…</p>}
    </div>
  )
}

function SectionLines({ sections, onRemove }) {
  return (
    <ul className="seclines">
      {sections.map((s) => (
        <li key={s.section_code}>
          <b>{sectionName(s)}</b> <span>{s.section_code} · {meetingText(s)}{s.instructors.length > 0 && ` · ${s.instructors.join(', ')}`}</span>
          {onRemove && s.added && <button className="link remove" onClick={() => onRemove(s.section_code)} aria-label={`Remove ${sectionName(s)} (${s.section_code})`}>Remove</button>}
        </li>
      ))}
    </ul>
  )
}

// Profile → Add a class by its 5-digit section code, looked up on Anteater.
function AddClass({ addClass }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await addClass(code.trim()); setCode('') } catch (err) {
      const m = err.message || 'Couldn\'t add that class'
      setError(m.charAt(0).toUpperCase() + m.slice(1))
    }
    setBusy(false)
  }
  return (
    <form className="add-class" onSubmit={submit}>
      <h2>Add a class</h2>
      <div className="add-row">
        <label className="field"><span>Section code</span>
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" autoComplete="off" placeholder="35400" aria-describedby="add-help" aria-invalid={!!error} />
        </label>
        <button className="btn solid" disabled={busy || code.length !== 5}>{busy ? 'Adding…' : 'Add class'}</button>
      </div>
      <p id="add-help" className={error ? 'fine bad' : 'fine'} role={error ? 'alert' : undefined}>{error ?? 'The 5-digit code from the Schedule of Classes'}</p>
    </form>
  )
}

// One class or course as a ticket. The whole ticket opens it.
function CourseTicket({ course, title, sections, sessions, action, onOpen }) {
  const colorOf = useContext(Colors)
  const s = api.bestSession(sessions, course)
  return (
    <li>
      <Ticket
        color={colorOf(course)} className="course-ticket"
        head={<><span className="code">{course}</span>{s?.state === 'running' && <span className="live"><i aria-hidden="true" />Open now</span>}</>}
        stub={<><span>{sessionLine(sessions, course)}</span><button className="btn solid open" onClick={onOpen}>{action}</button></>}
      >
        <h2 className="course-title">{title}</h2>
        <SectionLines sections={sections} />
      </Ticket>
    </li>
  )
}

function StudentHome({ classes, enrollment, enrollError, sessions, openClass }) {
  const failed = enrollment?.failed ?? []
  return (
    <section className="page">
      <div className="page-head">
        <h1>Pick a class</h1>
        <p>Your classes this quarter</p>
      </div>
      <Status {...{ enrollment, enrollError }} what="your classes" />
      {enrollment && classes.length === 0 && <p className="notice">No classes found. Check the section codes in <code>config.js</code>.</p>}
      <ul className="wallet">
        {classes.map((c) => (
          <CourseTicket key={c.course} course={c.course} title={c.title} sections={c.sections} sessions={sessions} action="Open" onOpen={() => openClass(c.course)} />
        ))}
      </ul>
      {failed.length > 0 && <p className="fine">Not found: {failed.join('; ')}</p>}
    </section>
  )
}

function Profile({ me, classes, enrollment, enrollError, addClass, removeClass }) {
  const colorOf = useContext(Colors)
  return (
    <section className="page">
      <div className="page-head">
        <h1>Profile</h1>
        <p>Name · <b>{me.name}</b></p>
      </div>
      <Status {...{ enrollment, enrollError }} what="your classes" />
      <ul className="wallet">
        {classes.map((c) => (
          <li key={c.course}>
            <Ticket color={colorOf(c.course)} head={<span className="code">{c.course}</span>}>
              <h2 className="course-title">{c.title}</h2>
              <SectionLines sections={c.sections} onRemove={removeClass} />
            </Ticket>
          </li>
        ))}
      </ul>
      <AddClass addClass={addClass} />
    </section>
  )
}

function ProHome({ prof, profError, sessions, openCourse }) {
  const courses = prof?.courses ?? []
  const waiting = courses.reduce((a, c) => a + (api.bestSession(sessions, c.course)?.waiting_count ?? 0), 0)
  return (
    <section className="page">
      <div className="page-head">
        <h1>Your courses</h1>
        {prof && <p>{prof.name} · {prof.quarter} {prof.year} · {waiting} waiting</p>}
      </div>
      {!prof && (
        <div className="notice" role="status">
          <h2>{profError ? "Couldn't load your courses" : 'Loading your courses…'}</h2>
          {profError && <p>{profError}. Retrying…</p>}
        </div>
      )}
      {prof && courses.length === 0 && <p className="notice">No lecture courses in {prof.quarter} {prof.year}.</p>}
      <ul className="wallet">
        {courses.map((c) => (
          <CourseTicket key={c.course} course={c.course} title={c.course_title} sections={c.sections.filter((x) => x.section_type === 'Lec')} sessions={sessions} action="Open queue" onOpen={() => openCourse(c.course)} />
        ))}
      </ul>
    </section>
  )
}

// One group in the line as a stub: number column, question, who and how long, actions.
function Stub({ g, n, cats, mine, handle, actions, children, className = '', ...rest }) {
  return (
    <li className={`stub cc cc-${catColor(g.type, cats)}${mine ? ' mine' : ''} ${className}`} {...rest}>
      {handle ?? <span className="stub-num">{n}</span>}
      <div className="stub-body">
        <p className="stub-q">{g.title}</p>
        <p className="stub-meta">{children}</p>
      </div>
      {actions && <div className="stub-actions">{actions}</div>}
    </li>
  )
}

function Student({ queue, groups, cats, hours, act, live, ready, me, course, go }) {
  const colorOf = useContext(Colors)
  // [{ id, name }], kept per student, so two student tabs in one browser don't claim each
  // other's questions. Matching the name too means leftover ids from a reset database never
  // claim someone else's ticket. Student 1 picks up the list saved before there were several
  // students (zh.mine2).
  const [mine, setMine] = useStored(`zh.mine.${me.id}`, me.id === 1 ? ls('zh.mine2', []) : [])
  const [q, setQ] = useState('')
  // Students don't pick a category; a new question gets the default (same as the backend).
  const type = api.DEFAULT_CAT
  const [confirm, setConfirm] = useState(false)
  const [asking, setAsking] = useState(false) // already in line, asking another question
  const [remote, setRemote] = useState([])
  const confirmRef = useRef(null)
  const n = q.trim() ? q.trim().split(/\s+/).length : 0
  const over = n > 25
  const running = hours?.state === 'running'
  const canJoin = !!hours && hours.state !== 'closed'
  const hasProfile = !!(me.name.trim() && me.section.trim())

  const isMine = (t) => mine.some((m) => m.id === t.id && m.name === t.student_name)
  const myTickets = queue.filter(isMine)
  const myBuckets = new Set(myTickets.map((t) => t.bucket_id))

  // Live: ask the backend for similar open questions once the student pauses typing.
  useEffect(() => {
    if (!live || n < 2) { setRemote([]); return }
    let stale = false
    const t = setTimeout(async () => {
      try { const r = await api.suggest(q.trim(), null, hours?.id); if (!stale) setRemote(r || []) } catch { if (!stale) setRemote([]) }
    }, 350)
    return () => { stale = true; clearTimeout(t) }
  }, [q, live, hours?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // The "session already started" check takes focus, so keyboard users land on it.
  useEffect(() => { if (confirm) confirmRef.current?.focus() }, [confirm])

  // Demo: a simple word-overlap guess over the local queue.
  let similar = null
  if (live) {
    const b = remote.find((x) => !myBuckets.has(x.id))
    if (b) similar = { id: b.id, title: b.title, count: b.member_count }
  } else {
    const w = new Set(words(q))
    if (w.size >= 2) {
      const g = groups.find((x) => !x.tickets.some(isMine) && words(x.title).filter((y) => w.has(y)).length >= 1)
      if (g) similar = { id: g.id, title: g.title, count: g.tickets.length }
    }
  }

  // The student's most recent question still waiting (mine is in the order they asked).
  // "Your spot" shows this one, and "Fixed it" marks only this one done.
  const latest = [...mine].reverse().map((m) => myTickets.find((t) => t.id === m.id)).find(Boolean)
  // Place in line is counted in groups, the same way the line is numbered.
  const myGroupIdx = latest ? groups.findIndex((g) => g.id === latest.bucket_id) : -1
  const myGroup = groups[myGroupIdx]
  const pos = myGroupIdx + 1
  const wait = myGroupIdx < 0 ? 0 : groups.slice(0, myGroupIdx + 1).reduce((a, g) => a + g.mins, 0)
  const lateMine = !!latest?.in_late_section
  // Turn time: the backend's estimate when it sends one, otherwise the groups ahead
  // counted from now (or from the start, before the session opens).
  const turnAt = !myGroup ? null : latest.estimated_turn_at
    ? new Date(latest.estimated_turn_at)
    : new Date(Math.max(Date.now(), hours ? new Date(hours.starts_at).getTime() : 0) + (wait - myGroup.mins) * 60000)
  // Where a brand-new question would land. Once the session is running it goes behind
  // everyone already waiting; before that, it's ranked by score among on-time questions.
  const c = cats[type]
  const newPriority = c ? c.base_time + c.complexity * 3 + 5 : 10
  const nextSpot = running
    ? groups.length + 1
    : groups.filter((g) => !isLate(g) && g.priority >= newPriority).length + 1
  const nextWait = groups.slice(0, nextSpot - 1).reduce((a, g) => a + g.mins, 0) + (c?.base_time ?? 5)

  const submit = (bucket_id) => {
    setConfirm(false)
    return act(async () => {
      const t = await api.join({ student_name: me.name.trim(), class_section: me.section.trim(), question: q.trim(), bucket_id, office_hours_id: hours?.id })
      setMine((m) => [...m, { id: t.id, name: me.name.trim() }]); setQ(''); setAsking(false)
    }, 'Spot saved.')
  }
  // "Same question?" on a stub in the line: join that group as it is.
  const joinGroup = (g) => act(async () => {
    const t = await api.join({ student_name: me.name.trim(), class_section: me.section.trim(), bucket_id: g.id, office_hours_id: hours?.id })
    setMine((m) => [...m, { id: t.id, name: me.name.trim() }])
  }, 'Joined the group.')
  // A new question in a session that already started goes to the back, so ask first.
  const startNew = () => (running ? setConfirm(true) : submit())
  const ok = canJoin && hasProfile && n > 0 && !over
  // Why Save is off, in the student's terms.
  const why = !ready ? 'Loading the line…'
    : !canJoin ? 'No open office hours'
    : !hasProfile ? 'No section found for this class'
    : over ? 'Shorten your question to 25 words'
    : 'Add a question to save your spot'

  // "Fixed it" marks only the latest question done; "Leave the line" takes the student
  // out of every group they're in. Other students' tickets (like the samples) aren't touched.
  const finish = (kind) => {
    const ts = kind === 'done' ? [latest] : myTickets
    return act(async () => {
      await Promise.all(ts.map((t) => (kind === 'done' ? api.update(t.id, { status: 'done' }) : api.leave(t.id))))
    }, kind === 'done' ? 'Marked as fixed.' : 'You left the line.')
  }

  if (!course) return null
  const showForm = !myGroup || asking
  const sessionNote = hours && (hours.state === 'upcoming' ? 'Join before it starts to stay ahead.' : hours.state === 'running' ? 'In session · new questions go to the back' : 'This session has ended')

  const form = (
    <div className="ask">
      <h1>What's your question?</h1>
      {sessionNote && <p className="lede">{sessionNote}</p>}
      {ready && !canJoin ? (
        <div className="notice">
          <h2>{hours ? 'No open office hours' : 'No office hours yet'}</h2>
          <p>Check back when the next session is posted.</p>
        </div>
      ) : (
        <>
          {!hasProfile && ready && <p className="notice">No section found. Check your <button className="link" onClick={() => go('profile')}>profile</button>.</p>}
          <label className="field">
            <span>Your question</span>
            <textarea rows={3} value={q} onChange={(e) => setQ(e.target.value)} aria-describedby="wordcount" placeholder="My recursive flatten() returns None for nested lists, but works for flat ones." />
          </label>
          <div className="field-foot">
            <span>{me.name.trim() || 'nobody yet'}{me.section.trim() && ` · ${me.section.trim()}`}</span>
            <span id="wordcount" className={over ? 'bad' : ''}>{n}/25 words{over && ' · shorten it a little'}</span>
          </div>
          {similar && (
            <div className="similar">
              <h3>Similar question in line</h3>
              <p>“{similar.title}” · {similar.count} waiting</p>
              <div className="btns">
                <button className="btn solid" disabled={!ok} onClick={() => submit(similar.id)}>Join group</button>
                <button className="btn outline" disabled={!ok} onClick={startNew}>Ask separately</button>
              </div>
            </div>
          )}
          {confirm ? (
            <div className="similar" role="alertdialog" aria-labelledby="started-h" tabIndex={-1} ref={confirmRef}>
              <h3 id="started-h">Session already started</h3>
              <p>Your question goes to the back of the line · about {nextWait} min</p>
              <div className="btns">
                <button className="btn primary" onClick={() => submit()}>Join anyway</button>
                <button className="btn outline" onClick={() => setConfirm(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="save">
              <button className="btn primary wide" disabled={!ok} onClick={startNew}>Save my spot</button>
              <p className="fine">{ok ? `${ordinal(nextSpot)} in line · about ${nextWait} min` : why}</p>
              {asking && <button className="link" onClick={() => setAsking(false)}>Back to your spot</button>}
            </div>
          )}
        </>
      )}
    </div>
  )

  return (
    <div className="layout student">
      <section className="lead" aria-label="Your spot">
        {showForm ? form : (
          <>
            <h1>Your spot</h1>
            {sessionNote && <p className="lede">{sessionNote}</p>}
            <Ticket
              key={latest.id} color={colorOf(course)} className="my-ticket print"
              head={<><span className="code">{course}</span><span>{hours ? `${hours.location} · ${when(hours.starts_at)}` : ''}</span></>}
              stub={<>
                <div className="fields">
                  <div className="f turn"><small>Turn</small><strong>{clock(turnAt)}</strong></div>
                  <div className="f"><small>Place</small><strong>{ordinal(pos)}</strong></div>
                  <div className="f"><small>Group</small><strong>{myGroup.tickets.length > 1 ? `+${myGroup.tickets.length - 1}` : 'Just you'}</strong></div>
                  <div className="f"><small>Room</small><strong>{hours?.location ?? '—'}</strong></div>
                </div>
              </>}
            >
              <p className="my-q">{myGroup.title}</p>
              <p className="my-meta">About {wait} min{myGroup.tickets.length > 1 && ` · with ${plural(myGroup.tickets.length - 1, 'other', 'others')}`}</p>
              {lateMine && <p className="my-meta">Joined late · behind on-time questions</p>}
            </Ticket>
            <div className="btns spread">
              <button className="btn solid" onClick={() => finish('done')}>Fixed it, thanks</button>
              <button className="btn quiet" onClick={() => finish('left')}>Leave the line</button>
              <button className="btn outline push" onClick={() => setAsking(true)}>{myBuckets.size > 1 ? `+${myBuckets.size - 1} more · ask another` : 'Ask another question'}</button>
            </div>
          </>
        )}
      </section>

      <section className="line" aria-labelledby="line-h">
        <div className="line-head">
          <h2 id="line-h">The line right now</h2>
          <p>{groups.length > 0 ? 'Same question? Join to get helped together.' : ready ? "No one's waiting. You'd be first." : 'Loading the line…'}</p>
        </div>
        <ol className="stubs">
          {groups.map((g, i) => {
            const yours = g.tickets.some(isMine)
            return (
              <Fragment key={g.id}>
                {isLate(g) && !isLate(groups[i - 1]) && <li className="divider" aria-hidden="true"><span>Joined after start</span></li>}
                <Stub
                  g={g} n={i + 1} cats={cats} mine={yours}
                  actions={yours ? <span className="yours">Your group</span> : <button className="btn outline small" disabled={!canJoin || !hasProfile} onClick={() => joinGroup(g)} aria-label={`Same question? Join the group: ${g.title}`}>Join</button>}
                >
                  {plural(g.tickets.length, 'student', 'students')} · ~{g.mins} min
                </Stub>
              </Fragment>
            )
          })}
        </ol>
      </section>
    </div>
  )
}

function Professor({ groups, queue, cats, hours, act, live, ready, courses, course, info, setProClass }) {
  const colorOf = useContext(Colors)
  const [helped, setHelped] = useStored('zh.helped', 0)
  const [form, setForm] = useState(null)
  const [drag, setDrag] = useState(null) // { from, to } (indexes in the list) while a group is being dragged
  const refs = useRef([])
  useEffect(() => { if (hours) setForm({ location: hours.location, starts_at: hours.starts_at, ends_at: hours.ends_at }) }, [hours?.id, hours?.is_open]) // eslint-disable-line react-hooks/exhaustive-deps
  const [first, ...rest] = groups
  const left = groups.reduce((a, g) => a + g.mins, 0)
  const saved = groups.reduce((a, g) => a + g.solo - g.mins, 0)
  // Helping a group can be undone for a few seconds: its students go back to waiting.
  const finish = (g) => act(
    async () => { await api.resolveGroup(g.id, g.tickets); setHelped((h) => h + g.tickets.length) },
    {
      msg: `Helped ${g.tickets[0].student_name}${g.tickets.length > 1 ? ` + ${g.tickets.length - 1}` : ''}.`,
      undo: async () => {
        await Promise.all(g.tickets.map((t) => api.update(t.id, { status: 'waiting' })))
        setHelped((h) => Math.max(0, h - g.tickets.length))
      },
    },
  )
  // Dropping a group pins it at that spot (1 = top, counted in groups).
  const pin = (g, position) => act(() => api.pinGroup(g.id, position), `Locked in spot ${position}.`)
  const unpin = (g) => act(() => api.pinGroup(g.id, null), 'Unlocked.')

  // Drag handle: pointer events work for mouse, pen and touch. Arrow keys move a group too.
  const dropTo = (clientY, from) => {
    let to = 0
    groups.forEach((_, i) => {
      if (i === from) return
      const r = refs.current[i]?.getBoundingClientRect()
      if (r && clientY > r.top + r.height / 2) to++
    })
    return to
  }
  // While dragging, a floating copy of the stub follows the pointer. drag also keeps where
  // it was grabbed (dy) and its box (left, width), so the copy lines up under it.
  const handleProps = (g, i) => ({
    type: 'button',
    'aria-label': `Move “${g.title}”. Drag it, or press the up and down arrow keys.`,
    onPointerDown: (e) => {
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      const r = refs.current[i]?.getBoundingClientRect()
      setDrag({ from: i, to: i, y: e.clientY, dy: r ? e.clientY - r.top : 0, left: r?.left ?? 0, width: r?.width ?? 400 })
    },
    onPointerMove: (e) => { if (drag && drag.from === i) setDrag({ ...drag, to: dropTo(e.clientY, i), y: e.clientY }) },
    onPointerUp: () => { const d = drag; setDrag(null); if (d && d.from === i && d.to !== i) pin(g, d.to + 1) },
    onPointerCancel: () => setDrag(null),
    onKeyDown: (e) => {
      if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); pin(g, i) }
      if (e.key === 'ArrowDown' && i < groups.length - 1) { e.preventDefault(); pin(g, i + 2) }
    },
  })
  // Lock = held in its spot. Closed lock: click to release. Open lock: click to hold it where it is.
  const lockBtn = (g, i) => {
    const pinned = isPinned(g)
    return (
      <button
        type="button" className={`lock${pinned ? ' on' : ''}`} aria-pressed={pinned}
        aria-label={pinned ? `Unlock “${g.title}”. The score decides its spot again.` : `Lock “${g.title}” in spot ${i + 1}.`}
        title={pinned ? 'Locked in this spot. Click to unlock.' : 'Click to lock it in this spot.'}
        onClick={() => (pinned ? unpin(g) : pin(g, i + 1))}
      ><LockIcon locked={pinned} /></button>
    )
  }
  const dragClass = (i) => {
    if (!drag) return ''
    if (i === drag.from) return ' dragging'
    if (drag.to === drag.from || i !== drag.to) return ''
    return drag.to < drag.from ? ' drop-before' : ' drop-after'
  }
  const sessionAction = hours && (
    hours.state === 'upcoming' ? <button className="btn solid" onClick={() => act(() => api.saveHours({ is_open: true }), 'Office hours open.')}>Open now</button>
    : hours.state === 'running' ? <button className="btn outline" onClick={() => act(() => api.wrapUp(), (msg) => msg)}>Wrap up</button>
    : <span className="ended">Ended</span>
  )

  return (
    <div className="pro-page">
      <div className="pro-bar">
        <div className="tabs" role="tablist" aria-label="Course">
          {courses.map((c) => (
            <button key={c} role="tab" aria-selected={course === c} className={`tab cc cc-${colorOf(c)}`} onClick={() => setProClass(c)}>
              <i aria-hidden="true" />{c}
            </button>
          ))}
        </div>
        <div className="pro-session">
          <span>{info?.course_title}</span>
          {sessionAction}
        </div>
      </div>

      <div className="pro-sum">
        <h1>{plural(queue.length, 'student', 'students')} · {plural(groups.length, 'group', 'groups')}</h1>
        <p>{left} min left · <b>{saved} min saved</b> by grouping · {helped} helped today</p>
      </div>

      <div className="layout pro">
        <section className="lead" aria-label="Next up">
          {first ? (
            <Ticket
              key={first.id} color={catColor(first.type, cats)} className={`now print${dragClass(0)}`}
              ref={(el) => { refs.current[0] = el }}
              head={<><span className="code">Next up · {cats[first.type]?.label || first.type}</span><span>about {first.mins} min{first.solo > first.mins && ` · saves ${first.solo - first.mins} min`}</span></>}
              stub={<>
                <button className="btn primary big" onClick={() => finish(first)}><Icon name="check" />{first.tickets.length > 1 ? 'Start with all' : 'Start with this student'}</button>
                <div className="tools">
                  <button className="grip" {...handleProps(first, 0)}><Icon name="grip" /></button>
                  {lockBtn(first, 0)}
                </div>
              </>}
            >
              <h2 className="now-q">{first.title}</h2>
              <p className="now-who"><Names tickets={first.tickets} /></p>
            </Ticket>
          ) : (
            <div className="notice empty"><h2>Queue is empty</h2><p>New questions show up here.</p></div>
          )}
        </section>

        <aside className="line" aria-labelledby="after-h">
          {rest.length > 0 && (
            <div className="line-head">
              <h2 id="after-h">After that</h2>
              <p>Drag to reorder · click a lock to hold or release a spot</p>
            </div>
          )}
          <ol className="stubs">
            {rest.map((g, k) => {
              const i = k + 1
              return (
                <Fragment key={g.id}>
                  {isLate(g) && !isLate(groups[i - 1]) && <li className="divider" aria-hidden="true"><span>Joined after start</span></li>}
                  <Stub
                    g={g} n={i + 1} cats={cats} className={`pro-stub${dragClass(i)}`}
                    ref={(el) => { refs.current[i] = el }}
                    handle={<button className="stub-num handle" {...handleProps(g, i)}><span>{i + 1}</span><Icon name="grip" size={16} /></button>}
                    actions={<><button className="btn outline small" onClick={() => finish(g)}>{g.tickets.length > 1 ? 'Help together' : 'Help'}</button>{lockBtn(g, i)}</>}
                  >
                    <Names tickets={g.tickets} /> · ~{g.mins} min
                    {g.tickets.some((t) => t.overflow_count > 0) && ' · from last session'}
                    {isLate(g) && ' · late'}
                  </Stub>
                </Fragment>
              )
            })}
          </ol>

          {hours && form && (
            <details className="session">
              <summary>Office hours · {hours.location} · {when(hours.starts_at)}</summary>
              <div className="form">
                <label className="field"><span>Location</span><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
                <div className="row2">
                  <label className="field"><span>Starts</span><input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></label>
                  <label className="field"><span>Ends</span><input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></label>
                </div>
                <div className="btns">
                  <button className="btn solid" onClick={() => act(() => api.saveHours(form), 'Saved.')}>Save changes</button>
                  {!live && <button className="link" onClick={() => { api.resetDemo(); Object.keys(localStorage).filter((k) => k.startsWith('zh.mine')).forEach((k) => localStorage.removeItem(k)); location.reload() }}>Reset demo data</button>}
                </div>
              </div>
            </details>
          )}
          {live && hours?.state === 'running' && !hours.has_next && queue.length > 0 && (
            <p className="fine">No later session · {queue.length} waiting will stay here</p>
          )}
          <NewSession act={act} course={course} courses={courses} alwaysOpen={ready && !hours} onCreated={setProClass} />
        </aside>
      </div>

      {drag && groups[drag.from] && (
        <ol className="stubs floating" aria-hidden="true" style={{ top: drag.y - drag.dy, left: drag.left, width: drag.width }}>
          <Stub g={groups[drag.from]} n={drag.from + 1} cats={cats}>
            {plural(groups[drag.from].tickets.length, 'student', 'students')} · ~{groups[drag.from].mins} min
          </Stub>
        </ol>
      )}
    </div>
  )
}

function NewSession({ act, course, courses, alwaysOpen, onCreated }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState(() => ({ course: course || '', location: '', starts_at: api.inHours(24), ends_at: api.inHours(26) }))
  useEffect(() => { if (course) setF((x) => ({ ...x, course })) }, [course])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const valid = f.course.trim() && f.location.trim() && f.starts_at && f.ends_at && f.ends_at > f.starts_at

  if (!open && !alwaysOpen) {
    return <button className="btn outline" onClick={() => setOpen(true)}>Schedule a session</button>
  }
  return (
    <div className="form new-session">
      <h2>{alwaysOpen ? 'Schedule your first session' : 'New session'}</h2>
      <div className="row2">
        <label className="field"><span>Course</span>
          {courses.length > 0
            ? <select value={f.course} onChange={set('course')}>{courses.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            : <input value={f.course} onChange={set('course')} placeholder="COMPSCI 161" />}
        </label>
        <label className="field"><span>Location</span><input value={f.location} onChange={set('location')} placeholder="DBH 1100" /></label>
      </div>
      <div className="row2">
        <label className="field"><span>Starts</span><input type="datetime-local" value={f.starts_at} onChange={set('starts_at')} /></label>
        <label className="field"><span>Ends</span><input type="datetime-local" value={f.ends_at} onChange={set('ends_at')} /></label>
      </div>
      {f.starts_at && f.ends_at && f.ends_at <= f.starts_at && <p className="fine bad">End time must be after start time.</p>}
      <div className="btns">
        <button className="btn solid" disabled={!valid} onClick={() => act(async () => {
          await api.createHours({ course: f.course.trim(), location: f.location.trim(), starts_at: f.starts_at, ends_at: f.ends_at })
          onCreated(f.course.trim())
          setOpen(false)
        }, 'Session scheduled.')}>Schedule session</button>
        {!alwaysOpen && <button className="btn outline" onClick={() => setOpen(false)}>Cancel</button>}
      </div>
    </div>
  )
}
