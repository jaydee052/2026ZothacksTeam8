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


# Each extra student in a bucket moves it up the queue by this much.
BUCKET_SIZE_BONUS = 5


def bucket_priority(base_priority, member_count):
    """Category score plus a bonus for every student beyond the first."""
    return base_priority + BUCKET_SIZE_BONUS * max(member_count - 1, 0)
