#!/usr/bin/env bash
# Compila la aplicación en dist/ (requiere bun). Uso: ./build.sh
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist/assets
bun build src/main.tsx --outdir dist/assets --entry-naming '[name].[ext]' --minify --target browser --define 'process.env.NODE_ENV="production"'
cp -r public/. dist/
cp index.html dist/index.html
echo "Listo: $(du -sh dist | cut -f1) en dist/"
