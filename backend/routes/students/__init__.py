# Student endpoints: a student's classes, looked up from the Anteater API.
# Each endpoint lives in its own file and attaches to this shared blueprint.
from flask import Blueprint

bp = Blueprint("students", __name__, url_prefix="/api/students")

from . import add_section, list_sections  # noqa: E402,F401  (registers the routes)
