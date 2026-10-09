#!/usr/bin/env bash
# Tests of the Python services on the Mac mini (hand-drawing renderer, face redraw, media bridge rules).
# They need the whiteboard venv (OpenCV); machines without it (CI) skip them with a notice.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
python="${WB_PYTHON:-${LOCAL_AI_ROOT:-$HOME/Developer/local-ai}/wb-venv/bin/python}"
if [[ ! -x "$python" ]]; then
  echo "local-tools tests skipped: $python not found"
  exit 0
fi
"$python" -m unittest discover -s "$root/local-tools/tests" 2> >(grep -v '^objc\[' >&2)
