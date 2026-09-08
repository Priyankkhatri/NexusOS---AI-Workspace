# NexusOS Resource Baseline Report — Sprint 0

**Specification:** Blueprint Section 89  
**Milestone:** M7 — Sprint 0 Exit  
**Measurement Script:** `scripts/measure-resource-baseline.js`  
**Measurement Timestamp:** 2026-09-08T12:34:28Z

---

## 1. Architectural Mandate & Principle (Section 89)

Per Blueprint Section 89:

> Before the first AI-heavy or browser-heavy vertical slice, establish a local baseline for CPU, RAM, GPU, VRAM, disk, network, startup time, and idle resource use.
>
> Sprint 0 MUST distinguish:
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

## 3. Observed Sprint 0 Baseline Measurements

### 3.1 Process Memory & Heap Usage

- **Process RSS (Resident Set Size):** `45.07 MB`
- **V8 Heap Total:** `6.98 MB`
- **V8 Heap Used:** `5.07 MB`
- **External C++ Memory:** `1.85 MB`

### 3.2 Idle Baseline Resource Consumption

Measured by sampling process memory and CPU activity over a steady-state quiescent window:

- **Average Idle RSS:** `47.37 MB`
- **Average Idle Heap Used:** `6.58 MB`
- **CPU Idle Load:** `< 0.5%` process CPU utilization during quiescent event loop

### 3.3 Module Import & Startup Latency

- **Contracts (`@nexusos/contracts`) Module Import:** `20.64 ms`
- **Cold Process Bootstrap Overhead:** `< 120 ms` from process spawn to event loop readiness

### 3.4 Build Artifacts & Storage Footprint

Measured compiled artifact sizes across workspaces:

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

## 4. Comparison Framework for Sprint 1

In Sprint 1, when real local LLM runtimes (e.g. ONNX Runtime, llama.cpp bindings) and browser execution sandboxes are introduced, this baseline will be rerun using `node scripts/measure-resource-baseline.js` to measure:

1. Additional memory footprint of model weights loaded into host RAM vs GPU VRAM.
2. Cold startup time delta when initializing WebAssembly / native runtimes.
3. Process memory growth under concurrent task dispatching.
