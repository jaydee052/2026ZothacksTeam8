"""GET /api/buckets — list buckets, highest priority first.

Query params (all optional):
  question_type  only show buckets in this category, e.g. "grading"
  status         defaults to "waiting"

Each bucket includes "members": the students in it, in the order they joined,
with their own wording of the question and whether they're still waiting.
"""
from flask import jsonify, request
from sqlalchemy import and_, func, select

from db import get_db
from models import Bucket, Ticket
from priority import score
from queue_order import in_late_section

from . import bp


@bp.get("")
def list_buckets():
    status = (request.args.get("status") or "waiting").strip().lower()
    question_type = (request.args.get("question_type") or "").strip().lower()

    query = (
        select(Bucket, func.count(Ticket.id).label("member_count"))
        .outerjoin(Ticket, and_(Ticket.bucket_id == Bucket.id, Ticket.status == "waiting"))
        .where(Bucket.status == status)
        .group_by(Bucket.id)
    )
    if question_type:
        query = query.where(Bucket.question_type == question_type)

    with get_db() as db:
        rows = db.execute(query).all()

        # Everyone in these buckets, grouped by bucket, in the order they joined.
        bucket_ids = [bucket.id for bucket, _ in rows]
        members = {bucket_id: [] for bucket_id in bucket_ids}
        # Buckets with a waiting student in the main line (e.g. moved up by the professor).
        in_main_line = set()
        if bucket_ids:
            tickets = db.scalars(
                select(Ticket).where(Ticket.bucket_id.in_(bucket_ids)).order_by(Ticket.id)
            ).all()
            for ticket in tickets:
                if ticket.status == "waiting" and not in_late_section(ticket):
                    in_main_line.add(ticket.bucket_id)
                members[ticket.bucket_id].append({
                    "ticket_id": ticket.id,
                    "student_name": ticket.student_name,
                    "class_section": ticket.class_section,
                    "question": ticket.question,
                    "status": ticket.status,
                })

        buckets = []
        for bucket, member_count in rows:
            data = bucket.to_dict()
            data["member_count"] = member_count
            # Students x 5 in the formula: more students sharing a question ranks it higher.
            data["priority"] = score(bucket.question_type, member_count, bucket.overflow_count)
            # A late group stays in the late section unless the professor moved
            # one of its waiting students up into the main line.
            data["in_late_section"] = in_late_section(bucket) and bucket.id not in in_main_line
            data["members"] = members[bucket.id]
            buckets.append(data)

    # Same order as the line: on-time groups by score, then late groups by arrival.
    buckets.sort(
        key=lambda b: (1, 0, b["created_at"], b["id"]) if b["in_late_section"]
        else (0, -b["priority"], b["created_at"], b["id"])
    )
    return jsonify(buckets)
