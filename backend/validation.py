"""Checks for student input. See "Input (Student)" in spec.md."""
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
