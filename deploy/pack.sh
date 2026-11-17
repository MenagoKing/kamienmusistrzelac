#!/usr/bin/env bash
# Builds the app and packs what the server needs into space-rocks-deploy.tar.gz (no node_modules, no data).
#   bash deploy/pack.sh
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
rm -f space-rocks-deploy.tar.gz
tar -czf space-rocks-deploy.tar.gz \
  package.json package-lock.json .env.example README.md \
  server shared dist dist-ssr deploy/install.sh
ls -lh space-rocks-deploy.tar.gz
