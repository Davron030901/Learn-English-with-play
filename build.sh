#!/usr/bin/env bash
# Full content build. Any gate failure blocks the build.
set -euo pipefail
cd "$(dirname "$0")"
python3 tools/build_lexemes.py
python3 tools/build_units.py
python3 tools/build_items.py
python3 tools/validate.py
python3 tools/report.py
echo "build ok"
