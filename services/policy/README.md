# `@nexusos/policy` — NexusOS Policy Decision Service Foundation

This package provides the control-plane Policy Decision Engine foundation for NexusOS, establishing deterministic decision evaluation, policy snapshots, decision evidence traceability, and HTTP authorization middleware.

---

## 🏛️ Governance & Authority

This package is strictly governed by the authoritative specifications in [`docs/`](file:///c:/Users/priya/Desktop/Nexus%20AI/docs):

1. **NexusOS Backend Engineering Design Document (EDD)** (`docs/EDDs/NexusOS_Backend_Engineering_Design_Document_EDD.md` Section 3.2)
2. **NexusOS Desktop Agent EDD** (`docs/EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md`)
3. **NexusOS Architecture Bible** (`docs/Architecture_and_Specs/`)

### 🛑 Responsibilities & Architectural Boundaries

- **Policy OWNS**: Action evaluation ("Is this authenticated identity allowed to perform action A on resource R?"), Policy snapshots/hashes, `DecisionEvidence` creation, 403 error responses.
- **Policy DOES NOT OWN**: User authentication / JWT parsing (owned by Identity service), database ownership, or Desktop Agent tool execution runtime.

---

## 📐 Policy Decision Model

```
Subject (AuthenticatedContext)
  + Action (actionName, requiredRole/Scope)
  + Resource (resourceType, resourceId, tenantId)
  + Context (requestId, correlationId, timestamp)
  + Policy Snapshot (version, hash, rules)
      ↓
  PolicyDecisionResult (ALLOW / DENY)
```

---

## 🔒 Security & Fail-Closed Behavior

- **Fail-Closed Guarantee**: Missing identity context, expired tokens, tenant isolation mismatches, or missing rules automatically result in a strict `DENY` decision.
- **Tenant Isolation**: Prevents cross-tenant resource access unless explicitly permitted by tenant-scoped rules.
- **No Default-Allow**: Any request not matched by an explicit `ALLOW` rule evaluates to `DENY`.
- **Decision Traceability**: Every decision produces an immutable `DecisionEvidence` audit record linking `decisionId`, `policyVersion`, `policyHash`, `principalId`, and `requestId`.

---

## ⚡ Usage Example

```typescript
import {
  loadPolicyConfig,
  ReferencePolicyEvaluator,
  createPolicyMiddleware,
  PolicyEffect,
} from '@nexusos/policy';

const config = loadPolicyConfig(process.env);
const evaluator = new ReferencePolicyEvaluator(config, [
  {
    ruleId: 'rule-tasks-dispatch',
    actionName: 'tasks:dispatch',
    resourceType: 'task',
    requiredRole: 'operator',
    effect: PolicyEffect.ALLOW,
  },
]);

const policyMiddleware = createPolicyMiddleware(evaluator);

// In HTTP route:
const allowed = await policyMiddleware({
  actionName: 'tasks:dispatch',
  resourceType: 'task',
  requiredRole: 'operator',
})(req, res);
```

---

## 🧪 Testing

Run Policy service foundation tests:

```bash
pnpm --filter @nexusos/policy test
```
