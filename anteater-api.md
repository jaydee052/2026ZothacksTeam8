# Anteater API Notes

Notes on using the [Anteater API](https://anteaterapi.com/reference) to get class data for the Office Hours Priority Queue (see `spec.md`).

Base URL: `https://anteaterapi.com/v2/rest`

## ID Formats

The API uses registrar department codes, not common abbreviations.

| What | Format | Example |
|------|--------|---------|
| Course ID | Department code + number, spaces removed | `I&CSCI32` (not `ICS32`) |
| Department | Registrar code | `I&C SCI`, `COMPSCI` |
| Section code | 5 digits, reused every quarter | `36090` |
| Instructor | UCInetID | `thornton` |

URL-encode `&` as `%26` and spaces as `%20`, e.g. `ids=I%26CSCI32`.

## Is `class_section` Enough?

No. The backend currently stores `class_section` as `"Lec A"` and the course as `"ICS 32"` on `office_hours`.

- `"Lec A"` exists in almost every course, so it can't identify a section on its own.
- `"ICS 32"` must be converted to `I&CSCI32` before the API will recognize it.

A section can be identified in one of two ways:

1. **Section code + year + quarter (recommended):**
   `GET /websoc?year=2026&quarter=Fall&sectionCodes=36090`
2. **Department + course number + year + quarter**, then filter the results by `sectionNum` (`"A"`):
   `GET /websoc?year=2026&quarter=Fall&department=I%26C%20SCI&courseNumber=32`

Suggested: add `section_code`, `year`, and `quarter` to `office_hours`. The professor enters them once, and students just pick the office hours they want.

## Courses vs. WebSoc

| | `/courses` | `/websoc` |
|---|---|---|
| Data | Catalog: one record per course | Schedule of classes: one record per section per term |
| Changes by quarter | No | Yes |
| Needs | Course ID | Year, quarter, and section code or course |
| Knows about "Lec A" | No | Yes |

If the app only needs course-level info (title, description, prerequisites), `/courses/batch` is enough. WebSoc is only needed for section-specific details.

## Useful Endpoints

### `GET /courses/batch?ids=I%26CSCI32,COMPSCI161`

Course catalog data. Use `/courses/{id}` for a single course.

- `title`, `description`, `departmentName`, `school`, `courseLevel`
- `minUnits`, `maxUnits`
- `prerequisiteText`, `prerequisiteTree`, `corequisites`, `restriction`, `geList`
- `instructors[]`: `name`, `title`, `email`, `ucinetid`. Lists **everyone who has ever taught** the course, not just the current quarter.
- `terms`: every term the course was offered

### `GET /websoc?year=2026&quarter=Fall&sectionCodes=36090`

Section data for a specific term.

- `sectionType` (Lec/Lab/Dis), `sectionNum`, `sectionCode`
- `instructors` (e.g. `"THORNTON, A."`)
- `meetings[]`: `days` (`"TuTh"`), `startTime`, `endTime`, `bldg` (`"BS3 1200"`)
- `finalExam`
- `numCurrentlyEnrolled.totalEnrolled`, `maxCapacity`: class size, which helps estimate office-hours load
- `status`, `isCancelled`, `sectionComment`, `webURL`
- Course wrapper: `courseTitle`, `courseComment`, `prerequisiteLink`

Querying by `department` + `courseNumber` returns **all** sections of a course, including lab/discussion sections and their TAs. This is useful for the TA queue feature.

### `GET /instructors/{ucinetid}`

Also available as `/instructors/batch?ucinetids=...`.

- `name`, `title`, `email`, `department`, `shortenedNames` (matches WebSoc's `"THORNTON, A."` format)
- `courses[]`: each course with the `terms` they taught it (e.g. `"2026 Fall"`)

### `GET /websoc/syllabi?courseId=I%26CSCI32`

Canvas syllabus URLs by `year`, `quarter`, and `instructorNames`. Could pre-fill or supplement the syllabus upload feature. Only includes courses that posted a syllabus.

### `GET /calendar?year=2026&quarter=Fall`

`instructionStart`, `instructionEnd`, `finalsStart`, `finalsEnd`. Useful for knowing when to stop scheduling office hours and when to expect heavy demand.

### `GET /week`

Current week and quarter, e.g. `"Week 3 • Fall Quarter 2026"`. Useful for labeling the queue and picking the current term automatically.

### `GET /larc?year=2026&quarter=Fall&department=...`

LARC tutoring sessions. A possible overflow option when office hours are full. (No I&C SCI sessions in Fall 2026.)

### Others

- `/studyRooms`: rooms that could be suggested for grouped or overflow sessions
- `/courseMaterials`: textbooks per section
- `/grades/aggregate`: historical grade distributions

## Getting the Professor

WebSoc is the only endpoint that maps a **section** to its instructor for a given term. Alternatives:

- **Without WebSoc:** get `instructors[]` from `/courses/batch`, fetch them with `/instructors/batch`, and keep whoever has the current term (e.g. `"2026 Fall"`) in that course's `terms`. This finds who teaches the course this quarter, but not which lecture each professor teaches.
- **Simplest:** the professor creates the office hours, so have them enter their UCInetID once and call `/instructors/{ucinetid}` for their name, title, and email.
