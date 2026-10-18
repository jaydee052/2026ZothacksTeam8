"""The order students are served in, and each student's place in line.

The line has two sections:
  1. Main line: on-time questions (and late ones the professor moved up),
     planned in time blocks: up to 2 long questions per block, then as many
     short ones as fit, by score (see blocks.py).
  2. Late section, at the back: questions submitted after the session started,
     in the order they arrived. Their score doesn't change their order.
Then students the professor pinned are placed at their pinned spot, and everyone
else fills in around them. Students in the same group stay next to each other.

Each waiting ticket gets:
  position     place in line (1 = next)
  block        which time block it's planned in (main line only, else None)
  eta_minutes  rough minutes until their group's turn
  estimated_turn_at  rough clock time of their turn ("2026-10-18T17:45"),
                     rounded to TURN_TIME_ROUNDING minutes
  past_session_end   true if that's after the session ends (they may not be
                     reached, and would move to the next session)

Shared by the queue and bucket endpoints so they always agree on positions.
"""
from collections import deque
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from blocks import is_long, minutes_for, plan_blocks
from models import OfficeHours, Ticket
from priority import score
from sessions import has_started

# Turn times are rounded to this many minutes: they're estimates, and 5:45 reads
# as less certain than 5:47.
TURN_TIME_ROUNDING = 5

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


def _groups_in_order(tickets):
    """Tickets grouped by bucket, in order of each group's first ticket."""
    groups, index = [], {}
    for ticket in tickets:
        key = ticket["bucket_id"] if ticket["bucket_id"] is not None else ("solo", ticket["id"])
        if key not in index:
            index[key] = len(groups)
            groups.append([])
        groups[index[key]].append(ticket)
    return groups


def _plan_main_line(tickets):
    """Plan the main line in time blocks. tickets are already in score order."""
    groups = [
        {
            "tickets": members,
            "minutes": minutes_for(members[0]["question_type"]),
            "long": is_long(members[0]["question_type"]),
            "score": members[0]["priority"],
        }
        for members in _groups_in_order(tickets)
    ]
    planned = []
    for number, block in enumerate(plan_blocks(groups), start=1):
        for group in block:
            for ticket in group["tickets"]:
                ticket["block"] = number
                planned.append(ticket)
    return planned


def _add_wait_times(line):
    """eta_minutes: estimated minutes of the groups ahead of each student's group."""
    waited, current, current_minutes = 0, object(), 0
    for ticket in line:
        if ticket["bucket_id"] != current:
            waited += current_minutes
            current = ticket["bucket_id"]
            current_minutes = minutes_for(ticket["question_type"])
        ticket["eta_minutes"] = waited


def _round_time(moment):
    """Round to the nearest TURN_TIME_ROUNDING minutes."""
    step = TURN_TIME_ROUNDING
    minutes = round(moment.minute / step) * step
    return moment.replace(minute=0, second=0, microsecond=0) + timedelta(minutes=minutes)


def _add_turn_times(db, line, office_hours_id):
    """Clock time of each student's turn: the session's start time plus the wait
    if it hasn't started yet, otherwise now plus the wait."""
    session = db.get(OfficeHours, office_hours_id) if office_hours_id is not None else None
    now = datetime.now().replace(second=0, microsecond=0)
    begins = now
    if session is not None and not has_started(session):
        begins = max(now, datetime.fromisoformat(session.starts_at))
    ends = datetime.fromisoformat(session.ends_at) if session is not None else None
    for ticket in line:
        turn = begins + timedelta(minutes=ticket["eta_minutes"])
        shown = _round_time(turn)
        if shown < begins:  # never show a time before the session (or now)
            shown += timedelta(minutes=TURN_TIME_ROUNDING)
        ticket["estimated_turn_at"] = shown.isoformat(timespec="minutes")
        ticket["past_session_end"] = ends is not None and turn >= ends


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

    pinned = [t for t in ordered if t["pinned_position"]]
    unpinned = [t for t in ordered if not t["pinned_position"]]
    main = _plan_main_line([t for t in unpinned if not t["in_late_section"]])
    late = [t for group in _groups_in_order([t for t in unpinned if t["in_late_section"]])
            for t in group]
    for ticket in late + pinned:
        ticket.setdefault("block", None)

    line = place_pinned(main + late + pinned)
    _add_wait_times(line)
    _add_turn_times(db, line, office_hours_id)
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
        data.update(position=None, block=None, eta_minutes=None,
                    estimated_turn_at=None, past_session_end=None)
        return data
    for data in session_line(db, ticket.office_hours_id):
        if data["id"] == ticket_id:
            return data
