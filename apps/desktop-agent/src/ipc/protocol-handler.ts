import { IPCMessageSchema } from './schemas.js';
import { IIPCProtocolHandler, IPCMessage } from './types.js';

export class IPCProtocolHandler implements IIPCProtocolHandler {
  constructor(private readonly allowedVersions: string[] = ['1.0']) {}

  public encodeMessage(msg: IPCMessage): Buffer {
    if (!msg) {
      throw new Error('Cannot encode null or undefined message.');
    }
    const jsonStr = JSON.stringify(msg);
    const payloadBuffer = Buffer.from(jsonStr, 'utf-8');
    const headerBuffer = Buffer.alloc(4);
    headerBuffer.writeUInt32BE(payloadBuffer.length, 0);

    return Buffer.concat([headerBuffer, payloadBuffer]);
  }

  public parseFrames(
    bufferState: Buffer,
    maxFrameSizeBytes: number,
  ): { messages: IPCMessage[]; remainder: Buffer } {
    const messages: IPCMessage[] = [];
    let offset = 0;

    while (offset + 4 <= bufferState.length) {
      const frameLength = bufferState.readUInt32BE(offset);

      // Oversized frame check - fail closed to prevent memory exhaustion attacks
      if (frameLength > maxFrameSizeBytes) {
        throw new Error(
          `Oversized IPC frame detected: ${frameLength} bytes exceeds limit of ${maxFrameSizeBytes} bytes.`,
        );
      }

      // Check if full frame payload is available
      if (offset + 4 + frameLength > bufferState.length) {
        // Partial frame, wait for more data
        break;
      }

      const payloadBuffer = bufferState.subarray(offset + 4, offset + 4 + frameLength);
      offset += 4 + frameLength;

      const jsonStr = payloadBuffer.toString('utf-8');
      const rawObj = JSON.parse(jsonStr);

      // Validate frame against Zod schema
      const parseResult = IPCMessageSchema.safeParse(rawObj);
      if (!parseResult.success) {
        const details = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join('; ');
        throw new Error(`Malformed IPC frame payload: ${details}`);
      }

      const msg = parseResult.data as IPCMessage;

      // Validate protocol version
      if (!this.validateProtocolVersion(msg.protocolVersion)) {
        throw new Error(
          `Unsupported IPC protocol version '${msg.protocolVersion}'. Allowed: ${this.allowedVersions.join(', ')}.`,
        );
      }

      messages.push(msg);
    }

    const remainder = bufferState.subarray(offset);
    return { messages, remainder };
  }

  public validateProtocolVersion(version: string): boolean {
    if (!version) return false;
    return this.allowedVersions.includes(version);
  }
}
