#!/usr/bin/env bash
set -euo pipefail

# Move para a raiz do projeto (pasta pai de scripts/)
cd "$(dirname "$0")/.."

exec npm run login -- "$@"
