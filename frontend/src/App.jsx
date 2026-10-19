import { Fragment, createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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
const SWIPE_AT = 0.3 // share of a ticket's width it must be swiped to count

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
  // Fade between light and dark instead of flipping every color at once: a cross-fade of the
  // whole page where the browser can, else a short color transition on everything.
  const switchTheme = (next) => {
    const root = document.documentElement
    const apply = () => { root.dataset.theme = next; flushSync(() => setTheme(next)) }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return apply()
    if (document.startViewTransition) return void document.startViewTransition(apply)
    root.classList.add('theme-fade')
    apply()
    setTimeout(() => root.classList.remove('theme-fade'), 400)
  }
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
    try { const r = await fn(); if (ok) setToast(typeof ok === 'function' ? ok(r) : ok); await refresh() } catch (e) { setToast({ msg: e.message, tone: 'error' }) }
  }
  const undo = () => { const u = toast?.undo; setToast(null); if (u) act(u, 'Back in line.') }
  const openClass = (c) => { setLastClass(c); setView('class') }
  const openCourse = (c) => { setProClass(c); setView('course') }
  const goHome = () => setView('home')
  // Which page is really showing (a class page with no class falls back to home).
  const onHome = role === 'professor' ? !(view === 'course' && curProClass) : !(view === 'profile' || (view === 'class' && cur))

  const studentProps = { queue, groups, cats, hours, act, live, ready, me, course: cur, title: classes.find((c) => c.course === cur)?.title, go: setView }
  const state = hours && (hours.state === 'running' ? 'is open' : hours.state === 'upcoming' ? `starts ${when(hours.starts_at)}` : 'has ended')

  return (
    <Colors.Provider value={colorOf}>
      <header className="top" ref={topRef}>
        <div className="top-in">
          <button className="logo" aria-current={onHome ? 'page' : undefined} onClick={goHome} title={role === 'professor' ? 'All courses' : 'All classes'}>
            <span className="logo-zot">Zot</span>Hours
          </button>
          <span className="role-tag">{role === 'professor' ? 'Instructor' : 'Student'}</span>
          <div className="top-status">
            {!live && ready && <span className="chip warn" title="Backend not reachable, using local demo data"><i aria-hidden="true" />Demo data</span>}
            {hours && <span className={`chip status cc cc-${colorOf(hours.course)} ${hours.state}`}><i aria-hidden="true" />{hours.course} {state}</span>}
          </div>
          <div className="top-right">
            {role === 'student' && (
              <button className="navbtn" aria-current={view === 'profile' ? 'page' : undefined} onClick={() => setView('profile')}>
                <span className="avatar" aria-hidden="true">{initials(student.name)}</span><span className="navlabel">Profile</span>
              </button>
            )}
            <button className="iconbtn" onClick={() => switchTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
          </div>
        </div>
      </header>
      <main className="shell">
        {/* Class pages have their own back button, next to the course strip. */}
        {view === 'profile' && role === 'student' && <Back go={goHome} label="All classes" />}
        {role === 'professor' ? (
          view === 'course' && curProClass ? (
            ready
              ? <Professor {...{ groups, queue, cats, hours, act, live, ready, courses: proCourseLabels, course: curProClass, info: proCourses.find((c) => c.course === curProClass), setProClass: openCourse, goHome }} />
              : <Loading what="the queue" layout="pro" />
          ) : (
            <ProHome {...{ prof, profError, sessions: ready ? sessions : null, openCourse }} />
          )
        ) : view === 'profile' ? (
          <Profile {...{ me, classes, enrollment, enrollError, addClass, removeClass }} />
        ) : view === 'class' && cur ? (
          ready ? <Student {...studentProps} /> : <Loading what="the line" layout="student" />
        ) : (
          <StudentHome {...{ classes, enrollment, enrollError, sessions: ready ? sessions : null, openClass }} />
        )}
      </main>
      <div className="toaster" role="status" aria-live="polite">
        {toast && (
          <div key={toast.msg ?? toast} className={`toast ${toast.tone ?? 'ok'}${toast.undo ? ' has-undo' : ''}`}>
            <span className="toast-icon" aria-hidden="true"><Icon name={toast.tone === 'error' ? 'alert' : 'check'} size={16} /></span>
            <span className="toast-msg">{toast.msg ?? toast}</span>
            {toast.undo && <button type="button" onClick={undo}>Undo</button>}
            {toast.undo && <span className="toast-timer" aria-hidden="true" />}
          </div>
        )}
      </div>
    </Colors.Provider>
  )
}

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')

// ---- icons: one 2px stroke set ----
function Icon({ name, size = 18 }) {
  const paths = {
    back: <path d="M15 18l-6-6 6-6" />,
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    grip: <><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" /></>,
    check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
    alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5v.01" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    pin: <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
    chat: <path d="M4 5h16v11H9l-5 4z" />,
    down: <path d="M6 9l6 6 6-6" />,
    person: <><circle cx="12" cy="7" r="3.5" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
    users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.2a6.5 6.5 0 0 1 3.5 5.8" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" /></>,
    moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    inbox: <><path d="M3 13l3-8h12l3 8v6H3z" /><path d="M3 13h5l1.5 3h5L16 13h5" /></>,
    // Points left, the way a ticket goes when it's passed to a TA.
    handoff: <><circle cx="16" cy="7" r="3.2" /><path d="M10.5 19a5.5 5.5 0 0 1 11 0M9 12H2.5M5.5 9l-3 3 3 3" /></>,
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

// A ticket: a head band in the class or category color, the body, then a perforated tear
// line (punched notches on both edges) and the stub. Classes, courses and a place in line
// are all tickets.
// tear="head" puts the tear line under the head band instead (Next up tears off at the top).
// --perf-y (the tear line's height in the card) lets CSS cut the notches out of the card itself.
function Card({ color, head, children, foot, tear = 'foot', className = '', ref, ...rest }) {
  const own = useRef(null)
  useLayoutEffect(() => {
    const card = own.current, line = card?.querySelector(':scope > .perf')
    if (!line) return
    const place = () => card.style.setProperty('--perf-y', `${card.clientTop + line.offsetTop + 1}px`)
    place()
    const ro = new ResizeObserver(place)
    ro.observe(card)
    return () => ro.disconnect()
  }, [])
  const setRef = (el) => {
    own.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }
  const perf = <div className="perf" aria-hidden="true" />
  return (
    <article ref={setRef} className={`card${color != null ? ` cc cc-${color}` : ''} tear-${tear} ${className}`} {...rest}>
      {head && <div className="card-head">{head}</div>}
      {head && tear === 'head' && perf}
      <div className="card-body">{children}</div>
      {foot && <>{tear === 'foot' && perf}<div className="card-foot">{foot}</div></>}
    </article>
  )
}

// Printed barcode on a class ticket, from its section code. Decoration only.
function Barcode({ code }) {
  return (
    <span className="barcode" aria-hidden="true">
      <span className="bars" />
      <span className="serial">No. {code}</span>
    </span>
  )
}

// "● COMPSCI 161": the class code with its color dot, used wherever a class is named.
function CourseCode({ course }) {
  return <span className="course-code"><i aria-hidden="true" />{course}</span>
}

// The top of a class page in one line, shaped like a ticket: the course code on a color stub,
// then the title and where/when, then anything else (the professor's figures and session button).
// onBack: a back button on its left (to all classes), in the same row, so it takes no line of its own.
function CourseStrip({ course, title, hours, heading: Heading = 'p', onBack, backLabel, children }) {
  const colorOf = useContext(Colors)
  return (
    <div className="strip-row">
      {onBack && <button className="strip-back" onClick={onBack} aria-label={backLabel} title={backLabel}><Icon name="back" size={22} /></button>}
      <div className={`course-strip cc cc-${colorOf(course)}`}>
        <span className="cs-code"><CourseCode course={course} /></span>
        <div className="cs-main">
          {title && <Heading className="cs-title">{title}</Heading>}
          {hours && <span className="class-where"><Icon name="pin" size={15} />{hours.location} · {when(hours.starts_at)}</span>}
        </div>
        {children}
      </div>
    </div>
  )
}

// sessions is null until the first load.
function sessionLine(sessions, course) {
  if (!sessions) return <span className="sk-text">Loading sessions…</span>
  const s = api.bestSession(sessions, course)
  if (!s) return 'No sessions yet'
  const waiting = s.waiting_count != null ? ` · ${s.waiting_count} waiting` : ''
  if (s.state === 'running') return `Open now · ${s.location}${waiting}`
  if (s.state === 'upcoming') return `Next: ${when(s.starts_at)} · ${s.location}${waiting}`
  return 'Last session ended'
}

function Status({ enrollment, enrollError, what }) {
  if (enrollment) return null
  return <LoadNotice error={enrollError} what={what} />
}

// Loading: blank tickets with shimmering lines where the data will go. layout="pro" or
// "student" sketches a class page (the big ticket and the line); without it, a few course
// tickets. It fades in after a moment, so a quick load doesn't flash it.
function Loading({ what, layout }) {
  const lines = (...widths) => widths.map((w, i) => <span key={i} className="sk" style={{ width: w }} />)
  const ticket = (key, big) => (
    <Card key={key} tear={big ? 'head' : 'foot'} className={`load-ticket${big ? ' big' : ''}`} head={lines('30%')} foot={lines('24%')}>
      <span className="sk sk-title" />
      {lines('85%', '55%')}
    </Card>
  )
  return (
    <div className="loading" role="status">
      <p className="load-msg"><span className="spinner" aria-hidden="true" />Loading {what}…</p>
      {layout ? (
        <div className={`layout ${layout}`} aria-hidden="true">
          <div className="lead">{ticket('now', true)}</div>
          <div className="side">
            <div className="card line">
              {lines('40%')}
              <ol className="stubs">
                {[0, 1, 2].map((i) => (
                  <li key={i}><div className="qrow load-row"><span className="qrow-grip" /><div className="qrow-main">{lines('80%', '45%')}</div></div></li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      ) : (
        <div className="wallet" aria-hidden="true">{[0, 1].map((i) => ticket(i))}</div>
      )}
    </div>
  )
}

// Loading tickets, or the error with a note that it's retrying.
function LoadNotice({ error, what }) {
  if (!error) return <Loading what={what} />
  return (
    <div className={`notice${error ? ' error' : ''}`} role="status">
      {error ? <span className="notice-icon"><Icon name="alert" /></span> : <span className="spinner" aria-hidden="true" />}
      <div>
        <h2>{error ? `Couldn't load ${what}` : `Loading ${what}…`}</h2>
        {error && <p>{error}. Retrying…</p>}
      </div>
    </div>
  )
}

function SectionLines({ sections, onRemove }) {
  return (
    <ul className="seclines">
      {sections.map((s) => (
        <li key={s.section_code}>
          <b className="sec-name">{sectionName(s)}</b> <span>{s.section_code} · {meetingText(s)}{s.instructors.length > 0 && ` · ${s.instructors.join(', ')}`}</span>
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
    <form className="card add-class" onSubmit={submit}>
      <h2>Add a class</h2>
      <div className="add-row">
        <label className="field"><span>Section code</span>
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" autoComplete="off" placeholder="35400" aria-describedby="add-help" aria-invalid={!!error} />
        </label>
        <button className="btn primary" disabled={busy || code.length !== 5}><Icon name="plus" size={16} />{busy ? 'Adding…' : 'Add class'}</button>
      </div>
      <p id="add-help" className={error ? 'fine bad' : 'fine'} role={error ? 'alert' : undefined}>{error ?? 'The 5-digit code from the Schedule of Classes'}</p>
    </form>
  )
}

// One class or course as a card. The whole card opens it.
function CourseTicket({ course, title, sections, sessions, action, onOpen }) {
  const colorOf = useContext(Colors)
  const s = sessions && api.bestSession(sessions, course)
  return (
    <li>
      <Card
        color={colorOf(course)} className={`course-card${s?.state === 'running' ? ' is-live' : ''}`}
        head={<CourseCode course={course} />}
        foot={<>
          <span className="session-line"><Icon name="clock" size={16} />{sessionLine(sessions, course)}</span>
          <span className="foot-row">
            {sections[0] && <Barcode code={sections[0].section_code} />}
            <button className="btn primary open" onClick={onOpen}>{action}<Icon name="arrow" size={16} /></button>
          </span>
        </>}
      >
        <h2 className="course-title">{title}</h2>
        <SectionLines sections={sections} />
      </Card>
    </li>
  )
}

function StudentHome({ classes, enrollment, enrollError, sessions, openClass }) {
  const failed = enrollment?.failed ?? []
  return (
    <section className="page">
      <div className="page-head">
        <p className="eyebrow">This quarter</p>
        <h1>Pick a class</h1>
        <p>Open a class to see its office hours and save your spot in line.</p>
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
      <div className="profile-head">
        <span className="avatar big" aria-hidden="true">{initials(me.name)}</span>
        <div className="page-head">
          <p className="eyebrow">Profile</p>
          <h1>{me.name}</h1>
          <p>{plural(classes.length, 'class', 'classes')} this quarter</p>
        </div>
      </div>
      <div className="profile-grid">
        <div className="profile-classes">
          <div className="section-head"><h2>Your classes</h2></div>
          <Status {...{ enrollment, enrollError }} what="your classes" />
          <ul className="wallet one">
            {classes.map((c) => (
              <li key={c.course}>
                <Card color={colorOf(c.course)} head={<CourseCode course={c.course} />}>
                  <h3 className="course-title">{c.title}</h3>
                  <SectionLines sections={c.sections} onRemove={removeClass} />
                </Card>
              </li>
            ))}
          </ul>
        </div>
        <AddClass addClass={addClass} />
      </div>
    </section>
  )
}

function ProHome({ prof, profError, sessions, openCourse }) {
  const courses = prof?.courses ?? []
  const waiting = courses.reduce((a, c) => a + (api.bestSession(sessions ?? [], c.course)?.waiting_count ?? 0), 0)
  return (
    <section className="page">
      <div className="page-head">
        <p className="eyebrow">{prof ? `${prof.quarter} ${prof.year}` : 'This quarter'}</p>
        <h1>Your courses</h1>
        {prof && <p>{prof.name}{sessions && <> · <b>{waiting} waiting</b> across all courses</>}</p>}
      </div>
      {!prof && <LoadNotice error={profError} what="your courses" />}
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

// One group in the professor's line: a grip on the left (in the category color) for
// dragging, the question with its time top right, then who's asking and the actions.
function QueueRow({ g, cats, grip, actions, extra, children, className = '', ...rest }) {
  return (
    <div className={`qrow cc cc-${catColor(g.type, cats)} ${className}`} {...rest}>
      {grip ?? <span className="qrow-grip" aria-hidden="true"><Icon name="grip" size={16} /></span>}
      <div className="qrow-main">
        <div className="qrow-top">
          <p className="stub-q">{g.title}</p>
          <span className="qrow-time"><Icon name="clock" size={14} />~{g.mins} min</span>
        </div>
        <div className="qrow-bottom">
          <p className="stub-meta">{children}</p>
          {actions && <div className="stub-actions">{actions}</div>}
        </div>
        {extra}
      </div>
    </div>
  )
}

// Every student's own wording of a group's question, as posts in a thread, so the professor
// sees what each one is actually stuck on. Collapsible. mini: the compact one on a queue ticket.
function Forum({ g, mini = false, startOpen = false }) {
  const [open, setOpen] = useState(startOpen)
  const id = useId()
  const n = g.tickets.length
  const same = (t) => t.question.trim().toLowerCase() === g.title.trim().toLowerCase()
  // Whoever joined with "Same question" (no wording of their own) is added to the first post's
  // names, like "+ 1 other"; only students with their own wording get a post.
  const metoo = g.tickets.slice(1).filter(same)
  const list = [g.tickets[0], ...g.tickets.slice(1).filter((t) => !same(t))]
  // The big forum scrolls on its own; the ticket around it never does. It shows at least two
  // and a half posts (measured, so long questions count), up to 204px, less only if the column
  // it's in would otherwise overflow. Then the column scrolls, as a last resort.
  const posts = useRef(null)
  useLayoutEffect(() => {
    const ol = posts.current, lead = ol?.closest('.lead')
    if (mini || !open || !ol) return
    const fit = () => {
      const li = ol.children
      const floor = li.length > 2 ? li[2].offsetTop - ol.offsetTop + li[2].offsetHeight / 2 : ol.scrollHeight
      let room = Infinity
      if (lead && getComputedStyle(lead).overflowY === 'auto') {
        const last = lead.lastElementChild
        const used = last.offsetTop + last.offsetHeight + parseFloat(getComputedStyle(lead).paddingBottom)
        room = ol.clientHeight + lead.clientHeight - used
      }
      ol.style.maxHeight = `${Math.ceil(Math.max(floor, Math.min(204, room)))}px`
      edges()
    }
    // Which ends have more posts past them, so CSS can fade those ends out.
    const edges = () => {
      ol.classList.toggle('more-up', ol.scrollTop > 1)
      ol.classList.toggle('more-down', ol.scrollTop + ol.clientHeight < ol.scrollHeight - 1)
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (lead) ro.observe(lead)
    for (const li of ol.children) ro.observe(li)
    ol.addEventListener('scroll', edges, { passive: true })
    return () => { ro.disconnect(); ol.removeEventListener('scroll', edges); ol.style.maxHeight = ''; ol.classList.remove('more-up', 'more-down') }
  }, [mini, open, list.length])
  return (
    <div className={`forum${mini ? ' mini' : ''}${open ? ' open' : ''}`}>
      <button type="button" className="forum-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <Icon name="chat" size={mini ? 14 : 16} />{list.length} {list.length === 1 ? 'question' : 'questions'} · {n} students<Icon name="down" size={mini ? 14 : 16} />
      </button>
      <div className="forum-body" id={id} inert={!open}>
        <ol className="forum-posts" ref={posts}>
          {list.map((t, i) => (
            <li key={t.id} className="post">
              {!mini && <span className="avatar" aria-hidden="true">{initials(t.student_name)}</span>}
              <div className="post-body">
                <p className="post-meta">
                  <b>{i === 0 ? <Names tickets={[t, ...metoo]} /> : t.student_name}</b>
                  {!mini && t.class_section && <span> · {t.class_section}</span>}
                  {!mini && t.created_at && <span> · {clock(new Date(t.created_at))}</span>}
                  {i === 0 && <span className="post-tag">Asked first</span>}
                </p>
                <p className="post-q">{t.question}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

// What shows under a ticket while it's swiped: "Helped" on the left, "Pass to TA" on the right.
function SwipeBg({ dir, ready }) {
  return (
    <div className={`swipe-bg${dir ? ` to-${dir}` : ''}${ready ? ' ready' : ''}`} aria-hidden="true">
      <span className="sb-help"><Icon name="check" />Helped</span>
      <span className="sb-ta">Pass to TA<Icon name="person" /></span>
    </div>
  )
}

// Shown after a swipe left. Native <dialog>: traps focus, Esc closes it.
// onClose(dontAsk): dontAsk is true when "Don't ask me again" was ticked.
function PassedDialog({ g, onClose, onUndo }) {
  const ref = useRef(null)
  const okRef = useRef(null)
  const [dontAsk, setDontAsk] = useState(false)
  useEffect(() => { ref.current?.showModal(); okRef.current?.focus() }, [])
  const close = () => ref.current?.close()
  return (
    <dialog ref={ref} className="modal" aria-labelledby="ta-h" onClose={() => onClose(dontAsk)} onClick={(e) => { if (e.target === ref.current) close() }}>
      <span className="modal-icon" aria-hidden="true"><Icon name="handoff" size={22} /></span>
      <h2 id="ta-h">Passed to a TA</h2>
      <p>“{g.title}” ({g.tickets.map((t) => t.student_name).join(', ')}) is out of your queue.</p>
      <p className="fine">Handing questions to TAs isn't built yet, so no TA was notified.</p>
      <label className="check">
        <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
        <span>Don't ask me again <small>(you'll get a short note with Undo instead)</small></span>
      </label>
      <div className="btns">
        <button className="btn outline" onClick={() => { close(); onUndo() }}>Undo</button>
        <button className="btn primary push" ref={okRef} onClick={close}>Got it</button>
      </div>
    </dialog>
  )
}

function Student({ queue, groups, cats, hours, act, live, ready, me, course, title, go }) {
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
      setMine((m) => [...m, { id: t.id, name: me.name.trim(), q: q.trim(), course, at: new Date().toISOString() }]); setQ(''); setAsking(false)
    }, 'Spot saved.')
  }
  // "Same question?" on a stub in the line: join that group as it is.
  const joinGroup = (g) => act(async () => {
    const t = await api.join({ student_name: me.name.trim(), class_section: me.section.trim(), bucket_id: g.id, office_hours_id: hours?.id })
    setMine((m) => [...m, { id: t.id, name: me.name.trim(), q: g.title, course, at: new Date().toISOString() }])
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

  // Every question this student submitted in this class, newest first: still in line (with its
  // place) or done. Entries saved before this list existed have no text or class; they show
  // only while their ticket is still in line.
  const history = [...mine].reverse().map((m) => {
    const ticket = myTickets.find((t) => t.id === m.id)
    if (!ticket && m.course !== course) return null
    const gi = ticket ? groups.findIndex((g) => g.id === ticket.bucket_id) : -1
    return { id: m.id, ticket, text: ticket?.question ?? m.q, at: ticket?.created_at ?? m.at, place: gi + 1, size: gi >= 0 ? groups[gi].tickets.length : 0 }
  }).filter((h) => h && h.text).slice(0, 10)

  if (!course) return null
  const showForm = !myGroup || asking
  const sessionNote = hours && (hours.state === 'upcoming' ? 'Join before it starts to stay ahead.' : hours.state === 'running' ? 'In session · new questions go to the back' : 'This session has ended')

  const form = (
    <div className="card ask-card">
      <div className="ask">
        <div className="section-head">
          <h1>What's your question?</h1>
          {sessionNote && <p className="lede">{sessionNote}</p>}
        </div>
        {ready && !canJoin ? (
          <div className="notice">
            <span className="notice-icon"><Icon name="clock" /></span>
            <div>
              <h2>{hours ? 'No open office hours' : 'No office hours yet'}</h2>
              <p>Check back when the next session is posted.</p>
            </div>
          </div>
        ) : (
          <>
            {!hasProfile && ready && <p className="callout warn">No section found. Check your <button className="link" onClick={() => go('profile')}>profile</button>.</p>}
            <label className="field">
              <span>Your question</span>
              <textarea rows={3} value={q} onChange={(e) => setQ(e.target.value)} aria-describedby="wordcount" placeholder="My recursive flatten() returns None for nested lists, but works for flat ones." />
            </label>
            <div className="field-foot">
              <span>{me.name.trim() || 'nobody yet'}{me.section.trim() && ` · ${me.section.trim()}`}</span>
              <span id="wordcount" className={`count${over ? ' bad' : ''}`}>{n}/25 words{over && ' · shorten it a little'}</span>
            </div>
            {confirm ? (
              <div className="callout warn" role="alertdialog" aria-labelledby="started-h" tabIndex={-1} ref={confirmRef}>
                <span className="callout-icon" aria-hidden="true"><Icon name="alert" /></span>
                <div className="callout-body">
                  <h3 id="started-h">Session already started</h3>
                  <p>Your question goes to the back of the line · about {nextWait} min</p>
                  <div className="btns">
                    <button className="btn primary" onClick={() => submit()}>Join anyway</button>
                    <button className="btn outline" onClick={() => setConfirm(false)}>Cancel</button>
                  </div>
                </div>
              </div>
            ) : similar ? (
              // A similar question is in line: joining it and asking separately take the place
              // of the Save button, side by side, so the form doesn't grow.
              <div className="save similar">
                <div className="callout info">
                  <span className="callout-icon" aria-hidden="true"><Icon name="users" /></span>
                  <div className="callout-body">
                    <h3>Similar question in line</h3>
                    <p>“{similar.title}” · {similar.count} waiting</p>
                  </div>
                </div>
                <div className="save-split">
                  <button className="btn accent" disabled={!ok} onClick={() => submit(similar.id)}>Join their group</button>
                  <button className="btn outline" disabled={!ok} onClick={startNew}>Ask separately</button>
                </div>
                {!ok && <p className="fine">{why}</p>}
                {asking && <button className="link" onClick={() => setAsking(false)}>Back to your spot</button>}
              </div>
            ) : (
              <div className="save">
                <button className="btn accent wide" disabled={!ok} onClick={startNew}>Save my spot</button>
                <p className="fine">{ok ? `${ordinal(nextSpot)} in line · about ${nextWait} min` : why}</p>
                {asking && <button className="link" onClick={() => setAsking(false)}>Back to your spot</button>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )

  return (
    <div className="class-page">
      <CourseStrip course={course} title={title} hours={hours} onBack={() => go('home')} backLabel="All classes" />
      <div className="layout student">
        <section className="lead" aria-label="Your spot">
          {showForm ? form : (
            <>
              <div className="section-head">
                <h1>Your spot</h1>
                {sessionNote && <p className="lede">{sessionNote}</p>}
              </div>
              <Card
                key={latest.id} color={colorOf(course)} className="spot-card print"
                head={<><CourseCode course={course} /><span className="chip">{pos === 1 ? 'Current' : lateMine ? 'Joined late' : 'In line'}</span></>}
                foot={<>
                  <div className="fields">
                    <div className="f"><small>Group</small><strong>{myGroup.tickets.length > 1 ? `+${myGroup.tickets.length - 1}` : 'Just you'}</strong></div>
                    <div className="f"><small>Room</small><strong>{hours?.location ?? '—'}</strong></div>
                  </div>
                </>}
              >
                <div className="spot-hero">
                  <div className="f place"><small>Place</small><strong>{ordinal(pos)}</strong></div>
                  <div className="f turn"><small>Turn</small><strong>{clock(turnAt)}</strong><span>about {wait} min</span></div>
                </div>
                <div className="progress" aria-hidden="true"><span style={{ width: `${Math.max(6, ((groups.length - pos + 1) / Math.max(groups.length, 1)) * 100)}%` }} /></div>
                <p className="my-meta">{pos === 1 ? "You're current" : `${plural(pos - 1, 'group', 'groups')} ahead of you`}</p>
                <div className="my-q-wrap">
                  <small>Your question</small>
                  {/* Their own wording; the group's question shows under it when it differs. */}
                  <p className="my-q">{latest.question}</p>
                  {myGroup.tickets.length > 1 && (
                    <p className="my-meta">
                      With {plural(myGroup.tickets.length - 1, 'other', 'others')}
                      {latest.question.trim().toLowerCase() !== myGroup.title.trim().toLowerCase() && <> · grouped under “{myGroup.title}”</>}
                    </p>
                  )}
                  {lateMine && <p className="my-meta">Joined late · behind on-time questions</p>}
                </div>
              </Card>
              <div className="btns spread">
                <button className="btn primary" onClick={() => finish('done')}><Icon name="check" size={16} />Fixed it, thanks</button>
                <button className="btn outline" onClick={() => setAsking(true)}>{myBuckets.size > 1 ? `+${myBuckets.size - 1} more · ask another` : 'Ask another question'}</button>
                <button className="btn quiet danger push" onClick={() => finish('left')}>Leave the line</button>
              </div>
            </>
          )}
          {history.length > 0 && (
            <div className="card my-questions">
              <div className="section-head"><h2>Your questions</h2><span className="count-pill">{history.length}</span></div>
              <ol className="myq-list">
                {history.map((h) => (
                  <li key={h.id} className={`myq${h.ticket ? ' active' : ''}${h.id === latest?.id && !showForm ? ' shown' : ''}`}>
                    <p className="myq-q">{h.text}</p>
                    <p className="myq-meta">
                      {h.ticket
                        ? <span className="myq-status">{h.place === 1 ? 'Current' : `${ordinal(h.place)} in line`}</span>
                        : <span className="myq-status done">Done</span>}
                      {h.size > 1 && <span>with {plural(h.size - 1, 'other', 'others')}</span>}
                      {h.at && <span>asked {clock(new Date(h.at))}</span>}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>

        <section className="card line" aria-labelledby="line-h">
          <div className="line-head">
            <div>
              <h2 id="line-h">The line right now</h2>
              <p>{groups.length > 0 ? 'Same question? Join to get helped together.' : ready ? "No one's waiting. You'd be first." : 'Loading the line…'}</p>
            </div>
            {groups.length > 0 && <span className="count-pill">{plural(groups.length, 'group', 'groups')}</span>}
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
                    <Icon name="users" size={14} />{plural(g.tickets.length, 'student', 'students')} · ~{g.mins} min
                  </Stub>
                </Fragment>
              )
            })}
          </ol>
        </section>
      </div>
    </div>
  )
}

// ---- drag to reorder ----
// The boxes of every ticket are measured once, when the drag starts (in page coordinates,
// so scrolling doesn't throw them off). Tickets then slide around with transforms, and the
// spot under the pointer is worked out from those first boxes, not the moving ones.
const ROW_GAP = 8 // .stubs gap in App.css
// Where a group dragged to page height py would land (index in the line).
function dropIndex(d, px, py) {
  // A row dragged out of the list onto Next up (in the other column) becomes next.
  const now = d.base[0]
  if (d.from > 0 && now && px > now.left - 12 && px < now.right + 12 && py > now.top - 12 && py < now.bottom + 12) return 0
  // Next up carried around its own column stays next; it has to be brought over the list.
  const list = d.base[1]
  if (d.from === 0 && list && (px < list.left - 40 || px > list.right + 40)) return 0
  let to = 0
  d.base.forEach((r, i) => {
    if (i === d.from || !r) return
    // Next up (0) sits in its own column: going above the first row of the list means "make it next".
    const line = i === 0 ? (d.base[1] ? d.base[1].top - 12 : r.bottom) : (r.top + r.bottom) / 2
    if (py > line) to++
  })
  return to
}
// Play the move of `el` from the box `from` (a viewport rect) to where it is now. `ghost` is a
// copy of how it looked there; it fades out while stretching onto the new box, and a copy of
// how it looks now grows in from the old box. The copies float above the page, so the column
// it leaves or enters doesn't clip them; the real ticket shows again when they're done.
const MORPH = { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
function float(copy, box) {
  copy.classList.remove('drop-target', 'drop-ready', 'dragging', 'lifted', 'dropping', 'swiping')
  copy.setAttribute('aria-hidden', 'true')
  copy.inert = true
  Object.assign(copy.style, {
    position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, margin: '0',
    zIndex: '60', pointerEvents: 'none', transformOrigin: '0 0', transform: 'none', scale: 'none', translate: 'none', opacity: '1', animation: 'none',
  })
  document.body.append(copy)
  return copy
}
// live: `el` already floats above the page and keeps moving (the copy under the pointer), so it
// is animated itself instead of through a still copy.
function morph(el, from, ghost, live = false) {
  const to = el.getBoundingClientRect()
  if (!to.width || !to.height || !from.width || !from.height) return
  const there = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`
  const back = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`
  const before = float(ghost, from)
  if (live) {
    before.animate([{ transform: 'none', opacity: 1 }, { opacity: 0.5, offset: 0.3 }, { transform: there, opacity: 0 }], MORPH).finished.finally(() => before.remove())
    el.animate([{ transform: back, transformOrigin: '0 0', opacity: 0 }, { opacity: 0.6, offset: 0.3 }, { transform: 'none', transformOrigin: '0 0', opacity: 1 }], MORPH)
    return
  }
  const after = float(el.cloneNode(true), to)
  el.style.visibility = 'hidden'
  before.animate([{ transform: 'none', opacity: 1 }, { opacity: 0.6, offset: 0.35 }, { transform: there, opacity: 0 }], MORPH)
  after.animate([{ transform: back, opacity: 0 }, { opacity: 0.6, offset: 0.35 }, { transform: 'none', opacity: 1 }], MORPH).finished
    .finally(() => { before.remove(); after.remove(); el.style.visibility = '' })
}
const moveDrag = (d, clientX, clientY) => ({ ...d, x: clientX, y: clientY, s: window.scrollY, to: dropIndex(d, clientX + window.scrollX, clientY + window.scrollY) })

function Professor({ groups, queue, cats, hours, act, live, ready, courses, course, info, setProClass, goHome }) {
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
  // Passing to a TA takes the group out of the line and explains it in a dialog (with Undo).
  // After "Don't ask me again", it's a toast with Undo instead (kept in this browser).
  const [passed, setPassed] = useState(null)
  const [skipTaDialog, setSkipTaDialog] = useStored('zh.skipTaDialog', false)
  const backInLine = (g) => Promise.all(g.tickets.map((t) => api.update(t.id, { status: 'waiting' })))
  const passToTA = (g) => (skipTaDialog
    ? act(() => api.passToTA(g.id, g.tickets), {
      msg: `Passed ${g.tickets[0].student_name}${g.tickets.length > 1 ? ` + ${g.tickets.length - 1}` : ''} to a TA.`,
      undo: () => backInLine(g),
    })
    : act(async () => { await api.passToTA(g.id, g.tickets); setPassed(g) }))
  const unpass = (g) => act(() => backInLine(g), 'Back in line.')
  const closePassed = (dontAsk) => { setPassed(null); if (dontAsk) setSkipTaDialog(true) }
  // Dropping a group pins it at that spot (1 = top, counted in groups).
  const pin = (g, position) => act(() => api.pinGroup(g.id, position), `Locked in spot ${position}.`)
  const unpin = (g) => act(() => api.pinGroup(g.id, null), 'Unlocked.')

  // Swipe a ticket sideways (mouse, pen or touch): right = helped, left = pass to a TA.
  // The gesture only counts once it's clearly sideways, so the page still scrolls, and it
  // never starts on a button (the drag handle, Help, the lock).
  const [swipe, setSwipe] = useState(null) // { id, x, w, live } while a ticket is swiped
  const swipeStart = useRef(null)
  const swipeProps = (g) => ({
    onPointerDown: (e) => {
      if (e.button !== 0 || drag || e.target.closest('button, a, input, select, textarea, summary')) return
      swipeStart.current = { id: g.id, x: e.clientX, y: e.clientY, w: e.currentTarget.offsetWidth, axis: null, dx: 0 }
    },
    onPointerMove: (e) => {
      const s = swipeStart.current
      if (!s || s.id !== g.id) return
      const dx = e.clientX - s.x, dy = e.clientY - s.y
      if (!s.axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        if (s.axis === 'x') e.currentTarget.setPointerCapture(e.pointerId)
      }
      if (s.axis !== 'x') return
      s.dx = dx
      setSwipe({ id: g.id, x: dx, w: s.w, live: true })
    },
    onPointerUp: () => {
      const s = swipeStart.current
      swipeStart.current = null
      if (!s || s.axis !== 'x' || Math.abs(s.dx) < s.w * SWIPE_AT) { setSwipe(null); return }
      const dir = Math.sign(s.dx)
      setSwipe({ id: g.id, x: dir * (s.w + 60), w: s.w, live: false }) // fly off, then act
      setTimeout(() => (dir > 0 ? finish(g) : passToTA(g)).finally(() => setSwipe(null)), 200)
    },
    onPointerCancel: () => { swipeStart.current = null; setSwipe(null) },
  })
  const swipeView = (g) => {
    const on = swipe?.id === g.id && swipe.x !== 0
    return {
      dir: on ? (swipe.x > 0 ? 'help' : 'ta') : null,
      ready: on && Math.abs(swipe.x) >= swipe.w * SWIPE_AT,
      style: on ? { transform: `translateX(${swipe.x}px)`, opacity: Math.max(0, 1 - Math.abs(swipe.x) / swipe.w * 0.7) } : undefined,
      cls: on && swipe.live ? ' swiping' : '',
      wrap: on ? ' is-swiped' : '', // clips the ticket to its track, so it never widens the page

    }
  }

  // Drag handle: pointer events work for mouse, pen and touch. Arrow keys move a group too.
  // A row in the list lifts and follows the pointer while the others slide apart to show
  // where it will land. Next up lives in another column, so it's dragged as a floating copy.
  // drag: { from, to, y, y0, s, s0 (pointer and scroll now / at the start), slot (how far the
  // other tickets slide), base (first boxes), dy, left, width (for the copy), dropping }
  const pointerY = useRef(0)
  // After a drop, the new order arrives from the backend. Clear the drag before that frame is
  // painted, with transitions off for a moment, so nothing jumps back and forth.
  const [settling, setSettling] = useState(false)
  const order = groups.map((g) => g.id).join(',')
  useLayoutEffect(() => {
    if (!drag?.dropping) return
    setDrag(null); setSettling(true)
    requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)))
  }, [order]) // eslint-disable-line react-hooks/exhaustive-deps
  // A group moving into or out of Next up morphs between the two shapes: a copy of how it
  // looked fades out while stretching to its new box, and the real one grows in from the old box.
  // snapshot() records every ticket just before such a move; the effect plays it once the move lands.
  const flip = useRef(null)
  const floatRef = useRef(null)
  // Picking up Next up: the big ticket shrinks into the row-sized copy under the pointer.
  const pickup = useRef(null)
  useLayoutEffect(() => {
    const p = pickup.current
    pickup.current = null
    const el = floatRef.current?.firstElementChild
    if (drag?.from !== 0 || !p || !el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    morph(el, p.rect, p.ghost, true)
  }, [drag?.from]) // eslint-disable-line react-hooks/exhaustive-deps
  // stand-in: { id, el } when a group is shown somewhere else just then (a floating copy, a preview).
  const snapshot = (standIn) => {
    const shot = { first: groups[0]?.id, boxes: {} }
    const add = (id, el) => { if (el) shot.boxes[id] = { rect: el.getBoundingClientRect(), ghost: el.cloneNode(true) } }
    add(groups[0]?.id, refs.current[0])
    groups.forEach((g, k) => { if (k > 0) add(g.id, refs.current[k]?.querySelector('.qrow')) })
    if (standIn) add(standIn.id, standIn.el)
    flip.current = shot
  }
  // A row carried over Next up turns into the big ticket (and back into a row if it's carried off).
  const overNow = !!drag && drag.from > 0 && drag.to === 0 && !!groups[drag.from] && !!drag.base[0]
  const previewRef = useRef(null)
  const previewWas = useRef(null)
  useLayoutEffect(() => {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const row = drag && refs.current[drag.from]?.querySelector('.qrow')
    if (overNow) {
      const el = previewRef.current
      if (!el || !row) return
      previewWas.current = { rect: el.getBoundingClientRect(), ghost: el.cloneNode(true) }
      if (!calm) morph(el, row.getBoundingClientRect(), row.cloneNode(true), true)
    } else if (previewWas.current) {
      const was = previewWas.current
      previewWas.current = null
      if (drag && !drag.dropping && row && !calm) morph(row, was.rect, was.ghost, true)
    }
  }, [overNow]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const shot = flip.current
    if (!shot || drag) return
    flip.current = null
    const now = groups[0]?.id
    // Only a reorder morphs: if the old Next up left the line (helped, passed), the new one just appears.
    if (!now || now === shot.first || !groups.some((g) => g.id === shot.first)) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const elOf = (id) => (id === now ? refs.current[0] : refs.current[groups.findIndex((g) => g.id === id)]?.querySelector('.qrow'))
    for (const id of [now, shot.first]) {
      const el = elOf(id), from = shot.boxes[id]
      if (el && from) morph(el, from.rect, from.ghost)
    }
  }, [order, drag]) // eslint-disable-line react-hooks/exhaustive-deps
  // Near the top or bottom of the window, scroll while dragging (faster closer to the edge).
  const dragging = !!drag && !drag.dropping
  useEffect(() => {
    if (!dragging) return
    let raf
    const tick = () => {
      const y = pointerY.current, edge = 80
      const v = y < edge ? -(edge - y) / 4 : y > window.innerHeight - edge ? (y - window.innerHeight + edge) / 4 : 0
      if (v) { window.scrollBy(0, v); setDrag((d) => (d && !d.dropping ? moveDrag(d, d.x, d.y) : d)) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [dragging])
  const handleProps = (g, i) => ({
    type: 'button',
    'aria-label': `Move “${g.title}”. Drag it, or press the up and down arrow keys. Right arrow marks it helped, left arrow passes it to a TA.`,
    onPointerDown: (e) => {
      if (e.button !== 0 || drag) return
      e.currentTarget.setPointerCapture(e.pointerId)
      const base = groups.map((_, k) => {
        const r = refs.current[k]?.getBoundingClientRect()
        return r && { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, left: r.left + window.scrollX, right: r.right + window.scrollX }
      })
      const row = base[i > 0 ? i : 1]
      // Next up's floating copy is a row as wide as the list's, held by its grip under the pointer.
      const r = refs.current[i > 0 ? i : 1]?.getBoundingClientRect() ?? refs.current[i]?.getBoundingClientRect()
      pointerY.current = e.clientY
      if (i === 0) pickup.current = { rect: refs.current[0].getBoundingClientRect(), ghost: refs.current[0].cloneNode(true) }
      setDrag({
        from: i, to: i, x: e.clientX, x0: e.clientX, y: e.clientY, y0: e.clientY, s: window.scrollY, s0: window.scrollY, base,
        slot: row ? row.bottom - row.top + ROW_GAP : 0,
        dy: i > 0 && r ? e.clientY - r.top : 40, dx: 16, width: r?.width ?? 400,
      })
    },
    onPointerMove: (e) => {
      if (!drag || drag.from !== i || drag.dropping) return
      pointerY.current = e.clientY
      setDrag(moveDrag(drag, e.clientX, e.clientY))
    },
    onPointerUp: () => {
      const d = drag
      if (!d || d.from !== i || d.dropping) return
      if (d.to === d.from) { setDrag(null); return }
      // Hold everything where it is until the new order arrives (see the layout effect above).
      if (d.from === 0) snapshot({ id: g.id, el: floatRef.current?.firstElementChild })
      else if (d.to === 0) snapshot({ id: g.id, el: previewRef.current })
      setDrag({ ...d, dropping: true })
      pin(g, d.to + 1).finally(() => setDrag((x) => (x?.dropping ? null : x)))
    },
    onPointerCancel: () => setDrag(null),
    onKeyDown: (e) => {
      if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); if (i === 1) snapshot(); pin(g, i) }
      if (e.key === 'ArrowDown' && i < groups.length - 1) { e.preventDefault(); if (i === 0) snapshot(); pin(g, i + 2) }
      // Keyboard version of the swipe.
      if (e.key === 'ArrowRight') { e.preventDefault(); finish(g) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); passToTA(g) }
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
  const firstSwipe = first && swipeView(first)
  // The big Next up ticket for group g (at index i in the line): its head, body and foot. Also
  // drawn, inert, as the preview of a row carried over Next up.
  const nowParts = (g, i) => ({
    color: catColor(g.type, cats), tear: 'head',
    head: <><span className="now-label"><span className="pulse" aria-hidden="true" />Current</span><span className="now-head-right"><span className="tag">{cats[g.type]?.label || g.type}</span><span className="qrow-time"><Icon name="clock" size={14} />~{g.mins} min</span></span></>,
    foot: <>
      <div className="tools">
        <button className="grip" {...handleProps(g, i)}><Icon name="grip" /></button>
        {lockBtn(g, i)}
      </div>
      {/* Same order as the swipe: pass to a TA on the left, helped on the right. */}
      <div className="decide">
        <button className="decide-btn ta" onClick={() => passToTA(g)} aria-label="Pass to a TA" title="Pass to a TA"><Icon name="handoff" size={26} /></button>
        <button className="decide-btn help" onClick={() => finish(g)} aria-label={g.tickets.length > 1 ? 'Helped, all of them' : 'Helped'} title={g.tickets.length > 1 ? 'Helped (all)' : 'Helped'}><Icon name="check" size={30} /></button>
      </div>
    </>,
    children: <>
      <h2 className="now-q">{g.title}</h2>
      <p className="now-who"><Icon name="users" size={16} /><Names tickets={g.tickets} /></p>
      {g.solo > g.mins && <p className="now-time"><Icon name="users" size={16} />Helping them together saves {g.solo - g.mins} min</p>}
      {g.tickets.length > 1 && <Forum g={g} startOpen />}
    </>,
  })
  const dragClass = (i) => {
    if (!drag) return settling ? ' no-anim' : ''
    if (i === drag.from) return drag.from === 0 ? ' dragging' : ` lifted${drag.to === 0 ? ' over-now' : ''}${drag.dropping ? ' dropping' : ''}`
    if (i === 0) return drag.to === 0 ? ' drop-target' : drag.dropping ? '' : ' drop-ready'
    return ''
  }
  // How far each ticket is moved while a group is dragged.
  const dragStyle = (i) => {
    if (!drag) return undefined
    const { from, to, slot, base } = drag
    if (i === from) {
      if (from === 0) return undefined // the floating copy moves instead
      // The lifted row follows the pointer anywhere, so it can be carried out of the list onto Next up.
      const held = { transform: `translate(${drag.x - drag.x0}px, ${drag.y + drag.s - drag.y0 - drag.s0}px)` }
      if (!drag.dropping) return held
      // Dropped: settle into the gap. Dropped on Next up, it waits where it was let go and then morphs in.
      if (to === 0) return held
      return { transform: `translateY(${to < from ? base[to].top - base[from].top : base[to].bottom - base[from].bottom}px)` }
    }
    if (i === 0) return undefined
    let shift = 0
    if (from === 0) shift = to > 0 && i > to ? slot : 0 // over the list: open a gap after row `to`
    else if (from < to && i > from && i <= to) shift = -slot
    else if (from > to && i >= to && i < from) shift = slot
    return shift ? { transform: `translateY(${shift}px)` } : undefined
  }
  const sessionAction = hours && (
    hours.state === 'upcoming' ? <button className="btn primary" onClick={() => act(() => api.saveHours({ is_open: true }), 'Office hours open.')}>Open now</button>
    : hours.state === 'running' ? <button className="btn outline" onClick={() => act(() => api.wrapUp(), (msg) => msg)}>Wrap up</button>
    : <span className="chip">Ended</span>
  )

  return (
    <div className="pro-page">
      <div className="tabs" role="tablist" aria-label="Course">
        {courses.map((c) => (
          <button key={c} role="tab" aria-selected={course === c} className={`tab cc cc-${colorOf(c)}`} onClick={() => setProClass(c)}>
            <i aria-hidden="true" />{c}
          </button>
        ))}
      </div>

      <CourseStrip course={course} title={info?.course_title || course} hours={hours} heading="h1" onBack={goHome} backLabel="All courses">
        <dl className="cs-stats">
          <div title={plural(queue.length, 'student', 'students')}><dt>Waiting</dt><dd>{queue.length}</dd></div>
          <div title="Groups in line"><dt>Groups</dt><dd>{groups.length}</dd></div>
          <div title="Estimated time to help everyone in line"><dt>Est. total</dt><dd>{left}<small>m</small></dd></div>
          <div className="good" title="Saved by grouping"><dt>Saved</dt><dd>{saved}<small>m</small></dd></div>
          <div title="Helped today"><dt>Helped</dt><dd>{helped}</dd></div>
        </dl>
        <div className="pro-session">{sessionAction}</div>
      </CourseStrip>

      <div className="layout pro">
        <section className="lead" aria-label="Current">
          {first ? (<>
            <div className={`swipe now-swipe${firstSwipe.wrap}`} key={first.id}>
              <SwipeBg dir={firstSwipe.dir} ready={firstSwipe.ready} />
              <Card
                {...nowParts(first, 0)} className={`now print swipe-card${firstSwipe.cls}${dragClass(0)}`}
                ref={(el) => { refs.current[0] = el }} style={firstSwipe.style} {...swipeProps(first)}
              />
            </div>
            <p className="swipe-tip" aria-hidden="true">Swipe a ticket</p>
          </>) : (
            <div className="notice empty">
              <span className="notice-icon"><Icon name="inbox" size={24} /></span>
              <div><h2>Queue is empty</h2><p>New questions show up here.</p></div>
            </div>
          )}
        </section>

        <aside className="side" aria-labelledby="after-h">
          <div className={`card line${drag?.from === 0 && !drag.dropping ? (drag.to > 0 ? ' drop-into' : ' drop-ready') : ''}`}>
            <div className="line-head">
              <div>
                <h2 id="after-h">Current Queue</h2>
                {rest.length === 0 && <p>Nobody else is waiting.</p>}
              </div>
              {rest.length > 0 && <span className="count-pill">{rest.length}</span>}
            </div>
            <ol className={`stubs${settling ? ' no-anim' : ''}`} style={drag?.from === 0 && drag.to > 0 ? { paddingBottom: drag.slot } : undefined}>
              {/* Next up carried over the list: a dashed slot shows where it will land. */}
              {drag?.from === 0 && drag.to > 0 && drag.base[1] && (
                <li className="drop-slot" aria-hidden="true" style={{ top: drag.base[drag.to].bottom + ROW_GAP - drag.base[1].top, height: drag.slot - ROW_GAP }} />
              )}
              {rest.map((g, k) => {
                const i = k + 1
                const sv = swipeView(g)
                return (
                  <Fragment key={g.id}>
                    {isLate(g) && !isLate(groups[i - 1]) && <li className={`divider${settling ? ' no-anim' : ''}`} aria-hidden="true" style={drag?.from === i ? undefined : dragStyle(i)}><span>Joined after start</span></li>}
                    <li className={`swipe${sv.wrap}${dragClass(i)}`} style={dragStyle(i)} ref={(el) => { refs.current[i] = el }}>
                      <SwipeBg dir={sv.dir} ready={sv.ready} />
                      <QueueRow
                        g={g} cats={cats} className={`swipe-card${sv.cls}`} extra={g.tickets.length > 1 && <Forum g={g} mini />}
                        style={sv.style} {...swipeProps(g)}
                        grip={<button className="qrow-grip handle" {...handleProps(g, i)}><Icon name="grip" size={16} /></button>}
                        actions={<>
                          {lockBtn(g, i)}
                          <button className="mini-btn ta" onClick={() => passToTA(g)} aria-label={`Pass “${g.title}” to a TA`} title="Pass to a TA"><Icon name="handoff" size={18} /></button>
                          <button className="mini-btn help" onClick={() => finish(g)} aria-label={`Helped: ${g.title}`} title={g.tickets.length > 1 ? 'Helped (all)' : 'Helped'}><Icon name="check" size={18} /></button>
                        </>}
                      >
                        <span className="tag">{cats[g.type]?.label || g.type}</span>
                        <Names tickets={g.tickets} />
                        {g.tickets.some((t) => t.overflow_count > 0) && ' · from last session'}
                        {isLate(g) && ' · late'}
                      </QueueRow>
                    </li>
                  </Fragment>
                )
              })}
            </ol>
          </div>

          {hours && form && (
            <details className="card session">
              <summary><span><Icon name="clock" size={16} />Office hours · {hours.location} · {when(hours.starts_at)}</span><span className="summary-hint">Edit</span></summary>
              <div className="form">
                <label className="field"><span>Location</span><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
                <div className="row2">
                  <label className="field"><span>Starts</span><input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></label>
                  <label className="field"><span>Ends</span><input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></label>
                </div>
                <div className="btns">
                  <button className="btn primary" onClick={() => act(() => api.saveHours(form), 'Saved.')}>Save changes</button>
                  {!live && <button className="link" onClick={() => { api.resetDemo(); Object.keys(localStorage).filter((k) => k.startsWith('zh.mine')).forEach((k) => localStorage.removeItem(k)); location.reload() }}>Reset demo data</button>}
                </div>
              </div>
            </details>
          )}
          {live && hours?.state === 'running' && !hours.has_next && queue.length > 0 && (
            <p className="callout info small"><Icon name="info" size={16} />No later session · {queue.length} waiting will stay here</p>
          )}
          <NewSession act={act} course={course} courses={courses} alwaysOpen={ready && !hours} onCreated={setProClass} />
        </aside>
      </div>

      {passed && <PassedDialog g={passed} onClose={closePassed} onUndo={() => unpass(passed)} />}
      {/* A row carried over Next up grows into a preview of the big ticket, right where it would go. */}
      {overNow && (
        <div className="now-swipe now-preview" inert aria-hidden="true" style={{ top: drag.base[0].top - window.scrollY, left: drag.base[0].left, width: drag.base[0].right - drag.base[0].left }}>
          <Card {...nowParts(groups[drag.from], drag.from)} className="now print" ref={previewRef} />
        </div>
      )}
      {drag?.from === 0 && groups[0] && (
        <ol className="stubs floating" aria-hidden="true" style={{ top: drag.y - drag.dy, left: drag.x - drag.dx, width: drag.width }}>
          <li ref={floatRef}>
            <QueueRow g={groups[0]} cats={cats}>
              <span className="tag">{cats[groups[0].type]?.label || groups[0].type}</span>
              <Names tickets={groups[0].tickets} />
            </QueueRow>
          </li>
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
    return <button className="btn dashed" onClick={() => setOpen(true)}><Icon name="plus" size={16} />Schedule a session</button>
  }
  return (
    <div className="card form new-session">
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
        <button className="btn primary" disabled={!valid} onClick={() => act(async () => {
          await api.createHours({ course: f.course.trim(), location: f.location.trim(), starts_at: f.starts_at, ends_at: f.ends_at })
          onCreated(f.course.trim())
          setOpen(false)
        }, 'Session scheduled.')}>Schedule session</button>
        {!alwaysOpen && <button className="btn outline" onClick={() => setOpen(false)}>Cancel</button>}
      </div>
    </div>
  )
}
