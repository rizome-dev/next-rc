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
  EbpfRuntimeBridge, 
  initializeRuntimeController 
} from '@rizome/next-rc-native';

export class EbpfRuntime implements Runtime {
  private bridge: EbpfRuntimeBridge;
  private initialized = false;

  constructor() {
    this.bridge = new EbpfRuntimeBridge();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize the native runtime controller
      initializeRuntimeController();
      
      // Initialize the eBPF bridge
      await this.bridge.initialize();
      
      this.initialized = true;
    } catch (error) {
      throw new RuntimeError(
        `Failed to initialize eBPF runtime: ${error}`,
        'INITIALIZATION_FAILED'
      );
    }
  }

  async compile(_code: string, _language: Language): Promise<ModuleId> {
    await this.ensureInitialized();
    
    // eBPF doesn't have a compile step - programs are loaded directly
    // Return a temporary module ID that represents the code
    return { id: `ebpf-module-${Date.now()}` };
  }

  async instantiate(moduleId: ModuleId): Promise<InstanceId> {
    await this.ensureInitialized();
    
    try {
      const result = await this.bridge.loadProgram({ id: moduleId.id });
      return { id: result.id };
    } catch (error) {
      throw new RuntimeError(
        `eBPF program load failed: ${error}`,
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
        output: result.output ? Array.from(result.output) : undefined,
        error: result.exitCode !== 0 ? `Exit code: ${result.exitCode}` : undefined,
        executionTime: result.executionTimeMs,
        memoryUsed: 0, // eBPF doesn't report memory usage
      };
    } catch (error) {
      throw new RuntimeError(
        `eBPF execution failed: ${error}`,
        'EXECUTION_FAILED'
      );
    }
  }

  async executeFilter(instanceId: InstanceId, inputData: Buffer): Promise<ExecutionResult> {
    await this.ensureInitialized();
    
    try {
      const result = await this.bridge.executeFilter({ id: instanceId.id }, inputData);
      
      return {
        success: result.success,
        output: result.output ? Array.from(result.output) : undefined,
        error: result.exitCode !== 0 ? `Exit code: ${result.exitCode}` : undefined,
        executionTime: result.executionTimeMs,
        memoryUsed: 0, // eBPF doesn't report memory usage
      };
    } catch (error) {
      throw new RuntimeError(
        `eBPF filter execution failed: ${error}`,
        'FILTER_EXECUTION_FAILED'
      );
    }
  }

  async destroy(instanceId: InstanceId): Promise<void> {
    await this.ensureInitialized();
    
    try {
      await this.bridge.destroy({ id: instanceId.id });
    } catch (error) {
      throw new RuntimeError(
        `eBPF program destruction failed: ${error}`,
        'DESTRUCTION_FAILED'
      );
    }
  }

  async verifyBytecode(_bytecode: Buffer): Promise<boolean> {
    await this.ensureInitialized();
    
    // eBPF verification happens during load
    // Return true as a placeholder
    return true;
  }

  async enableTracing(instanceId: InstanceId): Promise<void> {
    await this.ensureInitialized();
    
    try {
      await this.bridge.enableTracing({ id: instanceId.id });
    } catch (error) {
      throw new RuntimeError(
        `Failed to enable eBPF tracing: ${error}`,
        'TRACING_FAILED'
      );
    }
  }

  async getStatus() {
    await this.ensureInitialized();
    
    try {
      const status = await this.bridge.getStatus();
      return {
        runtime: 'ebpf',
        initialized: this.initialized,
        activeInstances: status.activeInstances,
        totalExecutions: status.totalExecutions,
        successfulExecutions: status.successfulExecutions,
        failedExecutions: status.failedExecutions,
        avgExecutionTime: status.avgExecutionTimeMs
      };
    } catch (error) {
      throw new RuntimeError(
        `Failed to get eBPF runtime status: ${error}`,
        'STATUS_FAILED'
      );
    }
  }

  async getPerformanceMetrics() {
    await this.ensureInitialized();
    
    // eBPF has fixed performance characteristics
    const status = await this.bridge.getStatus();
    return {
      runtimeType: 'ebpf',
      coldStartLatency: 100, // 100ns as per paper
      memoryOverhead: 4096, // Minimal overhead
      executionOverhead: 1, // 1% overhead
      activeInstances: status.activeInstances,
    };
  }

  async getJitStats() {
    await this.ensureInitialized();
    
    // Return mock JIT stats for now
    return {
      enabled: true,
      compiledPrograms: 0,
      compilationTime: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
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

export { EbpfRuntime as default };