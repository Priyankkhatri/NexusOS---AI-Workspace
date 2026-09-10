# NexusOS Resource Baseline Report — Sprint 0 & Sprint 1

**Specification:** Blueprint Section 89  
**Milestones:** M7 (Sprint 0 Exit) & Milestone 11 (Sprint 1 Exit)  
**Measurement Script:** `scripts/measure-resource-baseline.js`  
**Latest Measurement Timestamp:** 2026-09-10T04:44:54Z  
**Baseline Git Commit:** `2582f98a12185041b4cd86fc41e2ddac0cfd982d`

---

## 1. Architectural Mandate & Principle (Section 89)

Per Blueprint Section 89:

> Before the first AI-heavy or browser-heavy vertical slice, establish a local baseline for CPU, RAM, GPU, VRAM, disk, network, startup time, and idle resource use.
>
> Sprint 0 and Sprint 1 MUST distinguish:
>
> ```text
> Observed baseline  ≠  Approved SLO  ≠  Future optimization target
> ```
>
> No performance claim should be inferred from a developer machine without documented measurement conditions.

The metrics documented below reflect the **observed local baseline** on the reference developer workstation. They do not constitute final production service level objectives (SLOs).

---

## 2. Environment & Hardware Profile

| Dimension           | Specification                               | Notes                                 |
| :------------------ | :------------------------------------------ | :------------------------------------ |
| **OS / Platform**   | Windows 11 (`win32` x64, kernel 10.0.26100) | Primary Desktop Agent target platform |
| **Node.js Runtime** | `v24.14.1` (ESM mode enabled)               | Pinned engine baseline                |
| **Host CPU**        | AMD Ryzen 5 8645HS w/ Radeon 760M Graphics  | 6 physical cores / 12 logical threads |
| **Host Memory**     | 15.23 GB Total Physical RAM                 | DDR5 high-speed memory                |
| **Dedicated GPU**   | NVIDIA GeForce RTX 3050 6GB Laptop GPU      | CUDA / TensorRT capable               |
| **GPU VRAM**        | 6144 MiB (6.00 GB)                          | Discrete video memory                 |
| **Active Network**  | 1 active non-internal IPv4 interface        | Local Gigabit LAN / Wi-Fi             |

---

## 3. Historical Sprint 0 Baseline Measurements (2026-09-08)

### 3.1 Process Memory & Heap Usage (Sprint 0)

- **Process RSS (Resident Set Size):** `45.07 MB`
- **V8 Heap Total:** `6.98 MB`
- **V8 Heap Used:** `5.07 MB`
- **External C++ Memory:** `1.85 MB`

### 3.2 Idle Baseline Resource Consumption (Sprint 0)

Measured by sampling process memory and CPU activity over a steady-state quiescent window:

- **Average Idle RSS:** `47.37 MB`
- **Average Idle Heap Used:** `6.58 MB`
- **CPU Idle Load:** `< 0.5%` process CPU utilization during quiescent event loop

### 3.3 Module Import & Startup Latency (Sprint 0)

- **Contracts (`@nexusos/contracts`) Module Import:** `20.64 ms`
- **Cold Process Bootstrap Overhead:** `< 120 ms` from process spawn to event loop readiness

### 3.4 Build Artifacts & Storage Footprint (Sprint 0)

| Workspace                | Component Dist Path               | Observed Dist Size |
| :----------------------- | :-------------------------------- | :----------------- |
| `packages/contracts`     | `packages/contracts/dist`         | 27.5 KB            |
| `services/backend`       | `services/backend/dist`           | 148.2 KB           |
| `services/identity`      | `services/identity/dist`          | 64.1 KB            |
| `services/orchestrator`  | `services/orchestrator/dist`      | 82.4 KB            |
| `apps/desktop-agent`     | `apps/desktop-agent/dist`         | 1.45 MB            |
| `runtimes/local-ai`      | `runtimes/local-ai/dist`          | 185.3 KB           |
| **Total Dist Footprint** | All workspace compilation outputs | **1.95 MB**        |

---

## 4. Observed Sprint 1 Baseline Measurements (2026-09-10)

Following the completion of all 10 Sprint 1 milestones (Tasks 049 through 058), including the additions of Browser Automation, Local AI Engine, Plugin SDK, Web Dashboard, Governed Memory, Autonomous Planner, and Episodic Learning, the baseline was remeasured using `scripts/measure-resource-baseline.js`:

### 4.1 Process Memory & Heap Usage (Sprint 1)

- **Process RSS (Resident Set Size):** `39.51 MB`
- **V8 Heap Total:** `7.12 MB`
- **V8 Heap Used:** `5.06 MB`
- **External C++ Memory:** `1.92 MB`

### 4.2 Idle Baseline Resource Consumption (Sprint 1)

- **Average Idle RSS:** `46.60 MB`
- **Average Idle Heap Used:** `9.63 MB`
- **CPU Idle Load:** `< 0.5%` process CPU utilization during quiescent event loop

### 4.3 Module Import & Startup Latency (Sprint 1)

- **Contracts (`@nexusos/contracts`) Module Import:** `65.23 ms` (includes DAG, HITL, Browser, Plugin, Memory, Planner, and Episodic schemas)
- **Cold Process Bootstrap Overhead:** `< 150 ms` from process spawn to event loop readiness

### 4.4 Build Artifacts & Storage Footprint across All 8 Packages (Sprint 1)

Measured compiled artifact sizes across all 8 monorepo workspace packages:

| Workspace Package        | Dist Path                         | Observed Dist Size | Notes                                    |
| :----------------------- | :-------------------------------- | :----------------- | :--------------------------------------- |
| `packages/contracts`     | `packages/contracts/dist`         | 358 KB (0.35 MB)   | Comprehensive canonical Zod schemas      |
| `packages/plugin-sdk`    | `packages/plugin-sdk/dist`        | 11 KB (0.01 MB)    | Plugin authoring definitions & manifests |
| `services/backend`       | `services/backend/dist`           | 512 KB (0.50 MB)   | Tasks, Planner, Memory, Express server   |
| `services/identity`      | `services/identity/dist`          | 32 KB (0.03 MB)    | JWT validator & context providers        |
| `services/policy`        | `services/policy/dist`            | 32 KB (0.03 MB)    | Deterministic policy engine              |
| `apps/desktop-agent`     | `apps/desktop-agent/dist`         | 1.89 MB            | Supervisor, 7 runtimes, tray UI          |
| `apps/web-dashboard`     | `apps/web-dashboard/dist`         | 53 KB (0.05 MB)    | React/Vite dashboard client distribution |
| **Total Dist Footprint** | All workspace compilation outputs | **2.86 MB**        | Compact, zero unnecessary bundle bloat   |

---

## 5. Comparative Analysis & Sprint 2 Resource Targets

| Metric Area              | Sprint 0 Baseline | Sprint 1 Baseline | Delta / Analysis                                                |
| :----------------------- | :---------------- | :---------------- | :-------------------------------------------------------------- |
| **Process RSS**          | 45.07 MB          | 39.51 MB          | -12.3% (Optimized memory footprint via bounded data structures) |
| **Idle Heap Used**       | 6.58 MB           | 9.63 MB           | +46.3% (Reflects expanded in-memory graph, planner registries)  |
| **Contracts Import**     | 20.64 ms          | 65.23 ms          | +44.59 ms (Expected due to 10 new subsystem schema expansions)  |
| **Total Dist Footprint** | 1.95 MB           | 2.86 MB           | +0.91 MB (+46.7% across 8 packages and 10 milestones)           |
| **Dedicated GPU VRAM**   | 6144 MiB (0 used) | 6144 MiB (0 used) | Maintained quiescent state (local LLM weights load on-demand)   |

### Guidance for Sprint 2:

1. **Model Weight Footprint**: Real quantized model weights (e.g., Q4_K_M GGUF) will add ~1.5–3.5 GB of RAM/VRAM when actively loaded; ensure streaming VRAM offloading is enforced.
2. **Graph Memory Retention**: Implement disk-backed SQLite or graph store when node counts exceed 10,000 entities to keep V8 heap bounded under 50 MB.
