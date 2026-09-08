# Task 044 Discovery Report

## TASK 044 — BROWSER RUNTIME & DOMAIN SECURITY ADAPTER — HOST INTEGRATION

---

## 1. Baseline

| Field                   | Value                                                    |
| ----------------------- | -------------------------------------------------------- |
| HEAD                    | `20e5bb0c777256a40521e8af5337c12f672e75ec`               |
| origin/main             | `20e5bb0c777256a40521e8af5337c12f672e75ec`               |
| Branch                  | `main`                                                   |
| Working tree            | Clean (untracked task_043_discovery_report.md only)      |
| HEAD == origin/main     | YES                                                      |
| Latest completed task   | Task 043 - Terminal Runtime & Process Supervisor Adapter |
| Task 044 implementation | NOT STARTED                                              |

---

## 2. Authoritative Definition

### Exact Task Name

TASK 044 - BROWSER RUNTIME & DOMAIN SECURITY ADAPTER - HOST INTEGRATION

Runtime ID: rt:browser-v1
Category: RuntimeCategory.BROWSER

### Authoritative EDD Sections

- EDD section 3.7 (line 347): Browser Runtime - session/profile lifecycle, interfaces, events, failure handling
- EDD section 11 (line 747): Browser Runtime - session model, auth/cookies/downloads, automation architecture
- EDD section 18.5 (line 953): Browser automation sequence diagram

Key EDD 3.7 content:
Purpose: provide assisted, managed-visible, and approved managed-headless sessions isolated by workspace/device/profile/task.
Interfaces: IBrowserSessionManager, IBrowserPolicyEnforcer, IBrowserAutomationDriver, IDownloadManager, IBrowserEvidenceCollector.
Events: BrowserSessionCreated, BrowserOpened, BrowserNavigated, BrowserActionProposed, BrowserActionExecuted, BrowserDownloadStarted/Completed, BrowserUploadRequested, BrowserAuthRequired, BrowserMfaRequired, BrowserCaptchaDetected, BrowserSessionCleared.
Failure handling: pause on login, MFA, CAPTCHA, paywall, anti-bot, unexpected permission prompt, disallowed redirect, sensitive form submit, unknown download type, or ambiguous page state.
Shutdown order (EDD line 241): plugins, browser, terminal, filesystem/model, then coordinator.

EDD 11.3 - Automation architecture:
Automation uses typed browser actions: navigate, inspect, extract, click, fill, select, upload, download, screenshot, wait, and submit - rather than arbitrary page-script execution.

### Authoritative PRD Section

PRD section 5.7 (line 243): Browser Automation - operating model, BRW-001 through BRW-006

| ID      | Priority | Requirement                                                                                          |
| ------- | -------- | ---------------------------------------------------------------------------------------------------- |
| BRW-001 | P0       | Browser sessions tied to workspace, device, profile, and task                                        |
| BRW-002 | P0       | Agent can navigate, extract, fill forms, upload/download, and capture screenshots with authorization |
| BRW-003 | P0       | Agent must never bypass CAPTCHA, paywalls, MFA, or anti-bot controls                                 |
| BRW-004 | P1       | Domain policies classify read, draft, submit, purchase, publish, account change, data export         |
| BRW-005 | P1       | Sessions persist only with explicit user choice; user can clear from dashboard                       |
| BRW-006 | P2       | Web testing mode with test plans, trace capture, screenshots, non-production safeguards              |

### Task Sequence Evidence (from task_043_discovery_report.md section 3)

1. Task 041: Device Runtime (rt:device-v1) - COMPLETE
2. Task 042: Filesystem Runtime (rt:filesystem-v1) - COMPLETE
3. Task 043: Terminal Runtime (rt:terminal-v1) - COMPLETE
4. Task 044: Browser Runtime (rt:browser-v1) - NEXT

---

## 3. Existing Browser Runtime (Core Implementation)

Files under apps/desktop-agent/src/runtimes/browser/:

| File               | Bytes  | Responsibility                                                                                                               |
| ------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| types.ts           | 2,766  | BrowserOperationName enum (7 ops), BrowserSession, request/response types, BrowserResourceLimits, BrowserOperationResult     |
| domain-security.ts | 5,787  | DomainSecurityService: URL validation, prohibited scheme list, SSRF blocking, domain allowlist matching, redirect validation |
| session-manager.ts | 2,618  | BrowserSessionManager: isolated profile creation, session URL tracking, profile cleanup, abandoned session GC                |
| policy.ts          | 780    | BrowserExecutionPolicy: authorizes BROWSER, TERMINAL, FILESYSTEM categories                                                  |
| runtime.ts         | 17,620 | BrowserRuntime: 7 operations with centralized executeProtectedOperation (lease + scope + session checks)                     |
| index.ts           | 163    | Re-exports all of the above                                                                                                  |

Operations in BrowserRuntime:

- navigate (brw:navigate)
- extractContent (brw:extract)
- interactForm (brw:interact)
- captureScreenshot (brw:screenshot)
- downloadFile (brw:download)
- uploadFile (brw:upload)
- clearSession (brw:clear_session)

Existing security boundaries (core):

- DomainSecurityService blocks: file:, javascript:, data:, gopher:, ftp:, chrome:, edge:, about:, blob: schemes
- DomainSecurityService blocks: localhost, 127.0.0.1, 0.0.0.0, ::1, 169.254.169.254 (cloud metadata)
- DomainSecurityService blocks: private IPv4 (10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, 127/8) and IPv6 local
- Domain allowlist must be non-empty; empty allowlist always denies
- Redirect validation: redirect target must pass full domain security check
- Sensitive form detection: regex covering password, login, auth, mfa, captcha, paywall, credit card, SSN, checkout, etc.
- PathSecurityService.validatePath() used for screenshot/download destinations and upload sources
- executeProtectedOperation: lease validation + scope check + session existence check before every action

Existing tests (20 tests, all passing in the 569-test suite):

- tests/browser-runtime.test.ts: 13 tests (session isolation, navigation, sensitive form pause, path security, etc.)
- tests/browser-domain-security.test.ts: 7 tests (approved domains, SSRF, metadata, private IPv4, prohibited schemes, redirects)

Already existing (NO change needed):

- RuntimeCategory.BROWSER enum value: EXISTS in runtime-registry.ts line 6
- RuntimeCategory.BROWSER authorized in PluginExecutionPolicy: EXISTS (line 21)
- BrowserRuntime.RUNTIME_ID = 'rt:browser-v1': EXISTS in runtime.ts

---

## 4. Missing Host Integration - Gap Analysis

| Area                                                   | Existing? | Missing / Required Change                                                                                                                                                                              |
| ------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| rt:browser-v1 descriptor registered in RuntimeRegistry | MISSING   | this.runtimeRegistry.registerRuntime(this.browserRuntime.getDescriptor())                                                                                                                              |
| BrowserRuntime field on DesktopAgent                   | MISSING   | public readonly browserRuntime: BrowserRuntime                                                                                                                                                         |
| BrowserRuntime instantiation in composition root       | MISSING   | new BrowserRuntime(this.leaseBoundary, ...) with optional custom injection                                                                                                                             |
| schemas.ts (Zod IPC request schemas)                   | MISSING   | apps/desktop-agent/src/runtimes/browser/schemas.ts                                                                                                                                                     |
| 9 capability descriptors in CapabilityRegistry         | MISSING   | browser.createSession, browser.navigate, browser.extractContent, browser.interactForm, browser.captureScreenshot, browser.downloadFile, browser.uploadFile, browser.clearSession, browser.listSessions |
| browser.createSession IPC handler                      | MISSING   | registerMethodHandler('browser.createSession', ...)                                                                                                                                                    |
| browser.navigate IPC handler                           | MISSING   | registerMethodHandler('browser.navigate', ...)                                                                                                                                                         |
| browser.extractContent IPC handler                     | MISSING   | registerMethodHandler('browser.extractContent', ...)                                                                                                                                                   |
| browser.interactForm IPC handler                       | MISSING   | registerMethodHandler('browser.interactForm', ...)                                                                                                                                                     |
| browser.captureScreenshot IPC handler                  | MISSING   | registerMethodHandler('browser.captureScreenshot', ...)                                                                                                                                                |
| browser.downloadFile IPC handler                       | MISSING   | registerMethodHandler('browser.downloadFile', ...)                                                                                                                                                     |
| browser.uploadFile IPC handler                         | MISSING   | registerMethodHandler('browser.uploadFile', ...)                                                                                                                                                       |
| browser.clearSession IPC handler                       | MISSING   | registerMethodHandler('browser.clearSession', ...)                                                                                                                                                     |
| browser.listSessions IPC handler                       | MISSING   | registerMethodHandler('browser.listSessions', ...)                                                                                                                                                     |
| BrowserRuntime.shutdown() method                       | MISSING   | sessionManager.cleanupAbandonedSessions(0) on all sessions                                                                                                                                             |
| Lifecycle shutdown in DesktopAgent.stop()              | MISSING   | this.browserRuntime.shutdown()                                                                                                                                                                         |
| IPC integration test suite                             | MISSING   | tests/local-browser-ipc.test.ts                                                                                                                                                                        |
| Adversarial security test suite                        | MISSING   | tests/local-browser-security-hardening.test.ts (044-SEC-01 to 044-SEC-12)                                                                                                                              |
| Task 044 completion report                             | MISSING   | apps/desktop-agent/docs/task-044-completion-report.md                                                                                                                                                  |

NOT MISSING (no change needed):

- RuntimeCategory.BROWSER enum value
- PluginExecutionPolicy BROWSER authorization
- BrowserRuntime core implementation (runtime.ts, domain-security.ts, session-manager.ts, types.ts, policy.ts)

---

## 5. Required IPC Surface

Standard 5-layer security gate on every IPC handler:

1. Zod schema validation of raw params
2. Agent lifecycle state check (STOPPING/STOPPED/FAILED deny)
3. PluginExecutionPolicy.isRuntimeCategoryAuthorized(RuntimeCategory.BROWSER)
4. ExecutionLeaseBoundary.validateLease()
5. Capability scope check on leaseHeader.scopes

All IPC responses pass through RedactionFilter before returning to callers.

| Method                    | Required Scope | Dangerous | Response                                                       |
| ------------------------- | -------------- | --------- | -------------------------------------------------------------- |
| browser.createSession     | browser:write  | YES       | { sessionId, profilePath, createdAt }                          |
| browser.navigate          | browser:write  | YES       | BrowserOperationResult(string)                                 |
| browser.extractContent    | browser:read   | NO        | BrowserOperationResult(string)                                 |
| browser.interactForm      | browser:write  | YES       | BrowserOperationResult(boolean) with humanInterventionRequired |
| browser.captureScreenshot | browser:read   | NO        | BrowserOperationResult(string) - canonical path                |
| browser.downloadFile      | browser:write  | YES       | BrowserOperationResult(string) - canonical path                |
| browser.uploadFile        | browser:write  | YES       | BrowserOperationResult(boolean)                                |
| browser.clearSession      | browser:write  | YES       | BrowserOperationResult(boolean)                                |
| browser.listSessions      | browser:read   | NO        | { sessions: BrowserSession[] }                                 |

Note: browser.createSession calls sessionManager.createSession() directly (not a BrowserRuntime method).

---

## 6. Required Capabilities

| Capability ID             | isDangerous | Required Scope |
| ------------------------- | ----------- | -------------- |
| browser.createSession     | true        | browser:write  |
| browser.navigate          | true        | browser:write  |
| browser.extractContent    | false       | browser:read   |
| browser.interactForm      | true        | browser:write  |
| browser.captureScreenshot | false       | browser:read   |
| browser.downloadFile      | true        | browser:write  |
| browser.uploadFile        | true        | browser:write  |
| browser.clearSession      | true        | browser:write  |
| browser.listSessions      | false       | browser:read   |

---

## 7. Security Threat Model

### URL / Domain Threats (all defended in core BrowserRuntime)

- SSRF via loopback (localhost, 127.0.0.1) - PROHIBITED_HOSTNAMES
- SSRF via cloud metadata (169.254.169.254) - PROHIBITED_HOSTNAMES
- SSRF via private IPv4 (10.x, 172.16.x, 192.168.x) - isPrivateOrLocalIp()
- SSRF via IPv4-mapped IPv6 (::ffff:127.0.0.1) - prefix strip + isPrivateOrLocalIp()
- file:// URL navigation - PROHIBITED_SCHEMES
- javascript:// URL injection - PROHIBITED_SCHEMES
- data: URL injection - PROHIBITED_SCHEMES
- Unauthorized domain navigation - allowedDomains allowlist
- Open redirect to unauthorized domain - validateRedirect() re-validates

### Filesystem Threats (all defended in core BrowserRuntime)

- Path traversal in screenshot/download destination - PathSecurityService.validatePath()
- Path traversal in upload source - PathSecurityService.validatePath()
- Screenshot memory exhaustion - maxScreenshotSizeBytes limit
- Download size exhaustion - maxDownloadSizeBytes limit

### Host Integration Layer Threats (NEW - must be defended in IPC handlers)

- Expired lease replay: ExecutionLeaseBoundary.validateLease() in IPC handler
- Missing browser:write scope: scope check on leaseHeader.scopes
- Invalid sessionId: sessionManager.getSession() undefined -> INVALID_SESSION
- Session creation beyond concurrency limit (max 3): maxConcurrentSessions check in browser.createSession
- Browser request during STOPPING/STOPPED: agent lifecycle state check
- Orphan sessions on shutdown: BrowserRuntime.shutdown() in DesktopAgent.stop()
- Sensitive secret leakage in browser output: RedactionFilter on all responses
- Stale session reuse after clearSession: getSession() returns undefined post-clear
- TOCTOU lease gap: single atomic validateLease() call at start of executeProtectedOperation

---

## 8. Security Hardening Plan - 044-SEC Test Cases

| Test ID    | Scenario                                                   | Boundary                                 | Expected Result                                 |
| ---------- | ---------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------- |
| 044-SEC-01 | Navigate to SSRF target http://localhost:9000              | DomainSecurityService + IPC Handler      | PROHIBITED_DESTINATION                          |
| 044-SEC-02 | Navigate to cloud metadata http://169.254.169.254          | DomainSecurityService + IPC Handler      | PROHIBITED_DESTINATION                          |
| 044-SEC-03 | Navigate using file:// scheme                              | DomainSecurityService scheme block       | PROHIBITED_SCHEME                               |
| 044-SEC-04 | Navigate to unauthorized domain not in allowedDomains      | Domain allowlist check                   | UNAUTHORIZED_DOMAIN                             |
| 044-SEC-05 | Sensitive form interaction (password field, submit action) | interactForm sensitive-gate              | humanInterventionRequired: true                 |
| 044-SEC-06 | Screenshot destination outside allowedRoots                | PathSecurityService in captureScreenshot | PATH_OUTSIDE_SCOPE                              |
| 044-SEC-07 | Download from unauthorized domain                          | DomainSecurityService in downloadFile    | UNAUTHORIZED_DOMAIN                             |
| 044-SEC-08 | Download with redirect to unauthorized domain              | validateRedirect()                       | UNAUTHORIZED_REDIRECT                           |
| 044-SEC-09 | Expired/invalid ExecutionLeaseHeader                       | ExecutionLeaseBoundary.validateLease()   | LEASE_OR_POLICY_INVALID                         |
| 044-SEC-10 | Browser IPC during STOPPING lifecycle state                | Agent lifecycle state gate               | denied with lifecycle error                     |
| 044-SEC-11 | Use sessionId of cleared session for navigation            | sessionManager.getSession() undefined    | INVALID_SESSION                                 |
| 044-SEC-12 | Orphan sessions cleaned on BrowserRuntime.shutdown()       | BrowserRuntime.shutdown() + stop()       | profile directories removed, listSessions empty |

---

## 9. File Change Map

### Source Files

- apps/desktop-agent/src/runtimes/browser/schemas.ts [NEW] - Zod IPC request schemas for 9 browser IPC methods
- apps/desktop-agent/src/runtimes/browser/runtime.ts [MODIFY] - Add shutdown() method
- apps/desktop-agent/src/runtimes/browser/index.ts [MODIFY] - Re-export new schemas.ts
- apps/desktop-agent/src/agent.ts [MODIFY] - browserRuntime field, 9 capabilities, instantiation, rt:browser-v1 registration, 9 IPC handlers, shutdown() binding

### Test Files

- apps/desktop-agent/tests/local-browser-ipc.test.ts [NEW] - IPC integration & lifecycle tests (~10 cases)
- apps/desktop-agent/tests/local-browser-security-hardening.test.ts [NEW] - 12-case adversarial security suite

### Documentation Files

- apps/desktop-agent/docs/task-044-completion-report.md [NEW] - Task 044 completion report

---

## 10. Proposed Commit Sequence (13 commits)

1. feat(desktop-agent): define Task 044 Browser Runtime IPC request and response Zod schemas
2. feat(desktop-agent): register Browser capability descriptors in CapabilityRegistry
3. feat(desktop-agent): wire BrowserRuntime into DesktopAgent composition root
4. feat(desktop-agent): register rt:browser-v1 descriptor in RuntimeRegistry
5. feat(desktop-agent): register authorized browser.createSession and browser.navigate IPC handlers
6. feat(desktop-agent): register authorized browser.extractContent and browser.interactForm IPC handlers
7. feat(desktop-agent): register authorized browser.captureScreenshot and browser.downloadFile IPC handlers
8. feat(desktop-agent): register authorized browser.uploadFile, browser.clearSession, and browser.listSessions IPC handlers
9. fix(desktop-agent): add BrowserRuntime.shutdown() and bind to DesktopAgent.stop() for orphan session cleanup
10. test(desktop-agent): add Browser Runtime IPC integration and lifecycle test suite
11. test(desktop-agent): add Task 044 adversarial security regression suite (044-SEC-01 to 044-SEC-12)
12. style(desktop-agent): apply Prettier formatting to Task 044 sources and tests
13. docs(desktop-agent): create Task 044 completion report

---

## 11. Acceptance Criteria

Before Task 044 can be declared COMPLETE:

1. npm run typecheck - 0 TypeScript errors monorepo-wide
2. npm run lint - 0 ESLint errors
3. npm run format:check - 100% Prettier compliant
4. node scripts/validate-repo.js - PASSED
5. node scripts/security-scan.js - PASSED
6. npm test - 100% passing (all existing 569 tests + new Task 044 tests)
7. DesktopAgent has browserRuntime field of type BrowserRuntime
8. rt:browser-v1 registered in RuntimeRegistry
9. 9 capabilities registered in CapabilityRegistry (browser.createSession through browser.listSessions)
10. 9 IPC method handlers registered in IPCManager
11. BrowserRuntime.shutdown() cleans up all active sessions
12. DesktopAgent.stop() calls this.browserRuntime.shutdown()
13. 12 adversarial security test cases (044-SEC-01 through 044-SEC-12) - all pass
14. GitHub Actions CI - 100% GREEN (SUCCESS) on final push commit
15. Working tree clean and HEAD == origin/main
16. Task 045+ NOT STARTED

---

## 12. Task Boundary

### BELONGS TO TASK 044

- Zod IPC request/response schemas (schemas.ts) for 9 browser IPC methods
- BrowserRuntime.shutdown() method
- browserRuntime field and instantiation in DesktopAgent composition root
- rt:browser-v1 descriptor registration in RuntimeRegistry
- 9 capability descriptors in CapabilityRegistry
- 9 authorized IPC method handlers with 5-layer security gate pattern
- browserRuntime.shutdown() binding in DesktopAgent.stop()
- maxConcurrentSessions enforcement in browser.createSession
- IPC integration test suite
- 12-case adversarial security test suite
- Task 044 completion report

### DOES NOT BELONG TO TASK 044

- Actual Playwright/Chromium/CDP browser engine wiring (Sprint 0 uses mock/stub layer)
- Cloud browser infrastructure or remote browser orchestration
- Control-plane browser session visibility streaming
- Web dashboard UI for browser session monitoring
- Browser extensions or extension management
- Redesigning BrowserRuntime core logic unless required by concrete test failure
- Tasks 03A-043 modification
- Task 045+ work

### Tasks 03A-043: 100% intact and passing

### Task 044 implementation during this discovery: NOT STARTED

### Task 045+ NOT STARTED

---

## 13. Discovery Phase Verification

git status: On branch main, up to date with origin/main.
Untracked files: task_043_discovery_report.md, task_044_discovery_report.md
nothing added to commit but untracked files present

git diff --name-only: (empty - no tracked file changes)

New files created during discovery: task_044_discovery_report.md (this report - untracked, not committed)

No source code, tests, configuration, or runtime files modified.
No commits created. No pushes performed.
