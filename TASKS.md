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

- [ ] How a professor logs in, or whether the professor screen is simply a separate page with no login for the demo. (Students use a hardcoded account for now; see [ui-spec.md](ui-spec.md) section 1.)
- [ ] Whether tickets store a course (e.g. "ICS 32") as well as a class section. This is needed if more than one course runs office hours at the same time.
- [ ] What the class section field holds, such as "Lec A" or an Anteater API section code like "35500".
- [ ] Whether TA queues are in scope for the hackathon or a stretch goal.
- [ ] When a session is already running, should a student who doesn't pick a session join it as late, or be offered the next session to be on time? (Currently they join the running one as late. The frontend can offer the choice by sending `office_hours_id`.)
- [ ] Should places in line count **groups** (a group of 3 is one spot, as the screen does now) or **students** (as the backend's `position` does)? This affects "You are #N" and where drag-and-drop puts a group.
- [ ] Does the professor page show one class at a time, or every class together, color coded? (ui-spec.md sections 2 and 8)
- [ ] Should "Add classes" pick from courses that have sessions scheduled, or from all real UCI classes (from the Anteater API)?
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
| PATCH | `/api/queue/<id>` | any of `{status, priority, question_type, question, class_section}` | Updated ticket. `status` must be `waiting`, `done` or `left`. Setting `priority` marks it `manually_changed`. Changing `question_type` of a student in a shared group gives them their own group. |
| POST | `/api/queue/<id>/leave` | — | Ticket with `status: "left"`. 409 if not waiting. |
| POST | `/api/queue/<id>/pin` | `{position: 2}` or `{position: null}` to unpin | Updated ticket. Keeps the student at that spot (1 = first); the latest pin wins and shifts anyone pinned there down one. |
| POST | `/api/queue/<id>/bump` | `{direction: "up" or "down"}` | Updated ticket (moves 15 points, marks it `manually_changed`). 409 when bumping a late-section question down. |
| GET | `/api/buckets` | `?question_type=` `?status=` | Buckets in line order, with `member_count`, `priority`, `in_late_section` and `members` (each student's `ticket_id`, `student_name`, `class_section`, `question`, `status`) |
| GET | `/api/buckets/suggest` | `?question=` (required) `?question_type=` `?office_hours_id=` | Up to 5 open buckets with a similar question, each with `similarity` (0.5–1), most similar first. Empty list if nothing matches. |
| POST | `/api/buckets/<id>/resolve` | — | `{bucket, resolved_count}`. Marks the bucket and everyone waiting in it done. 409 if already done. |
| POST | `/api/buckets/<id>/join` | `{student_name, class_section, question?}` | New ticket (201). The student takes the bucket's place in line, even if they join late. |
| GET | `/api/office_hours` | `?course=` `?is_open=true/false` `?state=upcoming/running/closed` | Sessions with `waiting_count` and `state` (`upcoming` / `running` / `closed`) |
| POST | `/api/office_hours` | `{course, location, starts_at, ends_at}` | New session (201), with `moved_in_count` (students it picked up from an earlier closed session). Takes questions right away; `state` is `upcoming` until it starts. 409 if it overlaps another session of the same course. |
| PATCH | `/api/office_hours/<id>` | any of the above fields | Updated session. 409 if closed, if it would overlap another session, or if changing the start time after the session started. |
| DELETE | `/api/office_hours/<id>` | — | `{deleted: id}`. 409 if anyone is waiting in it (close it instead). |
| POST | `/api/office_hours/<id>/open` | — | Opened session. Starts it early if its start time hasn't come yet. 409 if already open or closed. |
| POST | `/api/office_hours/<id>/close` | — | `{session, moved_to, moved_count, warning?}`. Waiting students move to the next session of the same course. 409 if already closed. |

**Ticket fields:** `id`, `student_name`, `class_section`, `question`, `question_type`, `priority`, `status` (`waiting` / `done`), `bucket_id`, `student_count`, `overflow_count`, `manually_changed`, `late`, `in_late_section`, `pinned_position`, `office_hours_id`, `created_at`, `position`

`position` is the ticket's place in its own session's line, starting at 1, or `null` once it's no longer waiting. Joining the queue or a bucket returns it right away, so the student can see "you are #N".

**Session fields:** `id`, `course`, `location`, `starts_at`, `ends_at`, `is_open`, `closed_at`, `state`, `waiting_count` (list only)

**How the line works:**
- A session has started once the professor presses Open or its start time passes, whichever comes first.
- The line has two sections. The main line holds on-time questions, ranked by `(Base Time + Complex × 3 + Students × 5) × Overflow`.
- Questions submitted after the start have `late: true` and `in_late_section: true`. They go to the back, in the order they arrived. Their `priority` is still their real score, but it doesn't change their order.
- Bumping a late question up moves it into the main line (`in_late_section` becomes false). Bumping it down returns 409.
- When a session closes, waiting students move to the next session, are no longer late, and have their score doubled. Pins are cleared.
- Sessions close on their own 30 minutes after their end time.
- If there's no next session when one closes, its waiting students stay put and move into the next session as soon as one is scheduled.
- Pinned students (`pinned_position`) are placed at their spot after everything else is sorted.

Times use the format `2026-10-17T14:00`.

---

## Frontend

The app is called **zot hours**. It has a Student view and a Professor view, switched with tabs at the top. If the backend isn't running, it switches to **demo mode**: it uses sample data saved in the browser, so the screens still work on their own. A "Demo data" badge shows when that's happening.

### Next up (step-by-step details in [ui-spec.md](ui-spec.md))
Start with the first item; the classes and color items build on it.
- [ ] 1. Hardcoded student account and API settings in one config file (do first)
- [ ] 2. Classes: "See classes" / "Add classes" in the top bar, and a page for each class
- [ ] 3. Profile button showing the student's name, section and classes
- [ ] 4. "Same question?" Join button on every question in the line, not just the one suggested while typing
- [ ] 5. "Leave the line" button (status `left`) next to "Fixed it, thanks" (status `done`)
- [ ] 6. Professor: drag and drop to reorder the line, replacing the up/down arrows (uses pinning)
- [ ] 7. Professor: show names as "Jordan + 5 others", with the full list on hover
- [ ] 8. Color code each class on the class pages and the professor page

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
- [x] **Line order:** `groupUp` in `App.jsx` re-sorts groups by score, so a late question with a high score (e.g. Research, 35) would show above on-time questions. Keep the order the backend sends (or sort by `in_late_section` first).
- [x] **Late divider:** uses `in_late_section` instead of `late`. A late question the professor moved up has `late: true` but is back in the main line. (The "joined late" badge still uses `late`, since that's still true.)
- [x] **Down button:** hide it for groups in the late section. The backend refuses those (409) and the professor would see an error.
- [x] **"You'd be Nth in line" estimate:** it treats a new question as score 0 once the session is running. Use "behind everyone already waiting" instead.
- [x] **Demo mode:** `score()` in `api.js` still returns 0 for late questions. Update it to match the backend: real score, late section ordered by arrival.
- [x] Remove the committed `.DS_Store` files and add `.DS_Store` to `.gitignore`

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
- [x] Before submitting, show where they'd land: "You'd be 3rd in line, about 20 minutes"
- [x] After submitting, a "Your spot" card: place in line, estimated wait, how many share the question, and a "joined late" note
- [x] "Fixed it, thanks" button so a student can leave the line once their problem is solved
- [x] "No office hours scheduled yet" / "No open office hours right now" when there's nothing to join
- [ ] Session picker. The app currently picks automatically (the running session, else the next upcoming one); let students choose and send `office_hours_id`.

### Student: similar questions (buckets)
- [x] As the student types, show a similar open question from `GET /api/buckets/suggest` (waits until they pause typing)
- [x] "Join the group" or "Keep mine separate" buttons → `POST /api/buckets/<id>/join`
- [x] Shows how many classmates are waiting on it, and that joining keeps the group's place in line even after the session starts
- [ ] Show more than one suggestion when several match (the backend returns up to 5)
- [ ] Join button on every question in the line (see Next up #4)

### Student: queue view
- [x] "The line right now": each group's question, number of students and estimated minutes. Names aren't shown to other students.
- [x] The student's own group is highlighted
- [x] Refreshes automatically every 4 seconds
- [x] Session status at the top: "ICS 32 starts Mon 2:00 PM", "is open" or "has ended", plus the location
- [x] Message when nobody is waiting: "Nobody's waiting. Ask away and you'll be first."
- [ ] Place-in-line number: waiting on the groups vs. students decision (see Decisions)

### Professor: queue management
- [x] Headline: "7 students, 4 conversations"
- [x] "Next up" card for the top group: question, names, estimated minutes, and minutes saved by helping them together
- [x] Groups shown together, with all the students' names (to become "Jordan + 5 others", see Next up #7)
- [x] Badges: "moved by you", "pushed from last session", "joined late"
- [x] Divider before the late section, and no down arrow on late-section groups
- [x] "Help" / "Help together" button marks the whole group done → `POST /api/buckets/<id>/resolve`
- [x] Up/down buttons → `POST /api/queue/<id>/bump` (moves every student in the group). To be replaced by drag and drop (Next up #6).
- [x] "Today so far": students helped, minutes left in the queue, minutes saved by grouping (the helped count is kept in that browser only)
- [x] "What's coming up": bar chart of waiting questions by category
- [ ] Show each student's own wording of the question inside a group (`members` from `GET /api/buckets`)
- [ ] Edit a ticket's category or priority
- [ ] Pin a group to a spot and show a "pinned" badge, as part of drag and drop (Next up #6; backend ready: `POST /api/queue/<id>/pin`)
- [ ] "Leave the line" button for students (Next up #5; backend ready: `POST /api/queue/<id>/leave`)

### Professor: office hours
- [x] Edit the current session's location and times → `PATCH /api/office_hours/<id>`
- [x] "Open now" button (upcoming sessions) and "Wrap up" button (running sessions)
- [x] After wrapping up, show "N students moved to the next session", or the warning when there is no next session
- [x] Warning before wrapping up when no later session is scheduled
- [x] "Schedule a new session" form (course, location, start, end), with a check that the end is after the start
- [ ] List all sessions (today it only shows the current one), with `state` and the number waiting in each
- [ ] Delete button for empty sessions → `DELETE /api/office_hours/<id>`
- [ ] Show the overlap / "start time is locked" errors next to the session form, and lock the Starts field once a session is running
- [ ] After scheduling a session, show "N waiting students moved in" when `moved_in_count` > 0

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
- [x] Let a student leave the queue: `POST /api/queue/<id>/leave` sets `status: "left"` (`routes/queue_leave.py`)
- [x] Only allow known `status` values (`waiting`, `done`, `left`)
- [x] Pinning (spec "Manual Changing"): `POST /api/queue/<id>/pin` keeps a student at a spot while everyone else moves around them; the latest pin wins (`routes/queue_pin.py`, `queue_order.py`)
- [x] Category changes inside a group: if others share the group, the student moves to a group of their own; if they're alone, the group's category changes with them

### Buckets
- [x] `POST /api/buckets/<id>/resolve`: mark the bucket and all its tickets done (`routes/buckets/resolve_bucket.py`)
- [x] Close a bucket automatically when its last ticket is done, and reopen it if a ticket goes back to waiting (`bucket_rules.py`)
- [x] `GET /api/buckets/suggest?question=...&question_type=...`: similar-question matching (`routes/buckets/suggest_buckets.py`, `similarity.py`)
- [x] Return the member list in each bucket for the professor view
- [ ] Tune similar-question matching with real student questions (cutoff and filler words are in `similarity.py`)

### Office hours
- [x] Students stranded on a closed session move into the next session once one is scheduled (`overflow.py`)
- [x] `DELETE /api/office_hours/<id>`, only if nobody is waiting (`routes/office_hours/delete_office_hours.py`)
- [x] Two open or upcoming sessions of the same course can't overlap (closed ones don't count, so a make-up session can reuse the slot)
- [x] Filter `GET /api/office_hours` by `?state=upcoming` / `running` / `closed`
- [x] Start time is locked once a session has started (students already chose on time vs. late based on it); the end time can still change. Closed sessions can't be edited.
- [x] Sessions close automatically 30 minutes after their end time, moving waiting students on like a normal close (`AUTO_CLOSE_AFTER` in `overflow.py`)

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

### Classes (for the frontend's class pages, ui-spec.md section 2)
- [ ] Optional: `GET /api/courses`, a list of courses that have sessions, for the "Add classes" picker (the frontend can work it out from `GET /api/office_hours` for now)
- [ ] Optional: save each student's classes on the server, once there are real accounts (for now the list lives in the browser)

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
- [ ] Provide the list of real UCI classes for the frontend's "Add classes" picker, if the team chooses that (see Decisions)
- [ ] Optional: get instructor office hours, if Anteater has them, as an alternative to syllabus upload

### Testing
- [ ] Tests that use the saved sample responses instead of calling Anteater
- [ ] A manual check against the real API before the demo
