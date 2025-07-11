import {
  Runtime,
  RuntimeType,
  Language,
  ExecutionConfig,
  ExecutionResult,
  RuntimeError,
  ModuleId,
  InstanceId,
} from '@rizome/next-rc-types';
import { IntelligentScheduler, RuntimeRegistry, Task } from './scheduler';
import { V8Runtime } from '@rizome/next-rc-v8';
import PQueue from 'p-queue';

export interface RuntimeControllerConfig {
  enableScheduler?: boolean;
  runtimes?: {
    wasm?: { enabled: boolean; config?: any };
    ebpf?: { enabled: boolean; config?: any };
    v8?: { enabled: boolean; config?: any };
    firecracker?: { enabled: boolean; config?: any };
    python?: { enabled: boolean; config?: any };
  };
  concurrency?: number;
}

export class RuntimeController {
  private static instance: RuntimeController;
  private scheduler!: IntelligentScheduler;
  private runtimes: RuntimeRegistry = {};
  private executionQueue: PQueue;
  private isInitialized = false;

  private constructor(private config: RuntimeControllerConfig = {}) {
    this.executionQueue = new PQueue({ 
      concurrency: config.concurrency || 100 
    });
  }

  static getInstance(config?: RuntimeControllerConfig): RuntimeController {
    if (!RuntimeController.instance) {
      RuntimeController.instance = new RuntimeController(config);
    }
    return RuntimeController.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('Initializing Runtime Controller...');

    // Initialize enabled runtimes
    await this.initializeRuntimes();

    // Create scheduler with available runtimes
    this.scheduler = new IntelligentScheduler(this.runtimes);

    this.isInitialized = true;
    console.log('Runtime Controller initialized successfully');
  }

  private async initializeRuntimes(): Promise<void> {
    const runtimeConfig = this.config.runtimes || {};

    // Initialize V8 runtime (enabled by default)
    if (runtimeConfig.v8?.enabled !== false) {
      console.log('Initializing V8 runtime...');
      const v8Runtime = new V8Runtime();
      await v8Runtime.initialize();
      this.runtimes[RuntimeType.V8Isolate] = v8Runtime;
    }

    // Initialize WASM runtime
    if (runtimeConfig.wasm?.enabled) {
      console.log('Initializing WASM runtime...');
      // Import dynamically when available
      try {
        const wasmRuntime = await this.loadWasmRuntime();
        if (wasmRuntime) {
          this.runtimes[RuntimeType.Wasm] = wasmRuntime;
        }
      } catch (error) {
        console.warn('WASM runtime not available:', error);
      }
    }

    // Initialize eBPF runtime
    if (runtimeConfig.ebpf?.enabled) {
      console.log('Initializing eBPF runtime...');
      try {
        const ebpfRuntime = await this.loadEbpfRuntime();
        if (ebpfRuntime) {
          this.runtimes[RuntimeType.Ebpf] = ebpfRuntime;
        }
      } catch (error) {
        console.warn('eBPF runtime not available:', error);
      }
    }

    // Initialize Firecracker runtime
    if (runtimeConfig.firecracker?.enabled) {
      console.log('Initializing Firecracker runtime...');
      try {
        const firecrackerRuntime = await this.loadFirecrackerRuntime();
        if (firecrackerRuntime) {
          this.runtimes[RuntimeType.Firecracker] = firecrackerRuntime;
        }
      } catch (error) {
        console.warn('Firecracker runtime not available:', error);
      }
    }

    // Initialize Python runtime
    if (runtimeConfig.python?.enabled) {
      console.log('Initializing Python runtime...');
      try {
        const pythonRuntime = await this.loadPythonRuntime();
        if (pythonRuntime) {
          this.runtimes[RuntimeType.Python] = pythonRuntime;
        }
      } catch (error) {
        console.warn('Python runtime not available:', error);
      }
    }
  }

  async compile(code: string, language: Language): Promise<ModuleId> {
    await this.ensureInitialized();

    // For simple compilation, use the appropriate runtime directly
    const runtime = this.selectRuntimeForLanguage(language);
    if (!runtime) {
      throw new RuntimeError(
        `No runtime available for language: ${language}`,
        'NO_RUNTIME_AVAILABLE'
      );
    }

    return runtime.compile(code, language);
  }

  async instantiate(moduleId: ModuleId): Promise<InstanceId> {
    await this.ensureInitialized();

    // Find which runtime has this module
    for (const runtime of Object.values(this.runtimes)) {
      try {
        return await runtime.instantiate(moduleId);
      } catch (error) {
        // Module might not be in this runtime
        continue;
      }
    }

    throw new RuntimeError(
      `Module not found: ${moduleId.id}`,
      'MODULE_NOT_FOUND'
    );
  }

  async execute(
    instanceId: InstanceId,
    config: ExecutionConfig
  ): Promise<ExecutionResult> {
    await this.ensureInitialized();

    // Queue the execution
    return this.executionQueue.add(async () => {
      // Find which runtime has this instance
      for (const runtime of Object.values(this.runtimes)) {
        try {
          return await runtime.execute(instanceId, config);
        } catch (error) {
          if (error instanceof RuntimeError && error.code === 'INSTANCE_NOT_FOUND') {
            continue;
          }
          throw error;
        }
      }

      throw new RuntimeError(
        `Instance not found: ${instanceId.id}`,
        'INSTANCE_NOT_FOUND'
      );
    }) as Promise<ExecutionResult>;
  }

  async destroy(instanceId: InstanceId): Promise<void> {
    await this.ensureInitialized();

    // Find which runtime has this instance
    for (const runtime of Object.values(this.runtimes)) {
      try {
        await runtime.destroy(instanceId);
        return;
      } catch (error) {
        if (error instanceof RuntimeError && error.code === 'INSTANCE_NOT_FOUND') {
          continue;
        }
        throw error;
      }
    }

    throw new RuntimeError(
      `Instance not found: ${instanceId.id}`,
      'INSTANCE_NOT_FOUND'
    );
  }

  async executeWithScheduler(
    code: string,
    language: Language,
    config: ExecutionConfig,
    hints?: {
      expectedDuration?: number;
      latencyRequirement?: 'ultra-low' | 'low' | 'normal' | 'relaxed';
      complexity?: 'simple' | 'moderate' | 'complex';
    }
  ): Promise<ExecutionResult & { runtime: RuntimeType }> {
    await this.ensureInitialized();

    if (!this.config.enableScheduler) {
      // Fallback to direct execution
      const runtime = this.selectRuntimeForLanguage(language);
      if (!runtime) {
        throw new RuntimeError(
          `No runtime available for language: ${language}`,
          'NO_RUNTIME_AVAILABLE'
        );
      }

      const moduleId = await runtime.compile(code, language);
      const instanceId = await runtime.instantiate(moduleId);
      
      try {
        const result = await runtime.execute(instanceId, config);
        return {
          ...result,
          runtime: this.getRuntimeType(runtime),
        };
      } finally {
        await runtime.destroy(instanceId);
      }
    }

    // Use intelligent scheduler
    const task: Task = {
      code,
      language,
      expectedDuration: hints?.expectedDuration,
      latencyRequirement: hints?.latencyRequirement,
      complexity: hints?.complexity,
      resourceRequirements: {
        memory: config.memoryLimit,
      },
    };

    return this.scheduler.execute(task, config);
  }

  selectOptimalRuntime(options: {
    language: Language;
    expectedDuration?: number;
    latencyRequirement?: string;
  }): Runtime | null {
    // Use intelligent scheduler to select optimal runtime
    const factors = {
      language: options.language,
      latencyRequirement: (options.latencyRequirement || 'normal') as any,
      complexity: 'moderate' as const,
      trustLevel: 'medium',
      memoryLimit: 256 * 1024 * 1024, // Default 256MB
      cpuIntensive: false,
      networkAccess: false,
      estimatedDuration: options.expectedDuration
    };
    
    const availableRuntimes = new Set<RuntimeType>();
    for (const [type, runtime] of Object.entries(this.runtimes)) {
      if (runtime) {
        availableRuntimes.add(type as RuntimeType);
      }
    }
    
    try {
      const selectedType = this.scheduler.selectOptimalRuntime(factors, availableRuntimes);
      return this.runtimes[selectedType] || null;
    } catch (error) {
      console.warn('Failed to select optimal runtime:', error);
      // Fallback to simple selection
      return this.selectRuntimeForLanguage(options.language);
    }
  }

  private selectRuntimeForLanguage(language: Language): Runtime | null {
    // Language to runtime mapping
    switch (language) {
      case Language.JavaScript:
      case Language.TypeScript:
        return this.runtimes[RuntimeType.V8Isolate] || null;
      
      case Language.Python:
        return this.runtimes[RuntimeType.Python] || 
               this.runtimes[RuntimeType.Wasm] ||
               this.runtimes[RuntimeType.V8Isolate] ||
               null;
      
      case Language.Rust:
      case Language.C:
      case Language.Cpp:
      case Language.Go:
      case Language.Wasm:
        return this.runtimes[RuntimeType.Wasm] || 
               this.runtimes[RuntimeType.V8Isolate] || 
               null;
      
      default:
        // Try all runtimes
        return this.runtimes[RuntimeType.V8Isolate] ||
               this.runtimes[RuntimeType.Wasm] ||
               this.runtimes[RuntimeType.Python] ||
               this.runtimes[RuntimeType.Firecracker] ||
               null;
    }
  }

  private getRuntimeType(runtime: Runtime): RuntimeType {
    for (const [type, r] of Object.entries(this.runtimes)) {
      if (r === runtime) {
        return type as RuntimeType;
      }
    }
    return RuntimeType.V8Isolate; // Default
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  async shutdown(): Promise<void> {
    console.log('Shutting down Runtime Controller...');
    
    // Shutdown all runtimes
    for (const [type, runtime] of Object.entries(this.runtimes)) {
      try {
        console.log(`Shutting down ${type} runtime...`);
        if ('shutdown' in runtime && typeof runtime.shutdown === 'function') {
          await runtime.shutdown();
        }
      } catch (error) {
        console.error(`Error shutting down ${type} runtime:`, error);
      }
    }

    // Clear execution queue
    this.executionQueue.clear();
    
    this.isInitialized = false;
    console.log('Runtime Controller shutdown complete');
  }

  getMetrics() {
    return {
      initialized: this.isInitialized,
      availableRuntimes: Object.keys(this.runtimes),
      queueSize: this.executionQueue.size,
      queuePending: this.executionQueue.pending,
      schedulerMetrics: this.scheduler?.getMetrics(),
    };
  }

  // Runtime loaders - dynamically import real implementations
  private async loadWasmRuntime(): Promise<Runtime | null> {
    try {
      const { WasmRuntime } = await import('@rizome/next-rc-wasm');
      const runtime = new WasmRuntime();
      await runtime.initialize();
      return runtime;
    } catch (error) {
      console.warn('Failed to load WASM runtime:', error);
      return null;
    }
  }

  private async loadEbpfRuntime(): Promise<Runtime | null> {
    try {
      const { EbpfRuntime } = await import('@rizome/next-rc-ebpf');
      const runtime = new EbpfRuntime();
      await runtime.initialize();
      return runtime;
    } catch (error) {
      console.warn('Failed to load eBPF runtime:', error);
      return null;
    }
  }

  private async loadFirecrackerRuntime(): Promise<Runtime | null> {
    try {
      // Firecracker runtime not yet implemented
      console.warn('Firecracker runtime not yet available');
      return null;
    } catch (error) {
      console.warn('Failed to load Firecracker runtime:', error);
      return null;
    }
  }

  private async loadPythonRuntime(): Promise<Runtime | null> {
    try {
      const { PythonRuntime } = await import('@rizome/next-rc-python');
      const runtime = new PythonRuntime();
      await runtime.initialize();
      return runtime;
    } catch (error) {
      console.warn('Failed to load Python runtime:', error);
      return null;
    }
  }
}