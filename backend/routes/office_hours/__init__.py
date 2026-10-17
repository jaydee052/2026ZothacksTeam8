# Office hours endpoints: scheduling sessions and closing them out.
# Each endpoint lives in its own file and attaches to this shared blueprint.
from flask import Blueprint

bp = Blueprint("office_hours", __name__, url_prefix="/api/office_hours")

from . import (  # noqa: E402,F401  (registers the routes)
    close_office_hours,
    create_office_hours,
    delete_office_hours,
    list_office_hours,
    open_office_hours,
    update_office_hours,
)
