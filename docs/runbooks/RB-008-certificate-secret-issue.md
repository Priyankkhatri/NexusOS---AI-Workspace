# RB-008: Operational Runbook — Certificate / Secret Issue

**Failure Domain:** Security Credentials, Token Expiration & Vault Reference Resolution  
**Severity:** HIGH (P1)  
**Owning Subsystem:** Identity & Access (`services/identity`), Local Vault Host (`apps/desktop-agent`)  
**Target Component:** `JwtValidator`, `OidcProvider`, `LocalVaultUpdateHost`, `SecretResolver`

---

## 1. Symptoms & Impact

### Symptoms

- Inbound API requests fail with HTTP 401 `UNAUTHORIZED` or HTTP 403 `FORBIDDEN` across services.
- Desktop Agent logs report: `Vault resolution error: Reference <refId> could not be resolved or decrypted`.
- Identity service logs report: `TokenExpiredError: jwt expired` or `JsonWebTokenError: invalid signature`.
- Lease HMAC validation fails or token revocation offline cache reports missing or invalid cryptographic keys.

### Impact

- Inter-service communication and client-to-control-plane requests fail authorization checks.
- Desktop Agent cannot retrieve encrypted API credentials for LLM runtime or external tool providers.
- Workflow orchestration halts due to failure in evaluating task authorization grants.

---

## 2. Detection & Observability

- **Log Events:**
  - Component: `services/identity/src/auth/jwt-validator.ts`
  - Level: `warn` or `error`
  - Message: `[JwtValidator] Token validation failed: jwt expired` or `[JwtValidator] Signature verification failed`.
  - Component: `apps/desktop-agent/src/vault/`
  - Message: `[LocalVaultHost] Secret decryption failed` or `[Vault] Lease HMAC verification mismatch`.
- **Metrics & Probes:**
  - `GET /health/readiness` on identity or backend returns HTTP 503 if primary signing secret is missing or misconfigured.
  - Inbound error counter spikes on HTTP status code `401` / `403`.

---

## 3. Immediate Containment

1. **Verify Clock Synchronization:**
   - Confirm NTP synchronization on the host machine. Token clock tolerance is configured to `5s` by default (`IDENTITY_TOKEN_CLOCK_TOLERANCE`). Clock skew >5s causes immediate validation failure.
2. **Prevent Automated Crash Loops:**
   - If secrets were rotated with malformed keys, isolate the misconfigured service to prevent token storming against identity.
3. **Preserve Valid Vault Leases:**
   - Ensure local encrypted cache (`vault-revocation-offline`) is not wiped while investigation is underway.

---

## 4. Diagnosis Procedures

1. **Check Identity Service Secret Configuration:**
   Inspect environment variables for `services/identity`:

   ```powershell
   # Verify environment variables
   $env:IDENTITY_ISSUER
   $env:IDENTITY_AUDIENCE
   $env:IDENTITY_SECRET_KEY
   ```

   Confirm `IDENTITY_SECRET_KEY` meets the minimum 16-character length constraint (`IdentityConfigSchema`).

2. **Inspect Token Validation Logs:**
   Filter identity service logs for JWT validation errors:

   ```powershell
   Select-String -Path "services/identity/logs/*.log" -Pattern "JwtValidator"
   ```

3. **Check Vault Reference Resolution in Desktop Agent:**
   Inspect desktop agent structured logs for vault resolution failures:
   ```powershell
   Select-String -Path "apps/desktop-agent/logs/*.log" -Pattern "Vault"
   ```
   Verify whether the secret reference exists in the active keystore or if an offline lease has expired.

---

## 5. Safe Actions, Recovery & Remediation

1. **Rotate Expired or Compromised Secret Keys:**
   Update the key in the operational configuration or environment:

   ```powershell
   $env:IDENTITY_SECRET_KEY = "<new_secure_secret_key_minimum_32_bytes!>"
   ```

   Restart the identity service to reload configuration:

   ```powershell
   npm run build --workspace=services/identity
   ```

2. **Synchronize System Clock:**
   On Windows host:

   ```powershell
   w32tm /resync
   ```

3. **Re-issue Expired Local Leases:**
   Trigger client re-authentication from the Desktop Agent tray / IPC interface:
   - Invalidate local expired session token.
   - Re-request fresh bearer token from Identity endpoint.

---

## 6. Verification After Recovery

1. **Verify Token Issuance & Validation:**
   Run the identity service validation suite:
   ```powershell
   npx vitest run services/identity/tests/jwt-validator.test.ts
   ```
2. **Verify Desktop Vault Operation:**
   Run desktop vault unit tests:
   ```powershell
   npx vitest run apps/desktop-agent/tests/vault-reference-authz.test.ts
   ```
3. **Verify End-to-End Auth Handshake:**
   Send an authenticated test probe to `/health/readiness` or task endpoints to confirm HTTP 200 response.

---

## 7. Escalation & Rollback

- **Secret Rollback:** If a key rotation was deployed incorrectly, roll back to the Last Known Good (LKG) secret in the secure environment vault.
- **Escalation:** Escalate to Security/Platform Engineering if credentials show evidence of external compromise or leakage.

---

## 8. Evidence Collection

Collect the following artifacts for the incident post-mortem:

- Redacted identity service logs showing failure timestamps and error codes (ensure no raw secret keys or tokens are captured).
- Host system clock skew offset at time of failure.
- Audit log entries from `StructuredLoggerRedaction` verifying sensitive token masking.
