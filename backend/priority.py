"""Queue priority logic. See "Priority Formula" in spec.md.

    Priority Score = (Base Time + (Complex x 3) + (Students x 5)) x Overflow

Higher scores are served first. (The spec lists this as an open question.)

Lateness is not part of the score. It's a separate yes/no (OnTime): on-time
questions are served first by score, then late questions in the order they
arrived. See serving_order in queue_order.py.
"""

# Question categories from the spec.
#   base_time:  estimated minutes the question takes (placeholder estimates)
#   complexity: 1 = quick, 3 = understanding, 5 = conceptual
CATEGORIES = {
    "quick_qa": {"label": "Quick Q&A", "base_time": 2, "complexity": 1},
    "understanding_topic": {"label": "Understanding Topic", "base_time": 10, "complexity": 3},
    "grading": {"label": "Grading", "base_time": 5, "complexity": 1},
    "scheduling": {"label": "Scheduling / Logistics", "base_time": 3, "complexity": 1},
    "research": {"label": "Research", "base_time": 15, "complexity": 5},
    "personal": {"label": "Personal", "base_time": 10, "complexity": 3},
}

# Used for old tickets whose category is no longer in the list.
FALLBACK_CATEGORY = "quick_qa"

COMPLEXITY_WEIGHT = 3
STUDENT_WEIGHT = 5


def overflow_term(overflow_count):
    """1 the first time a question is queued, doubled for each day it overflowed."""
    return 2 ** max(overflow_count, 0)


def score(category, student_count=1, overflow_count=0):
    info = CATEGORIES.get(category, CATEGORIES[FALLBACK_CATEGORY])
    return (
        info["base_time"]
        + info["complexity"] * COMPLEXITY_WEIGHT
        + max(student_count, 1) * STUDENT_WEIGHT
    ) * overflow_term(overflow_count)
