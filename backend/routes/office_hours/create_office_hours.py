"""POST /api/office_hours — schedule a new session.

Body (JSON), all required:
  course, location, starts_at, ends_at   (times like "2026-10-17T14:00")

New sessions take questions right away. They count as started once the
professor opens them (POST /api/office_hours/<id>/open) or the start time passes.

Refused (409) if it overlaps another open or upcoming session of the same course.
Students left waiting on an earlier closed session of the course, with nowhere
to go, move into the new session. "moved_in_count" says how many.
"""
from flask import jsonify, request

from db import get_db
from models import OfficeHours
from overflow import rehome_stranded

from . import bp
from .fields import overlap_error, read_fields, session_to_dict


@bp.post("")
def create_office_hours():
    fields, error = read_fields(request.get_json(silent=True) or {})
    if error:
        return jsonify({"error": error}), 400

    with get_db() as db:
        clash = overlap_error(db, fields["course"], fields["starts_at"], fields["ends_at"])
        if clash:
            return jsonify({"error": clash}), 409

        session = OfficeHours(**fields, is_open=False)
        db.add(session)
        db.flush()  # gives the session its id
        moved_in = rehome_stranded(db, session.course)
        db.commit()

        data = session_to_dict(session)
        data["moved_in_count"] = moved_in
        return jsonify(data), 201
