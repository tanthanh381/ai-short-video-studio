#!/bin/zsh
set -euo pipefail
LOCAL_AI_ROOT=${LOCAL_AI_ROOT:-"$HOME/Developer/local-ai"}
OMNIVOICE_PYTHON=${OMNIVOICE_PYTHON:-"$LOCAL_AI_ROOT/omnivoice-venv312/bin/python"}
OMNIVOICE_MODEL=${OMNIVOICE_MODEL:-"$LOCAL_AI_ROOT/models/omnivoice"}
export LOCAL_AI_ROOT OMNIVOICE_MODEL
cd "$LOCAL_AI_ROOT"
exec "$OMNIVOICE_PYTHON" -m uvicorn omnivoice_api:app --host 127.0.0.1 --port "${OMNIVOICE_PORT:-5010}"
