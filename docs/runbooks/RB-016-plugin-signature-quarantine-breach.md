# RB-016: Operational Runbook — Plugin Signature Tampering & Quarantine

**Failure Domain:** Plugin SDK, Extensibility & Governed Third-Party Integrations  
**Severity:** CRITICAL (P0) / HIGH (P1)  
**Owning Subsystem:** Plugin Framework (`packages/plugin-sdk`), Plugin Runtime (`apps/desktop-agent/src/runtimes/plugins`)  
**Target Process:** `PluginHost`, `PluginRegistry`

---

## 1. Symptoms & Impact

### Symptoms

- Plugin installation or activation rejected with error `PLUGIN_SIGNATURE_INVALID` or `MANIFEST_TAMPERING_DETECTED`.
- Active plugin is automatically transitioned to status `QUARANTINED` by the runtime supervisor.
- Invocation of a plugin capability is blocked with error `PLUGIN_IN_QUARANTINE_CANNOT_EXECUTE`.
- Two-Factor capability check fails closed because plugin manifest requests a capability not granted in the tenant lease (`CAPABILITY_NOT_GRANTED_IN_LEASE`).

### Impact

- Malicious, corrupted, or tampered third-party code is strictly blocked from executing on the host.
- Legitimate plugins with expired or improperly generated signatures cannot be installed.
- System integrity and host isolation are preserved fail-closed.

---

## 2. Detection & Observability

- **Security Alert:** Alert triggered under `054-SEC-01` (Signature Verification) or `054-SEC-04` (Quarantine Enforcement).
- **Log Events:**
  - `level: "error"` emitted by `PluginHost`: `Cryptographic signature mismatch for plugin package` or `Refusing invocation for quarantined plugin`.
  - Correlation fields: `pluginId`, `publisherId`, `manifestHash`, `tenantId`.
- **Status Endpoint:**
  - Querying `GET /v1/plugins/:id` returns `status: "QUARANTINED"`.

---

## 3. Immediate Containment

1. **Verify Execution Block:**
   Confirm the runtime immediately denied execution and terminated any active worker hosts for the plugin.
2. **Prevent Deserialization:**
   Ensure the untrusted plugin bundle is not dynamically imported or eval'd.
3. **Audit Tenant Scope:**
   Check whether the tampered package was submitted to a specific tenant or globally, and ensure other tenants are unaffected.

---

## 4. Diagnosis Procedures

1. **Inspect Cryptographic Signature:**
   Verify the digital signature of the plugin package against the publisher's public key:
   - Check if the manifest file `plugin.json` was altered after signing.
2. **Inspect Manifest Capabilities:**
   Review `manifest.requestedCapabilities`:
   - Identify if the plugin attempted to request unpermitted high-risk capabilities (e.g. `raw_shell_exec`, `network_bypass`).
3. **Check Plugin Registry State:**
   Inspect the in-memory or persistent catalog record:
   - Ensure the plugin has not attempted an illegal state transition from `QUARANTINED` to `ACTIVATED` without administrative override.

---

## 5. Safe Actions & Recovery

1. **Re-sign Authentic Plugin:**
   If the failure was caused by an unsigned build during developer testing:
   - Sign the package using the verified developer private key and authorized toolchain:
     ```bash
     pnpm --filter @nexusos/plugin-sdk run sign-package
     ```
2. **Remove Quarantined Artifacts:**
   If malicious tampering is confirmed:
   - Delete the untrusted package files from the staging cache.
   - Block the offending publisher ID across the tenant policy.
3. **Re-install Clean Verified Version:**
   Install a verified release from the authoritative catalog.

---

## 6. Verification After Recovery

1. Run the plugin SDK security invariant test suite:
   ```bash
   pnpm --filter @nexusos/plugin-sdk test tests/vertical-slice/plugin-sdk-security-invariants.test.ts
   ```
   **Expected Response:** All package verification, 2FA capability checks, and quarantine enforcement tests pass cleanly.

---

## 7. Escalation & Prevention

- **Escalation Path:** Security Engineering / Extensibility Lead.
- **Prevention:** Enforce strict supply-chain signature verification in CI before plugins are published to the internal catalog.
