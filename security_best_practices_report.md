# Repository security and performance review

Date: 2026-09-15

Reviewed commit: `121991a50c7229d7c84dce0fb2ebce3df8b73662` (1.15.2).

## Executive summary

No confirmed leaked credentials were found in the scans performed. This is not a guarantee that every secret format or historical artifact is clean. The strongest confirmed runtime finding is an unauthenticated loopback request that crashes the UXP bridge process. CEP connectors also trust existing command directories without verifying ownership or permissions. Public HTML serving and local media operations contain synchronous work that can stall the shared MCP process.

The dependency audit reports three distinct affected packages across the two lockfiles: Hono, js-yaml, and sharp. Their advisory severity and actual application exposure differ; details follow.

The original audit produced a report only. The PR remediation section below records subsequent fixes and validation; the numbered findings preserve the original evidence. No deployment or credential rotation is included in the remediation PR.

## Scope and evidence

- Repository-wide tracked-text secret scan: 773 files; recognizable GitHub, AWS access ID, npm, Slack, Stripe/OpenAI token prefixes and private-key headers; no matches.
- Local reachable Git history: 5,352 distinct text blobs scanned with those provider/key patterns; no matches. Remote-only refs, unreachable objects, compressed/binary contents, releases, CI logs, and deployed secrets were not scanned.
- Additional current-tree literal token/password/secret/API-key assignment scan: candidates inspected were test fixtures and documentation placeholders. No environment, PEM, PFX, or npmrc files were found by the workspace filename search outside dependency and Git directories.
- Risk-focused manual review of HTTP/OAuth, capability enforcement, CEP/AE/UXP bridges, filesystem/media operations, context storage, telemetry, landing code, installer extraction, Docker and GitHub workflows. This is not a claim of line-by-line verification of every tool or every Adobe host action. Framework skill guidance covered TypeScript/React/Next.js; C#/CEP portions received manual review.
- `npm run build`: passed.
- Targeted Vitest run: **213 tests passed across 11 files**, covering HTTP admission/security, OAuth, capabilities, file/AE bridges, media watch, and recovery.
- Both `npm audit --json` calls completed after setting process-local `NODE_OPTIONS=--use-system-ca`; TLS verification remained enabled.
- Safe reproductions used a separate local Node process, mocked Adobe/filesystem APIs, and a loopback-only FFprobe fixture. No production traffic or real Adobe editing was exercised.
- Local landing dependencies are stale: `npm ls` reports installed Next 16.2.12 while the manifest/lockfile require 16.3.3. Dependency findings below use lockfiles; no fresh landing build/browser performance measurement was claimed.
- An unrelated untracked `landing/scripts/record-live-demo.mjs` appeared during the audit and was left untouched; it is outside the tracked snapshot above.

## High priority

### 1. CEP connectors execute commands from unverified existing directories

**Severity:** High when another user can prepare/write the configured bridge directory; conditional local trust-boundary issue.

**Evidence:** `cep-plugin/main.js:177-185` only creates the directory when absent and suppresses creation errors. `after-effects-cep-plugin/main.js:101-110` uses recursive mkdir without validating an existing directory. AE reads matching command files at lines 75-89 and passes their contents to `cs.evalScript`. The server-side ownership check in `src/bridge/file-bridge.ts:219-240` does not protect a connector started independently before the server.

**Impact:** An attacker who controls a shared/pre-created bridge directory can supply ExtendScript for execution under the Adobe user's account, outside MCP authentication and capability checks.

**Validation:** A VM fixture ran the unchanged AE panel against a mocked existing directory containing an inert marker command. Starting the panel and invoking its poll caused `evalScript` to receive that marker. This proves the missing validation path; it does not prove a cross-user exploit against the default private Windows temp folder or a live Mac installation.

**Fix:** Before heartbeat writes or polling, reject symlinks and non-directories, verify ownership and restrict permissions on POSIX, and require a private ACL on Windows custom/shared paths. Fail closed on validation errors. Apply the same policy to both CEP panels and server, including pre-existing paths.

## Medium priority

### 2. Malformed unauthenticated UXP upgrade crashes the process

**Severity:** Medium; local denial of service.

**Evidence:** `src/bridge/uxp-websocket-bridge.ts:114-115` constructs a URL inside the upgrade event handler without a try/catch, before token validation.

**Validation:** Started the freshly built bridge in a separate child process on an ephemeral loopback port. Sent a WebSocket upgrade with a malformed absolute request target (`http://[invalid`). The child exited with code **1**, reporting `ERR_INVALID_URL`, without a token.

**Impact:** A local process able to connect to the bridge can terminate the editor-control MCP process. The listener is loopback-only, so this is not an internet-exposed endpoint in the reviewed configuration.

**Fix:** Catch malformed URLs, return 400 and destroy the socket. Add a regression asserting the process remains available for a subsequent valid connection.

### 3. Public HTML requests perform synchronous reads and gzip on the MCP event loop

**Severity:** Medium; public availability/performance risk.

**Evidence:** `src/http-server.ts:213-218` reads complete HTML files synchronously, injects a nonce, and runs `gzipSync` per request. Line 220 suppresses the HEAD response body only after that work. Landing requests return at line 350 before MCP admission limits at line 374. `fly.toml:23-26` specifies one shared CPU and 256 MB.

**Impact:** Repeated public GET or HEAD requests consume the same event loop needed for MCP operations and health checks. Existing MCP concurrency/rate controls do not limit this route.

**Fix:** Cache trusted source HTML, compress asynchronously with bounded concurrency, avoid body construction for HEAD, and add a public-route resource budget or serve the landing through a separate static service. Preserve nonce correctness when caching.

**Validation limit:** Confirmed control flow and synchronous APIs; no production load test or measured outage threshold.

### 4. Media scan limit counts matching files, not total traversal work

**Severity:** Medium; authenticated/local availability risk.

**Evidence:** `src/tools/media-watch.ts:43-62` calls synchronous readdir/realpath for every entry. Directory queue growth and nonmatching entries are unlimited; `MAX_SCAN_FILES` is checked only after adding matching media to the output map.

**Validation:** Transpiled the unchanged module with a mocked directory containing **6,001 nonmatching files**. All 6,001 entries were visited and the watcher started successfully with zero baseline files despite the advertised 5,000-file cap.

**Impact:** A legitimate large folder or recursive tree can block all MCP requests; a wide tree also grows the queue. The caller needs the filesystem capability.

**Fix:** Bound total visited entries, directories, depth, queue length, and elapsed time. Use asynchronous traversal with cancellation and report truncation explicitly. Replace repeated `queue.shift()` with an index or deque.

### 5. Backup creation synchronously copies and hashes an unbounded file

**Severity:** Medium; authenticated/local availability risk.

**Evidence:** `src/tools/recovery.ts:49-50` hashes `readFileSync(path)`; lines 63-74 synchronously copy the project and read/hash both source and backup. There is no byte cap.

**Impact:** Large `.prproj` inputs block the event loop and require whole-file buffers, potentially exceeding a small server's memory budget. Filename extension and regular-file checks do not bound resource use.

**Fix:** Stream both hashes, use asynchronous copy, limit concurrent backups, and enforce an operator-configured size/storage budget. Preserve collision-safe creation and source-change verification.

**Validation limit:** Static control-flow finding; no large-file stress fixture was created.

### 6. Lockfiles contain packages with current security advisories

**Priority:** Medium in this repository; upstream advisories include High. No working dependency exploit was established against the deployed MCP route.

| Package | Locked version/location | Audit severity | Exposure and remediation |
| --- | --- | --- | --- |
| Hono | 4.13.0, `package-lock.json:1908` | Moderate, three advisories | Runtime dependency through MCP Node adapter. Update to at least 4.13.5. No application use of the reported `toSSG` or dot-notation form parsing was found; the MCP route parses bounded JSON. Query parsing advisory reachability remains unproven. |
| js-yaml | 4.3.1, `package-lock.json:2036`, `landing/package-lock.json:8449` | High | Development tooling dependency. Update to at least 4.3.2. Focus is untrusted YAML processed by tooling, not a public YAML endpoint. |
| sharp | 0.35.3, `landing/package-lock.json:10783` | High | Landing image/build dependency; update to at least 0.35.4. Production Docker copies static output rather than the Next runtime. No public image-upload/optimization endpoint was found. |

Audit totals: root **1 high + 1 moderate affected packages**; landing **2 high affected packages**. Counts overlap on js-yaml and are not four unique vulnerabilities.

Sources: [Hono dot-notation advisory](https://github.com/advisories/GHSA-g6gw-c38x-mqfc), [Hono static-generation advisory](https://github.com/advisories/GHSA-gqvv-2mrq-wpjv), [Hono query-parser advisory](https://github.com/advisories/GHSA-crvj-82cr-hjcx), [js-yaml advisory](https://github.com/advisories/GHSA-2883-xcg3-v3hh), [sharp advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).

Regenerate both lockfiles with patched versions, install cleanly, repeat audits, and run the build/tests. `npm audit fix --force` is unnecessary as an initial response.

## Lower priority hardening

### 7. Docker runner uses the default root user

**Severity:** Low; increases impact of a separate compromise.

**Evidence:** `Dockerfile:36-57` has no USER directive after the production base image. Filesystem and FFmpeg work inherit container root privileges.

**Fix:** Use a dedicated non-root user, grant access only to required bridge/context directories, and validate shared-volume permissions. This does not establish host-root access or a container escape.

### 8. Secret exclusion patterns are incomplete

**Severity:** Low; preventative packaging/build hygiene, no leak confirmed.

**Evidence:** `.gitignore:29-31` ignores `.env` and `.env.local` but not other root `.env.*` variants. `.dockerignore:1-16` has no secret-file exclusions. `Dockerfile:31` copies the entire landing directory into the builder.

**Impact:** Future local environment or credential files could enter Git or a remote Docker build context. A builder copy is not proof that a file reaches the final image or public browser bundle.

**Fix:** Exclude `.env*` except deliberate placeholder examples, private key/certificate files and local credential configuration from Git and Docker contexts. Add a redacted secret scanner to CI and scan release archives independently.

## Controls that held up in this review

- HTTP authentication fails closed by default; production disallows the unauthenticated override.
- Shared tokens use constant-time comparison; OAuth validates issuer, audience, signature algorithm, expiration, subject allowlist and scopes.
- HTTP body, concurrency and rate limits exist; bridge commands have a bounded serialized queue and response-size limit.
- Unsafe scripting requires an explicit capability; action-specific checks exist for consolidated tools.
- UXP binds loopback and authenticates upgrades; the malformed-URL exception is the separate gap above.
- Installer ZIP extraction checks containment; GitHub action references are pinned to commits.
- Landing JSON-LD sinks inspected use repository-owned static data; no confirmed user-input XSS was found.
- The FFprobe local-playlist fixture made **zero outbound requests**: the installed FFmpeg protocol restrictions blocked the loopback segment URL. Missing explicit protocol flags in some media tools alone was not reported as confirmed SSRF.

## Recommended order

1. Fix the UXP crash and CEP directory validation.
2. Update the three affected dependencies and reconcile the stale local landing installation.
3. Bound public HTML processing, directory traversal and backup resource use.
4. Harden container privileges and secret/build exclusions.
5. Re-run targeted regression tests, clean builds and audits; separately validate real Adobe hosts and production configuration.
# Remediation follow-up — September 15, 2026

The competitive release catches malformed UXP upgrade URLs, returns HTTP 400,
and includes a real-socket regression proving an authenticated host can still
connect afterward. This addresses the malformed-URL process crash below. The
remaining findings retain their original audit scope and are not marked fixed.

## PR remediation

The follow-up branch starts from `6980cc884307258ef16686f33c3564f59a9b2140`, which already contains the malformed UXP upgrade fix and its real-socket regression. The remaining findings are addressed as follows:

| Finding | Remediation |
| --- | --- |
| 1 — CEP directory trust | Server and both panels validate directory ownership, symlinks, permissions and ancestor replacement rights before command publication, cleanup, heartbeat or polling. Existing group/other-writable POSIX directories are rejected. Windows ACL checks reject untrusted write grants, including inherited ones; inspection uses an encoded command and passes the path as data. |
| 2 — malformed UXP upgrade | Retained the upstream 400 response and regression proving a subsequent authenticated connection still succeeds. |
| 3 — public HTML work | Bounded asynchronous source reads, bounded source cache, asynchronous gzip and a separate HTML concurrency cap. Per-response nonces remain fresh; HEAD skips rendering and compression. |
| 4 — media traversal | Asynchronous traversal with entry, file, directory, depth, queue and cooperative elapsed-time budgets; incomplete scans are explicitly reported and stopping cancels active traversal. |
| 5 — backups | Streamed copy/checksums, a default 2 GiB configurable budget, one active backup per process, exclusive destination creation, source verification and failure cleanup. |
| 6 — dependency advisories | Locked Hono 4.13.8, js-yaml 4.3.2 and sharp 0.35.4. Added dependency audit gates to CI. |
| 7 — container privileges | Production runs as `node` (UID 1000), with a private writable context directory. |
| 8 — secret exclusions | Git ignores local environment variants and credential/key files; Docker additionally excludes all such files and nested worktrees. |

Compatibility notes: cached HTML is immutable for the process lifetime, so replacing an export requires a restart. Unsafe existing bridge directories require an operator-selected private directory; the fix does not trust or execute commands already staged in a writable directory. Media scan elapsed limits are checked between asynchronous OS operations, not a deadline that can interrupt a stalled filesystem call. Backup and media-watch library methods are now asynchronous; MCP handler results retain their existing JSON shape with additional scan-completeness fields.

Validation details are recorded in the PR. Local tests do not establish licensed Premiere/After Effects execution or deployed production behavior.

Windows ACL validation intentionally performs a fresh bounded synchronous PowerShell check before publishing each command (five-second timeout, 64 KiB output cap). This adds latency; no stale trust cache is introduced.

After incorporating `origin/main` at `3d27049`, `npm run check` passed all 3,370 tests. The full coverage run passed the existing thresholds: 94.59% statements, 90.31% branches, 96.25% functions and 96.74% lines. Both dependency audits reported zero vulnerabilities. The package installed and ran in isolation, and the rebuilt Docker image passed checks for UID 1000, private bridge permissions, health/landing/HEAD responses and unauthenticated MCP rejection. Real Windows directory checks passed under a private user-profile path; an unsafe shared temp ancestor is intentionally rejected.
