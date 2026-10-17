# Professor endpoints: a professor's profile and classes from the Anteater API.
# Each endpoint lives in its own file and attaches to this shared blueprint.
from flask import Blueprint

bp = Blueprint("professors", __name__, url_prefix="/api/professors")

from . import add_professor, get_professor  # noqa: E402,F401  (registers the routes)
