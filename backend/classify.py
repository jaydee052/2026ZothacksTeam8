"""Picks a category for a question that starts a new group, using Gemini.

Students don't choose a category. A question that joins a group takes the
group's (see embeddings.py); one that starts a new group is classified here.
If AI is off (see llm.ai_enabled), or Gemini is slow or answers with something that isn't
a category, classify() returns None and the caller uses DEFAULT_CATEGORY.

Calls Gemini's REST API directly rather than through the google-genai package:
the package's interactions API kept retrying in testing and ignored the timeout,
which would leave a student waiting on the submit button.
"""
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import config
from llm import ai_enabled
from priority import CATEGORIES

URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# What each category means, for the model. Keys must match priority.CATEGORIES.
DESCRIPTIONS = {
    "quick_qa": "a short factual question about the course with a one-line answer "
                "(is the exam open notes, what's on the quiz, which version or tool to use)",
    "understanding_topic": "wants a concept, algorithm or piece of code explained, "
                           "or help debugging their own code",
    "grading": "about points lost, a score, a regrade, or how something was graded",
    "scheduling": "about when or where: dates, deadlines, extensions, rooms, or times",
    "research": "about research opportunities, joining a lab, or the professor's research",
    "personal": "about the student's own situation: advice, career, accommodations, "
                "or something they want to discuss privately",
}

PROMPT = """You sort student questions for a professor's office hours into one category.

Categories:
{categories}

Question: {question}

Reply with only the category id, exactly as written above."""


def classify(question):
    """The category id that fits the question best, or None if Gemini can't say."""
    if not ai_enabled() or not question:
        return None
    categories = "\n".join(f"- {key}: {DESCRIPTIONS[key]}" for key in CATEGORIES)
    body = json.dumps({
        "contents": [{"parts": [{"text": PROMPT.format(categories=categories, question=question)}]}],
        # One word back; little thinking needed, and less thinking answers faster.
        "generationConfig": {"thinkingConfig": {"thinkingLevel": "low"}},
    }).encode()
    request = Request(URL.format(model=config.CLASSIFY_MODEL), data=body, method="POST", headers={
        "Content-Type": "application/json",
        "x-goog-api-key": config.GEMINI_API_KEY,
    })
    try:
        with urlopen(request, timeout=config.AI_TIMEOUT_SECONDS) as response:
            parts = json.load(response)["candidates"][0]["content"]["parts"]
    except (HTTPError, URLError, TimeoutError, KeyError, IndexError, ValueError) as error:
        print(f"[classify] couldn't classify question: {error}")
        return None

    reply = "".join(p.get("text", "") for p in parts).strip().strip("`'\".").lower()
    if reply not in CATEGORIES:
        print(f"[classify] answer isn't a category: {reply!r}")
        return None
    return reply
