"""Groups questions by meaning, using Google's Gemini embedding model.

A new question is turned into a vector (a list of numbers describing what it
means). Each bucket keeps the vector of the question that started it. The new
question joins the closest open bucket if they're alike enough
(JOIN_THRESHOLD), and otherwise starts a bucket of its own.

Needs GEMINI_API_KEY, set in the environment or in backend/.env. Without it,
or if Google can't be reached, embed() returns None and every question gets
its own bucket, the same as before.
"""
import json
import math
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from sqlalchemy import select

from models import Bucket
from similarity import conflicts

MODEL = "gemini-embedding-001"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:embedContent"
TIMEOUT_SECONDS = 5
# Shorter vectors are cheaper to store and compare, and nearly as accurate.
DIMENSIONS = 768

# A question joins a bucket when their vectors are at least this alike
# (cosine similarity, from -1 to 1). Higher means stricter grouping.
# Measured: rewordings of one question score about 0.79-0.97, but "how does
# recursion work" vs "how do linked lists work" scores 0.83. Wrongly merging
# two questions is worse than missing a match, so this sits above that.
JOIN_THRESHOLD = 0.88

ENV_FILE = Path(__file__).parent / ".env"


def _api_key():
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"]
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            key, _, value = line.partition("=")
            if key.strip() == "GEMINI_API_KEY":
                return value.strip().strip("\"'")
    return None


def embed(text):
    """The question's vector, or None if the embedding model can't be used."""
    key = _api_key()
    if not key or not text:
        return None
    body = json.dumps({
        "model": f"models/{MODEL}",
        "content": {"parts": [{"text": text}]},
        "taskType": "SEMANTIC_SIMILARITY",
        "outputDimensionality": DIMENSIONS,
    }).encode()
    request = Request(URL, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "x-goog-api-key": key,
    })
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return json.load(response)["embedding"]["values"]
    except (HTTPError, URLError, TimeoutError, KeyError, ValueError) as error:
        print(f"[embeddings] couldn't embed question: {error}")
        return None


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    size = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / size if size else 0.0


def closest_bucket(db, question, vector, question_type, office_hours_id):
    """The open bucket in this session and category most like the question,
    with its similarity, or (None, 0) if none reaches JOIN_THRESHOLD."""
    buckets = db.scalars(select(Bucket).where(
        Bucket.status == "waiting",
        Bucket.question_type == question_type,
        Bucket.office_hours_id == office_hours_id,
    )).all()

    best, best_match = None, 0.0
    for bucket in buckets:
        # Embeddings rate "assignment 3" and "assignment 4" as nearly the same,
        # so the rule-based checks get a veto.
        if conflicts(question, bucket.title):
            continue
        if bucket.embedding is None:
            # Buckets from before embeddings: embed their question once and keep it.
            bucket_vector = embed(bucket.title)
            if bucket_vector is None:
                continue
            bucket.embedding = json.dumps(bucket_vector)
        else:
            bucket_vector = json.loads(bucket.embedding)
        match = cosine(vector, bucket_vector)
        if match > best_match:
            best, best_match = bucket, match

    if best_match < JOIN_THRESHOLD:
        return None, 0.0
    return best, round(best_match, 3)
