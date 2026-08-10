# Security Baseline — NexusOS Monorepo

NexusOS enforces strict security rules from Phase 0 onwards.

---

## 🛡️ Security Mechanisms

- **Secret Scanning**: Executed via `pnpm run security` (`scripts/security-scan.js`). Checks for API keys, private keys, AWS credentials, and `.env` files.
- **Lockfile Enforcement**: CI requires frozen lockfile dependencies (`pnpm-lock.yaml`) to ensure build reproducibility.
- **Git Ignore**: Ignores `.env`, private keys, certificates, build outputs, and temporary files.
