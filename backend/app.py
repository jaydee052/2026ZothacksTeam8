import os
from flask import Flask, request
from flask_cors import CORS

from db import get_db, init_db
from overflow import close_expired_sessions
from routes import (
    buckets,
    categories,
    office_hours,
    professors,
    queue,
    queue_leave,
    queue_pin,
    queue_ticket,
    students,
    syllabus,
)

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.config["UPLOAD_DIR"] = UPLOAD_DIR

init_db()

app.register_blueprint(queue.bp)
app.register_blueprint(queue_ticket.bp)
app.register_blueprint(queue_leave.bp)
app.register_blueprint(queue_pin.bp)
app.register_blueprint(office_hours.bp)
app.register_blueprint(syllabus.bp)
app.register_blueprint(buckets.bp)
app.register_blueprint(categories.bp)
app.register_blueprint(students.bp)
app.register_blueprint(professors.bp)


@app.before_request
def auto_close_finished_sessions():
    """Before handling a request, close any session that ended a while ago
    (see AUTO_CLOSE_AFTER in overflow.py), so the line is never stale."""
    if request.path.startswith("/api/") and request.path != "/api/health":
        with get_db() as db:
            if close_expired_sessions(db):
                db.commit()


@app.get("/api/health")
def health():
    return {"ok": True}


if __name__ == "__main__":
    app.run(port=5001, debug=True)
