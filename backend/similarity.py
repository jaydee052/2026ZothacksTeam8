"""How alike two student questions are, from 0 (different) to 1 (the same question).

Used to suggest an existing group to a student ("Maybe this helps first").
Tuned against the labeled pairs in tests/similarity_cases.py; check changes with
    python tests/check_similarity.py

How two questions are compared, in order:
  1. Different assignment, exam, part or question number   -> different
     ("assignment 3" vs "assignment 4", "part A" vs "part B", "q4" vs "q5")
  2. Same thing, but a different kind of ask               -> different
     ("when is project 2 due?" vs "can I get an extension on project 2?")
  3. Different error, or a different computer              -> different
     (FileNotFoundError vs ModuleNotFoundError, Mac vs Windows)
  4. Otherwise, compare key words both ways. Filler words are ignored, generic
     words ("code", "python", "project") count less, and abbreviations,
     synonyms and typos are recognized ("hw" = "homework", "dict" = "dictionary",
     "recurson" = "recursion").
  5. Both mention the same specific error                  -> at least SAME_ERROR_FLOOR
"""
import re
from difflib import SequenceMatcher

# Questions scoring at least this much are suggested to the student.
SUGGEST_THRESHOLD = 0.55
# (Same-question pairs in the tests score 0.58 or more; different ones 0.47 or less.)

# Two questions about the same specific error (e.g. both KeyError) score at least this.
SAME_ERROR_FLOOR = 0.6

# Generic words count this much instead of 1.
GENERIC_WEIGHT = 0.3

# Assignment/exam names like "project 2" count this much: they say what the
# question is about, but not what's being asked.
REFERENCE_WEIGHT = 0.5

# How alike two spellings must be to count as the same word (catches typos).
SPELLING_MATCH = 0.8

# Words that describe how someone asks, not what they're asking about.
FILLER_WORDS = {
    "a", "about", "after", "am", "an", "and", "any", "anyone", "are", "as", "ask", "at",
    "be", "but", "by", "can", "cant", "clarify", "confused", "confusing", "could", "did",
    "difference", "diff", "do", "does", "doesnt", "dont", "even", "every", "everything",
    "explain", "for", "from", "get", "gets", "getting", "go", "goes", "going", "got", "have",
    "help", "how", "i", "idk", "if", "im", "in", "inside", "instead", "is", "it", "its",
    "just", "keep", "keeps", "know", "make", "making", "create", "creating", "setup", "me", "mean", "my", "need", "not", "of", "on",
    "or", "other", "over", "please", "pls", "plz", "question", "really", "says", "should",
    "so", "soon", "still", "stuck", "supposed", "sure", "than", "that", "the", "there",
    "think", "this", "though", "through", "time", "to", "up", "us", "use", "using", "versus",
    "vs", "was", "wats", "we", "were", "what", "whats", "when", "where", "which", "who",
    "why", "will", "with", "work", "working", "works", "would", "you", "your",
}

# Words that appear in lots of unrelated questions, so they count less.
GENERIC_WORDS = {
    "assignment", "class", "code", "error", "exam", "found", "function", "homework",
    "line", "method", "object", "program", "project", "python", "quarter", "run", "statement",
}

# Phrases rewritten before anything else, so different wordings line up.
# (pattern, replacement), applied in order to lowercased text.
PHRASES = [
    # error names written out in words
    (r"\bfile ?not ?found\b|\bcan'?t find (my |the )?file\b", " filenotfounderror "),
    (r"\bmodule ?not ?found\b|\bno module named\b", " modulenotfounderror "),
    (r"\bindex out of range\b", " indexerror "),
    (r"\bmax(imum)? recursion depth\b", " recursionerror "),
    (r"\bconnection refused\b", " connectionrefused "),
    # loops and recursion that never end
    (r"\bnever (stops?|ends?|finish(es)?|returns?)\b|\bforever\b|\bdoesn'?t stop\b|"
     r"\binfinite\b|\bhang(s|ing)?\b", " infinite "),
    # other common phrasings
    (r"\bextra time\b|\bmore time\b|\bturn (it )?in late\b", " extension "),
    (r"\bcommand ?line arg(ument)?s?\b|\bsys ?\. ?argv\b|\bargv\b", " argv "),
    (r"\blists? of lists\b|\b2d lists?\b|\bnested lists?\b", " matrix "),  # no "list" inside, on purpose
    (r"\bbig ?o\b|\btime complexity\b|\bruntime\b|\befficien(t|cy)\b", " complexity "),
    (r"\bwhere is\b|\bwhere's\b|\bwheres\b|\bwhat room\b|\blocation\b", " place "),
    (r"\bwhats? on\b|\bwhat is on\b|\bwhat will be on\b", " study "),
    # common shorthand
    (r"\bf[- ]?strings?\b", " fstring "),
    (r"\bunit ?tests?\b|\bunittest\b", " unit test "),
    (r"\bvirtual ?env(ironment)?s?\b|\bvirtualenv\b|\bvenv\b", " venv "),
    (r"\bturn(ed|ing)? in\b|\bupload\b", " submit "),
    (r"\bwant us to do\b|\basking us\b|\brequirements?\b|\bspecs?\b|\binstructions\b", " requirement "),
    (r"\bwhat (day|time|date)\b|\bwhen is\b|\bwhen's\b|\bwhen are\b", " schedule "),
    (r"\bset ?up\b", " setup "),
    (r"==", " equalsop "),
]

# Single-word synonyms and abbreviations: word -> the word it should count as.
SYNONYMS = {
    "hw": "homework", "hws": "homework", "proj": "project", "assign": "assignment",
    "dict": "dictionary", "dicts": "dictionary", "recv": "receive", "txt": "text",
    "github": "git", "macbook": "mac", "macos": "mac", "osx": "mac", "win": "windows",
    "lost": "lose", "losing": "lose", "deducted": "lose", "pts": "points",
    "deadline": "due", "extend": "extension", "late": "extension",
    "regrade": "grade", "graded": "grade", "grading": "grade", "grades": "grade", "score": "grade",
    "written": "write", "wrote": "write", "change": "switch", "modify": "switch",
    "parameter": "argument", "parameters": "argument", "param": "argument", "args": "argument",
    "discussion": "lab", "dis": "lab", "iterate": "loop", "iterating": "loop", "iteration": "loop",
    "appear": "show", "appearing": "show", "showing": "show", "nothing": "empty", "blank": "empty",
    "attribute": "variable", "attributes": "variable", "attr": "variable", "var": "variable",
    "calculated": "weight", "calculate": "weight", "breakdown": "weight", "weights": "weight",
    "percent": "weight", "cumulative": "cover", "topics": "study", "material": "study",
    "crashing": "crash", "crashes": "crash", "freezing": "freeze", "freezes": "freeze",
}

# Kinds of ask. Two questions with different kinds of ask aren't the same question.
ASK_KINDS = {
    "schedule": "when", "due": "when",
    "extension": "extension",
    "grade": "grading", "lose": "grading", "points": "grading",
    "submit": "submit", "submission": "submit",
    "requirement": "requirement",
    "study": "study", "cover": "study",
    "place": "place",
}

# Things that can't both be true: different values mean different questions.
COMPUTERS = {"mac", "windows", "linux", "chromebook"}

# "project 2", "hw3", "q4", "part B", "the midterm" ...
REFERENCE = re.compile(
    r"\b(?P<kind>project|proj|p|assignment|assign|hw|homework|lab|quiz|exercise|ex|"
    r"question|q|problem|prob|part)\s*#?\s*(?P<id>\d+[a-z]?|(?<=part )[a-z]\b|(?<=part)[a-z]\b)"
)
REFERENCE_KINDS = {
    "proj": "project", "p": "project", "assign": "assignment", "hw": "homework",
    "ex": "exercise", "q": "question", "prob": "problem",
}
# Which reference kinds name the piece of work, and which name a part of it.
WORK_KINDS = {"project", "assignment", "homework", "lab", "quiz", "exercise", "exam"}
EXAMS = re.compile(r"\b(midterm|final)(?! (grade|project|answer|version|code|submission))\b")

ENDINGS = ("ation", "ance", "ion", "ive", "ing", "ed", "ly", "e")


def _base(word):
    """Trim plural and simple endings so different forms of a word line up
    ("recursion" / "recursive", "citing" / "cite")."""
    if len(word) > 4 and word.endswith("es") and not word.endswith("ses"):
        word = word[:-2]
    elif len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        word = word[:-1]
    for ending in ENDINGS:
        if word.endswith(ending) and len(word) - len(ending) >= 3:
            return word[: -len(ending)]
    return word


class _Question:
    """A question broken into the parts the comparison needs."""

    def __init__(self, text):
        raw = (text or "").replace("'", "")
        # Error names as written: "FileNotFoundError" -> "filenotfounderror"
        self.errors = {e.lower() for e in re.findall(r"\b[A-Za-z]*Error\b", raw)}

        # Lowercase, splitting CamelCase ("RecursionError" -> "recursion error"),
        # then rewrite common phrases so different wordings line up.
        text = " " + re.sub(r"([a-z])([A-Z])", r"\1 \2", raw).lower() + " "
        for pattern, replacement in PHRASES:
            text = re.sub(pattern, replacement, text)
        # Error names written out in words ("file not found") became names above.
        self.errors |= set(re.findall(r"\b([a-z]+error)\b", text))

        # Assignment, exam and part references: "project 2", "hw3", "part B".
        self.work, self.parts = set(), set()
        for match in REFERENCE.finditer(text):
            kind = REFERENCE_KINDS.get(match["kind"], match["kind"])
            (self.work if kind in WORK_KINDS else self.parts).add((kind, match["id"]))
        for exam in EXAMS.finditer(text):
            self.work.add(("exam", exam.group(1)))
        text = REFERENCE.sub(" ", text)

        # Key words, after synonyms, without filler.
        words = []
        for word in re.findall(r"[a-z0-9]+", text):
            word = SYNONYMS.get(word, word)
            if word not in FILLER_WORDS and len(word) >= 2 and not word.isdigit():
                words.append(word)

        self.computers = {w for w in words if w in COMPUTERS}
        self.asks = {ASK_KINDS[w] for w in words if w in ASK_KINDS}
        self.asks |= {ASK_KINDS[_base(w)] for w in words if _base(w) in ASK_KINDS}

        # Each key word (in its trimmed form) and how much it counts.
        self.weights = {}
        for word in words:
            weight = GENERIC_WEIGHT if word in GENERIC_WORDS else 1.0
            base = _base(word)
            self.weights[base] = max(weight, self.weights.get(base, 0))
        for kind, ref_id in self.work | self.parts:
            self.weights[f"{kind}#{ref_id}"] = REFERENCE_WEIGHT


def _words_match(a, b):
    if a == b:
        return True
    if "#" in a or "#" in b:
        return False  # "project#2" only matches itself
    if min(len(a), len(b)) >= 4 and (a in b or b in a):
        return True  # "recursion" / "recursionerror"
    if min(len(a), len(b)) >= 3 and (a.startswith(b) or b.startswith(a)):
        return True  # "fil" (file) / "filenotfounderror"
    return min(len(a), len(b)) >= 4 and SequenceMatcher(None, a, b).ratio() >= SPELLING_MATCH


def _coverage(mine, theirs):
    """Share of one question's key words (by weight) that the other also has."""
    total = sum(mine.values())
    if not total:
        return 0.0
    found = sum(w for word, w in mine.items() if any(_words_match(word, o) for o in theirs))
    return found / total


def _numbers_differ(refs_a, refs_b):
    """True if both mention the same kind of thing with a different number,
    e.g. assignment 3 vs assignment 4, or part A vs part B."""
    for kind in {k for k, _ in refs_a} & {k for k, _ in refs_b}:
        ids_a = {i for k, i in refs_a if k == kind}
        ids_b = {i for k, i in refs_b if k == kind}
        if ids_a.isdisjoint(ids_b):
            return True
    return False


def _conflict(a, b):
    """True if the questions are about different things that can't both be meant."""
    if _numbers_differ(a.work, b.work) or _numbers_differ(a.parts, b.parts):
        return True  # assignment 3 vs assignment 4, part A vs part B
    checks = (
        (a.work, b.work),            # project 2 vs the midterm
        (a.asks, b.asks),            # "when is it due" vs "can I get an extension"
        (a.errors, b.errors),        # IndexError vs KeyError
        (a.computers, b.computers),  # Mac vs Windows
    )
    return any(x and y and x.isdisjoint(y) for x, y in checks)


def similarity(a, b):
    qa, qb = _Question(a), _Question(b)
    if not qa.weights or not qb.weights or _conflict(qa, qb):
        return 0.0
    value = (_coverage(qa.weights, qb.weights) + _coverage(qb.weights, qa.weights)) / 2
    if qa.errors & qb.errors:
        value = max(value, SAME_ERROR_FLOOR)
    return round(value, 2)
