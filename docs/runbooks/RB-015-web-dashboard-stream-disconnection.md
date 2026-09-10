# RB-015: Operational Runbook — Web Dashboard Stream Disconnection & Telemetry Lag

**Failure Domain:** Web Dashboard Real-Time Streaming & Activity Telemetry  
**Severity:** MEDIUM (P2) / LOW (P3)  
**Owning Subsystem:** Experience Platform (`apps/web-dashboard`), Backend Event Stream (`services/backend`)  
**Target Process:** `WebDashboardApp`, `EventStreamGateway`

---

## 1. Symptoms & Impact

### Symptoms

- Dashboard UI displays "Disconnected" or "Reconnecting to live event stream..." warning banner.
- Active workflow progress bars freeze; status changes in the backend do not update in the browser view without manual page refresh.
- Browser DevTools console reports WebSocket or EventSource connection closed with code `1006` or `ERR_CONNECTION_REFUSED`.
- Event latency indicator reports significant clock drift or telemetry lag (> 15 seconds).

### Impact

- Operators lack real-time visibility into running workflow tasks and approval states.
- Underlying backend and desktop agent execution is unaffected (control plane operates independently).
- Risk of operator confusion or submitting duplicate requests due to stale dashboard views.

---

## 2. Detection & Observability

- **Browser Console:** Errors matching `WebSocket connection to 'ws://...' failed` or `SSE stream timed out`.
- **Backend Log Events:**
  - `level: "warn"` emitted by `EventStreamGateway`: `Client disconnected abruptly from event stream` or `Backpressure buffer full for client stream`.
  - Client identifier: `clientId`, `tenantId`, `connectionDurationMs`.
- **Dashboard Telemetry Metric:**
  - `dashboard_stream_connected_clients`: Sudden drop.
  - `event_dispatch_lag_ms`: Elevated > 5,000ms.

---

## 3. Immediate Containment

1. **Verify Backend Task Controller Health:**
   Ensure the disconnection is isolated to the presentation stream and the core task API is healthy:
   ```bash
   curl -i http://127.0.0.1:3000/health/readiness
   ```
2. **Advise Operators to Rely on REST Fallback:**
   Operators can view task status via polling REST endpoint `GET /v1/tasks/:id` while stream reconnects.
3. **Verify Reverse Proxy WebSocket Upgrades:**
   Ensure upstream proxies (e.g. NGINX, Cloudflare, Vite dev proxy) correctly pass `Upgrade: websocket` headers.

---

## 4. Diagnosis Procedures

1. **Inspect Event Stream Endpoint:**
   Test the raw event stream directly from terminal:
   ```bash
   curl -N -H "Accept: text/event-stream" -H "Authorization: Bearer <TOKEN>" http://127.0.0.1:3000/v1/events/stream
   ```
2. **Check CORS & Origin Policies:**
   Confirm the dashboard origin (e.g. `http://localhost:5173`) is explicitly allowed in backend CORS configuration.
3. **Check Client Token Expiration:**
   Verify whether the user's JWT bearer token expired, causing authentication rejection on stream handshake.

---

## 5. Safe Actions & Recovery

1. **Trigger Client Reconnect:**
   In the dashboard UI, refresh the browser window or click "Reconnect" button to establish a new session.
2. **Restart Event Stream Gateway:**
   If the backend event dispatcher entered backpressure deadlock:
   - Gracefully reload the backend process; clients will reconnect automatically with exponential backoff.
3. **Renew Identity Token:**
   If the token expired, prompt the user to re-authenticate through the identity provider.

---

## 6. Verification After Recovery

1. Run dashboard security and observability invariant test suite:
   ```bash
   pnpm --filter @nexusos/web-dashboard test tests/vertical-slice/dashboard-security-invariants.test.ts
   ```
   **Expected Response:** All event streaming, tenant isolation, and XSS sanitization tests pass cleanly.

---

## 7. Escalation & Prevention

- **Escalation Path:** Experience Platform Lead / Frontend Engineering.
- **Prevention:** Implement automatic heartbeat ping/pong every 15 seconds across WebSocket streams with transparent client-side reconnection.
