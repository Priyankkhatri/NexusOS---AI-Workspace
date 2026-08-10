# Testing Guide — NexusOS Monorepo

NexusOS testing validates code correctness, contract adherence, and system safety.

---

## 🧪 Execution

To run the complete test suite using **pnpm**:

```bash
pnpm run test
```

## 🎯 Test Layers

1. **Unit & Contract Tests**: Test schema definitions, contracts, and error taxonomies (`packages/contracts/tests/`).
2. **Monorepo Sanity Tests**: Test path mappings, cross-package imports, and system environment constraints (`tests/sanity.test.ts`).
3. **Repository Validation**: Validate directory layout and boundary isolation (`pnpm run validate`).
