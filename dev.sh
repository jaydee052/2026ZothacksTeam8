#!/usr/bin/env bash
# Start the backend and frontend together in one terminal.
#
#   ./dev.sh
#
# Backend:  http://localhost:5001   (check http://localhost:5001/api/health)
# Frontend: http://localhost:5173
# Press Ctrl+C once to stop both.
#
# The first run sets things up (Python packages, npm packages). Later runs
# reinstall only if requirements.txt or package.json changed, e.g. after a pull.

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
BACKEND_PORT=5001
FRONTEND_PORT=5173

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*"; exit 1; }

# --- Checks -----------------------------------------------------------------

command -v python3 >/dev/null || fail "python3 not found. Install Python 3 first."
command -v npm >/dev/null || fail "npm not found. Install Node.js first (e.g. brew install node)."

for port in $BACKEND_PORT $FRONTEND_PORT; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "Port $port is already in use (a server may already be running).
Stop it first, e.g.:  lsof -ti :$port | xargs kill"
  fi
done

# --- Backend setup ----------------------------------------------------------

if [ ! -x "$BACKEND/venv/bin/python" ]; then
  say "Creating the backend's Python environment (first run)..."
  python3 -m venv "$BACKEND/venv"
fi

# Reinstall Python packages only when requirements.txt changed.
STAMP="$BACKEND/venv/.requirements-installed"
if [ ! -f "$STAMP" ] || [ "$BACKEND/requirements.txt" -nt "$STAMP" ]; then
  say "Installing backend packages..."
  "$BACKEND/venv/bin/pip" install -q -r "$BACKEND/requirements.txt"
  touch "$STAMP"
fi

# Local settings (API keys). backend/.env is ignored by git.
if [ ! -f "$BACKEND/.env" ] && [ -f "$BACKEND/.env.example" ]; then
  cp "$BACKEND/.env.example" "$BACKEND/.env"
  say "Created backend/.env from the example. Add your ANTHROPIC_API_KEY there to use AI grouping."
fi

# --- Frontend setup ---------------------------------------------------------

if [ ! -d "$FRONTEND/node_modules" ] || [ "$FRONTEND/package.json" -nt "$FRONTEND/node_modules" ]; then
  say "Installing frontend packages..."
  (cd "$FRONTEND" && npm install --no-fund --no-audit)
  touch "$FRONTEND/node_modules"
fi

# --- Run both ---------------------------------------------------------------

# On Ctrl+C (or if either server stops), stop everything this script started.
cleanup() {
  trap - INT TERM EXIT
  echo
  say "Stopping backend and frontend..."
  kill -- -$$ 2>/dev/null || true
}
trap cleanup INT TERM EXIT

say "Starting backend on http://localhost:$BACKEND_PORT"
(cd "$BACKEND" && PYTHONUNBUFFERED=1 ./venv/bin/python app.py 2>&1 | sed -l 's/^/[backend]  /') &

say "Starting frontend on http://localhost:$FRONTEND_PORT"
(cd "$FRONTEND" && npm run dev -- --port "$FRONTEND_PORT" --strictPort 2>&1 | sed -l 's/^/[frontend] /') &

say "Both running. Press Ctrl+C to stop."

# Wait until either one exits (or Ctrl+C), then clean up both.
wait -n 2>/dev/null || wait
