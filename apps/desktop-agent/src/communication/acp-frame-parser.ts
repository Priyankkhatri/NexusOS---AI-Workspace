import {
  ACPMessageEnvelope,
  ACPMessageEnvelopeSchema,
  EventEnvelope,
  EventEnvelopeSchema,
  createNexusOSError,
  ErrorCategory,
} from '@nexusos/contracts';

export interface FrameValidationResult<T> {
  valid: boolean;
  data?: T;
  errorCode?: string;
  errorMessage?: string;
}

export class ACPFrameParser {
  private readonly maxFrameSizeBytes: number;
  private readonly maxTimestampDriftMs: number;

  constructor(
    maxFrameSizeBytes = 1024 * 1024, // 1 MB default
    maxTimestampDriftMs = 5 * 60 * 1000, // 5 minutes default
  ) {
    this.maxFrameSizeBytes = maxFrameSizeBytes;
    this.maxTimestampDriftMs = maxTimestampDriftMs;
  }

  public parseACPEnvelope(
    rawFrame: string | Uint8Array,
    expectedDeviceId?: string,
    expectedTenantId?: string,
  ): FrameValidationResult<ACPMessageEnvelope> {
    const rawString =
      typeof rawFrame === 'string' ? rawFrame : new TextDecoder('utf-8').decode(rawFrame);

    // 1. Frame size check
    const frameLength = Buffer.byteLength(rawString, 'utf-8');
    if (frameLength > this.maxFrameSizeBytes) {
      return {
        valid: false,
        errorCode: 'PAYLOAD_TOO_LARGE',
        errorMessage: `ACP frame size of ${frameLength} bytes exceeds limit of ${this.maxFrameSizeBytes} bytes.`,
      };
    }

    // 2. JSON Deserialization
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawString);
    } catch {
      return {
        valid: false,
        errorCode: 'MALFORMED_FRAME',
        errorMessage: 'ACP frame is not valid JSON.',
      };
    }

    // 3. Zod Schema Validation
    const schemaResult = ACPMessageEnvelopeSchema.safeParse(parsedJson);
    if (!schemaResult.success) {
      return {
        valid: false,
        errorCode: 'SCHEMA_INVALID',
        errorMessage: 'ACP frame failed schema validation.',
      };
    }

    const envelope = schemaResult.data;

    // 4. Target Device Binding Check
    if (expectedDeviceId && envelope.to_agent !== expectedDeviceId && envelope.to_agent !== '*') {
      return {
        valid: false,
        errorCode: 'TARGET_DEVICE_MISMATCH',
        errorMessage: 'ACP envelope target device ID does not match local device.',
      };
    }

    // 5. Tenant Binding Check inside payload/context if provided
    if (expectedTenantId && envelope.payload && typeof envelope.payload.tenant_id === 'string') {
      if (envelope.payload.tenant_id !== expectedTenantId) {
        return {
          valid: false,
          errorCode: 'TENANT_MISMATCH',
          errorMessage: 'ACP envelope tenant ID does not match local paired tenant.',
        };
      }
    }

    // 6. Timestamp Freshness Check
    const envelopeTime = new Date(envelope.timestamp).getTime();
    if (isNaN(envelopeTime)) {
      return {
        valid: false,
        errorCode: 'INVALID_TIMESTAMP',
        errorMessage: 'ACP envelope timestamp is invalid.',
      };
    }

    const now = Date.now();
    if (Math.abs(now - envelopeTime) > this.maxTimestampDriftMs) {
      return {
        valid: false,
        errorCode: 'STALE_TIMESTAMP',
        errorMessage: 'ACP envelope timestamp exceeds maximum allowed drift.',
      };
    }

    // 7. Nonce & Signature Validation Guard
    if (
      envelope.policy_snapshot_hash &&
      (!envelope.signature || envelope.signature.trim() === '')
    ) {
      return {
        valid: false,
        errorCode: 'MISSING_SIGNATURE',
        errorMessage: 'ACP envelope policy hash present but cryptographic signature is missing.',
      };
    }

    return {
      valid: true,
      data: envelope,
    };
  }

  public parseEventEnvelope(rawFrame: string | Uint8Array): FrameValidationResult<EventEnvelope> {
    const rawString =
      typeof rawFrame === 'string' ? rawFrame : new TextDecoder('utf-8').decode(rawFrame);

    const frameLength = Buffer.byteLength(rawString, 'utf-8');
    if (frameLength > this.maxFrameSizeBytes) {
      return {
        valid: false,
        errorCode: 'PAYLOAD_TOO_LARGE',
        errorMessage: `Event frame size of ${frameLength} bytes exceeds limit of ${this.maxFrameSizeBytes} bytes.`,
      };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawString);
    } catch {
      return {
        valid: false,
        errorCode: 'MALFORMED_FRAME',
        errorMessage: 'Event frame is not valid JSON.',
      };
    }

    const schemaResult = EventEnvelopeSchema.safeParse(parsedJson);
    if (!schemaResult.success) {
      return {
        valid: false,
        errorCode: 'SCHEMA_INVALID',
        errorMessage: 'Event frame failed schema validation.',
      };
    }

    return {
      valid: true,
      data: schemaResult.data,
    };
  }

  public serializeFrame(data: unknown): string {
    const serialized = JSON.stringify(data);
    const byteLength = Buffer.byteLength(serialized, 'utf-8');
    if (byteLength > this.maxFrameSizeBytes) {
      throw createNexusOSError(
        'PAYLOAD_TOO_LARGE',
        ErrorCategory.VALIDATION,
        `Outbound ACP frame size of ${byteLength} bytes exceeds limit of ${this.maxFrameSizeBytes} bytes.`,
      );
    }
    return serialized;
  }
}
