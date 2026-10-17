"""The order students are served in, and each student's place in line.

The line has two sections:
  1. Main line: on-time questions (and late ones the professor moved up),
     highest score first.
  2. Late section, at the back: questions submitted after the session started,
     in the order they arrived. Their score doesn't change their order.
Then students the professor pinned are placed at their pinned spot, and everyone
else fills in around them.

Shared by the queue and bucket endpoints so they always agree on positions.
"""
from collections import deque

from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from models import Ticket
from priority import score

# How many waiting students share each ticket's bucket (counted per ticket).
_members = aliased(Ticket)
STUDENT_COUNT = (
    select(func.count(_members.id))
    .where(_members.bucket_id == Ticket.bucket_id, _members.status == "waiting")
    .correlate(Ticket)
    .scalar_subquery()
    .label("student_count")
)


def with_priority(ticket, student_count):
    """Ticket as a dict. Professor-changed tickets keep their set priority;
    others use the formula."""
    data = ticket.to_dict()
    data["student_count"] = student_count
    data["in_late_section"] = in_late_section(ticket)
    if not ticket.manually_changed:
        data["priority"] = score(ticket.question_type, student_count, ticket.overflow_count)
    return data


def in_late_section(item):
    """Late, and not moved up by the professor. Works for tickets and buckets."""
    return bool(item.late) and not getattr(item, "manually_changed", False)


def serving_order(ticket):
    """Main line first, highest score first; then the late section by arrival.
    Ties go to whoever submitted first; the id breaks ties between questions
    submitted in the same second."""
    if ticket["in_late_section"]:
        return (1, 0, ticket["created_at"], ticket["id"])
    return (0, -ticket["priority"], ticket["created_at"], ticket["id"])


def place_pinned(ordered):
    """Put pinned students at their pinned spot (1 = first); everyone else keeps
    their order around them. Pins past the end of the line go last. (Two students
    pinned to the same spot shouldn't happen, since pinning makes room; if it does,
    the lower ticket id goes first.)"""
    pinned = deque(sorted(
        (t for t in ordered if t["pinned_position"]),
        key=lambda t: (t["pinned_position"], t["id"]),
    ))
    others = deque(t for t in ordered if not t["pinned_position"])
    line = []
    # Fill the line one spot at a time. A pinned student takes the spot once it
    # reaches their pinned number; otherwise the next student in normal order does.
    while pinned or others:
        spot = len(line) + 1
        if pinned and (pinned[0]["pinned_position"] <= spot or not others):
            line.append(pinned.popleft())
        else:
            line.append(others.popleft())
    return line


def session_line(db, office_hours_id):
    """Waiting tickets in one session, in serving order, numbered from 1."""
    if office_hours_id is None:
        in_session = Ticket.office_hours_id.is_(None)
    else:
        in_session = Ticket.office_hours_id == office_hours_id
    rows = db.execute(
        select(Ticket, STUDENT_COUNT).where(Ticket.status == "waiting", in_session)
    ).all()
    ordered = sorted((with_priority(ticket, count) for ticket, count in rows), key=serving_order)
    line = place_pinned(ordered)
    for number, ticket in enumerate(line, start=1):
        ticket["position"] = number
    return line


def get_ticket(db, ticket_id):
    """One ticket, with its position in its session's line (None if not waiting)."""
    row = db.execute(select(Ticket, STUDENT_COUNT).where(Ticket.id == ticket_id)).first()
    if row is None:
        return None
    ticket, count = row
    if ticket.status != "waiting":
        data = with_priority(ticket, count)
        data["position"] = None
        return data
    for data in session_line(db, ticket.office_hours_id):
        if data["id"] == ticket_id:
            return data
