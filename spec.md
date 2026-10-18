# Office Hours Priority Queue (zot hours)

## Summary

A priority queue app for office hours. Students line up their questions ahead of time, and the app plans the line so the professor's time goes furthest: students with the same question are helped together, and long and short questions are mixed into 15-minute blocks so quick questions aren't stuck behind long ones.

- **Student side:** pick a class, ask a question or join a classmate's group with the same one, see your place in line and roughly when your turn will be, and leave the line when you're done.
- **Professor side:** see the line planned into blocks, help one student or a whole group at once, drag groups to reorder the line, and schedule, open and close office hours.

| Doc | What's in it |
|---|---|
| [HOW_IT_WORKS.md](HOW_IT_WORKS.md) | Plain-text diagrams of how the app works |
| [TASKS.md](TASKS.md) | Checklist of what's done and what's left, the API reference, and decisions to make |
| [ui-spec.md](ui-spec.md) | Frontend tasks from the team's planning notes |
| [anteater-api.md](anteater-api.md) | Notes on UCI's Anteater API |

## Tech Stack

| Part | What we use |
|---|---|
| Front end | React (with Vite), in `frontend/` |
| Back end | Flask, in `backend/` |
| Database | SQLite (`backend/office_hours.db`), through SQLAlchemy |
| Class data | UCI's [Anteater API](https://anteaterapi.com/reference) |
| AI | Google's Gemini API (`gemini-3.5-flash`), through the `google-genai` package |

**Running it:** `./dev.sh` starts the backend (http://localhost:5001) and frontend (http://localhost:5173) together, installs packages when needed, and stops both on Ctrl+C. If the backend isn't running, the frontend switches to **demo mode** with sample data saved in the browser.

**AI setup (optional):** each developer puts their own Gemini key in `backend/.env` as `GEMINI_API_KEY` (from aistudio.google.com/apikey) and sets `USE_AI_GROUPING=1`. `backend/.env` is ignored by git. `python tests/check_ai_setup.py` checks the key, and http://localhost:5001/api/health shows whether AI is on. Without a key, everything runs on the rules.

## Status at a Glance

| Feature | Backend | Frontend |
|---|---|---|
| Ask a question, see your place in line | Done | Done |
| Question categories and the priority score | Done | Done |
| Time-block planning (long and short questions mixed into 15-minute blocks) | Done | Shows the planned order; block dividers not yet |
| Estimated turn time ("Your turn: about 6:20 PM") | Done | Done |
| Queue before a session starts; late questions to the back | Done | Done |
| Groups of students with the same question | Done | Done |
| "Same question?" Join button on every question in the line | Done | Done |
| Similar-question suggestion while typing (rule-based) | Done | Done |
| Leave the line ("Fixed it, thanks" / "Leave the line") | Done | Done |
| Help a whole group at once | Done | Done |
| Professor drags groups to reorder the line (pinning) | Done | Done |
| "Jordan + 5 others" names on the professor view | n/a | Done |
| Office hours: schedule, edit, open, close, delete | Done | Done (delete not on screen) |
| Push waiting students to the next session (overflow) | Done | Done |
| Sessions close on their own after the end time | Done | n/a |
| Class pages, "My classes", "Add a class", profile, class colors | n/a | Done (classes saved in the browser) |
| Classes looked up on the Anteater API (students and professors) | Done | Not connected yet |
| AI check on submit: is this question already in line? | Setup done; check not built | Not started |
| AI group summaries for the professor | Not started | Not started |
| Syllabus upload | Not started (placeholder) | Not started |
| TA queues | Not started (stretch) | Not started (stretch) |
| Real login | Not started (demo student built in) | Not started (demo student in `frontend/src/config.js`) |

## How a Session Works, End to End

1. The professor **schedules** office hours (course, location, start, end).
2. Students **queue up before it starts.** Each picks a class, sees the questions already in line, and either taps **"Same question?" Join** on one, or submits their own.
3. The line is **planned into 15-minute blocks**, and each student sees their place and **estimated turn time**.
4. The session **starts** when the professor opens it or the start time arrives. New questions after that go to the **back of the line**.
5. The professor **helps** students from the top, a whole group at a time where possible, and can **drag** groups to change the order.
6. The session **closes** (by the professor, or on its own 30 minutes after the end time). Anyone still waiting **moves to the next session** with a boost.

## Student Side

- **Classes:** "My classes" lists the student's classes, and "Add a class" picks from courses that have office hours. Each class has its own page and color. The list is saved in the browser for now.
- **Profile:** name and section, filled in from the demo account and editable.
- **The line:** each group's question, how many students are in it, and roughly how long it takes. Names aren't shown to other students. The student's own group is highlighted.
- **Joining:** a **"Same question?" Join** button on every question in the line. Joining a group keeps the group's place in line, even after the session has started.
- **Asking:** name, section, question (25 words max) and category. While typing, the app may suggest a similar open question to join instead. Submitting to a session that has already started asks for confirmation first, since the question will go to the back.
- **Your spot:** place in line, **"Your turn: about 6:20 PM"**, how many classmates share the question, and a note if they joined late.
- **Done:** "Fixed it, thanks" (helped) or "Leave the line" (left without help).

## Professor Side

- **Class chips** at the top pick which class's line to show. Each class has its own color.
- **Next up:** the top group's question, the students in it ("Jordan + 5 others", with the full list on tap), its estimated minutes, and minutes saved by helping them together.
- **The rest of the line,** with badges: "pinned", "moved by you", "pushed from last session", "joined late", and a divider before the late section.
- **Help / Help together:** marks the whole group as helped in one step.
- **Drag to reorder:** each group has a drag handle (mouse, pen or touch), or the professor can focus a group and use the arrow keys. Dropping pins the group at that spot; "Unpin" returns it to the planned order.
- **Today so far:** students helped, minutes left in the line, and minutes saved by grouping.
- **What's coming up:** waiting questions by category.
- **Office hours:** edit the location and times, "Open now" for an upcoming session, "Wrap up" to close a running one, a warning if no later session exists to move students into, and "Schedule a new session".

## Input (Student)

1. Student name
2. Class section
3. Question (25-word limit)
4. Question category
5. Optionally, the session to join. Without it, the question goes to the session that's running now, or else the next upcoming one.

## Categories

The minutes and complexity are placeholder guesses the team still needs to confirm. Block planning and turn times depend on the minutes, so they matter. They're set in `backend/priority.py`, and the long categories in `backend/blocks.py`.

| Category | Minutes | Complexity | Long or short | Score with 1 student |
|---|---|---|---|---|
| Quick Q&A | 2 | 1 | Short | 10 |
| Scheduling / Logistics | 3 | 1 | Short | 11 |
| Grading | 5 | 1 | Short | 13 |
| Understanding Topic | 10 | 3 | Long | 24 |
| Personal | 10 | 3 | Long | 24 |
| Research | 15 | 5 | Long | 35 |

## Priority Score

```
Score = ((Minutes) + (Complexity × 3) + (Students × 5)) × Overflow
```

| Term | Meaning |
|------|---------|
| Minutes | Estimated time for the question, from its category |
| Complexity | 1 = quick, 3 = understanding, 5 = conceptual |
| Students | Number of students in the group with this question |
| Overflow | 1 at first, ×2 each time the question was pushed to a later session |

The score decides which long questions and which short questions go first. Time-block planning decides how long and short questions are mixed. Ties go to whoever asked first.

## How the Line Is Ordered

1. **Main line:** questions asked before the session started (and late ones the professor moved up), planned in **15-minute blocks** (see below).
2. **Late section, at the back:** questions asked after the session started, first come, first served. Their score is shown but doesn't change their order.
3. **Pinned groups** (dragged by the professor) go at their spot, and everyone else fills in around them.

Students in the same group always stay next to each other. "You are #N" counts within the student's own session. A session counts as started once the professor opens it or its start time passes, whichever comes first.

## Time-Block Planning

The main line is planned in 15-minute blocks. Each block is filled in three steps:

1. **Long questions,** highest score first, **up to 2**, as long as they fit. A long question always fits in an empty block.
2. **Short questions,** highest score first, each one that still fits in the time left.
3. **Leftover time:** anything else that still fits, so no time sits idle.

Then the next block, until everyone is planned. Within a block, long questions are helped first.

```
Block 1 (15 min):  [Research 15m]
Block 2 (15 min):  [Understanding Topic 10m][Grading 5m]
Block 3 (15 min):  [Personal 10m][Scheduling 3m][Quick Q&A 2m]
```

| Rule | Decision |
|---|---|
| Block length | 15 minutes (`BLOCK_MINUTES` in `backend/blocks.py`) |
| Long questions | Understanding Topic, Research, Personal (`LONG_CATEGORIES`); everything else is short |
| Long questions per block | Up to 2 (`MAX_LONG_PER_BLOCK`) |
| Which short questions fill a block | Go down by score and add each one that fits |
| Groups | One slot, timed as one explanation |
| A long question that doesn't fit | Moves to the next block |
| Pins | Still win; the plan fills in around them |
| Late questions | After all on-time ones, first come, first served |
| When it's planned | On every request, so it always starts from "now" |

**With 15-minute blocks and today's minutes, only one long question fits per block** (two need at least 20 minutes), so a block is usually one long question plus about 5 minutes of short ones, and a Research question fills a block by itself. "Up to 2" takes effect if the block length or the minutes change.

## Estimated Turn Time

Each student's "Your spot" card shows roughly when their turn will be: **"Your turn: about 6:20 PM"**, with the day if it isn't today.

- **How it's worked out:** the minutes of everyone ahead, added to the session's start time if it hasn't started, or to the current time once it's running.
- **Rounded to 5 minutes,** and never before the session starts.
- **Past the end:** if the turn would come after the session ends, the card says instead: "You may not be reached this session. If not, you'll move to the next session with a boost."
- It's recalculated on every refresh, so it moves as students are helped, join groups or leave. It's only as accurate as the minutes per category.

## Groups and Similar Questions

- Every new question starts its own group (a "bucket"). Students with the same question join that group instead of asking again.
- A group is answered together, so a bigger group scores higher (Students × 5) and saves the professor time.
- A group closes when nobody in it is still waiting, and reopens if a student is put back in line.
- If a student's category changes and they share a group, they move to a group of their own.
- **Similar-question suggestion (rule-based, built):** as a student types, the app suggests an open group with a similar question. It uses rules and word lists, not AI:
  - A different assignment or question number, a different kind of ask (due date vs. extension), a different error, or a different computer means a different question.
  - Otherwise it compares key words both ways. Generic words count less, and common abbreviations, synonyms and typos are recognized.
  - It suggests a group at a score of 0.55 or more. It's tested on 145 labeled question pairs (143 correct, no wrong matches); see `backend/tests/`.

## AI Grouping on Submit *(planned; setup done)*

If a student submits their own question instead of joining one, Gemini checks whether it's actually the same as one already in line:

```
"None of these, submit mine"
        |
        v
Gemini: is this the same as one of the open groups in this session?
        |
   +----+------------------------+
   |                             |
Same as group X               New, unsure, or AI unavailable
(high confidence)                |
   |                             v
   v                         Start a new group, as today
Add the student to group X,
tell them why, and offer "That's not my question"
```

- **Only high-confidence matches count.** When in doubt, the question gets its own group.
- **Rules are a safety check:** a different assignment, part or question number is never merged, whatever the AI says.
- **Rules are the backup:** if Gemini takes more than 5 seconds, errors, or AI is off, the question gets its own group.
- **Undo:** "That's not my question" moves the student back to their own group and restores their own on-time / late status. The AI won't re-merge it.
- **Professor view:** an "added by AI" badge.
- **Privacy:** student questions are sent to Google. Fine for the demo; check UCI's rules before real use.

## AI Group Summaries *(planned)*

When a group has two or more students with different wording, the professor sees a short summary: a headline, a one-sentence summary, the distinct sub-questions with who asked each, and anyone whose question doesn't seem to fit. Summaries are made on request, saved on the group, and remade only when its members change.

## Sessions (Office Hours)

```
UPCOMING ──(professor opens, or start time arrives)──> RUNNING ──(professor closes, or 30 min after end)──> CLOSED
```

- Questions can be submitted to upcoming and running sessions. Closed sessions can't be joined, edited or reopened.
- Two open or upcoming sessions of the same course can't overlap.
- The start time is locked once a session starts, since students already chose on time vs. late based on it. The end time can still change.
- A session can be deleted only if nobody is waiting in it.
- Sessions close on their own 30 minutes after their end time, so a professor who runs a little over isn't cut off.

## Overflow Logic

When a session closes with students still waiting:

- **Next session:** they move to the next session of the same course. They count as on time there, their score doubles, and any pins are cleared. *(Built.)*
- **No next session yet:** they wait, and move in automatically once one is scheduled. *(Built.)*
- **TA queue:** move to an open TA session with a boost. *(Planned, stretch.)*

## Manual Changing

The professor can override the plan:

- **Drag and drop (pinning):** drag a group to a spot, and it stays there whatever the score or the blocks say.
  - New questions go around it.
  - When someone ahead is helped, it moves up with the line.
  - The latest pin wins: dropping on a taken spot moves that group down one.
  - Students who join a pinned group are pinned with it.
  - "Unpin" returns it to the planned order.
- **Bump (API only):** moves a question 15 points. A late question can be bumped up into the main line, but not down. A bump changes the score, so it can move a question to an earlier block, but not ahead of a long question in the same block. The screens use drag and drop instead.
- **Flag:** each queue entry has `manually_changed`: `true` once the professor moves it. It then keeps the priority the professor gave it instead of being recalculated.

## Student Statuses

| Status | Meaning |
|---|---|
| `waiting` | In line |
| `done` | Helped |
| `left` | Left the line without being helped |

## Accounts and Class Data

- **Students:** no real login yet. The frontend's "logged in" student comes from `frontend/src/config.js` (Jordan Lee, Lec A, classes ICS 32 and ICS 33), and the backend has a matching demo student (id 1).
- **Classes on screen:** "Add a class" offers the courses that have office hours, and the list is saved in the browser.
- **Anteater API (backend built, not yet used by the screens):**
  - Students can add a class by its 5-digit section code (e.g. `34190`), looked up on the Anteater API and saved (`/api/students/<id>/sections`).
  - Professors sign in by UCInetID (e.g. `mikes`), and their profile and this term's courses are loaded and saved (`/api/professors`).
  - The term is fixed to Fall 2026 for the demo. Saved data keeps working when the Anteater API is down, and lookups are cached for an hour. Details: [anteater-api.md](anteater-api.md).

## OH Data

- **Now:** the professor schedules sessions by hand.
- **Planned:** the professor uploads syllabi for the quarter, and the app finds the office hours in them. Anteater's syllabus links could help pre-fill this.

## Not Built Yet

| Item | Notes |
|---|---|
| AI grouping on submit, with undo | Gemini setup is done; see "AI Grouping on Submit" |
| AI group summaries | See "AI Group Summaries" |
| Block dividers on the professor view | The backend sends each student's `block` |
| Connect "Add a class" and professor sign-in to the Anteater API | The backend endpoints exist |
| Delete a session from the screen | The backend endpoint exists |
| Syllabus upload | `backend/routes/syllabus.py` is a placeholder |
| TA queues | Stretch goal |
| Real login | Students and the professor use demo accounts |

## Open Questions

Tracked in the "Decisions to make" list in [TASKS.md](TASKS.md):

- Should the highest or the lowest score be served first? (Highest first today.)
- Final minutes and complexity for each category. Block planning and turn times depend on the minutes.
- How does a professor log in, or is the professor page open to anyone for the demo?
- Should each question store its course, in case several courses run office hours at once?
- What should the class section field hold: "Lec A", or an Anteater section code?
- Are TA queues in scope for the hackathon?
- When a session is running, should a student who doesn't pick a session join it late, or be offered the next one to be on time?
- Should places in line count groups (as the screen does) or students (as the backend does)?
- Should "Add a class" offer only courses with office hours, or all UCI classes from the Anteater API?

Decided since the last version: the professor page shows **one class at a time**, picked with class chips.
