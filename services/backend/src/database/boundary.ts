import { BackendConfig } from '../config/index.js';

export interface DatabaseHealthStatus {
  connected: boolean;
  configured: boolean;
  message: string;
}

/**
 * Database Infrastructure Boundary Interface matching Backend EDD
 */
export class DatabaseBoundary {
  private isConnected = false;

  constructor(private readonly config: BackendConfig) {}

  async connect(): Promise<void> {
    if (!this.config.databaseUrl) {
      this.isConnected = false;
      return;
    }
    // Simulate database connection lifecycle setup
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
  }

  async healthCheck(): Promise<DatabaseHealthStatus> {
    if (!this.config.databaseUrl) {
      return {
        connected: false,
        configured: false,
        message: 'No database URL configured; running in stateless control-plane mode.',
      };
    }

    return {
      connected: this.isConnected,
      configured: true,
      message: this.isConnected ? 'Database connection active.' : 'Database connection inactive.',
    };
  }
}
