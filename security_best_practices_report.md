# Security Audit Report

Audit date: 2026-07-29  
Audited revision: `7a075870217ab495b001a38473cc652247edded4` (`main`, matching `origin/main`)  
Scope: MCP server, CEP/UXP/chat plugins, landing application, dependencies, container/deployment configuration, and GitHub Actions.

## Executive summary

The remote MCP server has a sound basic authentication posture: it fails closed when `MCP_AUTH_TOKEN` is absent, compares bearer tokens in constant time, limits UXP WebSocket payloads, binds the UXP bridge to loopback, validates MCP tool arguments with schemas, and gates raw scripting behind an explicit capability. Production dependency audits for both the MCP package and landing app found zero known vulnerabilities, the tracked-file scan found no high-confidence committed secrets, and GitHub currently reports zero open code-scanning alerts.

The most important issue is outside the guarded MCP tool path: the bundled AI chat panel enables automatic execution by default and directly executes code blocks returned by a remote language model. A prompt-injected model response can therefore edit a project or access the host capabilities available to ExtendScript without a per-script user decision. Release workflows also use mutable GitHub Action tags while holding release-write or npm trusted-publishing authority, creating a supply-chain path if a referenced action tag is compromised.

No critical findings were identified. This was a read-only audit; no fixes were applied.

## High severity

### SEC-001 — AI-generated ExtendScript executes by default without per-script approval

- **Location:** `chat-plugin/main.js:10-22`, `chat-plugin/main.js:272-287`, `chat-plugin/main.js:397-419`, `chat-plugin/main.js:434-447`
- **Evidence:** `state.autoExec` defaults to `true`; every fenced `extendscript`, `jsx`, or `javascript` block in the provider response is queued and passed to `cs.evalScript`. This path does not call the MCP server's capability guard or its script validator.
- **Impact:** Content supplied by a user, project metadata, or another untrusted source can prompt-inject the remote model into returning hostile ExtendScript. The panel then runs it inside Premiere without showing the script or asking the user. Depending on CEP/ExtendScript host capabilities, this can corrupt projects, overwrite edits, export data, or access local resources.
- **Fix:** Default `autoExec` to `false`; require an explicit confirmation for each generated script and show the exact script plus a concise capability/risk summary. Keep an optional session-scoped auto-run mode only behind a prominent unsafe-mode acknowledgement. Apply an allowlist/capability policy to chat-generated scripts; do not treat regex blocking as a sandbox.
- **Mitigation:** Run on copies of projects, restrict CEP/Node privileges where possible, and ensure project-derived context is explicitly treated as untrusted in the system prompt.
- **False-positive notes:** This behavior is intentional product functionality, but intent does not remove the prompt-injection boundary. The risk is lower only if the chat plugin is not shipped or users always disable auto-execution before supplying any untrusted context.

### SEC-002 — Mutable action tags hold release and package-publishing authority

- **Location:** `.github/workflows/cep-release.yml:7-18`, `.github/workflows/claude-desktop-bundle.yml:8-32`, `.github/workflows/npm-publish.yml:19-68`, `.github/workflows/cross-platform.yml:7-24`
- **Evidence:** Workflows use mutable references such as `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v6`, and `actions/download-artifact@v7`. Release jobs grant `contents: write`; the npm workflow grants `id-token: write`.
- **Impact:** If an action release tag is moved or its upstream distribution is compromised, attacker-controlled workflow code could alter signed/released artifacts, publish a malicious npm package, or use the workflow token to modify releases.
- **Fix:** Pin every third-party action to a reviewed full commit SHA and use Dependabot or Renovate to propose controlled SHA updates. Keep the human-readable version in a comment.
- **Mitigation:** Protect workflow files with CODEOWNERS/reviews, use GitHub environments with required reviewers for publishing, and reduce permissions at job level so build jobs do not inherit release authority.
- **False-positive notes:** GitHub-owned actions reduce likelihood but not impact. Immutable SHA pinning remains the appropriate control for artifact and package publication.

## Medium severity

### SEC-003 — Internet-facing MCP endpoint lacks application-level abuse limits

- **Location:** `src/http-server.ts:119-185`, `fly.toml:9-21`
- **Evidence:** Every authorized `/mcp` request constructs a new MCP server and transport. The application sets no request body limit, connection/header/request timeout, concurrency limit, or rate limit. Unauthorized attempts are also not throttled. Fly enforces HTTPS but no repository-visible edge rate policy is configured.
- **Impact:** A network client can consume memory, sockets, CPU, and telemetry volume with slow or concurrent requests. With a valid token, it can also queue expensive Premiere operations. When `ALLOW_UNAUTHENTICATED=1` is set, the same abuse is available without credentials.
- **Fix:** Enforce a small MCP request-size limit before transport handling, configure `headersTimeout`, `requestTimeout`, `keepAliveTimeout`, and maximum concurrent in-flight operations, and add per-token/IP rate limiting at the trusted edge. Reject methods other than the exact supported MCP methods.
- **Mitigation:** Keep `ALLOW_UNAUTHENTICATED` disabled, rotate a strong token, set Fly proxy/firewall limits, and alert on sustained unauthorized or high-concurrency traffic.
- **False-positive notes:** Fly may provide undocumented/account-level controls; verify them in the live configuration. Transport-library parsing may impose an internal body limit, but no explicit application guarantee is visible here.

### SEC-004 — Landing static-file containment check is not canonical or separator-aware

- **Location:** `src/http-server.ts:54-71`
- **Evidence:** The requested path is joined directly from the raw URL path and authorized with `filePath.startsWith(LANDING_DIR)`. The code does not decode and normalize the URL first, and string-prefix containment allows sibling names that merely begin with the same characters.
- **Impact:** If an attacker can cause a file to exist in a prefix-matching sibling directory, or if platform path behavior changes, the server could expose a file outside `landing-dist`. Current exploitability appears low because the static export is baked into the container and no remote upload path was found.
- **Fix:** Parse with `new URL`, decode safely, resolve against the root, and require `candidate === root` or `candidate.startsWith(root + path.sep)`. Reject malformed encodings, NULs, and traversal segments; serve only regular files.
- **Mitigation:** Keep the runtime filesystem immutable and do not mount attacker-writable directories adjacent to `landing-dist`.
- **False-positive notes:** The current container layout and absence of writes adjacent to the landing directory substantially limit practical exploitation.

## Low severity

### SEC-005 — HTTP responses lack explicit security headers

- **Location:** `src/http-server.ts:54-71`, `src/http-server.ts:120-184`, `landing/next.config.ts:1-10`
- **Evidence:** Static and API responses set content type but no CSP, `X-Content-Type-Options`, clickjacking protection, or referrer policy. No equivalent header policy is visible in the repository.
- **Impact:** This weakens defense in depth for the public landing page and makes any future HTML/script injection more damaging. It also permits content-type sniffing and framing unless the edge adds controls.
- **Fix:** Add a centralized response-header baseline appropriate to the static site, including at minimum `X-Content-Type-Options: nosniff`, a restrictive CSP, `frame-ancestors`, and a deliberate referrer policy. Verify compatibility before enabling HSTS.
- **Mitigation:** Configure and verify equivalent headers at Fly's trusted edge.
- **False-positive notes:** Edge-added headers were not live-tested in this source audit.

### SEC-006 — Development dependency advisories can affect CI availability

- **Location:** `landing/package.json`, `landing/package-lock.json`
- **Evidence:** Full `npm audit` reports nine high-severity advisory paths through ESLint, minimatch, and brace-expansion, including `GHSA-mh99-v99m-4gvg` (unbounded brace expansion). `npm audit --omit=dev` reports zero findings.
- **Impact:** Malicious or unexpectedly complex glob input during lint/build tooling could exhaust CI memory. These packages are not part of the deployed production dependency set, so this is not a production runtime vulnerability.
- **Fix:** Update the landing lint toolchain to versions resolving the advisory, testing configuration compatibility; avoid `npm audit fix --force` without reviewing the proposed major/downgrade changes.
- **Mitigation:** Keep CI permissions read-only for validation jobs and avoid processing attacker-controlled arbitrary glob patterns.
- **False-positive notes:** Raw audit severity overstates deployed exposure because all observed paths are development-only.

## Positive controls verified

- HTTP MCP refuses to start without authentication unless the operator explicitly sets `ALLOW_UNAUTHENTICATED=1`.
- Bearer and UXP tokens use constant-time comparison.
- UXP WebSocket binds to `127.0.0.1`, requires a token of at least 16 characters, limits frames to 1 MiB, and enforces a handshake timeout.
- MCP tool registration applies centralized capability checks; unsafe script tools require the non-default `unsafe-script` capability.
- Generated command scripts are capped at 500 KiB; standard commands reject `eval`, `new Function`, and `System.callSystem`.
- API keys in the chat panel are retained in memory rather than web storage.
- Production dependency audits returned zero known vulnerabilities for both packages.
- No high-confidence secrets were found in tracked files.
- GitHub's code-scanning API returned zero open alerts at audit time.

## Verification performed

- `git status --short --branch` and current revision inspection
- `npm audit --omit=dev --json` in the root and `landing/`
- full `npm audit --json` dependency review
- high-signal source scans for secrets, subprocesses, filesystem sinks, script execution, DOM sinks, storage, authentication, and network listeners
- manual review of HTTP/MCP transport, CEP file bridge, UXP WebSocket bridge, capability enforcement, chat execution, update handling, Docker/Fly configuration, and GitHub Actions
- GitHub code-scanning open-alert query
- `npm run build` passed
- `npm test` passed: 22 test files, 432 tests
