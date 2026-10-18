"""App settings, read from environment variables and backend/.env.

Copy backend/.env.example to backend/.env and fill it in. backend/.env is
ignored by git, so API keys never get committed.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

# Values already set in the environment win over the .env file.
load_dotenv(Path(__file__).parent / ".env", override=False)


def _flag(name, default="0"):
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


# Gemini (AI grouping and group summaries)
USE_AI_GROUPING = _flag("USE_AI_GROUPING")
# gemini-3.5-flash answered in about 1 second in testing (gemini-3.8-flash timed out).
AI_MODEL = os.environ.get("AI_MODEL", "gemini-3.5-flash").strip()
# Picking one of six categories doesn't need the bigger model. Lite answered in
# about 0.5 seconds, and has its own rate limit, separate from AI_MODEL's.
CLASSIFY_MODEL = os.environ.get("CLASSIFY_MODEL", "gemini-3.5-flash-lite").strip()
AI_TIMEOUT_SECONDS = float(os.environ.get("AI_TIMEOUT_SECONDS", "5"))
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip().strip("\"'")
HAS_API_KEY = bool(GEMINI_API_KEY)
