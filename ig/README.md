# qb Implementation Guide

FSH sources for the qb extensions (plan §5). Build with SUSHI:

```sh
pnpm ig:build        # = npx fsh-sushi@3 ig
```

## Vendored SDC snapshot

Plan §3.2 requires a dated snapshot of `hl7.fhir.uv.sdc#current` in `ig/vendor/`. Not yet vendored. To add it, download the package tarball from `https://build.fhir.org/ig/HL7/sdc/package.tgz`, save it as `vendor/hl7.fhir.uv.sdc-current-YYYYMMDD.tgz`, and record the retrieval date in `vendor/README.md`.
