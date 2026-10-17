"""Measure how well similar-question matching does on the labeled cases.

    cd backend
    python tests/check_similarity.py          # summary + every wrong answer
    python tests/check_similarity.py --all    # also show every case

"Missed" = should have been suggested but wasn't (students end up in separate groups).
"Wrong match" = suggested a different question (worse: students join the wrong group).

Exits with an error only if there are wrong matches, since those are the harmful kind.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from similarity import SUGGEST_THRESHOLD, similarity  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from similarity_cases import CASES  # noqa: E402


def main():
    show_all = "--all" in sys.argv
    missed, wrong = [], []
    for a, b, same in CASES:
        value = similarity(a, b)
        matched = value >= SUGGEST_THRESHOLD
        if same and not matched:
            missed.append((value, a, b))
        elif not same and matched:
            wrong.append((value, a, b))
        if show_all:
            mark = "ok " if matched == same else "BAD"
            print(f"{mark} {value:.2f} {'same' if same else 'diff'} | {a}  <->  {b}")

    total = len(CASES)
    same_total = sum(1 for case in CASES if case[2])
    print(f"\nCutoff: {SUGGEST_THRESHOLD}")
    print(f"Correct: {total - len(missed) - len(wrong)}/{total}")
    print(f"Missed (same question, not suggested): {len(missed)}/{same_total}")
    print(f"Wrong match (different question, suggested): {len(wrong)}/{total - same_total}")
    for title, rows in (("Missed", missed), ("Wrong match", wrong)):
        if rows:
            print(f"\n{title}:")
            for value, a, b in sorted(rows):
                print(f"  {value:.2f} | {a}  <->  {b}")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
