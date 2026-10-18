"""The one place the backend connects to Google's Gemini API.

Everything AI-related goes through get_client(). If AI is switched off or no
API key is set, ai_enabled() is False and callers use the rule-based matching
instead, so the app always works without a key.

Settings are in config.py (from backend/.env).
"""
from google import genai

import config

_client = None


def ai_enabled():
    """True when AI grouping is switched on and an API key is available."""
    return config.USE_AI_GROUPING and config.HAS_API_KEY


def ai_status():
    """Why AI is on or off, for /api/health (never includes the key)."""
    if not config.USE_AI_GROUPING:
        return "off (USE_AI_GROUPING is not 1)"
    if not config.HAS_API_KEY:
        return "off (no GEMINI_API_KEY in backend/.env)"
    return f"on ({config.AI_MODEL})"


def get_client():
    """A shared Gemini client, using GEMINI_API_KEY from backend/.env.

    The key is passed in directly, so a GOOGLE_API_KEY elsewhere in the
    environment can't override it. AI checks happen while a student waits, so
    each request has a short timeout (passed per request, in seconds) and the
    caller falls back to the rules if Gemini is slow.
    """
    global _client
    if _client is None:
        _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client
