# ZotHours

**Office hours without the crowd at the door.** ZotHours is a smart queue for university office hours. Students line up their questions ahead of time, and the app plans the line so the professor's time goes furthest: students with the same question are helped together, and short questions aren't stuck behind long ones.

Built at ZotHacks 2026 by Team 8.

**[Try the live demo →](https://jaydee052.github.io/2026ZothacksTeam8/)** (runs entirely in your browser; open a student and the professor side by side)

---

## The problem

Office hours run first come, first served. Ten students ask the same question one at a time, a two-minute question waits behind a twenty-minute one, and nobody knows when their turn will come, so they sit and wait instead of working.

## How ZotHours fixes it

| | |
|---|---|
| **Group identical questions** | As a student types, the app suggests open questions that look the same. Joining a group shares its place in line, and the professor answers everyone at once. |
| **Plan the line in time blocks** | The line is planned in 15-minute blocks: up to two long questions per block, filled out with short ones, so quick questions keep moving. |
| **Prioritize by impact** | Each group gets a score from its estimated length, complexity, and how many students it helps. Students carried over from a previous session move up. |
| **Honest wait times** | Every student sees their place in line and an estimated turn time, and is warned if that falls after the session ends. |
| **Fair to on-time students** | Questions submitted after a session starts wait in a separate late section, in arrival order. |
| **Nobody gets lost** | Students still waiting when a session closes move to the next session for that course automatically. |

### Student view
- Pick one of your enrolled classes (pulled live from UCI's course data)
- Ask a question (25 words max), or join a classmate's group with the same one
- See your place in line, group size, and estimated turn time
- Track all your questions in the class; leave the line when you're done

### Professor view
- See your courses for the term and schedule, open, edit, and close office hours
- Work through the line from a "Current" ticket: mark a group helped or pass it to a TA, by button, swipe, or keyboard
- Read each student's own wording of a group's question in a thread
- Drag groups to reorder the line, or pin a group to a spot

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | [React 19](https://react.dev), [Vite](https://vite.dev), plain CSS (custom design system with light/dark themes), Barlow typeface via Fontsource |
| Backend | [Flask 3](https://flask.palletsprojects.com) REST API with Flask-CORS |
| Database | SQLite through [SQLAlchemy 2](https://www.sqlalchemy.org) |
| Course data | UCI's [Anteater API](https://anteaterapi.com/reference) (WebSoc sections, instructors), called directly from the browser |
| AI (optional) | Google Gemini: `gemini-embedding-001` to group questions by meaning, `gemini-3.5-flash-lite` to classify new questions into a category |
| Tooling | Oxlint, GitHub Actions + GitHub Pages for the static demo |

**AI is optional.** Without a Gemini key, question matching falls back to a tuned rule-based similarity model (keyword overlap with synonyms, abbreviations, and typo tolerance, plus rules that tell "assignment 3" from "assignment 4" or a `FileNotFoundError` from a `ModuleNotFoundError`).

**The frontend works on its own.** If the backend isn't reachable, the app switches to a demo mode that keeps the same queue logic and sample data in the browser's local storage. The hosted demo is this mode.

---

## Architecture

```
┌──────────────────────────┐        ┌──────────────────────┐
│  React frontend (Vite)   │───────▶│   Anteater API       │
│  student & professor     │        │   UCI classes and    │
│  pages                   │        │   sections           │
└────────────┬─────────────┘        └──────────────────────┘
             │ REST (/api)
             ▼
┌──────────────────────────┐        ┌──────────────────────┐
│  Flask backend           │───────▶│   Google Gemini      │
│  queue planning, groups, │        │   (optional)         │
│  sessions, overflow      │        └──────────────────────┘
└────────────┬─────────────┘
             ▼
     SQLite (SQLAlchemy)
```

### Priority score

```
Priority = (Base Time + Complexity × 3 + Students × 5) × 2^Overflow
```

| Category | Base time | Complexity |
|---|---|---|
| Quick Q&A | 2 min | 1 |
| Scheduling / Logistics | 3 min | 1 |
| Grading | 5 min | 1 |
| Understanding Topic | 10 min | 3 |
| Personal | 10 min | 3 |
| Research | 15 min | 5 |

Higher scores go first within the time-block plan. *Overflow* counts how many sessions a student has already been carried over from.

---

## Project structure

```
.
├── frontend/                 React app
│   ├── src/
│   │   ├── App.jsx           Student and professor pages, queue UI
│   │   ├── api.js            Backend client, plus the in-browser demo store
│   │   ├── config.js         Demo student/professor profiles, API URL, term
│   │   ├── App.css           Component styles
│   │   └── index.css         Design tokens and themes
│   └── vite.config.js
├── backend/                  Flask API
│   ├── app.py                App entry point (port 5001)
│   ├── models.py, db.py      SQLAlchemy models and database setup
│   ├── routes/               Endpoints: queue, buckets, office_hours, students, professors
│   ├── priority.py           Categories and the priority score
│   ├── blocks.py             15-minute time-block planning
│   ├── queue_order.py        Serving order, positions, and turn estimates
│   ├── similarity.py         Rule-based question matching
│   ├── embeddings.py         Gemini embedding-based grouping
│   ├── classify.py           Gemini category classification
│   ├── overflow.py           Moving waiting students to the next session
│   └── tests/                Similarity test cases and AI setup check
├── .github/workflows/        GitHub Pages deploy for the static demo
├── dev.sh / dev.ps1 / dev.cmd  One-command local dev
└── spec.md, HOW_IT_WORKS.md, TASKS.md   Design docs
```

---

## Getting started

### Prerequisites
- Python 3.11+
- Node.js 20+ and npm

### Run everything

```bash
./dev.sh          # macOS / Linux
.\dev.cmd         # Windows
```

This creates the Python virtual environment, installs packages on the first run (and again whenever `requirements.txt` or `package.json` change), and starts both servers. Press Ctrl+C once to stop both.

| | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend | http://localhost:5001 (health check: `/api/health`) |

Each demo profile has its own page, so you can put them in side-by-side tabs:

| Page | URL |
|---|---|
| Student 1 | http://localhost:5173/student/1 |
| Student 2 | http://localhost:5173/student/2 |
| Professor | http://localhost:5173/professor |

Profiles and their enrolled section codes are set in [`frontend/src/config.js`](frontend/src/config.js).

### Run them separately

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py

# Frontend (in another terminal)
cd frontend
npm install
npm run dev
```

### Enable AI grouping (optional)

```bash
cp backend/.env.example backend/.env
```

Then set `GEMINI_API_KEY` (from [Google AI Studio](https://aistudio.google.com/apikey)) and `USE_AI_GROUPING=1` in `backend/.env`. The file is ignored by git. Check the setup with:

```bash
cd backend && python tests/check_ai_setup.py
```

`/api/health` also reports whether AI is on.

### Tests and checks

```bash
cd backend && python tests/check_similarity.py   # question-matching accuracy on labeled pairs
cd frontend && npm run lint                        # Oxlint
```

---

## Static demo (GitHub Pages)

The demo is the frontend alone, running in demo mode. Its front page links to each student and the professor.

```bash
cd frontend
npm run build:demo      # builds into frontend/dist for /2026ZothacksTeam8/
npm run preview:demo    # try the build locally
```

Every push to `main` deploys it through [`.github/workflows/demo.yml`](.github/workflows/demo.yml). One-time setup: **Settings → Pages → Source: GitHub Actions**. To host it at a different path (for example a custom domain), set `DEMO_BASE`, e.g. `DEMO_BASE=/ npm run build:demo`.

---

## API overview

All endpoints are under `/api`. See [TASKS.md](TASKS.md) for the full reference.

| Resource | Endpoints |
|---|---|
| Health | `GET /health` |
| Categories | `GET /categories` |
| Queue | `GET /queue`, `POST /queue`, `GET/PATCH /queue/<id>`, `POST /queue/<id>/leave`, `/pin`, `/bump` |
| Groups (buckets) | `GET /buckets`, `GET /buckets/suggest`, `POST /buckets/<id>/join`, `/pin`, `/resolve` |
| Office hours | `GET/POST /office_hours`, `PATCH/DELETE /office_hours/<id>`, `POST /office_hours/<id>/open`, `/close` |
| Professors | `POST /professors`, `GET /professors/<ucinetid>` |
| Students | `GET/POST /students/<id>/sections`, `DELETE /students/<id>/sections/<code>` |

---

## Documentation

| Doc | Contents |
|---|---|
| [spec.md](spec.md) | Product spec: priority formula, time blocks, overflow rules |
| [HOW_IT_WORKS.md](HOW_IT_WORKS.md) | Plain-language diagrams of the system |
| [TASKS.md](TASKS.md) | Progress checklist, API reference, open decisions |
| [ui-spec.md](ui-spec.md) | Frontend design notes |
| [anteater-api.md](anteater-api.md) | Notes on UCI's Anteater API |

## Roadmap

- Real sign-in (profiles are hardcoded for now)
- TA handoff: notifying TAs when the professor passes a group
- Syllabus upload: read office hours from a syllabus PDF and schedule them
