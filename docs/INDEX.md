# NexusOS AI & Contributor Documentation Index

Welcome to the central documentation navigation hub for NexusOS. This index provides clickable links to all authoritative specifications, engineering designs, contracts, operational runbooks, decision records, and security models.

---

## 🏛️ Authoritative Governance & Architecture

- 📄 **[NexusOS Enterprise PRD](PRDs/NexusOS_Enterprise_PRD_for_AI_Desktop_Agent_and_Web_Platform.md)**: Product requirements, MVP roadmap, release tiers, and user personas.
- 📐 **[NexusOS Architecture Bible](Architecture_and_Specs/NexusOS_Architecture_Bible_Pre_EDD_Foundation.md)**: System invariants, trust boundaries, control/runtime plane isolation, and event model.
- 📜 **[NexusOS AI Coding Standards & Development Guide](Architecture_and_Specs/NexusOS_AI_Coding_Standards_and_Development_Guide.md)**: Engineering constitution, naming rules, parent-document rules, and coding constraints.
- 🚀 **[NexusOS Sprint 0 Implementation Blueprint](Architecture_and_Specs/NexusOS_Sprint_0_Implementation_Blueprint.md)**: Sprint 0 phase transition program and validation criteria.
- 🧭 **[Architecture Index](ARCHITECTURE_INDEX.md)**: Multi-plane platform overview, service responsibilities, and system invariants.
- 🤖 **[AI Engineering Index](AI_ENGINEERING_INDEX.md)**: Operational guide and document precedence for autonomous coding agents (Antigravity/Codex).

---

## 🛠️ Subsystem Engineering Design Documents (EDDs)

- 🤖 **[AI Runtime EDD](EDDs/NexusOS_AI_Runtime_Engineering_Design_Document_EDD.md)**: Model router, execution plane, tool call dispatching, and prompt isolation.
- ⚙️ **[Backend EDD](EDDs/NexusOS_Backend_Engineering_Design_Document_EDD.md)**: Gateway, orchestrator, policy engine, memory service, and telemetry.
- 💻 **[Desktop Agent EDD](EDDs/NexusOS_Desktop_Agent_Engineering_Design_Document_EDD.md)**: Windows execution plane, IPC bridge, system tray, local authorization prompts.
- 🌐 **[Experience Platform EDD](EDDs/NexusOS_Experience_Platform_Engineering_Design_Document_EDD.md)**: Web dashboard, component library, state management, and visual activity logs.

---

## 🔌 Contracts & API Specifications

- 📡 **[API Contract Specification — Section 1](Architecture_and_Specs/NexusOS_API_Contract_Specification_Section_1_System_Communication_Map.md)**: System communication map, endpoints, request/response formats, and correlation IDs.
- 📦 **[Shared Contracts Package Guide](CONTRACTS.md)**: Governance, Zod schemas, error taxonomy, and ACP protocol envelopes.

---

## 📋 Architectural Decisions & Threat Models

- 📝 **[ADR 0001: Monorepo Foundation & Toolchain Pinning](../adrs/0001-monorepo-foundation.md)**: ADR establishing monorepo layout, toolchain versions, and quality commands.
- 🛡️ **[Threat Model TM-0001: Monorepo & Secret Baseline](../threat-models/TM-0001-phase0-baseline.md)**: Initial threat assessment and secret hygiene model.

---

## 📖 Developer & Operational Guides

- 💻 **[Local Development Setup](LOCAL_DEVELOPMENT.md)**: Step-by-step developer environment setup, running services, and local troubleshooting.
- 🛠️ **[General Development Guide](DEVELOPMENT.md)**: Canonical toolchain commands and validation workflows.
- 🧪 **[Testing Strategy Guide](TESTING.md)**: Test execution, coverage criteria, and contract testing.
- 🔒 **[Security Baseline Guide](SECURITY.md)**: Secret hygiene, vulnerability scanner, and security requirements.
- 📊 **[Observability & Audit Guide](OBSERVABILITY.md)**: Structured logging, secret redaction, telemetry spooling, and evidence receipts.
- 🚢 **[Deployment & Release Guide](DEPLOYMENT.md)**: Multi-environment topologies, containerization, and safe migrations.
- 🚨 **[Operational Runbooks Index](RUNBOOKS.md)**: Master index for all 10 failure-domain runbooks (`RB-001` through `RB-010`).
- 🔧 **[Troubleshooting Guide](TROUBLESHOOTING.md)**: Quick diagnostic tables, triage commands, and issue resolution workflows.
- 📈 **[Resource Baseline Report](RESOURCE_BASELINE.md)**: Sprint 0 local hardware resource baseline measurements.
- 🏁 **[Sprint 1 Readiness & Backlog](SPRINT_1_READINESS_AND_BACKLOG.md)**: Transition assessment and candidate backlog for Sprint 1.
