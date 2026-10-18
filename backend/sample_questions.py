"""Sample questions so every office hours line has something in it for demos.

A session with fewer than MIN_GROUPS groups waiting is topped up from the list
below when it's scheduled (see create_office_hours) and whenever the backend
starts (see init_db). They're ordinary tickets: the professor helps them like
anyone else, so restarting the backend refills a line that was helped through.

Each sample has its own category, so the line mixes long and short questions, and
one group has two students, so grouping shows up too. The frontend's demo mode has
the same list (SAMPLE_QUESTIONS in frontend/src/api.js); change both together.
"""
from sqlalchemy import select

from models import Bucket, OfficeHours, Ticket
from priority import score

MIN_GROUPS = 4

# (question, category, [(student name, section), ...]). Used in this order, so the
# first four cover short and long questions.
SAMPLE_QUESTIONS = [
    ("Can you walk through how recursion builds up the call stack?",
     "understanding_topic", [("Alex Kim", "Lec A")]),
    ("Why did I lose points on the hidden test cases for the last homework?",
     "grading", [("Priya Shah", "Lec A"), ("Marcus Chen", "Lec B")]),
    ("Is the midterm open notes?",
     "quick_qa", [("Sam Rivera", "Lec B")]),
    ("How can I get involved in undergraduate research in this area?",
     "research", [("Chris Patel", "Lec A")]),
    ("Can I switch my discussion section to the Friday one?",
     "scheduling", [("Taylor Nguyen", "Lec A")]),
]


def top_up(db, session):
    """Add sample questions to one session until it has MIN_GROUPS groups waiting.
    Samples already waiting in the session aren't added twice. Returns how many groups
    were added."""
    from db import create_bucket  # db.py imports this module, so import here

    waiting = set(db.scalars(
        select(Bucket.title).where(Bucket.office_hours_id == session.id, Bucket.status == "waiting")
    ).all())
    added = 0
    for question, category, students in SAMPLE_QUESTIONS:
        if len(waiting) >= MIN_GROUPS:
            break
        if question in waiting:
            continue
        # Samples are "there first", so they're on time even if the session has started.
        bucket = create_bucket(db, question, category, session.id)
        for name, section in students:
            db.add(Ticket(
                student_name=name,
                class_section=section,
                question=question,
                question_type=category,
                priority=score(category),
                office_hours_id=session.id,
                bucket_id=bucket.id,
            ))
        waiting.add(question)
        added += 1
    db.flush()
    return added


def top_up_all(db):
    """Top up every session that isn't closed."""
    for session in db.scalars(select(OfficeHours).where(OfficeHours.closed_at.is_(None))).all():
        top_up(db, session)
