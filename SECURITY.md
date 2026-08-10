# NexusOS Security Policy

NexusOS prioritizes security-by-default, least-privilege execution, and explicit authorization.

---

## 🔒 Reporting Vulnerabilities

If you discover a security vulnerability or credential leak within NexusOS:

1. **DO NOT** create a public GitHub issue.
2. Email security findings directly to `security@nexusos.dev`.
3. Include detailed steps to reproduce, affected versions, and potential risk impact.

---

## 🛡️ Phase 0 Security Baseline Requirements

All contributions MUST adhere to the Phase 0 security baseline:

- **No Committed Secrets**: Never commit `.env`, API keys, private keys, or passwords. Local secrets MUST remain in `.gitignore`.
- **Dependency Pinning**: All dependencies MUST be reproducibly pinned in lockfiles.
- **Automated Scanning**: CI runs automated secret scanning (`npm run security`) and dependency verification on every pull request.
- **Fail-Closed Security**: Security boundaries and policy engines fail closed by default.
