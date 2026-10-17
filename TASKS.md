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

### Running the project
- Backend: `cd backend && pip install -r requirements.txt && python app.py` (runs on http://localhost:5001)
- Frontend: `cd frontend && npm install && npm run dev`
- The database file `backend/office_hours.db` is created on first run with sample data. Delete it to reset.

### Before the demo
- [ ] Write the README: what the app does, how to run it, screenshots
- [ ] Prepare demo data: a few sessions, buckets with several students, an overflowed student
- [ ] Do a full run-through: student joins, professor helps them, session closes and remaining students are pushed to the next session
- [ ] Write the demo script and decide who presents which part

---

## API reference (for the frontend)

Base URL: `http://localhost:5001`. Every endpoint returns JSON. When something goes wrong, the response is `{"error": "message"}` with status 400, 404 or 409.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/health` | — | `{"ok": true}` |
| GET | `/api/categories` | — | `[{id, label, base_time, complexity}]` |
| GET | `/api/queue` | — | Waiting tickets, highest priority first |
| POST | `/api/queue` | `{student_name, class_section, question, question_type, office_hours_id?}` | New ticket (201). Without `office_hours_id`, it goes to the running session, or the next upcoming one. 409 if none. |
| PATCH | `/api/queue/<id>` | any of `{status, priority, question_type, question, class_section}` | Updated ticket |
| POST | `/api/queue/<id>/bump` | `{direction: "up" or "down"}` | Updated ticket |
| GET | `/api/buckets` | `?question_type=` `?status=` | Buckets with `member_count` and `priority` |
| POST | `/api/buckets/<id>/join` | `{student_name, class_section, question?}` | New ticket (201) |
| GET | `/api/office_hours` | `?course=` `?is_open=true/false` | Sessions with `waiting_count` and `state` (`upcoming` / `running` / `closed`) |
| POST | `/api/office_hours` | `{course, location, starts_at, ends_at}` | New session, closed (201) |
| PATCH | `/api/office_hours/<id>` | any of the above fields | Updated session |
| POST | `/api/office_hours/<id>/open` | — | Opened session |
| POST | `/api/office_hours/<id>/close` | — | `{session, moved_to, moved_count, warning?}` |

**Ticket fields:** `id`, `student_name`, `class_section`, `question`, `question_type`, `priority`, `status` (`waiting` / `done`), `bucket_id`, `student_count`, `overflow_count`, `manually_changed`, `late`, `office_hours_id`, `created_at`

Questions can be submitted before a session starts. Ones submitted after it starts have `late: true` and a priority of 0, so they go to the back of the line.

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
- [ ] Fill the category dropdown from `GET /api/categories`
- [ ] Live word counter on the question box ("12 / 25 words"); block submitting past 25
- [ ] Show the API's error message if a submission is rejected
- [ ] On success, show the student's place in the queue and their ticket details

### Student: similar questions (buckets)
- [ ] After a category is picked, show open buckets in it from `GET /api/buckets?question_type=...`
- [ ] Show each bucket's question and how many students are in it
- [ ] "Same question" button → `POST /api/buckets/<id>/join`
- [ ] Make clear that joining a bucket moves the whole group up

### Student: queue view
- [ ] Show the queue from `GET /api/queue` (position, category, question). Decide whether names are shown to other students.
- [ ] Highlight the student's own ticket
- [ ] Refresh automatically, e.g. every 5–10 seconds
- [ ] Show the current session's location and hours from `GET /api/office_hours?is_open=true`
- [ ] Show a message when no session is open
- [ ] Let students pick an upcoming session to queue for, and show "joined late" for late tickets

### Professor: queue management
- [ ] Queue list with priority, category, student count, and badges for "pushed from last session" and "manually changed"
- [ ] Group tickets in the same bucket together
- [ ] "Done" button → `PATCH /api/queue/<id>` with `{status: "done"}`
- [ ] Up/down bump buttons → `POST /api/queue/<id>/bump`
- [ ] Edit a ticket's category or priority
- [ ] Mark a whole bucket done (needs the backend "resolve bucket" task)
- [ ] Drag to pin a ticket to a spot (needs the backend pinning task)

### Professor: office hours
- [ ] List sessions from `GET /api/office_hours`, with the number waiting in each
- [ ] Form to create a session (course, location, start, end)
- [ ] Edit a session's time or location → `PATCH /api/office_hours/<id>`
- [ ] Open and Close buttons
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
- [x] Tables: `office_hours`, `tickets`, `buckets`, `syllabi`
- [x] Older databases get new columns added automatically on startup
- [x] Spec categories and priority formula (`priority.py`)
- [x] Input checks: class section required, 25-word limit, valid category (`validation.py`)
- [x] `GET /api/categories`
- [x] Queue: list, join, edit, bump (`routes/queue.py`)
- [x] Manual-change flag. Bumped or hand-set priorities don't get recalculated.
- [x] Buckets: every new question starts a bucket; list and join (`routes/buckets/`)
- [x] Office hours: list, create, edit, open, close (`routes/office_hours/`). *Not committed yet.*
- [x] Closing a session pushes waiting students to the next one and doubles their score
- [x] Questions can be submitted before a session starts; questions submitted after the start go to the back (`sessions.py`, OnTime term)

### Queue
- [ ] Filter `GET /api/queue` to one session (`?office_hours_id=`) so the queue shows only the current session
- [ ] Return each ticket's position number for the student "you are #N" display
- [ ] `GET /api/queue/<id>` so a student can check their own ticket
- [ ] Let a student leave the queue (`status: "left"`)
- [ ] Only allow known `status` values (`waiting`, `done`, `left`)
- [ ] Pinning (spec "Manual Changing"): store a `pinned_position` and keep pinned tickets at that spot when sorting
- [ ] Decide whether `question_type` changes on a ticket in a bucket should move it out of the bucket

### Buckets
- [ ] `POST /api/buckets/<id>/resolve`: mark the bucket and all its tickets done
- [ ] Close a bucket automatically when its last ticket is done
- [ ] `GET /api/buckets/suggest?question=...&question_type=...`: similar-question matching (start with Python's `difflib`)
- [ ] Return the member list in each bucket for the professor view

### Office hours
- [ ] Move students stranded on a closed session once a later session is scheduled
- [ ] `DELETE /api/office_hours/<id>` (only if nobody is waiting)
- [ ] Stop two sessions of the same course from overlapping
- [ ] Optional: open and close sessions automatically from their start and end times

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
- [ ] Add `pytest` tests for the endpoints, using a temporary database
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
