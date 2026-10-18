"""Groups questions by meaning, using Google's Gemini embedding model.

Every question is turned into a vector (a list of numbers describing what it
means) and saved on the student's ticket. A new question is compared to every
waiting student's question in the session, whatever their category. It joins
the bucket of the closest one if they're alike enough (JOIN_THRESHOLD), and
otherwise starts a bucket of its own.

Needs GEMINI_API_KEY and USE_AI_GROUPING=1 in backend/.env (see config.py).
Without them, or if Google can't be reached, embed() returns None and every
question gets its own bucket, the same as before.
"""
import json
import math
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from sqlalchemy import select

import config
from llm import ai_enabled
from models import Bucket, Ticket
from similarity import conflicts

MODEL = "gemini-embedding-001"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:batchEmbedContents"
TIMEOUT_SECONDS = 5
# Shorter vectors are cheaper to store and compare, and nearly as accurate.
DIMENSIONS = 768

# A question joins a bucket when their vectors are at least this alike
# (cosine similarity, from -1 to 1). Higher means stricter grouping.
# Measured: rewordings of one question score about 0.79-0.97, but "how does
# recursion work" vs "how do linked lists work" scores 0.83. Wrongly merging
# two questions is worse than missing a match, so this sits above that.
JOIN_THRESHOLD = 0.88


def embed_many(texts):
    """A vector for each text, in one request, or None if the model can't be used."""
    if not ai_enabled() or not texts:
        return None
    body = json.dumps({"requests": [{
        "model": f"models/{MODEL}",
        "content": {"parts": [{"text": text}]},
        "taskType": "SEMANTIC_SIMILARITY",
        "outputDimensionality": DIMENSIONS,
    } for text in texts]}).encode()
    request = Request(URL, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "x-goog-api-key": config.GEMINI_API_KEY,
    })
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return [e["values"] for e in json.load(response)["embeddings"]]
    except (HTTPError, URLError, TimeoutError, KeyError, ValueError) as error:
        print(f"[embeddings] couldn't embed questions: {error}")
        return None


def embed(text):
    """The question's vector, or None if the embedding model can't be used."""
    vectors = embed_many([text]) if text else None
    return vectors[0] if vectors else None


def to_json(vector):
    """How a vector is stored in the database."""
    return json.dumps(vector) if vector else None


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    size = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / size if size else 0.0


def closest_bucket(db, question, vector, office_hours_id):
    """The open bucket in this session with the question most like this one,
    with their similarity, or (None, 0) if none reaches JOIN_THRESHOLD.

    Every waiting student's question counts, not just the one that started the
    bucket, so a group can be found by any of the ways it's been asked.
    """
    buckets = {b.id: b for b in db.scalars(select(Bucket).where(
        Bucket.status == "waiting", Bucket.office_hours_id == office_hours_id
    ))}
    tickets = db.scalars(select(Ticket).where(
        Ticket.bucket_id.in_(buckets), Ticket.status == "waiting"
    )).all() if buckets else []
    _fill_missing_embeddings(tickets)

    asked = {bucket_id: [bucket.title] for bucket_id, bucket in buckets.items()}
    for ticket in tickets:
        asked[ticket.bucket_id].append(ticket.question)

    best, best_match = None, 0.0
    for ticket in tickets:
        # Embeddings rate "assignment 3" and "assignment 4" as nearly the same,
        # so the rule-based checks get a veto, against everyone in the bucket:
        # otherwise both could join a bucket that started as "the last homework".
        if ticket.embedding is None or any(
            conflicts(question, other) for other in asked[ticket.bucket_id]
        ):
            continue
        match = cosine(vector, json.loads(ticket.embedding))
        if match > best_match:
            best, best_match = buckets[ticket.bucket_id], match

    if best_match < JOIN_THRESHOLD:
        return None, 0.0
    return best, round(best_match, 3)


def _fill_missing_embeddings(tickets):
    """Tickets from before embeddings (and the sample questions) get their
    vectors here, all in one request, and keep them."""
    missing = [t for t in tickets if t.embedding is None]
    vectors = embed_many([t.question for t in missing]) if missing else None
    for ticket, vector in zip(missing, vectors or []):
        ticket.embedding = to_json(vector)
