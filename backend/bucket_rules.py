"""When a bucket (a group of students with the same question) is finished.

A bucket is done once nobody in it is still waiting, and opens again if a
student in it is put back to waiting.
"""
from sqlalchemy import func, select

from models import Bucket, Ticket
from pins import pin_at
from priority import score


def add_to_bucket(db, bucket, student_name, class_section, question, embedding=None):
    """Add a student to an open bucket. Returns their new ticket (flushed, not committed).

    The student takes on the bucket's category and its place in line. Joining a
    bucket from before the session started keeps the student with that group.
    embedding is the question's stored vector, if it has one already.
    """
    ticket = Ticket(
        embedding=embedding,
        student_name=student_name,
        class_section=class_section,
        question=question or bucket.title,
        question_type=bucket.question_type,
        priority=score(bucket.question_type),
        office_hours_id=bucket.office_hours_id,
        bucket_id=bucket.id,
        late=bucket.late,
    )
    db.add(ticket)
    db.flush()

    # If the professor pinned this group, the new student is pinned right
    # after the others so the group stays together.
    last_pin = db.scalar(
        select(func.max(Ticket.pinned_position)).where(
            Ticket.bucket_id == bucket.id, Ticket.status == "waiting", Ticket.id != ticket.id
        )
    )
    if last_pin is not None:
        mate = db.scalar(select(Ticket).where(
            Ticket.bucket_id == bucket.id, Ticket.pinned_position == last_pin
        ))
        pin_at(db, ticket, last_pin + 1, mate.priority)
    return ticket


def sync_bucket_status(db, bucket_id):
    """Set the bucket to "done" or "waiting" based on who's still waiting in it."""
    if bucket_id is None:
        return
    bucket = db.get(Bucket, bucket_id)
    if bucket is None:
        return
    still_waiting = db.scalar(
        select(func.count(Ticket.id)).where(
            Ticket.bucket_id == bucket_id, Ticket.status == "waiting"
        )
    )
    bucket.status = "waiting" if still_waiting else "done"
