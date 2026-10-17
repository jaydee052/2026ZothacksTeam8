"""Database setup with SQLAlchemy.

Use it in an endpoint like this:

    with get_db() as db:
        ticket = db.get(Ticket, ticket_id)
        ...
        db.commit()
"""
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import create_engine, event, inspect, select, text
from sqlalchemy.orm import Session

from models import Base, Bucket, OfficeHours, Ticket
from priority import score

DB_PATH = Path(__file__).parent / "office_hours.db"

# One engine per database file. Tests point DB_PATH at a temporary file.
_engines = {}


def get_engine():
    path = str(DB_PATH)
    if path not in _engines:
        engine = create_engine(f"sqlite:///{path}")

        @event.listens_for(engine, "connect")
        def _turn_on_foreign_keys(dbapi_connection, _record):
            dbapi_connection.execute("PRAGMA foreign_keys = ON")

        _engines[path] = engine
    return _engines[path]


def get_db():
    """A database session. Use it in a `with` block so it always closes."""
    return Session(get_engine())


def init_db():
    engine = get_engine()
    Base.metadata.create_all(engine)

    # Older databases are missing columns added since. Add them in place.
    _add_missing_columns(engine, "tickets", {
        "bucket_id": "INTEGER REFERENCES buckets(id)",
        "class_section": "TEXT",
        "overflow_count": "INTEGER NOT NULL DEFAULT 0",
        "manually_changed": "INTEGER NOT NULL DEFAULT 0",
        "late": "INTEGER NOT NULL DEFAULT 0",
    })
    _add_missing_columns(engine, "buckets", {
        "overflow_count": "INTEGER NOT NULL DEFAULT 0",
        "late": "INTEGER NOT NULL DEFAULT 0",
    })
    _add_missing_columns(engine, "office_hours", {
        "closed_at": "TEXT",
    })

    with get_db() as db:
        if db.scalar(select(OfficeHours).limit(1)) is None:
            _add_sample_data(db)

        # Every ticket belongs to a bucket. Give any ticket without one its own bucket.
        orphans = db.scalars(
            select(Ticket).where(Ticket.bucket_id.is_(None)).order_by(Ticket.id)
        ).all()
        for ticket in orphans:
            bucket = create_bucket(
                db, ticket.question, ticket.question_type, ticket.office_hours_id
            )
            ticket.bucket_id = bucket.id

        db.commit()


def _add_missing_columns(engine, table, columns):
    existing = {column["name"] for column in inspect(engine).get_columns(table)}
    with engine.begin() as conn:
        for name, definition in columns.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {definition}"))


def _add_sample_data(db):
    # Sample session starts an hour from now, so it's open for questions.
    start = datetime.now().replace(second=0, microsecond=0) + timedelta(hours=1)
    session = OfficeHours(
        course="ICS 32",
        location="ICS 2nd Floor Atrium",
        starts_at=start.isoformat(timespec="minutes"),
        ends_at=(start + timedelta(hours=2)).isoformat(timespec="minutes"),
        is_open=False,
    )
    db.add(session)
    db.flush()  # gives the session its id

    seed = [
        ("Alex", "Lec A", "Can you explain how recursion works?", "understanding_topic"),
        ("Jordan", "Lec A", "When is the midterm?", "quick_qa"),
        ("Sam", "Lec B", "Why did I lose points on assignment 3?", "grading"),
    ]
    for name, section, question, category in seed:
        db.add(Ticket(
            student_name=name,
            class_section=section,
            question=question,
            question_type=category,
            priority=score(category),
            office_hours_id=session.id,
        ))
    db.flush()


def create_bucket(db, title, question_type, office_hours_id, late=False):
    """Start a new bucket from a student's question. Returns the new bucket."""
    bucket = Bucket(
        title=title,
        question_type=question_type,
        priority=score(question_type, late=late),
        office_hours_id=office_hours_id,
        late=late,
    )
    db.add(bucket)
    db.flush()  # gives the bucket its id
    return bucket
