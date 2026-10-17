import os
from flask import Flask
from flask_cors import CORS

from db import init_db
from routes import (
    buckets, categories, office_hours, professors, queue, queue_ticket, students, syllabus,
)

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.config["UPLOAD_DIR"] = UPLOAD_DIR

init_db()

app.register_blueprint(queue.bp)
app.register_blueprint(queue_ticket.bp)
app.register_blueprint(office_hours.bp)
app.register_blueprint(syllabus.bp)
app.register_blueprint(buckets.bp)
app.register_blueprint(categories.bp)
app.register_blueprint(students.bp)
app.register_blueprint(professors.bp)


@app.get("/api/health")
def health():
    return {"ok": True}


if __name__ == "__main__":
    app.run(port=5001, debug=True)
