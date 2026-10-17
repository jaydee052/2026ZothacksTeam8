"""POST /api/buckets/<bucket_id>/join — add a student to an existing bucket.

Body (JSON):
  student_name   required
  class_section  required
  question       optional (25 words max); defaults to the bucket's question
"""
from flask import jsonify, request

from db import get_connection, row_to_dict
from priority import score
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

    conn = get_connection()
    bucket = conn.execute("SELECT * FROM buckets WHERE id = ?", (bucket_id,)).fetchone()
    if bucket is None:
        conn.close()
        return jsonify({"error": "bucket not found"}), 404
    if bucket["status"] != "waiting":
        conn.close()
        return jsonify({"error": "bucket is no longer open"}), 409

    # The student takes on the bucket's category.
    cursor = conn.execute(
        """
        INSERT INTO tickets
            (student_name, class_section, question, question_type, priority,
             office_hours_id, bucket_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            name,
            section,
            question or bucket["title"],
            bucket["question_type"],
            score(bucket["question_type"]),
            bucket["office_hours_id"],
            bucket_id,
        ),
    )
    conn.commit()
    ticket = conn.execute("SELECT * FROM tickets WHERE id = ?", (cursor.lastrowid,)).fetchone()
    conn.close()
    return jsonify(row_to_dict(ticket)), 201
