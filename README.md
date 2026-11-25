# Coaching E2E & Security Tests

Browser-level end-to-end and adversarial HTTP tests for the two product services. Everything runs inside Docker with Playwright and Chromium — no local browser, Node or SDK install required.

> Tests: [coaching-platform](https://github.com/RaiyanKhan19-41453-3/coaching-platform) and [proctored-exam-service](https://github.com/RaiyanKhan19-41453-3/proctored-exam-service)

## Run

```bash
./run-e2e.sh
```

The script:
1. Starts both real Docker stacks and waits for health.
2. Builds the Playwright image (Chromium + system deps).
3. Runs the suites below.
4. Stops the main-platform containers; the exam service is left running.

## Suites

| File | What it verifies |
| --- | --- |
| `tests/main.spec.ts` | Platform UI sign-in, live SignalR notification delivered from an API-created announcement, presigned material upload through the UI |
| `tests/exam.spec.ts` | Main-platform JWT accepted by the exam service, examiner seeds an exam, candidate enters token/attempt token in the UI, answers MCQ, submits, sees report, results published |
| `attack.mjs` | Auth forgery (wrong key, `alg:none`), missing tokens, tenant-header spoofing, RBAC escalation, integration key, injection, validation, path traversal, cross-tenant reads, brute-force rate limiting |
| `attack2.mjs` | Cross-tenant IDOR using real IDs, cross-candidate attempt/evidence/report access, foreign attempt tokens and question IDs, token reuse |
| `attack3.mjs` | Expired tokens, malformed JSON, invalid enums, negative values, rate limits, parallel report-generation races |
| `attack4.mjs` | Annihilation suite: JWT claim abuse, JSON/path/query fuzzing, CORS and header smuggling, content-type confusion, 30-way uniqueness race, 25-way attempt-token race, webhook replay flood |

The attack scripts sign JWTs with the repository's known development key — that is why production must replace `JWT_KEY` and refuses to start with the default.

## Run individual suites

```bash
docker run --rm --network host -v "$PWD":/work -w /work --entrypoint node coaching-e2e attack.mjs
docker run --rm --network host -v "$PWD":/work -w /work --entrypoint node coaching-e2e attack2.mjs
docker run --rm --network host -v "$PWD":/work -w /work --entrypoint node coaching-e2e attack3.mjs
```

## Layout

```
playwright.config.ts   Playwright settings (headless, 1 worker, traces on failure)
helpers.ts             JWT generation and API helpers
tests/                 Browser specs
attack*.mjs            Adversarial HTTP suites
Dockerfile             node:22-bookworm + @playwright/test + chromium deps
run-e2e.sh             Orchestration
```

## Screenshots

`capture.mjs` and `capture-main-clean.mjs` capture the UI screenshots embedded in both service READMEs.

```
docker run --rm --network host -v "$PWD":/work -w /work \
  -v /home/shoue/coaching-platform/docs/screenshots:/main \
  -v /home/shoue/exam-service/docs/screenshots:/exam \
  -e SHOT_DIR=/exam --entrypoint node coaching-e2e capture.mjs
```

## Expectations

All suites exit 0 when healthy. A `VULN` line means an attack succeeded and must be fixed in the corresponding service before release.
