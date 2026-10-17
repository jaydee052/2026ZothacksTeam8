"""Client for UCI's Anteater API (https://anteaterapi.com/reference).

This is the only file that talks to Anteater. Every function returns our own
simple dicts, so the rest of the backend never depends on Anteater's format.
Notes on the endpoints and fields are in anteater-api.md.
"""
import json
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import urlopen

BASE_URL = "https://anteaterapi.com/v2/rest"
TIMEOUT_SECONDS = 5

# Section codes are reused every quarter, so every lookup needs a term.
# Fixed for the demo so student and professor data always line up.
YEAR = "2026"
QUARTER = "Fall"

# Anteater allows 1000 requests an hour without a key. Keep answers for an hour.
CACHE_SECONDS = 60 * 60
_cache = {}


class AnteaterError(Exception):
    """Anteater couldn't be reached or sent back something unexpected."""


def _get(path, **params):
    """Call one endpoint and return its "data". Returns None for a 404."""
    url = f"{BASE_URL}{path}"
    if params:
        url += "?" + urlencode(params)

    cached = _cache.get(url)
    if cached and time.time() - cached[0] < CACHE_SECONDS:
        return cached[1]

    try:
        with urlopen(url, timeout=TIMEOUT_SECONDS) as response:
            body = json.load(response)
    except HTTPError as error:
        if error.code == 404:
            return None
        raise AnteaterError(f"Anteater API returned {error.code}") from error
    except (URLError, TimeoutError, ValueError) as error:
        raise AnteaterError("Anteater API is unreachable") from error

    data = body.get("data")
    _cache[url] = (time.time(), data)
    return data


def _clock(t):
    """{"hour": 8, "minute": 0} -> "08:00"."""
    return f"{t['hour']:02d}:{t['minute']:02d}" if t else None


def _meeting(m):
    if m.get("timeIsTBA"):
        return {"tba": True, "days": None, "start": None, "end": None, "location": None}
    return {
        "tba": False,
        "days": m.get("days"),
        "start": _clock(m.get("startTime")),
        "end": _clock(m.get("endTime")),
        "location": ", ".join(m.get("bldg") or []) or None,
    }


def _final_exam(f):
    if f.get("examStatus") != "SCHEDULED_FINAL":
        return None
    return {
        "day": f.get("dayOfWeek"),
        "date": f"{YEAR}-{f['month']:02d}-{f['day']:02d}",
        "start": _clock(f.get("startTime")),
        "end": _clock(f.get("endTime")),
        "location": ", ".join(f.get("bldg") or []) or None,
    }


def _section(course, s):
    """One WebSoc section, flattened together with its course."""
    return {
        "section_code": s["sectionCode"],
        "section_type": s["sectionType"],
        "section_num": s["sectionNum"],
        "course_id": course["courseId"],
        "department": course["deptCode"],
        "course_number": course["courseNumber"],
        "course_title": course["courseTitle"],
        "instructors": [name for name in s["instructors"] if name != "STAFF"],
        "meetings": [_meeting(m) for m in s["meetings"]],
        "final_exam": _final_exam(s["finalExam"]),
        "enrolled": int(s["numCurrentlyEnrolled"]["totalEnrolled"] or 0),
        "capacity": int(s["maxCapacity"] or 0),
        "status": s["status"],
        "year": YEAR,
        "quarter": QUARTER,
    }


def _websoc_courses(**filters):
    """Yield (course, section) pairs from a WebSoc query for the current term."""
    data = _get("/websoc", year=YEAR, quarter=QUARTER, **filters) or {}
    for school in data.get("schools", []):
        for department in school["departments"]:
            for course in department["courses"]:
                yield course, course["sections"]


def lookup_section(section_code):
    """The section with this 5-digit code this term, or None if there isn't one."""
    for course, sections in _websoc_courses(sectionCodes=section_code):
        for s in sections:
            if s["sectionCode"] == section_code and not s["isCancelled"]:
                return _section(course, s)
    return None


def lookup_instructor(ucinetid):
    """A professor's profile and the courses they lecture this term, or None if
    there's no instructor with this UCInetID.

    Independent study, seminars and thesis units are left out: only courses
    where the professor teaches a lecture are included.
    """
    profile = _get(f"/instructors/{quote(ucinetid)}")
    if profile is None:
        return None

    # WebSoc lists instructors as "SHINDLER, M.". Search by last name, then keep
    # only sections listing one of this professor's exact names, so other
    # professors with the same last name are left out.
    names = set(profile["shortenedNames"])
    websoc_name = next((n for n in names if "," in n), profile["name"].split()[-1])
    last_name = websoc_name.split(",")[0].strip()

    courses = []
    for course, sections in _websoc_courses(instructorName=last_name):
        mine = [s for s in sections if names & set(s["instructors"]) and not s["isCancelled"]]
        if not any(s["sectionType"] == "Lec" for s in mine):
            continue
        courses.append({
            "course_id": course["courseId"],
            "department": course["deptCode"],
            "course_number": course["courseNumber"],
            "course_title": course["courseTitle"],
            # Every section, so lab/discussion TAs are available too.
            "sections": [_section(course, s) for s in sections if not s["isCancelled"]],
        })

    return {
        "ucinetid": profile["ucinetid"],
        "name": profile["name"],
        "title": profile["title"],
        "email": profile["email"],
        "department": profile["department"],
        "year": YEAR,
        "quarter": QUARTER,
        "courses": courses,
    }
