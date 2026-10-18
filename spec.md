# Office Hours Priority Queue (zot hours)

## Summary

A priority queue app for office hours. Students line up their questions ahead of time, and the app orders the line so the professor's time goes furthest. It has two parts:

- **Student side:** ask a question (or join a classmate's group with the same question), see your place in line, and leave the line when you're done.
- **Professor side:** see the line, help students one at a time or a whole group at once, reorder the line by hand, and schedule, open and close office hours sessions.

Related docs:

| Doc | What's in it |
|---|---|
| [HOW_IT_WORKS.md](HOW_IT_WORKS.md) | Plain-text diagrams of how the app works |
| [TASKS.md](TASKS.md) | Checklist of what's done and what's left, plus the API reference |
| [ui-spec.md](ui-spec.md) | Next frontend tasks |
| [anteater-api.md](anteater-api.md) | Notes on UCI's Anteater API |

## Tech Stack

- **Front end:** React (with Vite)
- **Back end:** Flask
- **Database:** SQLite, through SQLAlchemy
- **Class data:** UCI's [Anteater API](https://anteaterapi.com/reference)
- **Running it:** `./dev.sh` starts the backend and frontend together

## Status at a Glance

| Feature | Backend | Frontend |
|---|---|---|
| Ask a question, see your place in line | Done | Done |
| Question categories and the priority formula | Done | Done |
| Groups of students with the same question | Done | Done |
| Similar-question suggestions | Done | Done (one suggestion while typing) |
| Queue before a session starts; late questions to the back | Done | Done |
| Office hours sessions: schedule, edit, open, close | Done | Done |
| Push waiting students to the next session (overflow) | Done | Done |
| Leave the line | Done | Planned |
| Professor reorders the line by drag and drop (pinning) | Done | Planned (arrows for now) |
| Classes from the Anteater API (students and professors) | Done | Planned |
| Class pages, profile, color coding | n/a | Planned |
| Syllabus upload | Planned | Planned |
| TA queues | Planned (stretch) | Planned (stretch) |
| Real login | Not started (a demo student is hardcoded) | Not started |

## Features

### Student side

- Ask a question: name, class section, question (25 words max) and category
- Queue up **before** a session starts, so the line fills up ahead of time
- See similar questions already in line and **join that group** instead of asking again
- See the line and "You are #N"
- Leave the line: "Fixed it, thanks" (helped) or "Leave the line" (left without help)
- Add classes by section code (looked up on the Anteater API)

### Professor side

- See the line, grouped by question, with badges (late, pushed from last session, moved by hand)
- Help one student, or a whole group at once
- Reorder the line by hand: drag a group to a spot (pinning), or bump it up or down
- Schedule office hours, and change their time and location
- Open a session early, or close it; students still waiting move to the next session
- Sign in by UCInetID to load their classes from the Anteater API

### Nice-to-haves (not built yet)

- TA office hours
- Send questions to TA office hours if professor office hours are overflowing, or from the start depending on the question
- Syllabus upload to fill in office hours automatically

## Input (Student)

1. Student name
2. Class section
3. Question (25-word limit)
4. Question category

Optionally, the office hours session to join. Without it, the question goes to the session that's running now, or else the next upcoming one.

## Categories

Base time and complexity are placeholder guesses the team still needs to confirm. They're set in `backend/priority.py`.

| Category | Base time (min) | Complexity | Score with 1 student |
|---|---|---|---|
| Quick Q&A | 2 | 1 | 10 |
| Understanding Topic | 10 | 3 | 24 |
| Grading | 5 | 1 | 13 |
| Scheduling / Logistics | 3 | 1 | 11 |
| Research | 15 | 5 | 35 |
| Personal | 10 | 3 | 24 |

## Priority Formula

```
Priority Score = ((Base Time) + (Complex × 3) + (Student × 5)) × Overflow
```

| Term | Meaning |
|------|---------|
| Base Time | Estimated time for the question, from its category |
| Complex | Difficulty: 1 = quick, 3 = understanding, 5 = conceptual |
| Student | Number of students in the group with this question |
| Overflow | 1 at first, ×2 each time the question was pushed to a later session |

Higher scores are served first. Ties go to whoever asked first.

**Open question:** should the highest or the lowest score be served first? Highest-first puts long, complex questions ahead of quick ones.

## How the Line Is Ordered

1. **Main line:** questions asked before the session started, highest score first.
2. **Late section, at the back:** questions asked after the session started, first come, first served. Their score is still shown but doesn't change their order.
3. **Pinned students** (placed by the professor) go at their pinned spot, and everyone else fills in around them.

A session counts as started once the professor opens it or its start time passes, whichever comes first. Joining a group that was made before the start keeps you with that group, even if you join late.

Place in line ("You are #N") is counted within your own session.

## Groups and Similar Questions

- Every new question starts its own group (a "bucket"). Students with the same question join that group instead of asking again.
- A group is answered together, so a bigger group scores higher (Student × 5) and saves the professor time.
- A group closes when nobody in it is still waiting, and reopens if a student is put back in line.
- If a student's category changes and they share a group, they move to a group of their own.
- **Similar-question suggestions:** as a student types, the app suggests open groups with a similar question. Matching uses rules and word lists, not AI:
  - Different assignment or question number, a different kind of ask (due date vs. extension), a different error, or a different computer all mean a different question.
  - Otherwise it compares key words both ways. Generic words count less, and common abbreviations, synonyms and typos are recognized.
  - Suggestions need a score of 0.55 or more. It's tested on 145 labeled question pairs (143 correct, no wrong matches); see `backend/tests/`.

## Sessions (Office Hours)

```
UPCOMING ──(professor opens, or start time arrives)──> RUNNING ──(professor closes, or 30 min after end)──> CLOSED
```

- Questions can be submitted to upcoming and running sessions. Closed sessions can't be joined, edited or reopened.
- Two open or upcoming sessions of the same course can't overlap.
- The start time is locked once a session starts, since students already chose on time vs. late based on it. The end time can still change.
- A session can be deleted only if nobody is waiting in it.
- Sessions close on their own 30 minutes after their end time.

## Overflow Logic

When a session closes with students still waiting:

- **Next office hours:** they move to the next session of the same course. They count as on time there, and their score doubles, so they're near the front. *(Built.)*
- If there's no next session yet, they wait and move in automatically once one is scheduled. *(Built.)*
- **TA queue:** move to an open TA session with a priority boost because they were waiting. *(Planned.)*

## Manual Changing

The professor can override the formula:

- **Drag and drop (pinning):** drag a group to a spot, and it stays there whatever the score says. *(Backend built; frontend planned.)*
  - New questions go around it.
  - When someone ahead is helped, it moves up with the line.
  - The latest pin wins: dropping on a taken spot moves that group down one.
  - Students who join a pinned group are pinned with it.
- **Bump up or down:** moves a question 15 points. A late question can be bumped up into the main line, but not down (it's already last).
- **Flag:** each queue entry has `manually_changed`: `true` once the professor moves it, `false` if not. A manually changed entry keeps the priority the professor gave it instead of being recalculated.

## Student Statuses

| Status | Meaning |
|---|---|
| `waiting` | In line |
| `done` | Helped |
| `left` | Left the line without being helped |

## Accounts and Class Data (Anteater API)

- **Students:** no real login yet. A demo student (id 1) is built in. Students add classes by their 5-digit section code (e.g. `34190`), which is looked up on the Anteater API and saved.
- **Professors:** sign in with their UCInetID (e.g. `mikes`). Their profile and the courses they lecture this term are loaded from the Anteater API and saved.
- The term is fixed to Fall 2026 for the demo (set in `backend/anteater.py`).
- Saved data keeps working when the Anteater API is down. Lookups are cached for an hour.
- Details: [anteater-api.md](anteater-api.md).

## OH Data

- **Planned:** the professor uploads syllabi for the quarter, and the app finds the office hours in them. Anteater's syllabus links could help pre-fill this.
- **For now:** the professor schedules sessions by hand.

## Open Questions

Tracked in the "Decisions to make" list in [TASKS.md](TASKS.md). The main ones:

- Highest or lowest score first?
- Final base time and complexity for each category
- Count places in line by group or by student?
- One class at a time on the professor page, or all classes together?
- Store the course on each question, in case several courses run office hours at once?
- Are TA queues in scope for the hackathon?
