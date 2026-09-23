# Evidence manifests

Validation creates immutable-by-convention local bundles under `evidence/runs/<UTC-RUN-ID>/`.
Each manifest uses `evidence-manifest.schema.json`; `checksums.sha256` covers every regular
file in the bundle except the checksum file itself. Local execution is never represented as
independent or production validation.
