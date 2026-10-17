"""GET /api/categories — the question categories, for the student form's dropdown."""
from flask import Blueprint, jsonify

from priority import CATEGORIES

bp = Blueprint("categories", __name__, url_prefix="/api/categories")


@bp.get("")
def list_categories():
    return jsonify([{"id": key, **info} for key, info in CATEGORIES.items()])
