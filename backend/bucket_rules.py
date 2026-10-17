"""When a bucket (a group of students with the same question) is finished.

A bucket is done once nobody in it is still waiting, and opens again if a
student in it is put back to waiting.
"""
from sqlalchemy import func, select

from models import Bucket, Ticket


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
