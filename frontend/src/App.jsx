import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api.js'

const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const useStored = (k, d) => {
  const [v, setV] = useState(() => ls(k, d))
  useEffect(() => { localStorage.setItem(k, JSON.stringify(v)) }, [k, v])
  return [v, setV]
}
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0] || 'th')
const when = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
const words = (s) => s.toLowerCase().match(/[a-z]{4,}/g) || []

// Tickets sharing a bucket are one "conversation".
// The queue already arrives in serving order (main line by score, then the late section
// by arrival), so groups keep that order: each group sits where its first student is.
// Don't re-sort by score here, or late questions with high scores would jump ahead.
function groupUp(queue, cats) {
  const map = new Map()
  queue.forEach((t) => {
    const g = map.get(t.bucket_id) || { id: t.bucket_id, tickets: [], priority: 0 }
    g.tickets.push(t); g.priority = Math.max(g.priority, t.priority); map.set(t.bucket_id, g)
  })
  return [...map.values()].map((g) => {
    const times = g.tickets.map((t) => cats[t.question_type]?.base_time ?? 3)
    return { ...g, title: g.tickets[0].question, mins: Math.max(...times), solo: times.reduce((a, b) => a + b, 0) }
  })
}
// In the late section at the back: joined after the session started, and not moved up
// by the professor.
const isLate = (g) => g.tickets.every((t) => t.in_late_section)

function useQueue() {
  const [state, setState] = useState({ queue: [], cats: api.CATS, hours: null, live: false, ready: false })
  const tick = useRef(0)
  const refresh = useCallback(async () => {
    try {
      // Backend started after the page loaded? Look for it every few refreshes.
      if (!api.isLive() && tick.current++ % 3 === 0 && await api.probe()) {
        const cats = await api.getCategories()
        setState((s) => ({ ...s, cats }))
      }
      const hours = await api.getHours()
      const queue = await api.getQueue(hours?.id) // only the session being shown
      setState((s) => ({ ...s, queue, hours, live: api.isLive(), ready: true }))
    } catch { /* keep last data */ }
  }, [])
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
  const [toast, setToast] = useState(null)
  const [{ queue, cats, hours, live, ready }, refresh] = useQueue()
  const groups = useMemo(() => groupUp(queue, cats), [queue, cats])

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) } }, [toast])
  const act = async (fn, ok) => {
    try { const r = await fn(); if (ok) setToast(typeof ok === 'function' ? ok(r) : ok); await refresh() } catch (e) { setToast(e.message) }
  }

  return (
    <div className="shell">
      <header className="top">
        <strong className="logo">zot hours</strong>
        <nav className="tabs" aria-label="View">
          {['student', 'professor'].map((r) => (
            <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{r === 'student' ? 'Student' : 'Professor'}</button>
          ))}
        </nav>
        <div className="top-right">
          {!live && ready && <span className="pill muted" title="Backend not reachable, using local demo data">Demo data</span>}
          {hours && <span className={`pill ${hours.state === 'closed' ? 'closed' : ''}`}><i />{hours.course} {hours.state === 'running' ? 'is open' : hours.state === 'upcoming' ? `starts ${when(hours.starts_at)}` : 'has ended'}</span>}
          <button className="ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle light and dark mode">
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </header>
      <main>
        {role === 'student'
          ? <Student {...{ queue, groups, cats, hours, act, live, ready }} />
          : <Professor {...{ groups, queue, cats, hours, act, live, ready }} />}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

function Student({ queue, groups, cats, hours, act, live, ready }) {
  const [me, setMe] = useStored('zh.me', { name: '', section: '' })
  // [{ id, name }]. Matching the name too means leftover ids from a reset database
  // never claim someone else's ticket.
  const [mine, setMine] = useStored('zh.mine2', [])
  const [q, setQ] = useState('')
  const [type, setType] = useState('understanding_topic')
  const [confirm, setConfirm] = useState(false)
  const [remote, setRemote] = useState([])
  const n = q.trim() ? q.trim().split(/\s+/).length : 0
  const over = n > 25
  const running = hours?.state === 'running'
  const canJoin = !!hours && hours.state !== 'closed'

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
      const t = await api.join({ student_name: me.name.trim(), class_section: me.section.trim(), question: q.trim(), question_type: type, bucket_id })
      setMine((m) => [...m, { id: t.id, name: me.name.trim() }]); setQ('')
    }, 'Saved. Your spot is in the line.')
  }
  // A new question in a session that already started goes to the back, so ask first.
  const startNew = () => (running ? setConfirm(true) : submit())
  const ok = canJoin && me.name.trim() && me.section.trim() && n > 0 && !over

  return (
    <div className="grid student">
      <section className="stack">
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
              <div className="row2">
                <label>Your name<input value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} placeholder="Maya" /></label>
                <label>Class section<input value={me.section} onChange={(e) => setMe({ ...me, section: e.target.value })} placeholder="Lec A" /></label>
              </div>
              <label>In a sentence or two
                <textarea rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="My recursive flatten() returns None for nested lists, but works for flat ones." />
              </label>
              <div className={`count ${over ? 'bad' : ''}`}>{n}/25 words{over && ' · shorten it a little'}</div>
              <div className="chips" role="radiogroup" aria-label="Question type">
                {Object.entries(cats).map(([id, cat]) => (
                  <button key={id} role="radio" aria-checked={type === id} className={type === id ? 'chip on' : 'chip'} onClick={() => setType(id)}>{cat.label}</button>
                ))}
              </div>
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
                <p className="fine">{ok ? `You'd be ${ordinal(nextSpot)} in line, about ${nextWait} minutes.` : 'Add your name, section, and a question (25 words max).'}</p>
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
            <p>About {wait} minutes. {groups[myGroupIdx].tickets.length > 1 && `You're sharing this with ${groups[myGroupIdx].tickets.length - 1} other.`}</p>
            {lateMine && <p className="muted">You joined after the session started, so you're behind everyone who was already waiting.</p>}
            <button className="btn outline" onClick={() => act(() => Promise.all(myTickets.map((t) => api.update(t.id, { status: 'done' }))), 'Glad that got fixed.')}>Fixed it, thanks</button>
          </div>
        )}
        <div className="card">
          <h2>The line right now</h2>
          {groups.length === 0 && <p className="muted pad">Nobody's waiting. Ask away and you'll be first.</p>}
          <ol className="list">
            {groups.map((g, i) => (
              <li key={g.id} className={g.tickets.some(isMine) ? 'me' : ''}>
                <span className="num">{i + 1}</span>
                <div><b>{g.title}</b><small>{g.tickets.length} {g.tickets.length === 1 ? 'student' : 'students'} · ~{g.mins} min</small></div>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  )
}

function Professor({ groups, queue, cats, hours, act, live, ready }) {
  const [helped, setHelped] = useStored('zh.helped', 0)
  const [form, setForm] = useState(null)
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
  const move = (g, dir) => act(() => Promise.all(g.tickets.map((t) => api.bump(t.id, dir))))
  const names = (g) => g.tickets.map((t) => t.student_name).join(', ')

  return (
    <div className="grid pro">
      <section className="stack">
        <h1>{queue.length} {queue.length === 1 ? 'student' : 'students'}, {groups.length} {groups.length === 1 ? 'conversation' : 'conversations'}.</h1>
        {first ? (
          <div className="next">
            <div>
              <p className="eyebrow">Next up</p>
              <h2 className="big">{first.title}</h2>
              <p>{names(first)} {first.tickets.length > 1 ? 'are all' : 'is'} stuck on this. About {first.mins} minutes.</p>
              <div className="btns">
                <button className="btn light" onClick={() => finish(first)}>{first.tickets.length > 1 ? `Start with all ${first.tickets.length}` : 'Start with this student'}</button>
                {first.solo > first.mins && <span>Saves about {first.solo - first.mins} minutes</span>}
              </div>
            </div>
            <i className="sun" aria-hidden="true" />
          </div>
        ) : <div className="card"><h2>The queue is empty.</h2><p className="muted">New questions show up here as students save their spots.</p></div>}
        {rest.length > 0 && <h2>After that</h2>}
        <ol className="rows">
          {rest.map((g, i) => {
            const prev = i === 0 ? first : rest[i - 1]
            return (
              <Fragment key={g.id}>
                {isLate(g) && !isLate(prev) && <li className="divider" aria-hidden="true"><span>Joined after the session started</span></li>}
                <li className="card row">
                  <span className="num">{g.tickets.length}</span>
                  <div>
                    <b>{g.title}</b>
                    <small>{names(g)} · ~{g.mins} min
                      {g.tickets.some((t) => t.manually_changed) && ' · moved by you'}
                      {g.tickets.some((t) => t.overflow_count > 0) && ' · pushed from last session'}
                      {g.tickets.some((t) => t.late) && ' · joined late'}
                    </small>
                  </div>
                  <div className="btns">
                    <button className="icon" aria-label="Move up" onClick={() => move(g, 'up')}>↑</button>
                    {/* Late questions are already at the back, so there's nowhere further down. */}
                    {!isLate(g) && <button className="icon" aria-label="Move down" onClick={() => move(g, 'down')}>↓</button>}
                    <button className="btn outline" onClick={() => finish(g)}>{g.tickets.length > 1 ? 'Help together' : 'Help'}</button>
                  </div>
                </li>
              </Fragment>
            )
          })}
        </ol>
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
            {!live && <button className="link" onClick={() => { api.resetDemo(); localStorage.removeItem('zh.mine2'); location.reload() }}>Reset demo data</button>}
          </div>
        )}
        <NewSession act={act} course={hours?.course} alwaysOpen={ready && !hours} />
      </aside>
    </div>
  )
}

function NewSession({ act, course, alwaysOpen }) {
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
          setOpen(false)
        }, 'Session scheduled.')}>Schedule session</button>
        {!alwaysOpen && <button className="btn outline" onClick={() => setOpen(false)}>Cancel</button>}
      </div>
    </div>
  )
}
