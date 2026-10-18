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
function ClassTag({ course }) {
  const colorOf = useContext(Colors)
  return <span className={`cc cc-${colorOf(course)} ctag`}><i aria-hidden="true" />{course}</span>
}

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
// Like the real app, a page never links to another role: the nav bar has no
// student/professor switch. Open each address in its own tab.
//   /student/1, /student/2 ...   one page per student in STUDENTS (config.js)
//   /professor                   the professor
// Anything else (like "/") shows the first student.
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

function App({ role, student }) {
  const [theme, setTheme] = useStored('zh.theme', 'dark')
  const [view, setView] = useState('home') // student: home | class | profile.  professor: home | course
  const [toast, setToast] = useState(null)
  const topRef = useRef(null)
  const [lastClass, setLastClass] = useStored(`zh.class.${student.id}`, null)
  const [proClass, setProClass] = useStored('zh.proclass', null)
  const [colors, setColors] = useStored('zh.colors', {})

  // Everything about classes comes from the Anteater API, through our backend.
  const [enrollment, enrollError] = useLoaded(`zh.enrolled.${student.id}`, () => api.loadEnrollment(student.crns))
  const [prof, profError] = useLoaded('zh.prof', () => api.loadProfessor(CURRENT_PROFESSOR.ucinetid))
  const classes = useMemo(() => api.classesOf(enrollment?.sections ?? []), [enrollment])
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
  // Demo mode (no backend): make sure every class has a line to show.
  useEffect(() => { if (ready && !live && known && api.ensureDemoSessions(known.split('|'))) refresh() }, [ready, live, known, sessions]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) } }, [toast])
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
  const act = async (fn, ok) => {
    try { const r = await fn(); if (ok) setToast(typeof ok === 'function' ? ok(r) : ok); await refresh() } catch (e) { setToast(e.message) }
  }
  const openClass = (c) => { setLastClass(c); setView('class') }
  const openCourse = (c) => { setProClass(c); setView('course') }
  const goHome = () => setView('home')
  // Which page is really showing (a class page with no class falls back to home).
  const onHome = role === 'professor' ? !(view === 'course' && curProClass) : !(view === 'profile' || (view === 'class' && cur))

  const studentProps = { queue, groups, cats, hours, act, live, ready, me, course: cur, go: setView }

  return (
    <Colors.Provider value={colorOf}>
      <div className="shell">
        <header className="top" ref={topRef}>
          <button className="logo" aria-current={onHome ? 'page' : undefined} aria-label="zot hours, go home" onClick={goHome}>zot hours</button>
          <div className="top-right">
            {!live && ready && <><span className="pill muted" title="Backend not reachable, using local demo data">Demo data</span><Sep /></>}
            {hours && <><span className={`cc cc-${colorOf(hours.course)} pill tinted ${hours.state === 'closed' ? 'closed' : ''}`}><i />{hours.course} {hours.state === 'running' ? 'is open' : hours.state === 'upcoming' ? `starts ${when(hours.starts_at)}` : 'has ended'}</span><Sep /></>}
            {role === 'student' && <><button className="navbtn" aria-current={view === 'profile' ? 'page' : undefined} onClick={() => setView('profile')}>Profile</button><Sep /></>}
            <button className="navbtn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle light and dark mode">
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </header>
        <main>
          {!onHome && <Back go={goHome} label={role === 'professor' ? 'All courses' : 'All classes'} />}
          {role === 'professor' ? (
            view === 'course' && curProClass ? (
              <Professor {...{ groups, queue, cats, hours, act, live, ready, courses: proCourseLabels, course: curProClass, info: proCourses.find((c) => c.course === curProClass), setProClass: openCourse }} />
            ) : (
              <ProHome {...{ prof, profError, sessions, openCourse }} />
            )
          ) : view === 'profile' ? (
            <Profile {...{ me, classes, enrollment, enrollError }} />
          ) : view === 'class' && cur ? (
            <Student {...studentProps} />
          ) : (
            <StudentHome {...{ me, classes, enrollment, enrollError, sessions, openClass }} />
          )}
        </main>
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </Colors.Provider>
  )
}

// Thin vertical line between items in the nav bar.
function Sep() {
  return <span className="vsep" aria-hidden="true" />
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

// The question's category as a colored capsule.
function Cat({ type, cats }) {
  const i = Math.max(0, Object.keys(cats).indexOf(type))
  return <span className={`cc cc-${i % PALETTE} catcap`}>{cats[type]?.label || type}</span>
}

// "← All classes" / "← All courses": top left of every page below the home pages.
function Back({ go, label }) {
  return <button className="link back" onClick={go}>← {label}</button>
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
    <div className="card">
      <h2>{enrollError ? `Couldn't load ${what}` : `Loading ${what}…`}</h2>
      {enrollError && <p className="muted pad">{enrollError}. Retrying…</p>}
    </div>
  )
}

function SectionLines({ sections }) {
  return (
    <ul className="seclines">
      {sections.map((s) => (
        <li key={s.section_code}>
          <b>{sectionName(s)}</b> <span className="muted">{s.section_code} · {meetingText(s)}{s.instructors.length > 0 && ` · ${s.instructors.join(', ')}`}</span>
        </li>
      ))}
    </ul>
  )
}

function StudentHome({ me, classes, enrollment, enrollError, sessions, openClass }) {
  const failed = enrollment?.failed ?? []
  return (
    <section className="stack narrow">
      <h1>Pick a class</h1>
      <p className="muted">Your classes this quarter</p>
      <Status {...{ enrollment, enrollError }} what="your classes" />
      {enrollment && classes.length === 0 && <div className="card"><p className="muted">No classes found. Check the section codes in <code>config.js</code>.</p></div>}
      <ul className="rows">
        {classes.map((c) => (
          <li key={c.course} className="card dash">
            <div className="grow">
              <ClassTag course={c.course} />
              <b>{c.title}</b>
              <SectionLines sections={c.sections} />
              <small>{sessionLine(sessions, c.course)}</small>
            </div>
            <button className="btn dark" onClick={() => openClass(c.course)}>Open</button>
          </li>
        ))}
      </ul>
      {failed.length > 0 && <p className="fine left">Not found: {failed.join('; ')}</p>}
    </section>
  )
}

function Profile({ me, classes, enrollment, enrollError }) {
  return (
    <section className="stack narrow">
      <h1>Profile</h1>
      <div className="card">
        <p className="muted">Name</p>
        <h2>{me.name}</h2>
      </div>
      <Status {...{ enrollment, enrollError }} what="your classes" />
      {classes.map((c) => (
        <div key={c.course} className="card">
          <ClassTag course={c.course} />
          <p className="pad"><b>{c.title}</b></p>
          <SectionLines sections={c.sections} />
        </div>
      ))}
    </section>
  )
}

function ProHome({ prof, profError, sessions, openCourse }) {
  const courses = prof?.courses ?? []
  const waiting = courses.reduce((a, c) => a + (api.bestSession(sessions, c.course)?.waiting_count ?? 0), 0)
  return (
    <section className="stack narrow">
      <h1>Your courses</h1>
      {prof && <p className="muted">{prof.name} · {prof.quarter} {prof.year} · {waiting} waiting</p>}
      {!prof && (
        <div className="card">
          <h2>{profError ? "Couldn't load your courses" : 'Loading your courses…'}</h2>
          {profError && <p className="muted pad">{profError}. Retrying…</p>}
        </div>
      )}
      {prof && courses.length === 0 && <div className="card"><p className="muted">No lecture courses in {prof.quarter} {prof.year}.</p></div>}
      <ul className="rows">
        {courses.map((c) => (
          <li key={c.course} className="card dash">
            <div className="grow">
              <ClassTag course={c.course} />
              <b>{c.course_title}</b>
              <SectionLines sections={c.sections.filter((x) => x.section_type === 'Lec')} />
              <small>{sessionLine(sessions, c.course)}</small>
            </div>
            <button className="btn dark" onClick={() => openCourse(c.course)}>Open queue</button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Student({ queue, groups, cats, hours, act, live, ready, me, course, go }) {
  // [{ id, name }]. Matching the name too means leftover ids from a reset database
  // never claim someone else's ticket.
  const colorOf = useContext(Colors)
  // Kept per student, so two student tabs in one browser don't claim each other's questions.
  // Student 1 picks up the list saved before there were several students (zh.mine2).
  const [mine, setMine] = useStored(`zh.mine.${me.id}`, me.id === 1 ? ls('zh.mine2', []) : [])
  const [q, setQ] = useState('')
  const [type, setType] = useState('understanding_topic')
  const [confirm, setConfirm] = useState(false)
  const [remote, setRemote] = useState([])
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
      try { const r = await api.suggest(q.trim(), type, hours?.id); if (!stale) setRemote(r || []) } catch { if (!stale) setRemote([]) }
    }, 350)
    return () => { stale = true; clearTimeout(t) }
  }, [q, type, live, hours?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Demo: a simple word-overlap guess over the local queue.
  let similar = null
  if (live) {
    const b = remote.find((x) => !myBuckets.has(x.id))
    if (b) similar = { id: b.id, title: b.title, count: b.member_count }
  } else {
    const w = new Set(words(q))
    if (w.size >= 2) {
      const g = groups.find((x) => !x.tickets.some(isMine) && words(x.title).filter((y) => w.has(y)).length >= 1 && x.tickets[0].question_type === type)
      if (g) similar = { id: g.id, title: g.title, count: g.tickets.length }
    }
  }

  // The student's most recent question still waiting (mine is in the order they asked).
  // "Your spot" shows this one, and "Fixed it" marks only this one done.
  const latest = [...mine].reverse().map((m) => myTickets.find((t) => t.id === m.id)).find(Boolean)
  // Place in line is counted in groups, the same way the list on the right is numbered.
  const myGroupIdx = latest ? groups.findIndex((g) => g.id === latest.bucket_id) : -1
  const pos = myGroupIdx + 1
  const wait = myGroupIdx < 0 ? 0 : groups.slice(0, myGroupIdx + 1).reduce((a, g) => a + g.mins, 0)
  const lateMine = !!latest?.in_late_section
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
      const t = await api.join({ student_name: me.name.trim(), class_section: me.section.trim(), question: q.trim(), question_type: type, bucket_id, office_hours_id: hours?.id })
      setMine((m) => [...m, { id: t.id, name: me.name.trim() }]); setQ('')
    }, 'Spot saved.')
  }
  // "Same question?" on a row in the line: join that group as it is.
  const joinGroup = (g) => act(async () => {
    const t = await api.join({ student_name: me.name.trim(), class_section: me.section.trim(), bucket_id: g.id, office_hours_id: hours?.id })
    setMine((m) => [...m, { id: t.id, name: me.name.trim() }])
  }, 'Joined the group.')
  // A new question in a session that already started goes to the back, so ask first.
  const startNew = () => (running ? setConfirm(true) : submit())
  const ok = canJoin && hasProfile && n > 0 && !over

  // "Fixed it" marks only the latest question done; "Leave the line" takes the student
  // out of every group they're in. Other students' tickets (like the samples) aren't touched.
  const finish = (kind) => {
    const ts = kind === 'done' ? [latest] : myTickets
    return act(async () => {
      await Promise.all(ts.map((t) => (kind === 'done' ? api.update(t.id, { status: 'done' }) : api.leave(t.id))))
    }, kind === 'done' ? 'Marked as fixed.' : 'You left the line.')
  }

  if (!course) return null

  return (
    <div className="grid student">
      <section className="stack askcol">
        <div className={`cc cc-${colorOf(course)} band`}>
          <h2>{course}</h2>
          <span>{hours ? `${hours.location} · ${when(hours.starts_at)}` : ready ? 'No sessions scheduled' : ''}</span>
        </div>
        <h1>What's your question?</h1>
        {hours && <p className="muted">{hours.state === 'upcoming' ? 'Join before it starts to stay ahead.' : hours.state === 'running' ? 'In session · new questions go to the back' : 'This session has ended'}</p>}
        {ready && !canJoin ? (
          <div className="card">
            <h2>{hours ? 'No open office hours' : 'No office hours yet'}</h2>
            <p className="muted pad">Check back when the next session is posted.</p>
          </div>
        ) : (
          <div className="askstick">
            <div className="card form ask">
              {!hasProfile && <p className="muted">No section found. Check your <button className="link inline" onClick={() => go('profile')}>profile</button>.</p>}
              <label>Your question
                <textarea rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="My recursive flatten() returns None for nested lists, but works for flat ones." />
              </label>
              <div className={`count ${over ? 'bad' : ''}`}>{n}/25 words{over && ' · too long'}</div>
              <div className="chips" role="radiogroup" aria-label="Question type">
                {Object.entries(cats).map(([id, cat]) => (
                  <button key={id} role="radio" aria-checked={type === id} className={type === id ? 'chip on' : 'chip'} onClick={() => setType(id)}>{cat.label}</button>
                ))}
              </div>
              <p className="muted small-note">{me.name.trim() || 'No name'}{me.section.trim() && ` · ${me.section.trim()}`}</p>
            </div>
            {similar && (
              <div className="card hint">
                <h3>Similar question in line</h3>
                <p>“{similar.title}” · {similar.count} waiting</p>
                <div className="btns">
                  <button className="btn dark" disabled={!ok} onClick={() => submit(similar.id)}>Join group</button>
                  <button className="btn outline" disabled={!ok} onClick={startNew}>Ask separately</button>
                </div>
              </div>
            )}
            <div className="savebar">
            {confirm ? (
              <div className="card hint" role="alertdialog" aria-label="Session already started">
                <h3>Session already started</h3>
                <p>Your question goes to the back of the line.</p>
                <div className="btns">
                  <button className="btn dark" onClick={() => submit()}>Join anyway</button>
                  <button className="btn outline" onClick={() => setConfirm(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div>
                <button className="btn primary wide" disabled={!ok} onClick={startNew}>Save my spot</button>
                <p className="fine">{ok ? `${ordinal(nextSpot)} in line · about ${nextWait} min` : 'Add a question to save your spot'}</p>
              </div>
            )}
            </div>
          </div>
        )}
      </section>

      <aside className="stack">
        {myGroupIdx >= 0 && (
          <div className="card spot">
            <p className="muted">Your spot</p>
            <h2 className="big">{ordinal(pos)} in line</h2>
            <p>“{groups[myGroupIdx].title}”</p>
            <p>About {wait} min{groups[myGroupIdx].tickets.length > 1 && ` · with ${groups[myGroupIdx].tickets.length - 1} ${groups[myGroupIdx].tickets.length === 2 ? 'other' : 'others'}`}</p>
            {myBuckets.size > 1 && <p className="muted">+{myBuckets.size - 1} more {myBuckets.size === 2 ? 'question' : 'questions'} in line</p>}
            {lateMine && <p className="muted">Joined late · behind on-time questions</p>}
            <div className="btns">
              <button className="btn outline" onClick={() => finish('done')}>Fixed it, thanks</button>
              <button className="btn outline" onClick={() => finish('left')}>Leave the line</button>
            </div>
          </div>
        )}
        <div className="line">
          <h2>The line right now</h2>
          {groups.length > 0 && <p className="muted small-note">Same question? Join to get helped together.</p>}
          {groups.length === 0 && <p className="muted pad">No one's waiting. You'd be first.</p>}
          <ol className="list">
            {groups.map((g, i) => {
              const yours = g.tickets.some(isMine)
              return (
                <li key={g.id} className={yours ? 'me' : ''}>
                  <span className="num">{i + 1}</span>
                  <div><b>{g.title}</b><small>{g.tickets.length} {g.tickets.length === 1 ? 'student' : 'students'} · ~{g.mins} min{yours && ' · your group'}</small></div>
                  {!yours && (
                    <div className="joinbox">
                      <span>Same question?</span>
                      <button className="btn outline small" disabled={!canJoin || !hasProfile} onClick={() => joinGroup(g)} aria-label={`Join the group: ${g.title}`}>Join</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      </aside>
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
  const finish = (g) => act(async () => { await api.resolveGroup(g.id, g.tickets); setHelped((h) => h + g.tickets.length) })
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
  // While dragging, a floating copy of the card follows the pointer. drag also keeps where
  // the card was grabbed (dy) and its box (left, width), so the copy lines up under it.
  const grip = (g, i, cls = '') => (
    <button
      type="button" className={`grip${cls}`}
      aria-label={`Move “${g.title}”. Drag it, or press the up and down arrow keys.`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const r = refs.current[i]?.getBoundingClientRect()
        setDrag({ from: i, to: i, y: e.clientY, dy: r ? e.clientY - r.top : 0, left: r?.left ?? 0, width: r?.width ?? 400 })
      }}
      onPointerMove={(e) => { if (drag && drag.from === i) setDrag({ ...drag, to: dropTo(e.clientY, i), y: e.clientY }) }}
      onPointerUp={() => { const d = drag; setDrag(null); if (d && d.from === i && d.to !== i) pin(g, d.to + 1) }}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); pin(g, i) }
        if (e.key === 'ArrowDown' && i < groups.length - 1) { e.preventDefault(); pin(g, i + 2) }
      }}
    >⋮⋮</button>
  )
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

  return (
    <div className="grid pro">
      <section className="stack">
        {courses.length > 1 && (
          <div className="chips" role="group" aria-label="Course">
            {courses.map((c) => (
              <ClassChip key={c} course={c} on={course === c} onClick={() => setProClass(c)} />
            ))}
          </div>
        )}
        <div className={`cc cc-${colorOf(course)} band`}>
          <h2>{course}</h2>
          <span>{info?.course_title}</span>
        </div>
        <h1>{queue.length} {queue.length === 1 ? 'student' : 'students'} · {groups.length} {groups.length === 1 ? 'group' : 'groups'}</h1>
        {first ? (
          <div className={`next${dragClass(0)}`} ref={(el) => { refs.current[0] = el }}>
            <div>
              <p className="eyebrow">Next up</p>
              <h2 className="big">{first.title}</h2>
              <p><Names tickets={first.tickets} /> · about {first.mins} min</p>
              <div className="tags">{hours && <ClassTag course={hours.course} />}<Cat type={first.type} cats={cats} /></div>
              <div className="btns">
                <button className="btn light" onClick={() => finish(first)}>{first.tickets.length > 1 ? 'Start with all' : 'Start with this student'}</button>
                {grip(first, 0)}
                {lockBtn(first, 0)}
                {first.solo > first.mins && <span>Saves {first.solo - first.mins} min</span>}
              </div>
            </div>
            <i className="sun" aria-hidden="true" />
          </div>
        ) : <div className="card"><h2>Queue is empty</h2><p className="muted">New questions show up here.</p></div>}
        {rest.length > 0 && <h2>After that</h2>}
        <ol className="rows">
          {rest.map((g, k) => {
            const i = k + 1
            const prev = groups[i - 1]
            return (
              <Fragment key={g.id}>
                {isLate(g) && !isLate(prev) && <li className="divider" aria-hidden="true"><span>Joined after start</span></li>}
                <li className={`card row${dragClass(i)}`} ref={(el) => { refs.current[i] = el }}>
                  {grip(g, i, ' side')}
                  <Cat type={g.type} cats={cats} />
                  <div className="rowtext">
                    <b>{g.title}</b>
                    <small>
                      {hours && <><ClassTag course={hours.course} />{' '}</>}
                      <Names tickets={g.tickets} /> · {g.tickets.length} {g.tickets.length === 1 ? 'student' : 'students'} · ~{g.mins} min
                      {g.tickets.some((t) => t.overflow_count > 0) && ' · from last session'}
                      {isLate(g) && ' · late'}
                    </small>
                  </div>
                  <div className="btns">
                    <button className="btn outline" onClick={() => finish(g)}>{g.tickets.length > 1 ? 'Help together' : 'Help'}</button>
                    {lockBtn(g, i)}
                  </div>
                </li>
              </Fragment>
            )
          })}
        </ol>
        {drag && groups[drag.from] && (
          <div className="card row floating" aria-hidden="true" style={{ top: drag.y - drag.dy, left: drag.left, width: drag.width }}>
            <span className="grip side">⋮⋮</span>
            <Cat type={groups[drag.from].type} cats={cats} />
            <div className="rowtext">
              <b>{groups[drag.from].title}</b>
              <small>{groups[drag.from].tickets.length} {groups[drag.from].tickets.length === 1 ? 'student' : 'students'} · ~{groups[drag.from].mins} min</small>
            </div>
          </div>
        )}
        {groups.length > 1 && <p className="muted small-note">Drag to reorder · click a lock to hold or release a spot</p>}
      </section>

      <aside className="stack">
        <div className="card">
          <h2>Today</h2>
          <dl className="stats">
            <div><dd>{helped}</dd><dt>helped</dt></div>
            <div><dd>{left}m</dd><dt>left</dt></div>
            <div><dd className="accent">−{saved}m</dd><dt>saved by grouping</dt></div>
          </dl>
        </div>
        {hours && form && (
          <div className="card form">
            <h2>Office hours</h2>
            <label>Location<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
            <div className="row2">
              <label>Starts<input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></label>
              <label>Ends<input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></label>
            </div>
            <div className="btns">
              <button className="btn dark" onClick={() => act(() => api.saveHours(form), 'Saved.')}>Save changes</button>
              {hours.state === 'upcoming' && <button className="btn outline" onClick={() => act(() => api.saveHours({ is_open: true }), 'Office hours open.')}>Open now</button>}
              {hours.state === 'running' && <button className="btn outline" onClick={() => act(() => api.wrapUp(), (msg) => msg)}>Wrap up</button>}
              {hours.state === 'closed' && <span className="muted">Ended</span>}
            </div>
            {live && hours.state === 'running' && !hours.has_next && queue.length > 0 && (
              <p className="fine left">No later session · {queue.length} waiting will stay here</p>
            )}
            {!live && <button className="link" onClick={() => { api.resetDemo(); Object.keys(localStorage).filter((k) => k.startsWith('zh.mine')).forEach((k) => localStorage.removeItem(k)); location.reload() }}>Reset demo data</button>}
          </div>
        )}
        <NewSession act={act} course={course} courses={courses} alwaysOpen={ready && !hours} onCreated={setProClass} />
      </aside>
    </div>
  )
}

function ClassChip({ course, on, onClick }) {
  const colorOf = useContext(Colors)
  return (
    <button className={`cc cc-${colorOf(course)} cchip${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick}>
      <ClassTag course={course} />
    </button>
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
    <div className="card form">
      <h2>{alwaysOpen ? 'Schedule your first session' : 'New session'}</h2>
      <div className="row2">
        <label>Course
          {courses.length > 0
            ? <select value={f.course} onChange={set('course')}>{courses.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            : <input value={f.course} onChange={set('course')} placeholder="COMPSCI 161" />}
        </label>
        <label>Location<input value={f.location} onChange={set('location')} placeholder="DBH 1100" /></label>
      </div>
      <div className="row2">
        <label>Starts<input type="datetime-local" value={f.starts_at} onChange={set('starts_at')} /></label>
        <label>Ends<input type="datetime-local" value={f.ends_at} onChange={set('ends_at')} /></label>
      </div>
      {f.starts_at && f.ends_at && f.ends_at <= f.starts_at && <p className="fine left">End time must be after start time.</p>}
      <div className="btns">
        <button className="btn dark" disabled={!valid} onClick={() => act(async () => {
          await api.createHours({ course: f.course.trim(), location: f.location.trim(), starts_at: f.starts_at, ends_at: f.ends_at })
          onCreated(f.course.trim())
          setOpen(false)
        }, 'Session scheduled.')}>Schedule session</button>
        {!alwaysOpen && <button className="btn outline" onClick={() => setOpen(false)}>Cancel</button>}
      </div>
    </div>
  )
}
