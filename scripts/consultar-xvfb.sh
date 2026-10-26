#!/bin/sh
set -eu

cd /app
export CONTAINER="${CONTAINER:-1}"
export HEADLESS="${HEADLESS:-false}"

exec xvfb-run -a --server-args="-screen 0 1280x720x24" node consultar-email.mjs
