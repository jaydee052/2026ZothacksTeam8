"""How alike two student questions are, from 0 (nothing alike) to 1 (the same topic).

The score is the share of key words in the shorter question that also show up
in the other one. Filler words ("how", "the", "explain", "confused") are ignored,
since they describe how someone asks, not what they're asking about.

Two words count as a match if they're the same word in a different form
("cite" / "citing", "lose" / "lost"), one contains the other
("recursionerror" / "recursion"), or they're spelled almost the same (typos).
"""
import re
from difflib import SequenceMatcher

FILLER_WORDS = {
    # common small words
    "a", "an", "and", "are", "about", "am", "at", "be", "but", "can", "could", "did",
    "do", "does", "dont", "for", "from", "get", "go", "got", "have", "how", "i", "if",
    "im", "in", "is", "it", "its", "just", "me", "my", "not", "of", "on", "or", "so",
    "still", "that", "the", "this", "to", "was", "we", "what", "when", "where",
    "which", "who", "why", "will", "with", "would", "you", "your",
    # question-framing words
    "anyone", "ask", "clarify", "confused", "confusing", "explain", "help", "know",
    "mean", "please", "question", "really", "understand", "work", "works", "working",
}

ENDINGS = ("ing", "ed", "es", "s", "e")

# How alike two spellings must be to count as the same word (catches typos).
SPELLING_MATCH = 0.8

# Questions scoring at least this much are suggested to the student.
SUGGEST_THRESHOLD = 0.5


def _base(word):
    """Trim a simple ending so different forms of a word line up."""
    for ending in ENDINGS:
        if word.endswith(ending) and len(word) - len(ending) >= 3:
            return word[: -len(ending)]
    return word


def key_words(text):
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    return {_base(w) for w in words if w not in FILLER_WORDS}


def _words_match(a, b):
    if a == b:
        return True
    if min(len(a), len(b)) >= 4 and (a in b or b in a):
        return True
    return SequenceMatcher(None, a, b).ratio() >= SPELLING_MATCH


def similarity(a, b):
    words_a, words_b = key_words(a), key_words(b)
    if not words_a or not words_b:
        return 0.0
    shorter, longer = sorted((words_a, words_b), key=len)
    matched = sum(1 for word in shorter if any(_words_match(word, w) for w in longer))
    return round(matched / len(shorter), 2)
