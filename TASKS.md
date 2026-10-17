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
- **Easiest:** from the project folder, run `./dev.sh`. It starts the backend and frontend together, installs packages on the first run (and again after a pull changes them), and stops both when you press Ctrl+C.
- Or run them separately:
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

The app is called **zot hours**. It has a Student view and a Professor view, switched with tabs at the top. If the backend isn't running, it switches to **demo mode**: it uses sample data saved in the browser, so the screens still work on their own. A "Demo data" badge shows when that's happening.

### Files
| File | What it does |
|---|---|
| `frontend/index.html` | The page shell: title "zot hours", the Figtree font, and dark/light mode remembered from last visit |
| `frontend/src/main.jsx` | Starts the React app and loads the styles |
| `frontend/src/App.jsx` | All the screens: the top bar, the Student view, the Professor view and the "schedule a new session" form. Refreshes the line every 4 seconds. |
| `frontend/src/api.js` | Every call to the backend, in one place. Also holds the demo-mode version of each call (sample data in the browser) for when the backend is down. |
| `frontend/src/App.css` | Layout and look of the screens, including phone-size layouts |
| `frontend/src/index.css` | Colors for dark and light mode, base fonts and spacing |

### Fixes needed to match the latest backend
The backend's late rule changed after these screens were written. Late questions now keep their real score and sit in a separate late section, instead of scoring 0.
- [ ] **Line order:** `groupUp` in `App.jsx` re-sorts groups by score, so a late question with a high score (e.g. Research, 35) would show above on-time questions. Keep the order the backend sends (or sort by `in_late_section` first).
- [ ] **Late divider and badge:** use `in_late_section` instead of `late`. A late question the professor moved up has `late: true` but is back in the main line.
- [ ] **Down button:** hide it for groups in the late section. The backend refuses those (409) and the professor would see an error.
- [ ] **"You'd be Nth in line" estimate:** it treats a new question as score 0 once the session is running. Use "behind everyone already waiting" instead.
- [ ] **Demo mode:** `score()` in `api.js` still returns 0 for late questions. Update it to match the backend: real score, late section ordered by arrival.
- [ ] Remove the committed `.DS_Store` files and add `.DS_Store` to `.gitignore`

### Setup
- [x] Replace the Vite starter page in `frontend/src/App.jsx`
- [x] Point the app at the backend. Defaults to `http://localhost:5001/api`; to change it, set `VITE_API_URL` in `frontend/.env`, **including `/api` at the end**.
- [x] One API helper file (`src/api.js`) with a function for each backend call
- [x] Switching between the Student and Professor views (tabs at the top, remembered between visits)
- [x] Style approach: plain CSS, Figtree font, dark and light themes
- [x] Errors from the backend show as a short pop-up message at the bottom
- [x] Demo mode when the backend isn't reachable, with a "Reset demo data" button

### Student: join the queue
- [x] Form fields: name, class section, question, category (name and section are remembered for next time)
- [x] Category buttons filled from `GET /api/categories`
- [x] Live word counter ("12/25 words"); can't submit past 25
- [x] Warn before submitting to a running session: "This session has started. Your question will go to the back of the line."
- [x] Show the API's error message if a submission is rejected
- [x] Before submitting, show where they'd land: "You'd be 3rd in line, about 20 minutes" (needs the estimate fix above)
- [x] After submitting, a "Your spot" card: place in line, estimated wait, how many share the question, and a "joined late" note
- [x] "Fixed it, thanks" button so a student can leave the line once their problem is solved
- [x] "No office hours scheduled yet" / "No open office hours right now" when there's nothing to join
- [ ] Session picker. The app currently picks automatically (the running session, else the next upcoming one); let students choose and send `office_hours_id`.

### Student: similar questions (buckets)
- [x] As the student types, show a similar open question from `GET /api/buckets/suggest` (waits until they pause typing)
- [x] "Join the group" or "Keep mine separate" buttons → `POST /api/buckets/<id>/join`
- [x] Shows how many classmates are waiting on it, and that joining keeps the group's place in line even after the session starts
- [ ] Show more than one suggestion when several match (the backend returns up to 5)

### Student: queue view
- [x] "The line right now": each group's question, number of students and estimated minutes. Names aren't shown to other students.
- [x] The student's own group is highlighted
- [x] Refreshes automatically every 4 seconds
- [x] Session status at the top: "ICS 32 starts Mon 2:00 PM", "is open" or "has ended", plus the location
- [x] Message when nobody is waiting: "Nobody's waiting. Ask away and you'll be first."
- [ ] Decide which place-in-line number to show. The screen counts **groups** (a group of 3 counts as one spot); the backend's `position` counts **students**.

### Professor: queue management
- [x] Headline: "7 students, 4 conversations"
- [x] "Next up" card for the top group: question, names, estimated minutes, and minutes saved by helping them together
- [x] Groups shown together, with all the students' names
- [x] Badges: "moved by you", "pushed from last session", "joined late"
- [x] Divider before questions that joined after the session started (needs the `in_late_section` fix above)
- [x] "Help" / "Help together" button marks the whole group done → `POST /api/buckets/<id>/resolve`
- [x] Up/down buttons → `POST /api/queue/<id>/bump` (moves every student in the group)
- [x] "Today so far": students helped, minutes left in the queue, minutes saved by grouping (the helped count is kept in that browser only)
- [x] "What's coming up": bar chart of waiting questions by category
- [ ] Show each student's own wording of the question inside a group (`members` from `GET /api/buckets`)
- [ ] Edit a ticket's category or priority
- [ ] Drag to pin a ticket to a spot (needs the backend pinning task)

### Professor: office hours
- [x] Edit the current session's location and times → `PATCH /api/office_hours/<id>`
- [x] "Open now" button (upcoming sessions) and "Wrap up" button (running sessions)
- [x] After wrapping up, show "N students moved to the next session", or the warning when there is no next session
- [x] Warning before wrapping up when no later session is scheduled
- [x] "Schedule a new session" form (course, location, start, end), with a check that the end is after the start
- [ ] List all sessions (today it only shows the current one), with `state` and the number waiting in each

### Professor: syllabus upload
- [ ] File picker that uploads to the syllabus endpoint (needs the backend syllabus task)
- [ ] Show the office hours found in the syllabus, with a button to confirm and create them

### Polish
- [x] Phone-size layouts (adjusts below 900px and 480px wide)
- [x] Empty states for the line, the professor queue and sessions
- [x] Page title ("zot hours") and dark/light mode toggle
- [ ] Replace the default Vite favicon
- [ ] Test on a real phone

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
