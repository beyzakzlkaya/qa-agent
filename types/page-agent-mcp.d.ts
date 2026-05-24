declare module "@page-agent/mcp/src/hub-bridge.js" {
  export interface TaskResult {
    success: boolean;
    data: string;
  }

  export class HubBridge {
    constructor(port: number);
    start(): Promise<void>;
    executeTask(task: string, config?: Record<string, unknown>): Promise<TaskResult>;
    stopTask(): void;
    get connected(): boolean;
    get busy(): boolean;
  }
}
