#!/usr/bin/env node
/**
 * scripts/measure-resource-baseline.js
 *
 * Sprint 0 Milestone M7: Resource Baseline Measurement
 * Implements Blueprint Section 89:
 * - CPU, RAM, GPU, VRAM, Disk, Network, Startup time, Idle resource use.
 *
 * Uses strictly built-in Node.js / system facilities with ZERO external dependencies.
 */

import os from 'node:os';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export function getDirectorySize(dirPath) {
  let total = 0;
  try {
    if (!fs.existsSync(dirPath)) return 0;
    const stats = fs.statSync(dirPath);
    if (stats.isFile()) return stats.size;
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      try {
        const fileStats = fs.statSync(fullPath);
        if (fileStats.isDirectory()) {
          total += getDirectorySize(fullPath);
        } else {
          total += fileStats.size;
        }
      } catch {
        // Skip inaccessible files
      }
    }
  } catch {
    return 0;
  }
  return total;
}

export function probeGpu() {
  const gpuInfo = {
    detected: false,
    model: 'Not detected / Not available',
    vram: 'N/A',
    notes:
      'No compatible GPU CLI (nvidia-smi or wmic) found or running in virtualized/headless environment.',
  };

  if (process.platform === 'win32') {
    try {
      const output = execSync('wmic path win32_VideoController get Name,AdapterRAM /format:list', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const lines = output.split('\r\n').filter(Boolean);
      let name = '';
      let adapterRam = '';
      for (const line of lines) {
        if (line.startsWith('Name=')) name = line.replace('Name=', '').trim();
        if (line.startsWith('AdapterRAM=')) adapterRam = line.replace('AdapterRAM=', '').trim();
      }
      if (name) {
        gpuInfo.detected = true;
        gpuInfo.model = name;
        if (adapterRam && !isNaN(Number(adapterRam))) {
          gpuInfo.vram = formatBytes(Number(adapterRam));
        }
        gpuInfo.notes = 'Detected via Windows WMI VideoController.';
      }
    } catch {
      // Fallback to nvidia-smi
    }
  }

  if (!gpuInfo.detected) {
    try {
      const nvidiaOut = execSync(
        'nvidia-smi --query-gpu=gpu_name,memory.total --format=csv,noheader',
        {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        },
      );
      if (nvidiaOut && nvidiaOut.trim()) {
        const parts = nvidiaOut.trim().split(',');
        gpuInfo.detected = true;
        gpuInfo.model = parts[0]?.trim() || 'NVIDIA GPU';
        gpuInfo.vram = parts[1]?.trim() || 'N/A';
        gpuInfo.notes = 'Detected via nvidia-smi.';
      }
    } catch {
      // No nvidia-smi
    }
  }

  return gpuInfo;
}

export async function measureIdleUsage(samples = 3, sampleIntervalMs = 300) {
  const readings = [];
  for (let i = 0; i < samples; i++) {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    readings.push({ mem, cpu });
    await new Promise((resolve) => setTimeout(resolve, sampleIntervalMs));
  }
  const avgRss = readings.reduce((acc, r) => acc + r.mem.rss, 0) / readings.length;
  const avgHeapUsed = readings.reduce((acc, r) => acc + r.mem.heapUsed, 0) / readings.length;
  return {
    avgRssBytes: Math.round(avgRss),
    avgRssFormatted: formatBytes(avgRss),
    avgHeapUsedBytes: Math.round(avgHeapUsed),
    avgHeapUsedFormatted: formatBytes(avgHeapUsed),
  };
}

export async function measureStartup() {
  const t0 = performance.now();
  try {
    await import('../packages/contracts/dist/index.js');
  } catch {
    // If dist doesn't exist yet, import package source or measure base overhead
  }
  const t1 = performance.now();
  return {
    contractsImportLatencyMs: +(t1 - t0).toFixed(2),
  };
}

export async function run() {
  const startTime = new Date().toISOString();
  console.log('='.repeat(60));
  console.log('NexusOS Sprint 0 Resource Baseline Measurement');
  console.log(`Blueprint Section 89 Compliance | Started: ${startTime}`);
  console.log('='.repeat(60));

  // 1. Host Hardware Dimensions
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const host = {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    cpuModel: cpus[0]?.model || 'Unknown',
    cpuCores: cpus.length,
    totalRamBytes: totalMem,
    totalRamFormatted: formatBytes(totalMem),
    freeRamBytes: freeMem,
    freeRamFormatted: formatBytes(freeMem),
  };

  // 2. GPU Dimensions
  const gpu = probeGpu();

  // 3. Process Resource Footprint
  const mem = process.memoryUsage();
  const processUsage = {
    rss: formatBytes(mem.rss),
    heapTotal: formatBytes(mem.heapTotal),
    heapUsed: formatBytes(mem.heapUsed),
    external: formatBytes(mem.external),
  };

  // 4. Startup Latency
  const startup = await measureStartup();

  // 5. Idle Usage Sampling
  console.log('Sampling idle baseline resource usage...');
  const idle = await measureIdleUsage();

  // 6. Disk Footprint
  console.log('Measuring repository storage footprints...');
  const rootDir = path.resolve(__dirname, '..');
  const disk = {
    contractsDistBytes: getDirectorySize(path.join(rootDir, 'packages', 'contracts', 'dist')),
    backendDistBytes: getDirectorySize(path.join(rootDir, 'services', 'backend', 'dist')),
    identityDistBytes: getDirectorySize(path.join(rootDir, 'services', 'identity', 'dist')),
    orchestratorDistBytes: getDirectorySize(path.join(rootDir, 'services', 'orchestrator', 'dist')),
    desktopAgentDistBytes: getDirectorySize(path.join(rootDir, 'apps', 'desktop-agent', 'dist')),
    runtimesDistBytes: getDirectorySize(path.join(rootDir, 'runtimes', 'local-ai', 'dist')),
  };
  disk.totalBuildArtifactsBytes = Object.values(disk).reduce((a, b) => a + b, 0);
  disk.totalBuildArtifactsFormatted = formatBytes(disk.totalBuildArtifactsBytes);

  // 7. Network Dimension
  const networkInterfaces = os.networkInterfaces();
  const activeInterfaces = [];
  for (const [name, nets] of Object.entries(networkInterfaces)) {
    if (!nets) continue;
    for (const net of nets) {
      if (!net.internal && net.family === 'IPv4') {
        activeInterfaces.push({ name, address: net.address, mac: net.mac });
      }
    }
  }

  const baselineData = {
    timestamp: startTime,
    host,
    gpu,
    process: processUsage,
    startup,
    idle,
    disk,
    network: {
      activeInterfaceCount: activeInterfaces.length,
      interfaces: activeInterfaces.map((i) => i.name),
    },
  };

  console.log('\n--- MEASURED RESOURCE BASELINE SUMMARY ---');
  console.log(`Host CPU:       ${host.cpuModel} (${host.cpuCores} cores)`);
  console.log(`Host Memory:    ${host.freeRamFormatted} free / ${host.totalRamFormatted} total`);
  console.log(`GPU Hardware:   ${gpu.model} (VRAM: ${gpu.vram})`);
  console.log(`Process Memory: RSS ${processUsage.rss} | Heap Used ${processUsage.heapUsed}`);
  console.log(
    `Idle Baseline:  RSS ${idle.avgRssFormatted} | Heap Used ${idle.avgHeapUsedFormatted}`,
  );
  console.log(`Startup Delay:  Contracts import ${startup.contractsImportLatencyMs} ms`);
  console.log(`Disk Artifacts: Total Build Dist ${disk.totalBuildArtifactsFormatted}`);
  console.log(`Active Network: ${activeInterfaces.length} active non-internal IPv4 interface(s)`);
  console.log('='.repeat(60));

  return baselineData;
}

let isMain = false;
try {
  if (process.argv[1]) {
    isMain =
      fs.realpathSync(process.argv[1]).toLowerCase() ===
      fs.realpathSync(fileURLToPath(import.meta.url)).toLowerCase();
  }
} catch {
  isMain = false;
}

if (isMain) {
  run().catch((err) => {
    console.error('Resource baseline measurement failed:', err);
    process.exit(1);
  });
}
