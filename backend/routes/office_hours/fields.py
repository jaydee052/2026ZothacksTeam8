"""Shared checks for office hours details (used by create and update)."""
from validation import clean, parse_time

TEXT_FIELDS = ("course", "location")
TIME_FIELDS = ("starts_at", "ends_at")


def read_fields(data, current=None):
    """Pull office hours fields out of a request body.

    current: the existing session when updating; None when creating.
    Returns (fields, error). fields holds only what the request changed.
    """
    fields = {}

    for key in TEXT_FIELDS:
        if key in data:
            fields[key] = clean(data[key])
            if not fields[key]:
                return None, f"{key} cannot be empty"

    for key in TIME_FIELDS:
        if key in data:
            fields[key] = parse_time(data[key])
            if fields[key] is None:
                return None, f"{key} must be a time like 2026-10-17T14:00"

    # Combine with what's already saved, so a partial update is checked as a whole.
    merged = {**(current or {}), **fields}

    if current is None:
        missing = [key for key in TEXT_FIELDS + TIME_FIELDS if not merged.get(key)]
        if missing:
            return None, "missing: " + ", ".join(missing)

    if merged["ends_at"] <= merged["starts_at"]:
        return None, "ends_at must be after starts_at"

    return fields, None


def session_to_dict(row):
    """A session as JSON, with is_open as true/false instead of 1/0."""
    if row is None:
        return None
    session = dict(row)
    session["is_open"] = bool(session["is_open"])
    return session
