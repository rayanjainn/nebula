#!/bin/bash
# Nebula Enhanced — start all services

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Resolve the right Python / uvicorn — prefer pyenv 3.10 where torch is installed
PYTHON="${PYENV_ROOT:-$HOME/.pyenv}/versions/3.10.13/bin/python3"
UVICORN="${PYENV_ROOT:-$HOME/.pyenv}/versions/3.10.13/bin/uvicorn"

# Fallback: find whichever python3 has torch
if [ ! -f "$UVICORN" ]; then
  UVICORN="$(command -v uvicorn 2>/dev/null || echo uvicorn)"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Nebula Enhanced — Starting Services"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Python: $PYTHON"

# Start FastAPI backend
echo "→ Starting FastAPI backend on :8000"
"$UVICORN" dashboard.api:app --host 0.0.0.0 --port 8000 --reload &
API_PID=$!
echo "  API PID: $API_PID"

# Wait for API to start
sleep 2

# Start Next.js frontend
echo "→ Starting Next.js frontend on :3000"
cd frontend
npm run dev &
FRONTEND_PID=$!
echo "  Frontend PID: $FRONTEND_PID"
cd ..

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Dashboard: http://localhost:3000"
echo "  API:       http://localhost:8000"
echo "  API Docs:  http://localhost:8000/docs"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for Ctrl+C
trap "kill $API_PID $FRONTEND_PID 2>/dev/null; echo 'Stopped.'; exit 0" INT
wait
