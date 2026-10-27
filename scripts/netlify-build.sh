#!/usr/bin/env bash
# Netlify build (plan §9.5): builder app at /, versioned renderer bundle and demo under /renderer/.
set -euo pipefail

pnpm --filter "./packages/**" run build
pnpm --filter @qb/renderer build:demo
pnpm --filter builder build

out=apps/builder/dist
major=$(node -p "require('./packages/renderer/package.json').version.split('.')[0]")
mkdir -p "$out/renderer/v$major"
cp packages/renderer/dist/qb-questionnaire.iife.js packages/renderer/dist/qb-questionnaire.js packages/renderer/dist/element-*.js "$out/renderer/v$major/"
rm -rf "$out/renderer/demo"
cp -R packages/renderer/dist-demo "$out/renderer/demo"
