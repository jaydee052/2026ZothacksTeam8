"""Time-block planning for the main line. See "Time-Block Planning" in spec.md.

Instead of one ranked list, the line is planned in blocks of BLOCK_MINUTES.
Each block is filled like this:
  1. Long questions, highest score first, up to MAX_LONG_PER_BLOCK, as long
     as they fit. A long question always fits in an empty block, so one that's
     longer than a block still gets a block of its own.
  2. Short questions, highest score first, each one that still fits.
  3. Leftover time: anything else that still fits, so no time sits idle.
Then the next block, until everyone is planned.

Planning works on groups: a group of students with the same question takes one
slot, timed as one explanation. The plan is redone on every request, so it
always starts from "now" and reflects who's still waiting.
"""
from priority import CATEGORIES, FALLBACK_CATEGORY

# Length of each block, in minutes.
BLOCK_MINUTES = 15

# At most this many long questions in one block.
MAX_LONG_PER_BLOCK = 2

# Categories that count as long questions. Everything else is short.
LONG_CATEGORIES = {"understanding_topic", "research", "personal"}


def minutes_for(category):
    """Estimated minutes for one explanation of a question in this category."""
    return CATEGORIES.get(category, CATEGORIES[FALLBACK_CATEGORY])["base_time"]


def is_long(category):
    return category in LONG_CATEGORIES


def plan_blocks(groups):
    """Split groups into blocks.

    groups: list of dicts with "minutes", "long" and "score", already in score
            order (highest first, ties already broken).
    Returns a list of blocks, each a list of groups in the order they'll be helped
    (long questions first, then short ones).
    """
    waiting = list(groups)
    blocks = []
    while waiting:
        block, time_left, longs = [], BLOCK_MINUTES, 0

        def add(group):
            nonlocal time_left
            block.append(group)
            time_left -= group["minutes"]
            waiting.remove(group)

        # 1. Long questions, highest score first, up to the limit.
        for group in list(waiting):
            if longs == MAX_LONG_PER_BLOCK:
                break
            if group["long"] and (group["minutes"] <= time_left or not block):
                add(group)
                longs += 1

        # 2. Short questions, highest score first, each one that still fits.
        for group in list(waiting):
            if not group["long"] and group["minutes"] <= time_left:
                add(group)

        # 3. Leftover time: anything else that still fits (e.g. a third long
        #    question when no short ones are waiting).
        for group in list(waiting):
            if group["minutes"] <= time_left:
                add(group)

        # A block can't stay empty (only possible if a short question were
        # longer than a block); take the next one in score order.
        if not block:
            add(waiting[0])

        blocks.append(block)
    return blocks
