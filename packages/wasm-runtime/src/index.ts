import { 
  Runtime, 
  ModuleId, 
  InstanceId, 
  Language, 
  ExecutionConfig, 
  ExecutionResult,
  RuntimeError,
  Capability
} from '@rizome/next-rc-types';
import { 
  WasmRuntimeBridge, 
  initializeRuntimeController 
} from '@rizome/next-rc-native';

export class WasmRuntime implements Runtime {
  private bridge: WasmRuntimeBridge;
  private initialized = false;

  constructor() {
    this.bridge = new WasmRuntimeBridge();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize the native runtime controller
      initializeRuntimeController();
      
      // Initialize the WASM bridge
      await this.bridge.initialize();
      
      // Pre-warm the runtime for better performance
      await this.bridge.preWarm(10);
      
      this.initialized = true;
    } catch (error) {
      throw new RuntimeError(
        `Failed to initialize WASM runtime: ${error}`,
        'INITIALIZATION_FAILED'
      );
    }
  }

  async compile(code: string, language: Language): Promise<ModuleId> {
    await this.ensureInitialized();
    
    try {
      const result = await this.bridge.compile(code, this.mapLanguage(language));
      return { id: result.id };
    } catch (error) {
      throw new RuntimeError(
        `WASM compilation failed: ${error}`,
        'COMPILATION_FAILED'
      );
    }
  }

  async instantiate(moduleId: ModuleId): Promise<InstanceId> {
    await this.ensureInitialized();
    
    try {
      const result = await this.bridge.instantiate({ id: moduleId.id });
      return { id: result.id };
    } catch (error) {
      throw new RuntimeError(
        `WASM instantiation failed: ${error}`,
        'INSTANTIATION_FAILED'
      );
    }
  }

  async execute(instanceId: InstanceId, config: ExecutionConfig): Promise<ExecutionResult> {
    await this.ensureInitialized();
    
    try {
      const nativeConfig = {
        timeoutMs: config.timeout,
        memoryLimitBytes: config.memoryLimit,
        trustLevel: this.mapTrustLevel(config.permissions.trustLevel),
        networkAccess: config.permissions.capabilities.has(Capability.NetworkAccess),
        filesystemAccess: config.permissions.capabilities.has(Capability.FileSystemRead) || 
                         config.permissions.capabilities.has(Capability.FileSystemWrite),
      };

      const result = await this.bridge.execute({ id: instanceId.id }, nativeConfig);
      
      return {
        success: result.success,
        output: result.output ? JSON.parse(result.output) : undefined,
        error: result.error || undefined,
        executionTime: result.executionTimeMs,
        memoryUsed: result.memoryUsedBytes,
      };
    } catch (error) {
      throw new RuntimeError(
        `WASM execution failed: ${error}`,
        'EXECUTION_FAILED'
      );
    }
  }

  async destroy(instanceId: InstanceId): Promise<void> {
    await this.ensureInitialized();
    
    try {
      await this.bridge.destroy({ id: instanceId.id });
    } catch (error) {
      throw new RuntimeError(
        `WASM instance destruction failed: ${error}`,
        'DESTRUCTION_FAILED'
      );
    }
  }

  async getStatus() {
    await this.ensureInitialized();
    
    try {
      const status = await this.bridge.getStatus();
      return {
        runtime: 'wasm',
        initialized: this.initialized,
        activeInstances: status.activeInstances,
        totalExecutions: status.totalExecutions,
        successfulExecutions: status.successfulExecutions,
        failedExecutions: status.failedExecutions,
        avgExecutionTime: status.avgExecutionTimeMs,
      };
    } catch (error) {
      throw new RuntimeError(
        `Failed to get WASM runtime status: ${error}`,
        'STATUS_FAILED'
      );
    }
  }

  async getPerformanceMetrics() {
    await this.ensureInitialized();
    
    try {
      const metrics = await this.bridge.getPerformanceMetrics();
      return {
        runtimeType: metrics.runtimeType,
        coldStartLatency: metrics.coldStartLatencyNs,
        memoryOverhead: metrics.memoryOverheadBytes,
        executionOverhead: metrics.executionOverheadPercent,
        activeInstances: metrics.activeInstances,
      };
    } catch (error) {
      throw new RuntimeError(
        `Failed to get WASM performance metrics: ${error}`,
        'METRICS_FAILED'
      );
    }
  }

  async getMemoryStats() {
    await this.ensureInitialized();
    
    try {
      const stats = await this.bridge.getMemoryStats();
      return stats;
    } catch (error) {
      throw new RuntimeError(
        `Failed to get WASM memory stats: ${error}`,
        'MEMORY_STATS_FAILED'
      );
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private mapLanguage(language: Language): any {
    // Map TypeScript enum to NAPI enum
    switch (language) {
      case Language.Rust: return 'Rust';
      case Language.JavaScript: return 'JavaScript';
      case Language.TypeScript: return 'TypeScript';
      case Language.Python: return 'Python';
      case Language.Go: return 'Go';
      case Language.C: return 'C';
      case Language.Cpp: return 'Cpp';
      case Language.Wasm: return 'Wasm';
      default: return 'Wasm';
    }
  }

  private mapTrustLevel(trustLevel: string): any {
    switch (trustLevel) {
      case 'low': return 'Low';
      case 'medium': return 'Medium';
      case 'high': return 'High';
      default: return 'Medium';
    }
  }
}

export { WasmRuntime as default };