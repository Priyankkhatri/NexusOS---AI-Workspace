# RB-018: Operational Runbook — Governed Memory Poisoning & Secret Leakage

**Failure Domain:** Governed Memory Runtime, Untrusted Delimiters & Secret Redaction  
**Severity:** CRITICAL (P0) / HIGH (P1)  
**Owning Subsystem:** Memory Subsystem (`services/backend/src/memory`), Memory Contracts (`packages/contracts/src/memory`)  
**Target Process:** `MemoryService`, `RedactionFilter`, `MemoryStore`

---

## 1. Symptoms & Impact

### Symptoms

- Attempt to store memory record fails with error `MemorySecretDetectedError` or code `056-SEC-07` / `058-SEC-07`.
- Cross-tenant memory retrieval query is rejected with `CROSS_TENANT_FORBIDDEN`.
- Memory search query returns records missing required untrusted delimiters `<<<UNTRUSTED_RETRIEVED_MEMORY>>>`.
- Sensitive token (API key, private key, AWS credential) detected in retrieved prompt context.

### Impact

- Prevention of memory poisoning attacks attempting to elevate memory content to execution authority.
- Hard isolation between tenants prevents cross-tenant data exfiltration.
- Unredacted credentials are prevented from entering persistent long-term storage or LLM context windows.

---

## 2. Detection & Observability

- **Security Alerts:**
  - Alert `056-SEC-01`: Attempt to execute memory content as instruction or authority.
  - Alert `056-SEC-07` / `058-SEC-07`: Raw secret pattern detected by `RedactionFilter`.
  - Alert `056-SEC-02`: Cross-tenant search or read attempt intercepted.
- **Log Events:**
  - `level: "error"` emitted by `MemoryService`: `Memory operation aborted: Secret pattern detected in content`.
  - Log fields: `tenantId`, `workspaceId`, `memoryId`, `secretPatternMatched`.
- **API Status:** HTTP 400 Bad Request on memory injection with secret; HTTP 404/403 on cross-tenant read.

---

## 3. Immediate Containment

1. **Verify Rejection of Ingested Secret:**
   Confirm the secret was blocked _before_ database commit:
   - Check that `getMemory(memoryId)` returns null for the rejected transaction.
2. **Tombstone Compromised Record (if already stored):**
   If a poisoned record was committed under an earlier revision:
   ```bash
   curl -X DELETE http://127.0.0.1:3000/v1/memory/<memoryId> \
     -H "Authorization: Bearer <ADMIN_TOKEN>"
   ```
   Confirm atomic cascade tombstoning marks derived records and graph nodes as revoked.
3. **Verify Delimiter Wrapping:**
   Confirm all retrieved memories delivered to planners or runtimes are enclosed in `<<<UNTRUSTED_RETRIEVED_MEMORY>>>`.

---

## 4. Diagnosis Procedures

1. **Scan Content with RedactionFilter:**
   Run the content through `RedactionFilter.scanForSecrets(text)` to identify the offending pattern.
2. **Audit Memory Provenance:**
   Examine `memory.provenance`:
   - Inspect `sourceType`, `creatorPrincipalId`, and `timestamp` to identify the origin of the submission.
3. **Inspect Tenant Scoping:**
   Verify whether the search query payload `tenantId` matched the caller's JWT token `principal.tenantId`.

---

## 5. Safe Actions & Recovery

1. **Sanitize and Resubmit Record:**
   Instruct the caller application or agent to redact credentials or pass vault references instead of raw secrets.
2. **Purge Cache / Vector Index:**
   If using an external vector store or projection cache:
   - Clear cached embeddings for the tombstoned record ID.
3. **Review Ingestion Filter Rules:**
   If a new secret format slipped through:
   - Update `RedactionFilter` regex patterns with comprehensive token signatures.

---

## 6. Verification After Recovery

1. Run governed memory security invariant tests:
   ```bash
   pnpm --filter @nexusos/backend test services/backend/tests/memory/memory-security.test.ts
   ```
   **Expected Response:** All delimiter wrapping, sensitivity inheritance, and secret rejection tests pass cleanly.

---

## 7. Escalation & Prevention

- **Escalation Path:** Security Operations / Platform Data Governance.
- **Prevention:** Always enforce client-side and server-side secret scanning using `RedactionFilter` before any memory atom is serialized to persistent storage.
