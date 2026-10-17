# Team Task List

Checklist for the Office Hours Priority Queue. Check items off as you finish them (`- [ ]` → `- [x]`).

**Roles**
- **Frontend:** React screens for students and professors
- **Backend:** our Flask API and the SQLite database
- **Anteater API:** connecting our API to UCI's Anteater API for real class data

Feature details are in [spec.md](spec.md).

---

## Shared (whole team)

### Decisions to make
- [ ] Is the highest or the lowest score served first? (Code currently serves highest first.)
- [ ] Base time and complexity for each category. Current guesses are in `backend/priority.py`:

  | Category | Base time (min) | Complexity | Score with 1 student |
  |---|---|---|---|
  | Quick Q&A | 2 | 1 | 10 |
  | Understanding Topic | 10 | 3 | 24 |
  | Grading | 5 | 1 | 13 |
  | Scheduling / Logistics | 3 | 1 | 11 |
  | Research | 15 | 5 | 35 |
  | Personal | 10 | 3 | 24 |

- [ ] How a professor logs in, or whether the professor screen is simply a separate page with no login for the demo.
- [ ] Whether tickets store a course (e.g. "ICS 32") as well as a class section. This is needed if more than one course runs office hours at the same time.
- [ ] What the class section field holds, such as "Lec A" or an Anteater API section code like "35500".
- [ ] Whether TA queues are in scope for the hackathon or a stretch goal.
- [ ] When a session is already running, should a student who doesn't pick a session join it as late, or be offered the next session to be on time? (Currently they join the running one as late. The frontend can offer the choice by sending `office_hours_id`.)
- [x] Professor bumps on late questions: bumping up moves the question into the main line at its score + 15; bumping down is refused, since it's already at the back.

### Running the project
- Backend, first time:
  ```bash
  cd backend
  python3 -m venv venv
  source venv/bin/activate
  pip install -r requirements.txt
  ```
- After pulling backend changes, run `pip install -r requirements.txt` again (with the venv active) in case new packages were added.
- Backend, every time: `cd backend && source venv/bin/activate && python app.py` (runs on http://localhost:5001; check http://localhost:5001/api/health)
- The backend has no web page of its own. A blank or "Not Found" page at http://localhost:5001 is normal.
- Frontend: `cd frontend && npm install && npm run dev` (usually http://localhost:5173)
- The database file `backend/office_hours.db` is created on first run with sample data, including a session that starts an hour later. Delete the file to reset; do this after pulling database changes if anything looks off.

### Before the demo
- [ ] Write the README: what the app does, how to run it, screenshots
- [ ] Prepare demo data: a few sessions, buckets with several students, a late student, an overflowed student
- [ ] Do a full run-through: students queue before the session, the session starts, a late student goes to the back, the professor helps people, the session closes and remaining students are pushed to the next session
- [ ] Write the demo script and decide who presents which part

---

## API reference (for the frontend)

Base URL: `http://localhost:5001`. Every endpoint returns JSON. When something goes wrong, the response is `{"error": "message"}` with status 400, 404 or 409.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/health` | — | `{"ok": true}` |
| GET | `/api/categories` | — | `[{id, label, base_time, complexity}]` |
| GET | `/api/queue` | `?office_hours_id=` (optional) | Waiting tickets in serving order, each with `position`. Without the filter: every session's line, grouped by session start time. |
| GET | `/api/queue/<id>` | — | One ticket with its current `position` (404 if not found) |
| POST | `/api/queue` | `{student_name, class_section, question, question_type, office_hours_id?}` | New ticket (201). Without `office_hours_id`, it goes to the running session, or the next upcoming one. 409 if none. |
| PATCH | `/api/queue/<id>` | any of `{status, priority, question_type, question, class_section}` | Updated ticket. Setting `priority` marks it `manually_changed`. |
| POST | `/api/queue/<id>/bump` | `{direction: "up" or "down"}` | Updated ticket (moves 15 points, marks it `manually_changed`). 409 when bumping a late-section question down. |
| GET | `/api/buckets` | `?question_type=` `?status=` | Buckets in line order, with `member_count`, `priority`, `in_late_section` and `members` (each student's `ticket_id`, `student_name`, `class_section`, `question`, `status`) |
| GET | `/api/buckets/suggest` | `?question=` (required) `?question_type=` `?office_hours_id=` | Up to 5 open buckets with a similar question, each with `similarity` (0.5–1), most similar first. Empty list if nothing matches. |
| POST | `/api/buckets/<id>/resolve` | — | `{bucket, resolved_count}`. Marks the bucket and everyone waiting in it done. 409 if already done. |
| POST | `/api/buckets/<id>/join` | `{student_name, class_section, question?}` | New ticket (201). The student takes the bucket's place in line, even if they join late. |
| GET | `/api/office_hours` | `?course=` `?is_open=true/false` | Sessions with `waiting_count` and `state` (`upcoming` / `running` / `closed`) |
| POST | `/api/office_hours` | `{course, location, starts_at, ends_at}` | New session (201). Takes questions right away; `state` is `upcoming` until it starts. |
| PATCH | `/api/office_hours/<id>` | any of the above fields | Updated session |
| POST | `/api/office_hours/<id>/open` | — | Opened session. Starts it early if its start time hasn't come yet. 409 if already open or closed. |
| POST | `/api/office_hours/<id>/close` | — | `{session, moved_to, moved_count, warning?}`. Waiting students move to the next session of the same course. 409 if already closed. |

**Ticket fields:** `id`, `student_name`, `class_section`, `question`, `question_type`, `priority`, `status` (`waiting` / `done`), `bucket_id`, `student_count`, `overflow_count`, `manually_changed`, `late`, `in_late_section`, `office_hours_id`, `created_at`, `position`

`position` is the ticket's place in its own session's line, starting at 1, or `null` once it's no longer waiting. Joining the queue or a bucket returns it right away, so the student can see "you are #N".

**Session fields:** `id`, `course`, `location`, `starts_at`, `ends_at`, `is_open`, `closed_at`, `state`, `waiting_count` (list only)

**How the line works:**
- A session has started once the professor presses Open or its start time passes, whichever comes first.
- The line has two sections. The main line holds on-time questions, ranked by `(Base Time + Complex × 3 + Students × 5) × Overflow`.
- Questions submitted after the start have `late: true` and `in_late_section: true`. They go to the back, in the order they arrived. Their `priority` is still their real score, but it doesn't change their order.
- Bumping a late question up moves it into the main line (`in_late_section` becomes false). Bumping it down returns 409.
- When a session closes, waiting students move to the next session, are no longer late, and have their score doubled.

Times use the format `2026-10-17T14:00`.

---

## Frontend

### Setup
- [ ] Replace the Vite starter page in `frontend/src/App.jsx`
- [ ] Add `VITE_API_URL=http://localhost:5001` in `frontend/.env`, or set up a proxy in `vite.config.js`
- [ ] Create one small API helper file (e.g. `src/api.js`) with a function for each endpoint, so screens don't repeat `fetch` code
- [ ] Add page switching between the Student and Professor views (`react-router-dom`, or a simple tab toggle)
- [ ] Pick a style approach (plain CSS, Tailwind or a component library) and a basic color/font theme
- [ ] Show loading and error states the same way everywhere

### Student: join the queue
- [ ] Form fields: name, class section, question, category
- [ ] Session picker: list sessions with `state` `upcoming` or `running` from `GET /api/office_hours`, and send the chosen `office_hours_id`
- [ ] Warn before submitting to a running session: "This session has started. Your question will go to the back of the line."
- [ ] Fill the category dropdown from `GET /api/categories`
- [ ] Live word counter on the question box ("12 / 25 words"); block submitting past 25
- [ ] Show the API's error message if a submission is rejected
- [ ] On success, show the student's place in the queue and their ticket details, including a "joined late" note if `late` is true
- [ ] If the API says there's no upcoming session, show "No office hours scheduled yet"

### Student: similar questions (buckets)
- [ ] As the student types, show similar open questions from `GET /api/buckets/suggest?question=...&question_type=...` (wait until they pause typing before calling it)
- [ ] After a category is picked, show open buckets in it from `GET /api/buckets?question_type=...`
- [ ] Show each bucket's question and how many students are in it
- [ ] "Same question" button → `POST /api/buckets/<id>/join`
- [ ] Make clear that joining a bucket moves the whole group up
- [ ] Point out that joining an existing bucket keeps its place in line, even after the session starts

### Student: queue view
- [ ] Show the queue from `GET /api/queue` (position, category, question). Decide whether names are shown to other students.
- [ ] Highlight the student's own ticket
- [ ] Refresh automatically, e.g. every 5–10 seconds
- [ ] Show the session's location, hours and `state` (upcoming / running) from `GET /api/office_hours`
- [ ] Before the start, show "Office hours start at 2:00 PM. N questions queued so far."
- [ ] Show a message when no session is upcoming or running

### Professor: queue management
- [ ] Queue list with priority, category, student count, and badges for "late", "pushed from last session" (`overflow_count` > 0) and "manually changed"
- [ ] Show a divider between the main line and the late section (`in_late_section`)
- [ ] Hide or disable the "down" button for questions in the late section
- [ ] Group tickets in the same bucket together
- [ ] "Done" button → `PATCH /api/queue/<id>` with `{status: "done"}`
- [ ] Up/down bump buttons → `POST /api/queue/<id>/bump`
- [ ] Edit a ticket's category or priority
- [ ] Show each bucket's members (names and their wording of the question)
- [ ] "Answered" button for a whole bucket → `POST /api/buckets/<id>/resolve`
- [ ] Drag to pin a ticket to a spot (needs the backend pinning task)

### Professor: office hours
- [ ] List sessions from `GET /api/office_hours`, with `state` and the number waiting in each
- [ ] Form to create a session (course, location, start, end)
- [ ] Edit a session's time or location → `PATCH /api/office_hours/<id>`
- [ ] Open button (starts the session now; questions after that go to the back) and Close button. Hide Open on closed sessions.
- [ ] After closing, show "N students moved to <next session>", or the warning when there is no next session

### Professor: syllabus upload
- [ ] File picker that uploads to the syllabus endpoint (needs the backend syllabus task)
- [ ] Show the office hours found in the syllabus, with a button to confirm and create them

### Polish
- [ ] Works at phone width (students will use phones)
- [ ] Empty states: "No one in line", "No sessions scheduled"
- [ ] Favicon and page title

---

## Backend (our API and database)

### Done
- [x] Flask app, CORS, SQLite setup (`app.py`, `db.py`)
- [x] Database code uses SQLAlchemy; tables are defined in `models.py`
- [x] Tables: `office_hours`, `tickets`, `buckets`, `syllabi`
- [x] Older databases get new columns added automatically on startup
- [x] Spec categories and priority formula (`priority.py`)
- [x] Input checks: class section required, 25-word limit, valid category (`validation.py`)
- [x] `GET /api/categories`
- [x] Queue: list, join, edit, bump (`routes/queue.py`)
- [x] Manual-change flag. Bumped or hand-set priorities don't get recalculated.
- [x] Buckets: every new question starts a bucket; list and join (`routes/buckets/`)
- [x] Office hours: list, create, edit, open, close (`routes/office_hours/`)
- [x] Closing a session pushes waiting students to the next one and doubles their score
- [x] Questions can be submitted before a session starts; questions submitted after the start go to the late section at the back, by arrival (`sessions.py`, `queue_order.py`)
- [x] Session states (`upcoming` / `running` / `closed`) and `closed_at`; closed sessions can't be reopened or joined
- [x] Joining a bucket from before the start keeps the late student with that bucket
- [x] Sample session is set relative to the current time, so a fresh database always has one to join

### Queue
- [x] Filter `GET /api/queue` to one session (`?office_hours_id=`)
- [x] Return each ticket's position number for the student "you are #N" display (`queue_order.py`)
- [x] `GET /api/queue/<id>` so a student can check their own ticket (`routes/queue_ticket.py`)
- [ ] Let a student leave the queue (`status: "left"`)
- [ ] Only allow known `status` values (`waiting`, `done`, `left`)
- [ ] Pinning (spec "Manual Changing"): store a `pinned_position` and keep pinned tickets at that spot when sorting
- [ ] Decide whether `question_type` changes on a ticket in a bucket should move it out of the bucket

### Buckets
- [x] `POST /api/buckets/<id>/resolve`: mark the bucket and all its tickets done (`routes/buckets/resolve_bucket.py`)
- [x] Close a bucket automatically when its last ticket is done, and reopen it if a ticket goes back to waiting (`bucket_rules.py`)
- [x] `GET /api/buckets/suggest?question=...&question_type=...`: similar-question matching (`routes/buckets/suggest_buckets.py`, `similarity.py`)
- [x] Return the member list in each bucket for the professor view
- [ ] Tune similar-question matching with real student questions (cutoff and filler words are in `similarity.py`)

### Office hours
- [ ] Move students stranded on a closed session once a later session is scheduled
- [ ] `DELETE /api/office_hours/<id>` (only if nobody is waiting)
- [ ] Stop two sessions of the same course from overlapping
- [ ] Filter `GET /api/office_hours` by `?state=upcoming` / `running` / `closed`
- [ ] Decide what happens when a session's start time is edited after questions came in (currently each question keeps its late / on-time mark)
- [ ] Optional: close sessions automatically at their end time (they already count as started at their start time)

### Syllabus upload (`routes/syllabus.py` is a placeholder)
- [ ] `POST /api/syllabus`: accept a PDF upload and save it to `backend/uploads/`
- [ ] Pull text out of the PDF (e.g. the `pypdf` library) and find office hours times and locations
- [ ] Return the sessions found, for the professor to confirm
- [ ] `GET /api/syllabus`: list uploaded files

### TA queues (stretch)
- [ ] Add a `host` field on sessions (`professor` or `ta`)
- [ ] When a professor session is full, move lower-priority tickets to an open TA session with an overflow boost
- [ ] Send some categories (e.g. Quick Q&A) to TAs first

### Quality
- [ ] Add `pytest` tests for the endpoints, using a temporary database. Include before-start and after-start submissions, since they depend on the clock.
- [ ] One consistent error format and status codes everywhere
- [ ] Add a `course` field to tickets if the team decides to (see Decisions)

---

## Anteater API connection

UCI's Anteater API provides course and section data. Check its documentation for the current endpoints before building. The work is to call it from our backend and expose the parts we need through our own API, so the frontend never calls Anteater directly.

### Research
- [ ] Read the Anteater API docs. Find out the base URL, whether an API key is needed, and the rate limits.
- [ ] Find the endpoints for course info (title, department) and current-quarter sections (section codes, lecture/discussion, instructors, times, locations)
- [ ] Save sample responses in `backend/anteater_samples/` for reference and offline testing
- [ ] Note in this file which fields we use

### Client code
- [ ] Add `requests` (or `httpx`) to `backend/requirements.txt`
- [ ] Create `backend/anteater.py` with one function per lookup, e.g. `get_course("ICS 32")` and `get_sections("ICS 32", term)`
- [ ] Turn Anteater responses into our own simple shapes so the rest of the code doesn't depend on theirs
- [ ] Handle timeouts and errors. The app must keep working when Anteater is down.
- [ ] Cache results, e.g. in an `anteater_cache` table or in memory with an expiry time, so we don't call Anteater on every request

### Our endpoints (one file each in `backend/routes/classes/`)
- [ ] `GET /api/classes/search?q=ICS 32`: course search for the frontend
- [ ] `GET /api/classes/<course>`: course details
- [ ] `GET /api/classes/<course>/sections`: sections for the class section dropdown

### Using the data
- [ ] Check `class_section` on `POST /api/queue` against real sections (coordinate with Backend)
- [ ] Fill in course names and instructors when creating office hours
- [ ] Optional: get instructor office hours, if Anteater has them, as an alternative to syllabus upload

### Testing
- [ ] Tests that use the saved sample responses instead of calling Anteater
- [ ] A manual check against the real API before the demo
