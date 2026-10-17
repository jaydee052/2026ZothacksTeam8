# UI Spec: Next Frontend Tasks

Tasks for the frontend, from the team's handwritten planning notes. Check items off as you finish them (`- [ ]` → `- [x]`).

- The full task list is in [TASKS.md](TASKS.md). Backend endpoints are listed in its "API reference" section.
- [HOW_IT_WORKS.md](HOW_IT_WORKS.md) explains how the line is ordered.
- Code lives in `frontend/src/App.jsx` (screens) and `frontend/src/api.js` (calls to the backend).

**Order:** start with section 1, the hardcoded student account, which the notes mark as "first". Sections 2 (classes) and 8 (color coding) build on it.

---

## 1. Hardcoded student account (do this first)

No real login for now. One fake student is "logged in" so the screens know who's using them.

- [ ] Add a small config file (e.g. `src/config.js`) with the hardcoded student: name, class section, and the classes they're in. Example:
  ```js
  export const CURRENT_STUDENT = {
    name: 'Jordan Lee',
    section: 'Lec A',
    classes: ['ICS 32', 'ICS 33'],
  }
  ```
- [ ] Put the API settings in the same file (the backend address, currently `http://localhost:5001/api`), and have `api.js` read them from there
- [ ] Fill the student's name and section on the join form from the account, instead of asking each time. They can still be edited.
- [ ] Keep it easy to swap for real login later: screens should read the student only from this config, never hardcode the name elsewhere



## 2. Classes: navigation and class pages

The app becomes organized around classes. Each class has its own page with its office hours and line.

- [ ] Navigation in the top bar, next to the "ICS 32" session badge and the light/dark mode button:
  - [ ] **See classes:** a list of the student's classes. Picking one opens its class page.
  - [ ] **Add classes:** add a class to the student's list, e.g. pick from the courses that have office hours (`GET /api/office_hours` returns each session's `course`). Save the list in the browser for now.
- [ ] **Class page:** shows that class's sessions and line. Filter sessions with `GET /api/office_hours?course=ICS%2032` and the line with `GET /api/queue?office_hours_id=<id>`.
- [ ] The current Student view becomes the class page for the selected class
- [ ] Remember the last class the student looked at
- [ ] Not doing: an "open office hours right now" link in the navigation (crossed out in the notes)

Note: the backend doesn't store classes yet. Courses only exist as the `course` on each office hours session, and tickets have a class section but no course. If classes need to be saved on the server or linked to tickets, ask the backend developer.

## 3. Profile

- [ ] Profile button in the top bar, next to the navigation and light/dark mode button
- [ ] Shows the hardcoded student's name, section and classes (from section 1)
- [ ] Optional: let them edit their name and section there



## 4. Student view: "Is this your question too?" on every question

Right now the student only sees one suggested similar question while typing. The notes ask for a join option on **every** question in the line.

- [ ] On each question in "The line right now", add a "Same question?" / **Join** button
- [ ] Join → `POST /api/buckets/<id>/join` with the student's name and section (each line entry has a `bucket_id`)
- [ ] Hide the button on the student's own group
- [ ] After joining, highlight the group as theirs and show their updated spot
- [ ] Explain the benefit in a short line, e.g. "Joining gets you helped together, and you keep the group's place in line"
- [ ] Keep the existing "Maybe this helps first" suggestion while typing



## 5. Student view: status values (waiting / done / left)

The backend now has three statuses: `waiting` (in line), `done` (helped) and `left` (left the line without being helped).

- [ ] Keep "Fixed it, thanks" (marks the student `done`)
- [ ] Add a **Leave the line** button → `POST /api/queue/<id>/leave` (marks them `left`)
- [ ] After either, remove their "Your spot" card and show a short confirmation
- [ ] Optional: a small "past questions" list showing done vs. left



## 6. Professor view: drag and drop, no arrows

- [ ] Remove the up/down arrow buttons
- [ ] Let the professor drag a group to a new spot in the line
- [ ] On drop, pin the group there with `POST /api/queue/<id>/pin` and `{"position": N}`:
  - The backend counts positions by **student**, so a group of 3 takes 3 spots. To drop a group at a spot, pin each of its students to back-to-back positions, starting at the number of students in the groups above it + 1.
  - The latest pin wins, so anyone already pinned there moves down one.
- [ ] Show a "pinned" badge on pinned groups (`pinned_position` is set), with an **Unpin** option → `{"position": null}`
- [ ] Late-section groups can be dragged up into the main line. Dragging within the late section isn't needed, since it's first come, first served.
- [ ] Works with a mouse and on a touchscreen; keep a keyboard way to move a group (e.g. focus it and press up/down) so it stays accessible without arrows on screen
- [ ] Clean up `api.bump` in `api.js` if nothing uses it anymore



## 7. Professor view: "Jordan + 5 others"

- [ ] Show group names as the first student plus a count, e.g. "Jordan + 5 others" (or "Jordan" alone, "Jordan + 1 other"), instead of listing every name
- [ ] Show the full list on hover or tap, so the professor can still see everyone
- [ ] Apply this everywhere names are listed: the "Next up" card and the rows after it



## 8. Color code by class

- [ ] Give each class a color (e.g. a fixed list assigned in order, saved so each class keeps its color)
- [ ] Use it on the class page: a header band, the session badge, and the class in the navigation list
- [ ] Use it on the professor page: a small color tag on each group or row showing its class
- [ ] Check that every color works in both light and dark mode, and that text on it stays readable
- [ ] Don't rely on color alone; always show the class name too

---



## Open questions for the team

These are also in the "Decisions to make" list in [TASKS.md](TASKS.md). Check them off there.

- [ ] Does the professor page show one class at a time (with its own navigation), or every class together, color coded?
- [ ] Should places in line count **groups** (a group of 3 is one spot, as the screen does now) or **students** (as the backend does)? This affects "You are #N" and drag-and-drop positions.
- [ ] Should "add classes" pick from courses with sessions scheduled, or from all real UCI classes? The latter would come from the Anteater API work.