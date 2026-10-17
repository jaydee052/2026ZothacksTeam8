"""Checks for student input. See "Input (Student)" in spec.md."""
from datetime import datetime

from priority import CATEGORIES

MAX_QUESTION_WORDS = 25

# waiting = in line, done = helped, left = left the line without being helped
TICKET_STATUSES = ("waiting", "done", "left")


def clean(value):
    return (value or "").strip()


def question_error(question):
    """Returns an error message, or None if the question is fine."""
    if not question:
        return "question is required"
    if len(question.split()) > MAX_QUESTION_WORDS:
        return f"question must be {MAX_QUESTION_WORDS} words or fewer"
    return None


def status_error(status):
    if status not in TICKET_STATUSES:
        return "status must be one of: " + ", ".join(TICKET_STATUSES)
    return None


def category_error(category):
    if category not in CATEGORIES:
        return "question_type must be one of: " + ", ".join(CATEGORIES)
    return None


def parse_time(value):
    """Turn "2026-10-17T14:00" into a standard string, or None if it isn't a valid time.

    Times are stored as text in one fixed format, so comparing the text
    ("is this session later than that one?") gives the right answer.
    """
    try:
        return datetime.fromisoformat(clean(value)).isoformat(timespec="minutes")
    except (TypeError, ValueError):
        return None
