"""Database tables as SQLAlchemy models.

Columns match the tables the app created before SQLAlchemy, so existing
office_hours.db files keep working. Times are stored as text like
"2026-10-17T14:00", which sorts correctly as plain text.
"""
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Integer, String, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    def to_dict(self):
        """Every column as a plain dict, ready for jsonify."""
        return {column.key: getattr(self, column.key) for column in self.__table__.columns}


class OfficeHours(Base):
    __tablename__ = "office_hours"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course: Mapped[str] = mapped_column(String, nullable=False)
    location: Mapped[str] = mapped_column(String, nullable=False)
    starts_at: Mapped[str] = mapped_column(String, nullable=False)
    ends_at: Mapped[str] = mapped_column(String, nullable=False)
    is_open: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    closed_at: Mapped[Optional[str]] = mapped_column(String)


class Bucket(Base):
    """A group of students with the same question, answered together."""

    __tablename__ = "buckets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    question_type: Mapped[str] = mapped_column(String, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="waiting")
    created_at: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    office_hours_id: Mapped[Optional[int]] = mapped_column(ForeignKey("office_hours.id"))
    overflow_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    late: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Ticket(Base):
    """One student's place in the queue."""

    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_name: Mapped[str] = mapped_column(String, nullable=False)
    class_section: Mapped[Optional[str]] = mapped_column(String)
    question: Mapped[str] = mapped_column(String, nullable=False)
    question_type: Mapped[str] = mapped_column(String, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="waiting")
    created_at: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    office_hours_id: Mapped[Optional[int]] = mapped_column(ForeignKey("office_hours.id"))
    bucket_id: Mapped[Optional[int]] = mapped_column(ForeignKey("buckets.id"))
    overflow_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    manually_changed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    late: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Syllabus(Base):
    __tablename__ = "syllabi"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    stored_path: Mapped[str] = mapped_column(String, nullable=False)
    uploaded_at: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
