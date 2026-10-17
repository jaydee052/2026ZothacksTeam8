import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from priority import score

DB_PATH = Path(__file__).parent / "office_hours.db"


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_connection()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS office_hours (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course TEXT NOT NULL,
            location TEXT NOT NULL,
            starts_at TEXT NOT NULL,
            ends_at TEXT NOT NULL,
            is_open INTEGER NOT NULL DEFAULT 1,
            closed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS buckets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            question_type TEXT NOT NULL,
            priority INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'waiting',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            office_hours_id INTEGER,
            overflow_count INTEGER NOT NULL DEFAULT 0,
            late INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (office_hours_id) REFERENCES office_hours(id)
        );

        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_name TEXT NOT NULL,
            class_section TEXT,
            question TEXT NOT NULL,
            question_type TEXT NOT NULL,
            priority INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'waiting',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            office_hours_id INTEGER,
            bucket_id INTEGER,
            overflow_count INTEGER NOT NULL DEFAULT 0,
            manually_changed INTEGER NOT NULL DEFAULT 0,
            late INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (office_hours_id) REFERENCES office_hours(id),
            FOREIGN KEY (bucket_id) REFERENCES buckets(id)
        );

        CREATE TABLE IF NOT EXISTS syllabi (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )

    # Older databases are missing columns added since. Add them in place.
    _add_missing_columns(conn, "tickets", {
        "bucket_id": "INTEGER REFERENCES buckets(id)",
        "class_section": "TEXT",
        "overflow_count": "INTEGER NOT NULL DEFAULT 0",
        "manually_changed": "INTEGER NOT NULL DEFAULT 0",
        "late": "INTEGER NOT NULL DEFAULT 0",
    })
    _add_missing_columns(conn, "buckets", {
        "overflow_count": "INTEGER NOT NULL DEFAULT 0",
        "late": "INTEGER NOT NULL DEFAULT 0",
    })
    _add_missing_columns(conn, "office_hours", {
        "closed_at": "TEXT",
    })

    existing = conn.execute("SELECT COUNT(*) AS n FROM office_hours").fetchone()["n"]
    if existing == 0:
        # Sample session starts an hour from now, so it's open for questions.
        start = datetime.now().replace(second=0, microsecond=0) + timedelta(hours=1)
        conn.execute(
            """
            INSERT INTO office_hours (course, location, starts_at, ends_at, is_open)
            VALUES (?, ?, ?, ?, 0)
            """,
            (
                "ICS 32",
                "ICS 2nd Floor Atrium",
                start.isoformat(timespec="minutes"),
                (start + timedelta(hours=2)).isoformat(timespec="minutes"),
            ),
        )
        oh_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        seed = [
            ("Alex", "Lec A", "Can you explain how recursion works?", "understanding_topic"),
            ("Jordan", "Lec A", "When is the midterm?", "quick_qa"),
            ("Sam", "Lec B", "Why did I lose points on assignment 3?", "grading"),
        ]
        for name, section, question, category in seed:
            conn.execute(
                """
                INSERT INTO tickets
                    (student_name, class_section, question, question_type, priority, office_hours_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (name, section, question, category, score(category), oh_id),
            )

    # Every ticket belongs to a bucket. Give any ticket without one its own bucket.
    orphans = conn.execute("SELECT * FROM tickets WHERE bucket_id IS NULL").fetchall()
    for ticket in orphans:
        bucket_id = create_bucket(
            conn, ticket["question"], ticket["question_type"], ticket["office_hours_id"]
        )
        conn.execute("UPDATE tickets SET bucket_id = ? WHERE id = ?", (bucket_id, ticket["id"]))

    conn.commit()
    conn.close()


def _add_missing_columns(conn, table, columns):
    existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    for name, definition in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")


def create_bucket(conn, title, question_type, office_hours_id, late=False):
    """Start a new bucket from a student's question. Returns the new bucket id."""
    cursor = conn.execute(
        """
        INSERT INTO buckets (title, question_type, priority, office_hours_id, late)
        VALUES (?, ?, ?, ?, ?)
        """,
        (title, question_type, score(question_type, late=late), office_hours_id, int(late)),
    )
    return cursor.lastrowid


def row_to_dict(row):
    return dict(row) if row is not None else None
