"""POST /api/buckets/<bucket_id>/resolve — the professor answered this question.

Marks the bucket and everyone still waiting in it as done, in one step.
Returns the bucket and how many students were marked done.
"""
from flask import jsonify
from sqlalchemy import update

from db import get_db
from models import Bucket, Ticket

from . import bp


@bp.post("/<int:bucket_id>/resolve")
def resolve_bucket(bucket_id):
    with get_db() as db:
        bucket = db.get(Bucket, bucket_id)
        if bucket is None:
            return jsonify({"error": "bucket not found"}), 404
        if bucket.status != "waiting":
            return jsonify({"error": "bucket is already done"}), 409

        resolved = db.execute(
            update(Ticket)
            .where(Ticket.bucket_id == bucket_id, Ticket.status == "waiting")
            .values(status="done")
        ).rowcount
        bucket.status = "done"
        db.commit()

        return jsonify({"bucket": bucket.to_dict(), "resolved_count": resolved})
