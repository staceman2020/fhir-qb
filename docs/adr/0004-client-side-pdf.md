# ADR-004: Client-side PDF library and tagging approach

- Status: Open (blocked on Spike A)
- Date: 2026-10-27

## Context

PDFs must be generated in the browser, work offline, and be tagged (PDF/UA target), with Noto Sans embedded for te reo Māori macrons.

## Options

1. PDFKit (browser build): has structure-tree/tagging support; larger.
2. pdf-lib plus in-house text layout: smaller; no tagging support, so we would ship an accessible HTML print view as a companion.

## Decision

Pending Spike A: PDFKit in a Vite browser build, tagged output, Noto Sans subset, veraPDF result.
