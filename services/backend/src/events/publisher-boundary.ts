import { EventEnvelope } from '@nexusos/contracts';

export interface EventPublisherBoundary {
  publish(event: EventEnvelope): Promise<{ published: boolean; messageId: string }>;
}

export interface InMemoryEventPublisherBoundaryOptions {
  maxEvents?: number;
}

/**
 * In-memory Event Publisher Adapter Boundary (for architectural boundary separation without event bus runtime)
 * Bounded with FIFO eviction to prevent memory leaks in long-running processes (max 1,000 events by default).
 */
export class InMemoryEventPublisherBoundary implements EventPublisherBoundary {
  public static readonly DEFAULT_MAX_EVENTS = 1000;
  private readonly maxEvents: number;
  private readonly publishedEvents: EventEnvelope[] = [];

  constructor(options?: InMemoryEventPublisherBoundaryOptions) {
    this.maxEvents = options?.maxEvents ?? InMemoryEventPublisherBoundary.DEFAULT_MAX_EVENTS;
  }

  async publish(event: EventEnvelope): Promise<{ published: boolean; messageId: string }> {
    if (this.publishedEvents.length >= this.maxEvents) {
      this.publishedEvents.shift();
    }
    this.publishedEvents.push(event);
    return {
      published: true,
      messageId: event.event_id,
    };
  }

  getPublishedEvents(): EventEnvelope[] {
    return [...this.publishedEvents];
  }

  clear(): void {
    this.publishedEvents.length = 0;
  }
}
