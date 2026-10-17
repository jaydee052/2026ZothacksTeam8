"""GET /api/office_hours — list sessions, earliest first.

Query params (all optional):
  course   only this course, e.g. "ICS 32"
  is_open  "true" for open sessions only, "false" for closed only
"""
from flask import jsonify, request

from db import get_connection

from . import bp
from .fields import session_to_dict


@bp.get("")
def list_office_hours():
    sql = """
        SELECT o.*, COUNT(t.id) AS waiting_count
        FROM office_hours o
        LEFT JOIN tickets t ON t.office_hours_id = o.id AND t.status = 'waiting'
        WHERE 1 = 1
    """
    params = []

    course = (request.args.get("course") or "").strip()
    if course:
        sql += " AND o.course = ?"
        params.append(course)

    is_open = (request.args.get("is_open") or "").strip().lower()
    if is_open in ("true", "false"):
        sql += " AND o.is_open = ?"
        params.append(1 if is_open == "true" else 0)

    sql += " GROUP BY o.id ORDER BY o.starts_at"

    conn = get_connection()
    rows = conn.execute(sql, params).fetchall()
    conn.close()

    return jsonify([session_to_dict(row) for row in rows])
