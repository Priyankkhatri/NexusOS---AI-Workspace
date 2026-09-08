# RB-006: Operational Runbook — Model Provider Outage

**Failure Domain:** External / Upstream Model Provider & Gateway  
**Severity:** HIGH (P1)  
**Owning Subsystem:** Model Provider Adapters (`apps/desktop-agent/src/runtimes/local-ai/providers/`)  
**Target Component:** `LocalModelProviderAdapter`, Control-Plane Provider Gateway

---

## 1. Symptoms & Impact

### Symptoms

- Remote model provider requests return HTTP 503 Service Unavailable, HTTP 429 Too Many Requests (Rate Limited), or connection timeout (`ETIMEDOUT`).
- Local provider loopback adapter cannot reach background inference engine daemon (`ECONNREFUSED` on loopback port).
- Tasks requiring generative inference or complex reasoning stall or transition to `FAILED`.
- Task error code reports `PROVIDER_OUTAGE`, `UPSTREAM_UNAVAILABLE`, or `RATE_LIMIT_EXCEEDED`.

### Impact

- AI-driven automation steps cannot proceed.
- Workflows dependent on model output halt at the affected node.
- Deterministic/low-risk device capabilities (`device.*`, `filesystem.*`, `terminal.*`) continue to function normally.

---

## 2. Detection & Observability

- **Log Events:**
  - Component: `LocalAiProviderAdapter`
  - Level: `error` or `warn`
  - Message: `Upstream model provider returned error 503` or `Rate limit exceeded; backoff engaged`.
- **Error Codes:**
  - `PROVIDER_UNAVAILABLE`
  - `RATE_LIMITED`
  - `LOOPBACK_CONNECTION_REFUSED`
  - `INVALID_PROVIDER_RESPONSE`

---

## 3. Immediate Containment

1. Engage circuit breaker / backoff:
   - Prevent client task queues from flooding the failing upstream provider with retry storms.
   - Enforce exponential backoff with jitter on transient 5xx errors.
2. Maintain fail-closed posture:
   - Do NOT bypass policy gates or fabricate artificial model completions.
   - Transition affected tasks cleanly to `FAILED` with informative error message (`EXECUTION_FAILED: Upstream model provider temporarily unavailable`).
3. Preserve non-AI capabilities:
   - Ensure other desktop runtimes remain active for non-AI tasks.

---

## 4. Diagnosis Procedures

1. **Verify Provider Network Status:**
   - If using a cloud provider: check public status page (e.g., Anthropic, OpenAI, Vertex AI).
   - If using local background daemon (e.g., Ollama, llama.cpp): verify process is active on localhost:
     ```powershell
     Get-Process -Name "ollama" -ErrorAction SilentlyContinue
     curl http://127.0.0.1:11434/api/tags
     ```
2. **Verify Loopback Security Constraints:**
   - Ensure provider URL satisfies `validateLoopbackEndpoint` (blocks non-loopback SSRF attacks; only `127.0.0.1`, `::1`, or `localhost` allowed for local providers).
3. **Inspect Authentication / API Key:**
   - Confirm credentials stored in Secrets Vault have not expired or been revoked.
   - Confirm no Bearer token strings are logged in plaintext.

---

## 5. Safe Actions & Recovery

1. **Restart Local Provider Daemon (if local):**
   ```powershell
   # If using local inference daemon
   Restart-Service -Name "ollama" -ErrorAction SilentlyContinue
   ```
2. **Failover to Secondary Provider (if configured):**
   - If a fallback provider adapter is configured in the runtime, route subsequent requests to the secondary endpoint.
3. **Re-test Provider Adapter:**
   ```bash
   node --import tsx/esm --test apps/desktop-agent/tests/local-ai-provider-adapters.test.ts
   ```

---

## 6. Verification After Recovery

1. Issue diagnostic ping to model provider adapter:
   - Confirm healthy response code (HTTP 200) and latency within expected budget (<2000ms).
2. Execute failure injection scenario 5 (provider failure handling):
   ```bash
   node --import tsx/esm --test tests/vertical-slice/failure-injection.test.ts
   ```
   **Expected Result:** Graceful error handling verified with clean failure transition.

---

## 7. Escalation & Rollback

- If primary cloud provider outage is widespread:
  1. Post system notice in status dashboard.
  2. Switch default routing policy to queue incoming non-interactive tasks until recovery.
- If unresolvable within 30 minutes:
  - Escalate to AI Operations / Platform Engineering Lead.

---

## 8. Evidence Collection

- Capture HTTP response status and error headers (with API keys redacted).
- Record provider latency logs and correlation IDs.
- Archive task execution failure record.
