"""POST /api/buckets/<bucket_id>/join — add a student to an existing bucket.

Body (JSON):
  student_name  required
  question      optional; defaults to the bucket's question
"""
from flask import jsonify, request

from db import get_connection, row_to_dict

from . import bp


@bp.post("/<int:bucket_id>/join")
def join_bucket(bucket_id):
    data = request.get_json(silent=True) or {}
    name = (data.get("student_name") or "").strip()
    if not name:
        return jsonify({"error": "student_name is required"}), 400

    conn = get_connection()
    bucket = conn.execute("SELECT * FROM buckets WHERE id = ?", (bucket_id,)).fetchone()
    if bucket is None:
        conn.close()
        return jsonify({"error": "bucket not found"}), 404
    if bucket["status"] != "waiting":
        conn.close()
        return jsonify({"error": "bucket is no longer open"}), 409

    question = (data.get("question") or "").strip() or bucket["title"]

    # The student takes on the bucket's category and priority.
    cursor = conn.execute(
        """
        INSERT INTO tickets
            (student_name, question, question_type, priority, office_hours_id, bucket_id)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            name,
            question,
            bucket["question_type"],
            bucket["priority"],
            bucket["office_hours_id"],
            bucket_id,
        ),
    )
    conn.commit()
    ticket = conn.execute("SELECT * FROM tickets WHERE id = ?", (cursor.lastrowid,)).fetchone()
    conn.close()
    return jsonify(row_to_dict(ticket)), 201
