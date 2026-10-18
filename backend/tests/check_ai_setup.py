"""Check that your Gemini API key works, with one tiny request.

    cd backend
    python tests/check_ai_setup.py

Reads the key from backend/.env (see backend/.env.example). Never prints the key.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from google.genai import errors  # noqa: E402

import config  # noqa: E402
from llm import ai_status, get_client  # noqa: E402


def main():
    print(f"AI grouping: {ai_status()}")
    if not config.HAS_API_KEY:
        print("\nNo key found. Copy backend/.env.example to backend/.env and set GEMINI_API_KEY.")
        return 1

    try:
        interaction = get_client().interactions.create(
            model=config.AI_MODEL,
            input="Reply with just: OK",
            # Leave room: Gemini thinks before answering, and thinking counts toward this limit.
            generation_config={"thinking_level": "low", "max_output_tokens": 1024},
            timeout=30,
        )
    except errors.ClientError as error:
        if error.code in (400, 401, 403):
            print(f"\nThe key was rejected ({error.code}): {error.message}")
            print("Check GEMINI_API_KEY in backend/.env. Keys come from https://aistudio.google.com/apikey")
        elif error.code == 404:
            print(f"\nModel {config.AI_MODEL!r} wasn't found. Check AI_MODEL in backend/.env.")
        elif error.code == 429:
            print("\nRate limited or out of quota. Check your plan in Google AI Studio.")
        else:
            print(f"\nGemini returned an error ({error.code}): {error.message}")
        return 1
    except errors.APIError as error:
        print(f"\nGemini had a problem ({error.code}): {error.message}. Try again in a minute.")
        return 1
    except Exception as error:  # timeouts and network errors use the package's own types
        if "Timeout" in type(error).__name__:
            print(f"\n{config.AI_MODEL} didn't answer within 30 seconds. It may be overloaded;")
            print("try again, or set AI_MODEL=gemini-3.5-flash-lite in backend/.env.")
        else:
            print(f"\nCouldn't reach Gemini ({type(error).__name__}). Check your internet connection.")
        return 1

    if interaction.status != "completed":
        print(f"\nThe key works, but the answer didn't finish (status: {interaction.status}).")
        return 1
    reply = (interaction.output_text or "").strip()
    print(f"\nKey works. {config.AI_MODEL} replied: {reply!r}")
    usage = interaction.usage
    if usage is not None:
        print(f"Tokens used: {usage.total_input_tokens} in, {usage.total_output_tokens} out")
    if not config.USE_AI_GROUPING:
        print("Set USE_AI_GROUPING=1 in backend/.env to turn AI grouping on.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
