"""GET /api/buckets — list buckets, highest priority first.

Query params (all optional):
  question_type  only show buckets in this category, e.g. "grading"
  status         defaults to "waiting"
"""
from flask import jsonify, request

from db import get_connection, row_to_dict
from priority import score

from . import bp


@bp.get("")
def list_buckets():
    status = (request.args.get("status") or "waiting").strip().lower()
    question_type = (request.args.get("question_type") or "").strip().lower()

    sql = """
        SELECT b.*, COUNT(t.id) AS member_count
        FROM buckets b
        LEFT JOIN tickets t ON t.bucket_id = b.id AND t.status = 'waiting'
        WHERE b.status = ?
    """
    params = [status]
    if question_type:
        sql += " AND b.question_type = ?"
        params.append(question_type)
    sql += " GROUP BY b.id"

    conn = get_connection()
    rows = conn.execute(sql, params).fetchall()
    conn.close()

    buckets = []
    for row in rows:
        bucket = row_to_dict(row)
        # Students x 5 in the formula: more students sharing a question ranks it higher.
        bucket["priority"] = score(
            bucket["question_type"], bucket["member_count"], bucket["overflow_count"]
        )
        buckets.append(bucket)

    buckets.sort(key=lambda b: (-b["priority"], b["created_at"]))
    return jsonify(buckets)
