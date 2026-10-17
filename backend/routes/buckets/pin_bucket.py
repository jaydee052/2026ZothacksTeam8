"""POST /api/buckets/<bucket_id>/pin — the professor drags a whole group to a spot.

Body (JSON):
  {"group_position": 2}     put this group 2nd in line, counting groups the way
                            the screen shows them (a group of 3 is one spot)
  {"group_position": null}  unpin the group; it goes back to being ordered by score

The group's students are pinned to back-to-back places, so the group stays
together and stays put no matter what the score formula says. The latest pin
wins: anyone already pinned there moves down. A spot past the end of the line
puts the group last. Students who join a pinned group are pinned with it.

Returns the group's students with their new positions.
"""
from flask import jsonify, request
from sqlalchemy import select

from db import get_db
from models import Bucket, Ticket
from pins import pin_at
from queue_order import get_ticket, session_line
from validation import spot_error

from . import bp


@bp.post("/<int:bucket_id>/pin")
def pin_bucket(bucket_id):
    data = request.get_json(silent=True) or {}
    if "group_position" not in data:
        return jsonify({
            "error": "group_position is required (a number from 1, or null to unpin)"
        }), 400
    group_position = data["group_position"]
    error = spot_error(group_position, "group_position")
    if error:
        return jsonify({"error": error}), 400

    with get_db() as db:
        bucket = db.get(Bucket, bucket_id)
        if bucket is None:
            return jsonify({"error": "bucket not found"}), 404

        line = session_line(db, bucket.office_hours_id)
        members = [t for t in line if t["bucket_id"] == bucket_id]
        if bucket.status != "waiting" or not members:
            return jsonify({"error": "nobody in this group is waiting"}), 409

        # Start from a clean slate for this group, so its old pins don't get in the way.
        member_ids = [m["id"] for m in members]
        tickets = {t.id: t for t in db.scalars(select(Ticket).where(Ticket.id.in_(member_ids)))}
        for ticket in tickets.values():
            ticket.pinned_position = None
        db.flush()

        if group_position is not None:
            start = _first_place_for_group(line, bucket_id, group_position)
            for offset, member in enumerate(members):
                pin_at(db, tickets[member["id"]], start + offset, member["priority"])

        db.commit()
        return jsonify({
            "bucket_id": bucket_id,
            "group_position": group_position,
            "members": [get_ticket(db, m["id"]) for m in members],
        })


def _first_place_for_group(line, bucket_id, group_position):
    """Turn a spot counted in groups into a place counted in students.

    The other groups keep their current order; this group goes in front of
    whichever group is now at group_position.
    """
    groups = []  # other groups, in line order, as lists of students
    index = {}
    for ticket in line:
        if ticket["bucket_id"] == bucket_id:
            continue
        if ticket["bucket_id"] not in index:
            index[ticket["bucket_id"]] = len(groups)
            groups.append([])
        groups[index[ticket["bucket_id"]]].append(ticket)
    ahead = groups[: group_position - 1]
    return 1 + sum(len(group) for group in ahead)
