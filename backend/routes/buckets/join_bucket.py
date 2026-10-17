"""POST /api/buckets/<bucket_id>/join — add a student to an existing bucket.

Body (JSON):
  student_name   required
  class_section  required
  question       optional (25 words max); defaults to the bucket's question
"""
from flask import jsonify, request

from db import get_connection
from priority import score
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

    conn = get_connection()
    bucket = conn.execute("SELECT * FROM buckets WHERE id = ?", (bucket_id,)).fetchone()
    if bucket is None:
        conn.close()
        return jsonify({"error": "bucket not found"}), 404
    if bucket["status"] != "waiting":
        conn.close()
        return jsonify({"error": "bucket is no longer open"}), 409

    # The student takes on the bucket's category and its place in line. Joining a
    # bucket from before the session started keeps the student with that group.
    cursor = conn.execute(
        """
        INSERT INTO tickets
            (student_name, class_section, question, question_type, priority,
             office_hours_id, bucket_id, late)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            name,
            section,
            question or bucket["title"],
            bucket["question_type"],
            score(bucket["question_type"], late=bucket["late"]),
            bucket["office_hours_id"],
            bucket_id,
            bucket["late"],
        ),
    )
    conn.commit()
    # Includes the student's position in line, for the "you are #N" display.
    ticket = get_ticket(conn, cursor.lastrowid)
    conn.close()
    return jsonify(ticket), 201
