# How the Office Hours Queue Works

A plain-language map of the app so far. Task status is in [TASKS.md](TASKS.md);
feature details are in [spec.md](spec.md).

---

## 1. The big picture

```
   STUDENT SCREEN            PROFESSOR SCREEN
   (not built yet)           (not built yet)
         |                          |
         |   ask, join, check line  |   schedule, open, help, close
         v                          v
   +------------------------------------------+
   |            OUR BACKEND (Flask)           |
   |                                          |
   |   decides who goes next, and in what     |
   |   order, using the priority score        |
   +------------------------------------------+
         |                          :
         | saves everything         : (planned) looks up real
         v                          :  UCI classes and sections
   +--------------+          +------------------+
   |   DATABASE   |          |   ANTEATER API   |
   | (one file:   |          |  (not connected  |
   |  office_     |          |   yet)           |
   |  hours.db)   |          +------------------+
   +--------------+
```

---

## 2. What gets stored

```
   OFFICE HOURS SESSION       e.g. "ICS 32, Mon 2-4 PM, DBH 1100"
     |
     +-- GROUP (bucket)        one question, shared by everyone who has it
     |     |                   e.g. "How do I cite sources?"
     |     +-- Kim     (ticket)
     |     +-- Lee     (ticket)   <- each student's spot in line
     |     +-- Pat     (ticket)
     |
     +-- GROUP
           +-- Ned     (ticket)
```

- Every question starts its own group. Other students with the same question
  join that group instead of asking again.
- The professor answers a whole group at once.

---

## 3. A student's path

```
   Student types a question
             |
             v
   App shows similar open questions  ----------------------+
             |                                             |
     "None of these"                             "That's my question!"
             |                                             |
             v                                             v
   Starts a NEW group                            JOINS that group
             |                                   (gets the group's place
             |                                    in line, even if late)
             v                                             |
   Which session?                                          |
   - the one they picked, or                               |
   - the one happening now, or                             |
   - the next one coming up                                |
             |                                             |
             v                                             |
   Has that session started yet?                           |
       |                    |                              |
      NO                   YES                             |
       |                    |                              |
       v                    v                              |
   ON TIME              LATE: goes to the                  |
   (ranked by score)    very back of the line,             |
       |                in the order they arrived          |
       |                    |                              |
       +---------+----------+------------------------------+
                 |
                 v
        "You are #3 in line"
        (can check again any time; the number updates as
         people are helped, join groups, or get moved)
                 |
                 v
        Can leave the line any time ("left"), e.g. if they
        figured it out or have to go
```

---

## 4. A professor's path

```
   1. SCHEDULE a session (course, room, start, end)
            |
            |   students can queue up before it starts
            v
   2. OPEN the session (or the start time arrives)
            |
            |   new questions from now on go to the back
            v
   3. HELP students, top of the line first
            |
            +--> "Done" for one student
            |       (their group closes when the last person is done)
            |
            +--> "Answered" for a whole group (everyone in it at once)
            |
            +--> Move someone up or down by hand
            |       (the app won't re-rank them after that;
            |        moving a late question up puts it in the main line,
            |        moving it down does nothing since it's already last)
            |
            +--> DRAG a group to a spot, e.g. "#2" (this pins it)
            |       (it stays there whatever the score says; new questions go
            |        around it; when someone ahead is helped, it moves up too;
            |        dropping on a pinned spot moves that group down one)
            |
            v
   4. CLOSE the session (or it closes by itself 30 minutes after its end time)
            |
            +--> Anyone still waiting moves to the NEXT session
                 for the same course, with their score DOUBLED
                 so they're near the front next time.
                 (If there's no next session yet, they wait, and move in
                  automatically as soon as one is scheduled.)

   Rules for sessions:
     - Two sessions of the same course can't overlap.
     - The start time is locked once a session starts (the end time isn't).
     - A session can be deleted only if nobody is waiting in it.
```

---

## 5. A session's life

```
   UPCOMING  ------------------>  RUNNING  ------------------>  CLOSED
   (taking questions;             (questions still accepted,    (can't join, edit
    everyone counts as             but new ones go to the        or reopen; leftover
    on time)                       back of the line)             students moved on)

             professor presses OPEN,          professor presses CLOSE,
             or the start time arrives        or 30 min after the end time
```

---

## 6. How the line is ordered

The line has two sections:

```
   +-------------------------------------------+   +--------------------------+
   |  MAIN LINE                                |   |  LATE SECTION (the back) |
   |  asked before the session started         |   |  asked after it started  |
   |  (or moved up by the professor)           |   |                          |
   |                                           |   |                          |
   |  highest score first                      |-->|  first come, first served|
   +-------------------------------------------+   +--------------------------+
```

Being on time is a yes/no that picks your section. It isn't part of the score,
so a late question still shows its real score; it just doesn't move you ahead
of anyone in the late section.

**Time blocks** (how the main line is ordered): the main line is planned in
15-minute blocks. Each block gets up to 2 long questions (Understanding Topic,
Research, Personal), highest score first, then is filled with short questions
(Quick Q&A, Grading, Scheduling) by score, each one that fits.

```
Block 1:  [Research 15m]
Block 2:  [Understanding Topic 10m][Grading 5m]
Block 3:  [Personal 10m][Scheduling 3m][Quick Q&A 2m]
```

**The score** (decides which long and which short questions come first):

```
   score = ( Time  +  Difficulty x 3  +  Students x 5 )  x  Moved
             ----     --------------     ------------       -----
             how      1 quick            how many           1, then x2 each
             long it  3 understanding    people share       time the question
             takes    5 conceptual       the question       was moved to a
                                                            later session
```

Higher score = helped sooner. Ties go to whoever asked first.

After that, anyone the professor **pinned** (by dragging) is placed at their
pinned spot, and everyone else fills in around them.

When a session closes, everyone still waiting moves to the next session. They
count as on time there (they were waiting before it started), and their score
doubles.

**Example:**

| Who | Question type | Group size | Moved? | On time? | Score | Section |
|---|---|---|---|---|---|---|
| Kim | Research | 3 students | no | yes | (15 + 15 + 15) x 1 = **45** | main |
| Alex | Understanding Topic | 1 | no | yes | (10 + 9 + 5) x 1 = **24** | main |
| Jordan | Quick Q&A | 1 | yes, once | yes | (2 + 3 + 5) x 2 = **20** | main |
| Dee | Quick Q&A | 1 | no | **no**, asked at 2:05 | (2 + 3 + 5) x 1 = **10** | late |
| Cal | Research | 1 | no | **no**, asked at 2:10 | (15 + 15 + 5) x 1 = **35** | late |

Line: Kim (#1), Alex (#2), Jordan (#3), then the late section in arrival order:
Dee (#4), Cal (#5). Cal's higher score doesn't put him ahead of Dee.

The time and difficulty numbers for each category are placeholder guesses the team still needs to decide (see TASKS.md).

---

## 7. Where things live in the code

```
backend/
  tests/                  similar-question test pairs and a script to measure matching
  app.py                  starts the server and plugs in all the pieces
  models.py               what's stored: sessions, groups, tickets
  db.py                   opens the database, adds sample data
  priority.py             the score formula and question categories
  blocks.py               plans the main line in 15-minute blocks (long + short questions)
  queue_order.py          builds the line: blocks, late section, pins, numbers each spot
  overflow.py             moving waiting students on: closing, auto-closing, stranded students
  sessions.py             upcoming / running / closed, and which session a question joins
  similarity.py           decides if two questions are "the same question"
  pins.py                 pinning: placing, making room, moving pins up as people leave
  bucket_rules.py         closes a group when nobody in it is waiting
  validation.py           checks input (25-word limit, valid times, etc.)

  routes/                 the requests the screens can make
    queue.py              join the line, list the line, mark done, move up/down
    queue_ticket.py       "where am I in line?"
    queue_leave.py        leave the line
    queue_pin.py          professor pins a student to a spot
    categories.py         the list of question types
    buckets/              groups: list, join, suggest similar, mark answered, pin (drag)
    office_hours/         sessions: list, schedule, edit, open, close, delete
    syllabus.py           (empty, not built yet)

frontend/                 React app (still the starter page)
```
