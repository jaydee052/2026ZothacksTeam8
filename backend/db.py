"""Database setup with SQLAlchemy.

Use it in an endpoint like this:

    with get_db() as db:
        ticket = db.get(Ticket, ticket_id)
        ...
        db.commit()
"""
import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import create_engine, event, func, inspect, select, text
from sqlalchemy.orm import Session

from models import Base, Bucket, OfficeHours, Student, Ticket
from priority import score
from sample_questions import top_up, top_up_all

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


def get_connection():
    """sqlite3 connection for Anteater student/professor routes."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


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
        "pinned_position": "INTEGER",
    })
    _add_missing_columns(engine, "buckets", {
        "overflow_count": "INTEGER NOT NULL DEFAULT 0",
        "late": "INTEGER NOT NULL DEFAULT 0",
        "embedding": "TEXT",
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

        # Any session with fewer than 4 groups waiting gets sample questions.
        top_up_all(db)

        # Hardcoded demo student (id 1). Classes are added through
        # POST /api/students/1/sections, e.g. section code 34190 (COMPSCI 161).
        if db.scalar(select(func.count()).select_from(Student)) == 0:
            db.add(Student(name="Demo Student"))

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
        course="I&C SCI 46",  # one of the demo professor's courses (frontend/src/config.js)
        location="ICS 2nd Floor Atrium",
        starts_at=start.isoformat(timespec="minutes"),
        ends_at=(start + timedelta(hours=2)).isoformat(timespec="minutes"),
        is_open=False,
    )
    db.add(session)
    db.flush()  # gives the session its id
    top_up(db, session)


def create_bucket(db, title, question_type, office_hours_id, late=False, embedding=None):
    """Start a new bucket from a student's question. Returns the new bucket.

    embedding is the question's vector from embeddings.embed(), if there is one.
    """
    bucket = Bucket(
        title=title,
        question_type=question_type,
        priority=score(question_type),
        office_hours_id=office_hours_id,
        late=late,
        embedding=json.dumps(embedding) if embedding else None,
    )
    db.add(bucket)
    db.flush()  # gives the bucket its id
    return bucket
