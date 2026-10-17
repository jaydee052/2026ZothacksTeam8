"""GET /api/buckets — list buckets, highest priority first.

Query params (all optional):
  question_type  only show buckets in this category, e.g. "grading"
  status         defaults to "waiting"
"""
from flask import jsonify, request
from sqlalchemy import and_, func, select

from db import get_db
from models import Bucket, Ticket
from priority import score

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

        buckets = []
        for bucket, member_count in rows:
            data = bucket.to_dict()
            data["member_count"] = member_count
            # Students x 5 in the formula: more students sharing a question ranks it higher.
            data["priority"] = score(
                bucket.question_type, member_count, bucket.overflow_count, bucket.late
            )
            buckets.append(data)

    buckets.sort(key=lambda b: (-b["priority"], b["created_at"]))
    return jsonify(buckets)
