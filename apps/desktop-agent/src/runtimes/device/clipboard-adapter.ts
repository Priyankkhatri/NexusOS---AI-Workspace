export interface IClipboardAdapter {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryClipboardAdapter implements IClipboardAdapter {
  private clipboardContent: string = '';

  constructor(private readonly maxSizeBytes: number = 1048576) {}

  public async readText(): Promise<string> {
    return this.clipboardContent;
  }

  public async writeText(text: string): Promise<void> {
    if (typeof text !== 'string') {
      throw new Error('Clipboard text must be a string.');
    }

    if (Buffer.byteLength(text, 'utf-8') > this.maxSizeBytes) {
      throw new Error(
        `Clipboard payload exceeds maximum size limit of ${this.maxSizeBytes} bytes.`,
      );
    }

    this.clipboardContent = text;
  }

  public async clear(): Promise<void> {
    this.clipboardContent = '';
  }
}
