import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api.js'
import { CURRENT_STUDENT } from './config.js'

const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const useStored = (k, d) => {
  const [v, setV] = useState(() => ls(k, d))
  useEffect(() => { localStorage.setItem(k, JSON.stringify(v)) }, [k, v])
  return [v, setV]
}
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0] || 'th')
const when = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
// "6:05 PM" today, "Sat 6:05 PM" on another day. t is local time like "2026-10-18T18:05".
const turnTime = (t) => {
  const d = new Date(t)
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : when(t)
}
const words = (s) => s.toLowerCase().match(/[a-z]{4,}/g) || []
const PALETTE = 6 // class colors cc-0 .. cc-5 in App.css

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
    return { ...g, title: g.tickets[0].question, mins: Math.max(...times), solo: times.reduce((a, b) => a + b, 0) }
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

function useQueue(course) {
  const [state, setState] = useState({ queue: [], cats: api.CATS, hours: null, sessions: [], live: false, ready: false })
  const tick = useRef(0)
  const courseRef = useRef(course)
  courseRef.current = course
  const refresh = useCallback(async () => {
    try {
      // Backend started after the page loaded? Look for it every few refreshes.
      if (!api.isLive() && tick.current++ % 3 === 0 && await api.probe()) {
        const cats = await api.getCategories()
        setState((s) => ({ ...s, cats }))
      }
      const sessions = await api.getSessions()
      const hours = api.pickHours(sessions, course)
      const queue = await api.getQueue(hours?.id) // only the session being shown
      if (courseRef.current !== course) return // the page moved to another class meanwhile
      setState((s) => ({ ...s, queue, hours, sessions, live: api.isLive(), ready: true }))
    } catch { /* keep last data */ }
  }, [course])
  useEffect(() => { setState((s) => (s.ready ? { ...s, ready: false, queue: [], hours: null } : s)) }, [course])
  useEffect(() => {
    let id, dead = false
    api.probe().then(async () => {
      const cats = await api.getCategories()
      if (dead) return
      setState((s) => ({ ...s, cats })); refresh(); id = setInterval(refresh, 4000)
    })
    return () => { dead = true; clearInterval(id) }
  }, [refresh])
  return [state, refresh]
}

export default function App() {
  const [theme, setTheme] = useStored('zh.theme', 'dark')
  const [role, setRole] = useStored('zh.role', 'student')
  const [view, setView] = useState('class') // student pages: class | classes | add | profile
  const [toast, setToast] = useState(null)
  // The student comes from config.js. Name and section can be edited on the profile page.
  const [me, setMe] = useStored('zh.profile', { name: CURRENT_STUDENT.name, section: CURRENT_STUDENT.section })
  const [classes, setClasses] = useStored('zh.classes', CURRENT_STUDENT.classes)
  const [lastClass, setLastClass] = useStored('zh.class', CURRENT_STUDENT.classes[0] ?? null)
  const [proClass, setProClass] = useStored('zh.proclass', null)
  const [colors, setColors] = useStored('zh.colors', {})

  const cur = classes.includes(lastClass) ? lastClass : classes[0] ?? null
  const [{ queue, cats, hours, sessions, live, ready }, refresh] = useQueue(role === 'student' ? cur : proClass)
  const groups = useMemo(() => groupUp(queue, cats), [queue, cats])
  const courses = useMemo(() => [...new Set(sessions.map((s) => s.course))], [sessions])

  // Give every class a color the first time we see it, in order, and remember it.
  const known = [...classes, ...courses].join('|')
  useEffect(() => {
    const missing = known.split('|').filter((c) => c && colors[c] === undefined)
    if (missing.length) setColors((prev) => {
      const next = { ...prev }
      missing.forEach((c) => { if (next[c] === undefined) next[c] = Object.keys(next).length % PALETTE })
      return next
    })
  }, [known]) // eslint-disable-line react-hooks/exhaustive-deps
  const colorOf = useCallback((c) => colors[c] ?? 0, [colors])

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) } }, [toast])
  const act = async (fn, ok) => {
    try { const r = await fn(); if (ok) setToast(typeof ok === 'function' ? ok(r) : ok); await refresh() } catch (e) { setToast(e.message) }
  }
  const openClass = (c) => { setLastClass(c); setView('class') }
  const addClass = (c) => { setClasses((l) => (l.includes(c) ? l : [...l, c])); setToast(`Added ${c}.`) }
  const removeClass = (c) => { setClasses((l) => l.filter((x) => x !== c)); setToast(`Removed ${c}.`) }

  const navButtons = [['classes', 'My classes'], ['add', 'Add a class'], ['profile', 'Profile']]
  const studentProps = { queue, groups, cats, hours, act, live, ready, me, course: cur, go: setView }

  return (
    <Colors.Provider value={colorOf}>
      <div className="shell">
        <header className="top">
          <strong className="logo">zot hours</strong>
          <nav className="tabs" aria-label="View">
            {['student', 'professor'].map((r) => (
              <button key={r} className={role === r ? 'on' : ''} onClick={() => { setRole(r); setView('class') }}>{r === 'student' ? 'Student' : 'Professor'}</button>
            ))}
          </nav>
          <div className="top-right">
            {!live && ready && <span className="pill muted" title="Backend not reachable, using local demo data">Demo data</span>}
            {hours && <span className={`cc cc-${colorOf(hours.course)} pill tinted ${hours.state === 'closed' ? 'closed' : ''}`}><i />{hours.course} {hours.state === 'running' ? 'is open' : hours.state === 'upcoming' ? `starts ${when(hours.starts_at)}` : 'has ended'}</span>}
            {role === 'student' && navButtons.map(([v, label]) => (
              <button key={v} className="ghost" aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>{label}</button>
            ))}
            <button className="ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle light and dark mode">
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </header>
        <main>
          {role === 'professor' ? (
            <Professor {...{ groups, queue, cats, hours, act, live, ready, courses, setProClass }} />
          ) : view === 'classes' ? (
            <ClassList {...{ classes, sessions, cur, openClass, removeClass, go: setView }} />
          ) : view === 'add' ? (
            <AddClass {...{ classes, courses, addClass, cur, go: setView }} />
          ) : view === 'profile' ? (
            <Profile {...{ me, setMe, classes, cur, openClass, go: setView }} />
          ) : (
            <Student {...studentProps} />
          )}
        </main>
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </Colors.Provider>
  )
}

function Back({ cur, go }) {
  return cur ? <button className="link" onClick={() => go('class')}>← Back to {cur}</button> : null
}

function sessionLine(sessions, course) {
  const s = api.bestSession(sessions, course)
  if (!s) return 'No sessions scheduled yet'
  const waiting = s.waiting_count != null ? ` · ${s.waiting_count} waiting` : ''
  if (s.state === 'running') return `Open now at ${s.location}${waiting}`
  if (s.state === 'upcoming') return `Next: ${when(s.starts_at)} at ${s.location}${waiting}`
  return 'Last session has ended'
}

function ClassList({ classes, sessions, cur, openClass, removeClass, go }) {
  return (
    <section className="stack narrow">
      <Back cur={cur} go={go} />
      <h1>Your classes</h1>
      {classes.length === 0 && <div className="card"><p className="muted">No classes yet. Add one to see its office hours and line.</p><button className="btn primary" onClick={() => go('add')}>Add a class</button></div>}
      <ul className="rows">
        {classes.map((c) => (
          <li key={c} className="card row">
            <div className="grow"><ClassTag course={c} /><small>{sessionLine(sessions, c)}</small></div>
            <div className="btns">
              <button className="btn dark" onClick={() => openClass(c)}>Open</button>
              <button className="btn outline" onClick={() => removeClass(c)} aria-label={`Remove ${c}`}>Remove</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function AddClass({ classes, courses, addClass, cur, go }) {
  const available = courses.filter((c) => !classes.includes(c))
  return (
    <section className="stack narrow">
      <Back cur={cur} go={go} />
      <h1>Add a class</h1>
      <p className="muted">These are the classes that have office hours scheduled.</p>
      {available.length === 0 && <div className="card"><p className="muted">Every class with office hours is already on your list. When a professor schedules one for another class, it shows up here.</p></div>}
      <ul className="rows">
        {available.map((c) => (
          <li key={c} className="card row">
            <div className="grow"><ClassTag course={c} /></div>
            <button className="btn primary" onClick={() => addClass(c)}>Add</button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Profile({ me, setMe, classes, cur, openClass, go }) {
  return (
    <section className="stack narrow">
      <Back cur={cur} go={go} />
      <h1>Profile</h1>
      <div className="card form">
        <div className="row2">
          <label>Name<input value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} /></label>
          <label>Class section<input value={me.section} onChange={(e) => setMe({ ...me, section: e.target.value })} /></label>
        </div>
        <p className="muted">Used to fill in the join form. Changes save as you type.</p>
      </div>
      <div className="card">
        <h2>Classes</h2>
        {classes.length === 0 && <p className="muted pad">None yet.</p>}
        <ul className="chips pad">
          {classes.map((c) => <li key={c} style={{ listStyle: 'none' }}><ClassChip course={c} on={c === cur} onClick={() => openClass(c)} /></li>)}
        </ul>
      </div>
    </section>
  )
}

function Student({ queue, groups, cats, hours, act, live, ready, me, course, go }) {
  // [{ id, name }]. Matching the name too means leftover ids from a reset database
  // never claim someone else's ticket.
  const colorOf = useContext(Colors)
  const [mine, setMine] = useStored('zh.mine2', [])
  const [past, setPast] = useStored('zh.past', [])
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

  // Place in line is counted in groups, the same way the list on the right is numbered.
  const myGroupIdx = groups.findIndex((g) => g.tickets.some(isMine))
  const pos = myGroupIdx + 1
  const wait = myGroupIdx < 0 ? 0 : groups.slice(0, myGroupIdx + 1).reduce((a, g) => a + g.mins, 0)
  const lateMine = myTickets.length > 0 && myTickets.every((t) => t.in_late_section)
  // Estimated turn time from the backend (rounded to 5 minutes). Not in demo mode.
  const myTurn = myTickets.find((t) => t.estimated_turn_at)
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
    }, 'Saved. Your spot is in the line.')
  }
  // "Same question?" on a row in the line: join that group as it is.
  const joinGroup = (g) => act(async () => {
    const t = await api.join({ student_name: me.name.trim(), class_section: me.section.trim(), bucket_id: g.id, office_hours_id: hours?.id })
    setMine((m) => [...m, { id: t.id, name: me.name.trim() }])
  }, 'You joined the group. You keep its place in line.')
  // A new question in a session that already started goes to the back, so ask first.
  const startNew = () => (running ? setConfirm(true) : submit())
  const ok = canJoin && hasProfile && n > 0 && !over

  // "Fixed it" marks the student done; "Leave the line" marks them left.
  const finish = (kind) => {
    const ts = myTickets
    return act(async () => {
      await Promise.all(ts.map((t) => (kind === 'done' ? api.update(t.id, { status: 'done' }) : api.leave(t.id))))
      setPast((p) => [...ts.map((t) => ({ id: t.id, question: t.question, status: kind, course, at: Date.now() })), ...p].slice(0, 30))
    }, kind === 'done' ? "Glad that got fixed. You're off the list." : 'You left the line. You can join again any time.')
  }
  const myPast = past.filter((p) => p.course === course).slice(0, 5)

  if (!course) {
    return (
      <section className="stack narrow">
        <h1>No classes yet</h1>
        <div className="card"><p className="muted">Add a class to see its office hours and join the line.</p><button className="btn primary" onClick={() => go('add')}>Add a class</button></div>
      </section>
    )
  }

  return (
    <div className="grid student">
      <section className="stack">
        <div className={`cc cc-${colorOf(course)} band`}>
          <h2>{course}</h2>
          <span>{hours ? `${hours.location} · ${when(hours.starts_at)}` : ready ? 'No sessions scheduled' : ''}</span>
        </div>
        <h1>{me.name.trim() ? `Hey ${me.name.trim()}, what's tripping you up?` : "What's tripping you up?"}</h1>
        {hours && <p className="muted">{hours.state === 'upcoming' ? `${hours.course} starts ${when(hours.starts_at)} at ${hours.location}. Join now to go ahead of anyone who joins after it starts.` : hours.state === 'running' ? `${hours.course} is running at ${hours.location}. New questions go behind anyone already waiting.` : 'These office hours have ended. Check back for the next session.'}</p>}
        {ready && !canJoin ? (
          <div className="card">
            <h2>{hours ? 'No open office hours right now' : 'No office hours scheduled yet'}</h2>
            <p className="muted pad">{hours ? 'Your professor will post the next session here.' : 'Once your professor schedules a session, you can save your spot here.'}</p>
          </div>
        ) : (
          <>
            <div className="card form">
              {!hasProfile && <p className="muted">Add your name and section on the <button className="link inline" onClick={() => go('profile')}>profile page</button> first.</p>}
              <label>In a sentence or two
                <textarea rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="My recursive flatten() returns None for nested lists, but works for flat ones." />
              </label>
              <div className={`count ${over ? 'bad' : ''}`}>{n}/25 words{over && ' · shorten it a little'}</div>
              <div className="chips" role="radiogroup" aria-label="Question type">
                {Object.entries(cats).map(([id, cat]) => (
                  <button key={id} role="radio" aria-checked={type === id} className={type === id ? 'chip on' : 'chip'} onClick={() => setType(id)}>{cat.label}</button>
                ))}
              </div>
              <p className="muted small-note">Asking as {me.name.trim() || 'nobody yet'}{me.section.trim() && `, ${me.section.trim()}`}.</p>
            </div>
            {similar && (
              <div className="card hint">
                <h3>Maybe this helps first</h3>
                <p>{similar.count} {similar.count === 1 ? 'classmate is' : 'classmates are'} waiting on something close: “{similar.title}”. Joining them gets you helped in one go{running ? ', and you keep their place in line even though the session has started' : ''}.</p>
                <div className="btns">
                  <button className="btn dark" disabled={!ok} onClick={() => submit(similar.id)}>Join the group</button>
                  <button className="btn outline" disabled={!ok} onClick={startNew}>Keep mine separate</button>
                </div>
              </div>
            )}
            {confirm ? (
              <div className="card hint" role="alertdialog" aria-label="Session already started">
                <h3>This session has started</h3>
                <p>Your question will go to the back of the line, behind everyone already waiting.</p>
                <div className="btns">
                  <button className="btn dark" onClick={() => submit()}>Join anyway</button>
                  <button className="btn outline" onClick={() => setConfirm(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div>
                <button className="btn primary wide" disabled={!ok} onClick={startNew}>Save my spot</button>
                <p className="fine">{ok ? `You'd be ${ordinal(nextSpot)} in line, about ${nextWait} minutes.` : 'Add a question (25 words max) to save your spot.'}</p>
              </div>
            )}
          </>
        )}
      </section>

      <aside className="stack">
        {myGroupIdx >= 0 && (
          <div className="card spot">
            <p className="muted">Your spot</p>
            <h2 className="big">{ordinal(pos)} in line</h2>
            {myTurn?.past_session_end ? (
              <p className="turn warn">You may not be reached this session. If not, you'll move to the next session with a boost.</p>
            ) : myTurn ? (
              <p className="turn">Your turn: about <b>{turnTime(myTurn.estimated_turn_at)}</b></p>
            ) : (
              <p>About {wait} minutes.</p>
            )}
            {groups[myGroupIdx].tickets.length > 1 && <p>You're sharing this with {groups[myGroupIdx].tickets.length - 1} other.</p>}
            {lateMine && <p className="muted">You joined after the session started, so you're behind everyone who was already waiting.</p>}
            <div className="btns">
              <button className="btn outline" onClick={() => finish('done')}>Fixed it, thanks</button>
              <button className="btn outline" onClick={() => finish('left')}>Leave the line</button>
            </div>
          </div>
        )}
        <div className="card">
          <h2>The line right now</h2>
          {groups.length > 0 && <p className="muted small-note">Same question as one of these? Joining gets you helped together, and you keep the group's place in line.</p>}
          {groups.length === 0 && <p className="muted pad">Nobody's waiting. Ask away and you'll be first.</p>}
          <ol className="list scroll">
            {groups.map((g, i) => {
              const yours = g.tickets.some(isMine)
              return (
                <li key={g.id} className={yours ? 'me' : ''}>
                  <span className="num">{i + 1}</span>
                  <div><b>{g.title}</b><small>{g.tickets.length} {g.tickets.length === 1 ? 'student' : 'students'} · ~{g.mins} min{yours && " · you're in this group"}</small></div>
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
        {myPast.length > 0 && (
          <div className="card">
            <h2>Past questions</h2>
            <ul className="list">
              {myPast.map((p) => (
                <li key={`${p.id}-${p.at}`}><div><b>{p.question}</b><small>{p.status === 'done' ? 'Done' : 'Left the line'}</small></div></li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  )
}

function Professor({ groups, queue, cats, hours, act, live, ready, courses, setProClass }) {
  const [helped, setHelped] = useStored('zh.helped', 0)
  const [form, setForm] = useState(null)
  const [drag, setDrag] = useState(null) // { from, to } (indexes in the list) while a group is being dragged
  const refs = useRef([])
  useEffect(() => { if (hours) setForm({ location: hours.location, starts_at: hours.starts_at, ends_at: hours.ends_at }) }, [hours?.id, hours?.is_open]) // eslint-disable-line react-hooks/exhaustive-deps
  const [first, ...rest] = groups
  const left = groups.reduce((a, g) => a + g.mins, 0)
  const saved = groups.reduce((a, g) => a + g.solo - g.mins, 0)
  const topics = useMemo(() => {
    const m = {}; queue.forEach((t) => { const l = cats[t.question_type]?.label || t.question_type; m[l] = (m[l] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [queue, cats])
  const peak = Math.max(1, ...topics.map((t) => t[1]))
  const finish = (g) => act(async () => { await api.resolveGroup(g.id, g.tickets); setHelped((h) => h + g.tickets.length) })
  // Dropping a group pins it at that spot (1 = top, counted in groups).
  const pin = (g, position) => act(() => api.pinGroup(g.id, position), `Moved to spot ${position}. It stays there until you unpin it.`)
  const unpin = (g) => act(() => api.pinGroup(g.id, null), 'Unpinned. The score decides its spot again.')

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
  const grip = (g, i) => (
    <button
      type="button" className="grip"
      aria-label={`Move “${g.title}”. Drag it, or press the up and down arrow keys.`}
      onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag({ from: i, to: i }) }}
      onPointerMove={(e) => { if (drag && drag.from === i) { const to = dropTo(e.clientY, i); if (to !== drag.to) setDrag({ from: i, to }) } }}
      onPointerUp={() => { const d = drag; setDrag(null); if (d && d.from === i && d.to !== i) pin(g, d.to + 1) }}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); pin(g, i) }
        if (e.key === 'ArrowDown' && i < groups.length - 1) { e.preventDefault(); pin(g, i + 2) }
      }}
    >⋮⋮</button>
  )
  const dragClass = (i) => {
    if (!drag) return ''
    if (i === drag.from) return ' dragging'
    if (drag.to === drag.from || i !== drag.to) return ''
    return drag.to < drag.from ? ' drop-before' : ' drop-after'
  }

  return (
    <div className="grid pro">
      <section className="stack">
        {courses.length > 0 && (
          <div className="chips" role="group" aria-label="Class">
            {courses.map((c) => (
              <ClassChip key={c} course={c} on={hours?.course === c} onClick={() => setProClass(c)} />
            ))}
          </div>
        )}
        <h1>{queue.length} {queue.length === 1 ? 'student' : 'students'}, {groups.length} {groups.length === 1 ? 'conversation' : 'conversations'}.</h1>
        {first ? (
          <div className={`next${dragClass(0)}`} ref={(el) => { refs.current[0] = el }}>
            <div>
              <p className="eyebrow">Next up{isPinned(first) && ' · Pinned'}</p>
              <h2 className="big">{first.title}</h2>
              <p><Names tickets={first.tickets} /> {first.tickets.length > 1 ? 'are all' : 'is'} stuck on this. About {first.mins} minutes.</p>
              {hours && <p><ClassTag course={hours.course} /></p>}
              <div className="btns">
                <button className="btn light" onClick={() => finish(first)}>{first.tickets.length > 1 ? `Start with all ${first.tickets.length}` : 'Start with this student'}</button>
                {grip(first, 0)}
                {isPinned(first) && <button className="link" onClick={() => unpin(first)}>Unpin</button>}
                {first.solo > first.mins && <span>Saves about {first.solo - first.mins} minutes</span>}
              </div>
            </div>
            <i className="sun" aria-hidden="true" />
          </div>
        ) : <div className="card"><h2>The queue is empty.</h2><p className="muted">New questions show up here as students save their spots.</p></div>}
        {rest.length > 0 && <h2>After that</h2>}
        <ol className="rows">
          {rest.map((g, k) => {
            const i = k + 1
            const prev = groups[i - 1]
            return (
              <Fragment key={g.id}>
                {isLate(g) && !isLate(prev) && <li className="divider" aria-hidden="true"><span>Joined after the session started</span></li>}
                <li className={`card row${dragClass(i)}`} ref={(el) => { refs.current[i] = el }}>
                  <span className="num">{g.tickets.length}</span>
                  <div>
                    <b>{g.title}</b>
                    <small>
                      {hours && <><ClassTag course={hours.course} />{' '}</>}
                      <Names tickets={g.tickets} /> · ~{g.mins} min
                      {isPinned(g) && <> · <span className="badge">Pinned</span> <button className="link inline" onClick={() => unpin(g)}>Unpin</button></>}
                      {g.tickets.some((t) => t.overflow_count > 0) && ' · pushed from last session'}
                      {isLate(g) && ' · joined late'}
                    </small>
                  </div>
                  <div className="btns">
                    <button className="btn outline" onClick={() => finish(g)}>{g.tickets.length > 1 ? 'Help together' : 'Help'}</button>
                    {grip(g, i)}
                  </div>
                </li>
              </Fragment>
            )
          })}
        </ol>
        {groups.length > 1 && <p className="muted small-note">Drag the handle to pin a group at a spot, or focus it and press the up and down arrow keys. Pinned groups stay put whatever the score says.</p>}
      </section>

      <aside className="stack">
        <div className="card">
          <h2>Today so far</h2>
          <dl className="stats">
            <div><dd>{helped}</dd><dt>helped</dt></div>
            <div><dd>{left}m</dd><dt>left in queue</dt></div>
            <div><dd className="accent">−{saved}m</dd><dt>from grouping</dt></div>
          </dl>
        </div>
        <div className="card">
          <h2>What's coming up</h2>
          {topics.length === 0 && <p className="muted pad">Nothing yet.</p>}
          {topics.map(([l, c]) => (
            <div key={l} className="bar"><span>{l}<b>{c}</b></span><i style={{ width: `${(c / peak) * 100}%` }} /></div>
          ))}
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
              <button className="btn dark" onClick={() => act(() => api.saveHours(form), 'Office hours updated.')}>Save changes</button>
              {hours.state === 'upcoming' && <button className="btn outline" onClick={() => act(() => api.saveHours({ is_open: true }), 'Office hours started. New questions now go behind the line.')}>Open now</button>}
              {hours.state === 'running' && <button className="btn outline" onClick={() => act(() => api.wrapUp(), (msg) => msg)}>Wrap up</button>}
              {hours.state === 'closed' && <span className="muted">These office hours ended.</span>}
            </div>
            {live && hours.state === 'running' && !hours.has_next && queue.length > 0 && (
              <p className="fine left">No later {hours.course} session is scheduled. Schedule one below before wrapping up, or the {queue.length === 1 ? 'student' : `${queue.length} students`} still waiting will stay in this one.</p>
            )}
            {!live && <button className="link" onClick={() => { api.resetDemo(); ['zh.mine2', 'zh.past'].forEach((k) => localStorage.removeItem(k)); location.reload() }}>Reset demo data</button>}
          </div>
        )}
        <NewSession act={act} course={hours?.course} alwaysOpen={ready && !hours} onCreated={setProClass} />
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

function NewSession({ act, course, alwaysOpen, onCreated }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState(() => ({ course: course || '', location: '', starts_at: api.inHours(24), ends_at: api.inHours(26) }))
  useEffect(() => { if (course) setF((x) => (x.course ? x : { ...x, course })) }, [course])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const valid = f.course.trim() && f.location.trim() && f.starts_at && f.ends_at && f.ends_at > f.starts_at

  if (!open && !alwaysOpen) {
    return <button className="btn outline" onClick={() => setOpen(true)}>Schedule a new session</button>
  }
  return (
    <div className="card form">
      <h2>{alwaysOpen ? 'No sessions yet. Schedule one.' : 'New session'}</h2>
      <div className="row2">
        <label>Course<input value={f.course} onChange={set('course')} placeholder="ICS 32" /></label>
        <label>Location<input value={f.location} onChange={set('location')} placeholder="DBH 1100" /></label>
      </div>
      <div className="row2">
        <label>Starts<input type="datetime-local" value={f.starts_at} onChange={set('starts_at')} /></label>
        <label>Ends<input type="datetime-local" value={f.ends_at} onChange={set('ends_at')} /></label>
      </div>
      {f.starts_at && f.ends_at && f.ends_at <= f.starts_at && <p className="fine left">The end time has to be after the start time.</p>}
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
