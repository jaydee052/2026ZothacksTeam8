"""Pinning: the professor puts a student (or a whole group) at a spot in line,
and it stays there no matter what the score formula says.

Pins are stored per student as pinned_position (1 = first in line, counted in
students). queue_order.place_pinned puts them in place after sorting.
"""
from sqlalchemy import select

from models import Ticket


def _waiting_pins(db, session_id, exclude_ids=()):
    """Waiting students in a session who are pinned."""
    query = select(Ticket).where(
        Ticket.office_hours_id == session_id,
        Ticket.status == "waiting",
        Ticket.pinned_position.is_not(None),
    )
    if exclude_ids:
        query = query.where(Ticket.id.not_in(list(exclude_ids)))
    return list(db.scalars(query))


def make_room(db, ticket, position):
    """The latest pin wins: if someone else is pinned to this spot, move them down
    one, along with anyone pinned right after them, so back-to-back pins shift together."""
    pins = {t.pinned_position: t for t in _waiting_pins(db, ticket.office_hours_id, [ticket.id])}
    spot = position
    in_the_way = []
    while spot in pins:
        in_the_way.append(pins[spot])
        spot += 1
    for other in in_the_way:
        other.pinned_position += 1


def pin_at(db, ticket, position, shown_priority):
    """Pin one student to a spot. They keep the score they have now, so it
    doesn't jump when the formula stops applying to them."""
    make_room(db, ticket, position)
    ticket.pinned_position = position
    ticket.priority = shown_priority
    ticket.manually_changed = True
    db.flush()


def leaving_line(db, tickets):
    """Call before students stop waiting (helped, left, or their group answered).

    Pinned students behind them move up one spot per student leaving, so a pin
    keeps its place relative to the line (if the professor dragged a group to
    #2 and #1 is helped, that group is now #1). This also keeps a pinned group
    together when one of its members leaves. The leaving students' pins are cleared.
    """
    # Imported here to avoid a circular import (queue_order doesn't need pins).
    from queue_order import session_line

    by_session = {}
    for ticket in tickets:
        if ticket.status == "waiting":
            by_session.setdefault(ticket.office_hours_id, []).append(ticket)

    for session_id, leaving in by_session.items():
        # Where each leaving student is in line right now.
        positions = {t["id"]: t["position"] for t in session_line(db, session_id)}
        spots = [positions[t.id] for t in leaving if t.id in positions]
        for other in _waiting_pins(db, session_id, exclude_ids={t.id for t in leaving}):
            ahead = sum(1 for spot in spots if spot < other.pinned_position)
            other.pinned_position = max(1, other.pinned_position - ahead)
        for ticket in leaving:
            ticket.pinned_position = None
    db.flush()
