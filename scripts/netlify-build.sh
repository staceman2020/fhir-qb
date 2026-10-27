#!/usr/bin/env bash
# Netlify build (plan §9.5): builder app at /, versioned renderer bundle and demo under /renderer/.
set -euo pipefail

pnpm --filter "./packages/**" run build
pnpm --filter @qb/renderer build:demo
pnpm --filter builder build

out=apps/builder/dist
major=$(node -p "require('./packages/renderer/package.json').version.split('.')[0]")
mkdir -p "$out/renderer/v$major"
# All ES chunks: the IIFE loads qb-fhirpath.js (and its chunks) from the same folder on demand.
cp packages/renderer/dist/*.js "$out/renderer/v$major/"
rm -rf "$out/renderer/demo"
cp -R packages/renderer/dist-demo "$out/renderer/demo"
