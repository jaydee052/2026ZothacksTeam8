"""POST /api/buckets/<bucket_id>/join — add a student to an existing bucket.

Body (JSON):
  student_name   required
  class_section  required
  question       optional (25 words max); defaults to the bucket's question
"""
from flask import jsonify, request

from bucket_rules import add_to_bucket
from db import get_db
from models import Bucket
from queue_order import get_ticket
from validation import clean, question_error

from . import bp


@bp.post("/<int:bucket_id>/join")
def join_bucket(bucket_id):
    data = request.get_json(silent=True) or {}
    name = clean(data.get("student_name"))
    section = clean(data.get("class_section"))
    if not name or not section:
        return jsonify({"error": "student_name and class_section are required"}), 400

    question = clean(data.get("question"))
    if question:
        error = question_error(question)
        if error:
            return jsonify({"error": error}), 400

    with get_db() as db:
        bucket = db.get(Bucket, bucket_id)
        if bucket is None:
            return jsonify({"error": "bucket not found"}), 404
        if bucket.status != "waiting":
            return jsonify({"error": "bucket is no longer open"}), 409

        ticket = add_to_bucket(db, bucket, name, section, question)
        db.commit()

        # Includes the student's position in line, for the "you are #N" display.
        return jsonify(get_ticket(db, ticket.id)), 201
