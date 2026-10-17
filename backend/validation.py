"""Checks for student input. See "Input (Student)" in spec.md."""
from datetime import datetime

from priority import CATEGORIES

MAX_QUESTION_WORDS = 25


def clean(value):
    return (value or "").strip()


def question_error(question):
    """Returns an error message, or None if the question is fine."""
    if not question:
        return "question is required"
    if len(question.split()) > MAX_QUESTION_WORDS:
        return f"question must be {MAX_QUESTION_WORDS} words or fewer"
    return None


def category_error(category):
    if category not in CATEGORIES:
        return "question_type must be one of: " + ", ".join(CATEGORIES)
    return None


def section_code_error(code):
    """UCI section codes (sometimes called CRNs) are 5 digits, e.g. "34190"."""
    if not (len(code) == 5 and code.isdigit()):
        return "section_code must be 5 digits, e.g. 34190"
    return None


def ucinetid_error(ucinetid):
    """A UCInetID is the part of a UCI email before "@uci.edu", e.g. "mikes"."""
    if not ucinetid or not ucinetid.replace("-", "").isalnum():
        return "ucinetid must be letters and numbers only, e.g. mikes"
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
