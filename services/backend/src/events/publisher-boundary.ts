import { EventEnvelope } from '@nexusos/contracts';

export interface EventPublisherBoundary {
  publish(event: EventEnvelope): Promise<{ published: boolean; messageId: string }>;
}

/**
 * In-memory Event Publisher Adapter Boundary (for architectural boundary separation without event bus runtime)
 */
export class InMemoryEventPublisherBoundary implements EventPublisherBoundary {
  private readonly publishedEvents: EventEnvelope[] = [];

  async publish(event: EventEnvelope): Promise<{ published: boolean; messageId: string }> {
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
