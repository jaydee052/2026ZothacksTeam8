from db import QUESTION_TYPES


def score_question(question_type, question_text=""):
    """
    Must-have: ranking by question type.
    Nice-to-have hook: bump similar/keyword-heavy exam questions later.
    """
    base = QUESTION_TYPES.get(question_type, QUESTION_TYPES["other"])
    text = (question_text or "").lower()
    if "exam" in text or "midterm" in text or "final" in text:
        base += 10
    return base
