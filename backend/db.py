"""Database setup with SQLAlchemy.

Use it in an endpoint like this:

    with get_db() as db:
        ticket = db.get(Ticket, ticket_id)
        ...
        db.commit()
"""
import sqlite3
from pathlib import Path

from sqlalchemy import create_engine, event, func, inspect, select, text
from sqlalchemy.orm import Session

from models import Base, Bucket, Student, Ticket
from priority import score
from sample_questions import ensure_demo_sessions, top_up_all

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
        "embedding": "TEXT",
    })
    _add_missing_columns(engine, "buckets", {
        "overflow_count": "INTEGER NOT NULL DEFAULT 0",
        "late": "INTEGER NOT NULL DEFAULT 0",
    })
    _add_missing_columns(engine, "office_hours", {
        "closed_at": "TEXT",
    })

    with get_db() as db:
        # Every ticket belongs to a bucket. Give any ticket without one its own bucket.
        orphans = db.scalars(
            select(Ticket).where(Ticket.bucket_id.is_(None)).order_by(Ticket.id)
        ).all()
        for ticket in orphans:
            bucket = create_bucket(
                db, ticket.question, ticket.question_type, ticket.office_hours_id
            )
            ticket.bucket_id = bucket.id

        # Each demo course has a session to show, and any session with fewer than
        # 4 groups waiting gets sample questions.
        ensure_demo_sessions(db)
        top_up_all(db)

        # Hardcoded demo students, matching STUDENTS in frontend/src/config.js.
        # Classes they add themselves go through POST /api/students/<id>/sections.
        for student_id, name in DEMO_STUDENTS.items():
            if db.get(Student, student_id) is None:
                db.add(Student(id=student_id, name=name))

        db.commit()


# Demo students by id; ids match STUDENTS in frontend/src/config.js.
DEMO_STUDENTS = {1: "Jordan Lee", 2: "Riley Park"}


def _add_missing_columns(engine, table, columns):
    existing = {column["name"] for column in inspect(engine).get_columns(table)}
    with engine.begin() as conn:
        for name, definition in columns.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {definition}"))


def create_bucket(db, title, question_type, office_hours_id, late=False):
    """Start a new bucket from a student's question. Returns the new bucket."""
    bucket = Bucket(
        title=title,
        question_type=question_type,
        priority=score(question_type),
        office_hours_id=office_hours_id,
        late=late,
    )
    db.add(bucket)
    db.flush()  # gives the bucket its id
    return bucket
