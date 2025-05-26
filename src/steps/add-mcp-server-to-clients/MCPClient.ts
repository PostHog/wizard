export abstract class MCPClient {
  name: string;
  abstract isServerInstalled(): Promise<boolean>;
  abstract addServer(apiKey: string): Promise<void>;
  abstract removeServer(): Promise<void>;
  abstract isClientSupported(): boolean;
}
