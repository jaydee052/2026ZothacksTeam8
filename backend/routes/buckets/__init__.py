# Bucket endpoints: groups of similar questions students can join.
# Each endpoint lives in its own file and attaches to this shared blueprint.
from flask import Blueprint

bp = Blueprint("buckets", __name__, url_prefix="/api/buckets")

from . import join_bucket, list_buckets  # noqa: E402,F401  (registers the routes)
