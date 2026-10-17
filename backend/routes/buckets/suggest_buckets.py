"""GET /api/buckets/suggest — open buckets with a question like the student's.

Query params:
  question         required: what the student typed so far
  question_type    optional: only look in this category
  office_hours_id  optional: only look in this session

Returns up to 5 buckets, most similar first, each with a "similarity"
from 0.5 to 1. An empty list means nothing similar is open.
"""
from flask import jsonify, request
from sqlalchemy import and_, func, select

from db import get_db
from models import Bucket, Ticket
from priority import score
from similarity import SUGGEST_THRESHOLD, similarity
from validation import clean

from . import bp

MAX_SUGGESTIONS = 5


@bp.get("/suggest")
def suggest_buckets():
    question = clean(request.args.get("question"))
    if not question:
        return jsonify({"error": "question is required"}), 400

    query = (
        select(Bucket, func.count(Ticket.id).label("member_count"))
        .outerjoin(Ticket, and_(Ticket.bucket_id == Bucket.id, Ticket.status == "waiting"))
        .where(Bucket.status == "waiting")
        .group_by(Bucket.id)
    )
    question_type = clean(request.args.get("question_type")).lower()
    if question_type:
        query = query.where(Bucket.question_type == question_type)
    office_hours_id = request.args.get("office_hours_id", type=int)
    if office_hours_id is not None:
        query = query.where(Bucket.office_hours_id == office_hours_id)

    with get_db() as db:
        rows = db.execute(query).all()

    suggestions = []
    for bucket, member_count in rows:
        match = similarity(question, bucket.title)
        if match < SUGGEST_THRESHOLD:
            continue
        data = bucket.to_dict()
        data["member_count"] = member_count
        data["priority"] = score(bucket.question_type, member_count, bucket.overflow_count)
        data["similarity"] = match
        suggestions.append(data)

    # Most similar first; between equally similar ones, the bigger group first.
    suggestions.sort(key=lambda b: (-b["similarity"], -b["member_count"], b["id"]))
    return jsonify(suggestions[:MAX_SUGGESTIONS])
