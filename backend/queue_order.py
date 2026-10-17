"""The order students are served in, and each student's place in line.

Shared by the queue and bucket endpoints so they always agree on positions.
"""
from db import row_to_dict
from priority import score

# Each ticket plus how many waiting students share its bucket.
TICKETS_WITH_COUNT = """
    SELECT t.*,
        (SELECT COUNT(*) FROM tickets m
         WHERE m.bucket_id = t.bucket_id AND m.status = 'waiting') AS student_count
    FROM tickets t
"""


def with_priority(row):
    """Professor-changed tickets keep their set priority; others use the formula."""
    ticket = row_to_dict(row)
    ticket["manually_changed"] = bool(ticket["manually_changed"])
    ticket["late"] = bool(ticket["late"])
    if not ticket["manually_changed"]:
        ticket["priority"] = score(
            ticket["question_type"],
            ticket["student_count"],
            ticket["overflow_count"],
            ticket["late"],
        )
    return ticket


def serving_order(ticket):
    """Highest score first. Ties go to whoever submitted first; the id breaks
    ties between questions submitted in the same second."""
    return (-ticket["priority"], ticket["created_at"], ticket["id"])


def session_line(conn, office_hours_id):
    """Waiting tickets in one session, in serving order, numbered from 1."""
    rows = conn.execute(
        TICKETS_WITH_COUNT + " WHERE t.status = 'waiting' AND t.office_hours_id IS ?",
        (office_hours_id,),
    ).fetchall()
    line = sorted((with_priority(row) for row in rows), key=serving_order)
    for number, ticket in enumerate(line, start=1):
        ticket["position"] = number
    return line


def get_ticket(conn, ticket_id):
    """One ticket, with its position in its session's line (None if not waiting)."""
    row = conn.execute(TICKETS_WITH_COUNT + " WHERE t.id = ?", (ticket_id,)).fetchone()
    if row is None:
        return None
    if row["status"] != "waiting":
        ticket = with_priority(row)
        ticket["position"] = None
        return ticket
    for ticket in session_line(conn, row["office_hours_id"]):
        if ticket["id"] == ticket_id:
            return ticket
