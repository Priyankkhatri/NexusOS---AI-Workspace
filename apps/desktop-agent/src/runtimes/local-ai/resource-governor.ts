import crypto from 'node:crypto';
import {
  HardwareProfile,
  InferenceRequest,
  ResourceReservation,
  MAX_CONCURRENT_INFERENCES,
  MAX_RAM_PERCENT,
  MAX_VRAM_PERCENT,
  ModelArtifact,
} from './types.js';

export class ResourceGovernorError extends Error {
  constructor(
    message: string,
    public readonly code: 'MODEL_ADMISSION_DENIED' | 'RESOURCE_EXHAUSTED' | 'INVALID_STATE',
  ) {
    super(message);
    this.name = 'ResourceGovernorError';
  }
}

export class ResourceGovernor {
  private activeReservations = new Map<string, ResourceReservation>();
  private activeConcurrentCount = 0;
  private reservedRamBytes = 0;
  private reservedVramBytes = 0;

  constructor(
    private readonly maxConcurrent = MAX_CONCURRENT_INFERENCES,
    private readonly maxRamPercent = MAX_RAM_PERCENT,
    private readonly maxVramPercent = MAX_VRAM_PERCENT,
  ) {}

  /**
   * Evaluates hardware capacity and reserves resources for an inference request.
   * Throws ResourceGovernorError if capacity is insufficient or limits are exceeded.
   */
  public async reserve(
    request: InferenceRequest,
    hardware: HardwareProfile,
    model?: ModelArtifact,
  ): Promise<ResourceReservation> {
    // 1. Check max concurrent inference limit
    if (this.activeConcurrentCount >= this.maxConcurrent) {
      throw new ResourceGovernorError(
        `Inference request '${request.requestId}' rejected: maximum concurrent inference limit of ${this.maxConcurrent} reached.`,
        'RESOURCE_EXHAUSTED',
      );
    }

    // 2. Estimate required RAM and VRAM
    const requiredRam = model?.fileSizeBytes ? Math.ceil(model.fileSizeBytes * 1.1) : 1073741824; // Default 1 GB estimate
    const requiredVram =
      hardware.gpuAdapters.length > 0
        ? model?.fileSizeBytes
          ? Math.ceil(model.fileSizeBytes * 0.9)
          : 1073741824
        : 0; // 0 if CPU only

    // 3. Validate against physical system limits
    const maxAllowedRam = Math.floor(hardware.totalRamBytes * this.maxRamPercent);
    if (this.reservedRamBytes + requiredRam > maxAllowedRam) {
      throw new ResourceGovernorError(
        `Inference request '${request.requestId}' rejected: RAM requirement (${requiredRam} bytes) exceeds safety ceiling of ${maxAllowedRam} bytes (70% system RAM). Currently reserved: ${this.reservedRamBytes} bytes.`,
        'MODEL_ADMISSION_DENIED',
      );
    }

    if (hardware.gpuAdapters.length > 0) {
      const primaryGpu = hardware.gpuAdapters[0];
      const maxAllowedVram = Math.floor(primaryGpu.vramBytes * this.maxVramPercent);
      if (this.reservedVramBytes + requiredVram > maxAllowedVram) {
        throw new ResourceGovernorError(
          `Inference request '${request.requestId}' rejected: VRAM requirement (${requiredVram} bytes) exceeds safety ceiling of ${maxAllowedVram} bytes (80% GPU VRAM). Currently reserved: ${this.reservedVramBytes} bytes.`,
          'MODEL_ADMISSION_DENIED',
        );
      }
    }

    // 4. Create transactional reservation
    const reservationId = `res-${crypto.randomUUID()}`;
    const reservation: ResourceReservation = {
      reservationId,
      ramBytes: requiredRam,
      vramBytes: requiredVram,
      cpuCores: 1,
      acquiredAt: Date.now(),
      isReleased: false,
    };

    // Update internal tracking
    this.activeReservations.set(reservationId, reservation);
    this.activeConcurrentCount++;
    this.reservedRamBytes += requiredRam;
    this.reservedVramBytes += requiredVram;

    return { ...reservation };
  }

  /**
   * Releases a reservation. Exactly-once release semantics (idempotent).
   */
  public release(reservation: ResourceReservation | string): boolean {
    const reservationId =
      typeof reservation === 'string' ? reservation : reservation?.reservationId;

    if (!reservationId) {
      return false;
    }

    const existing = this.activeReservations.get(reservationId);
    if (!existing || existing.isReleased) {
      return false; // Idempotent: already released or non-existent
    }

    // Mark released
    existing.isReleased = true;
    this.activeReservations.delete(reservationId);

    // Safely decrement counters with zero-floor protection
    this.activeConcurrentCount = Math.max(0, this.activeConcurrentCount - 1);
    this.reservedRamBytes = Math.max(0, this.reservedRamBytes - existing.ramBytes);
    this.reservedVramBytes = Math.max(0, this.reservedVramBytes - existing.vramBytes);

    return true;
  }

  /**
   * Emergency reset for shutdown or diagnostic recovery.
   */
  public reset(): void {
    for (const res of this.activeReservations.values()) {
      res.isReleased = true;
    }
    this.activeReservations.clear();
    this.activeConcurrentCount = 0;
    this.reservedRamBytes = 0;
    this.reservedVramBytes = 0;
  }

  public getStats(): {
    activeConcurrentCount: number;
    reservedRamBytes: number;
    reservedVramBytes: number;
    activeReservationCount: number;
  } {
    return {
      activeConcurrentCount: this.activeConcurrentCount,
      reservedRamBytes: this.reservedRamBytes,
      reservedVramBytes: this.reservedVramBytes,
      activeReservationCount: this.activeReservations.size,
    };
  }
}
