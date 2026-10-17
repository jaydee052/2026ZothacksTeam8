import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "office_hours.db"

QUESTION_TYPES = {
    "exam": 100,
    "debugging": 80,
    "homework": 60,
    "conceptual": 40,
    "other": 20,
}


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
            is_open INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_name TEXT NOT NULL,
            question TEXT NOT NULL,
            question_type TEXT NOT NULL,
            priority INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'waiting',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            office_hours_id INTEGER,
            FOREIGN KEY (office_hours_id) REFERENCES office_hours(id)
        );

        CREATE TABLE IF NOT EXISTS syllabi (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )

    existing = conn.execute("SELECT COUNT(*) AS n FROM office_hours").fetchone()["n"]
    if existing == 0:
        conn.execute(
            """
            INSERT INTO office_hours (course, location, starts_at, ends_at, is_open)
            VALUES (?, ?, ?, ?, 1)
            """,
            ("ICS 32", "ICS 2nd Floor Atrium", "2026-10-17T14:00", "2026-10-17T16:00"),
        )
        oh_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        seed = [
            ("Alex", "How do I debug a RecursionError?", "debugging"),
            ("Jordan", "What will be on the midterm?", "exam"),
            ("Sam", "Can you walk through assignment 3 part B?", "homework"),
        ]
        for name, question, qtype in seed:
            conn.execute(
                """
                INSERT INTO tickets (student_name, question, question_type, priority, office_hours_id)
                VALUES (?, ?, ?, ?, ?)
                """,
                (name, question, qtype, QUESTION_TYPES[qtype], oh_id),
            )

    conn.commit()
    conn.close()


def row_to_dict(row):
    return dict(row) if row is not None else None
