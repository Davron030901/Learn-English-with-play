#!/usr/bin/env bash
# Create random secrets for the local docker compose stack in ./.secrets.
#
# Existing files are never overwritten: the database volume was initialised with them,
# and a new password would lock the services out. To start over, run
# `docker compose down -v` and delete ./.secrets.
set -euo pipefail
cd "$(dirname "$0")/.."

umask 077
mkdir -p .secrets
chmod 700 .secrets

for name in lep_db_password lep_db_migrator_password lep_redis_password lep_jwt_secret lep_demo_password; do
  file=".secrets/$name"
  if [[ -s "$file" ]]; then
    echo "kept    $file"
  else
    # 36 random bytes -> 48 URL-safe characters (288 bits)
    head -c 36 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n' > "$file"
    echo "created $file"
  fi
  # Readable by the containers' non-root users; the directory itself stays 0700.
  chmod 644 "$file"
done
