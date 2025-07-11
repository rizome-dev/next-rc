import ivm from 'isolated-vm';
import { v4 as uuidv4 } from 'uuid';
import {
  Runtime,
  ModuleId,
  InstanceId,
  Language,
  ExecutionConfig,
  ExecutionResult,
  RuntimeError,
  TrustLevel,
  Capability,
} from '@rizome/next-rc-types';
import { V8IsolatePool } from './isolate-pool';
import { V8Module, V8Instance } from './types';

export class V8Runtime implements Runtime {
  private pool: V8IsolatePool;
  private modules: Map<string, V8Module> = new Map();
  private instances: Map<string, V8Instance> = new Map();

  constructor(pool?: V8IsolatePool) {
    this.pool = pool || new V8IsolatePool();
  }

  async initialize(): Promise<void> {
    await this.pool.initialize();
  }

  async compile(code: string, language: Language): Promise<ModuleId> {
    if (language !== Language.JavaScript && language !== Language.TypeScript) {
      throw new RuntimeError(
        `Unsupported language: ${language}`,
        'UNSUPPORTED_LANGUAGE'
      );
    }

    const startTime = Date.now();
    const id = uuidv4();

    try {
      // For TypeScript, we'd transpile here. For now, treat as JS
      let jsCode = code;
      if (language === Language.TypeScript) {
        jsCode = await this.transpileTypeScript(code);
      }

      // Extract metadata
      const metadata = this.extractMetadata(jsCode);

      // Pre-compile the module
      const compiled = await this.compileModule(jsCode);

      const module: V8Module = {
        id,
        code: jsCode,
        compiled,
        metadata: {
          language: language === Language.TypeScript ? 'typescript' : 'javascript',
          ...metadata,
        },
      };

      this.modules.set(id, module);

      const compileTime = Date.now() - startTime;
      console.log(`Compiled module ${id} in ${compileTime}ms`);

      return { id };
    } catch (error) {
      throw new RuntimeError(
        `Compilation failed: ${error instanceof Error ? error.message : String(error)}`,
        'COMPILATION_ERROR',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async instantiate(moduleId: ModuleId): Promise<InstanceId> {
    const startTime = Date.now();
    
    const module = this.modules.get(moduleId.id);
    if (!module) {
      throw new RuntimeError(
        `Module not found: ${moduleId.id}`,
        'MODULE_NOT_FOUND'
      );
    }

    try {
      // Acquire isolate from pool (should be instant if pre-warmed)
      const { isolate, context } = await this.pool.acquire();

      // Prepare the module in the context
      if (module.compiled) {
        await module.compiled.instantiate(context, (specifier: string) => {
          throw new Error(`Module resolution not supported for: ${specifier}`);
        });
      } else {
        await context.eval(module.code);
      }

      const instanceId = uuidv4();
      const instance: V8Instance = {
        id: instanceId,
        moduleId: moduleId.id,
        isolate,
        context,
        startTime: Date.now(),
      };

      this.instances.set(instanceId, instance);

      const instantiateTime = Date.now() - startTime;
      console.log(`Instantiated instance ${instanceId} in ${instantiateTime}ms`);

      return { id: instanceId };
    } catch (error) {
      throw new RuntimeError(
        `Instantiation failed: ${error instanceof Error ? error.message : String(error)}`,
        'INSTANTIATION_ERROR',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async execute(
    instanceId: InstanceId,
    config: ExecutionConfig
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    const instance = this.instances.get(instanceId.id);
    if (!instance) {
      throw new RuntimeError(
        `Instance not found: ${instanceId.id}`,
        'INSTANCE_NOT_FOUND'
      );
    }

    try {
      // Set up security constraints
      this.applySecurityConstraints(instance, config);

      // Create execution wrapper
      const executionScript = `
        (async function() {
          const startTime = Date.now();
          let result;
          let error;
          
          try {
            if (typeof main === 'function') {
              result = await main();
            } else if (typeof exports === 'object' && typeof exports.handler === 'function') {
              result = await exports.handler();
            } else {
              throw new Error('No entry point found (main or exports.handler)');
            }
          } catch (e) {
            error = {
              message: e.message,
              stack: e.stack,
            };
          }
          
          return {
            result,
            error,
            executionTime: Date.now() - startTime,
          };
        })();
      `;

      // Execute with timeout
      const script = await instance.context.eval(executionScript, { 
        timeout: config.timeout.valueOf(),
        copy: true,
      });

      const executionResult = await script.then(
        (ref: ivm.Reference) => ref.copySync()
      );

      const memoryUsed = instance.isolate.getHeapStatisticsSync().used_heap_size;
      const executionTime = Date.now() - startTime;

      if (executionResult.error) {
        return {
          success: false,
          error: executionResult.error.message,
          executionTime,
          memoryUsed,
        };
      }

      return {
        success: true,
        output: executionResult.result,
        executionTime,
        memoryUsed,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('Script execution timed out')) {
        return {
          success: false,
          error: 'Execution timeout',
          executionTime: config.timeout,
          memoryUsed: 0,
        };
      }

      throw new RuntimeError(
        `Execution failed: ${error instanceof Error ? error.message : String(error)}`,
        'EXECUTION_ERROR',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async destroy(instanceId: InstanceId): Promise<void> {
    const instance = this.instances.get(instanceId.id);
    if (!instance) {
      throw new RuntimeError(
        `Instance not found: ${instanceId.id}`,
        'INSTANCE_NOT_FOUND'
      );
    }

    try {
      // Release isolate back to pool
      this.pool.release(instance.isolate);
      
      // Remove instance
      this.instances.delete(instanceId.id);
      
      console.log(`Destroyed instance ${instanceId.id}`);
    } catch (error) {
      throw new RuntimeError(
        `Failed to destroy instance: ${error instanceof Error ? error.message : String(error)}`,
        'DESTROY_ERROR',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async shutdown(): Promise<void> {
    // Clean up all instances
    for (const [id, instance] of this.instances) {
      try {
        this.pool.release(instance.isolate);
      } catch (error) {
        console.error(`Failed to release instance ${id}:`, error);
      }
    }
    
    this.instances.clear();
    this.modules.clear();
    
    await this.pool.shutdown();
  }

  getMetrics() {
    return {
      poolMetrics: this.pool.getMetrics(),
      moduleCount: this.modules.size,
      instanceCount: this.instances.size,
    };
  }

  private async transpileTypeScript(code: string): Promise<string> {
    // In a real implementation, use TypeScript compiler API
    // For now, strip type annotations in a very basic way
    return code
      .replace(/:\s*\w+(\[\])?/g, '') // Remove type annotations
      .replace(/interface\s+\w+\s*{[^}]*}/g, '') // Remove interfaces
      .replace(/type\s+\w+\s*=\s*[^;]+;/g, ''); // Remove type aliases
  }

  private extractMetadata(code: string): { exports?: string[]; imports?: string[] } {
    const exports: string[] = [];
    const imports: string[] = [];

    // Extract exports (basic regex approach)
    const exportRegex = /export\s+(?:function|const|let|var|class)\s+(\w+)/g;
    let match;
    while ((match = exportRegex.exec(code)) !== null) {
      exports.push(match[1]);
    }

    // Extract imports
    const importRegex = /import\s+.+\s+from\s+['"](.+)['"]/g;
    while ((match = importRegex.exec(code)) !== null) {
      imports.push(match[1]);
    }

    return { exports, imports };
  }

  private async compileModule(code: string): Promise<ivm.Module> {
    try {
      // Create isolate with snapshot for better performance
      const isolate = new ivm.Isolate();
      return await isolate.compileModule(code);
    } catch (error) {
      // Fallback to regular compilation
      const isolate = new ivm.Isolate();
      return await isolate.compileModule(code);
    }
  }

  private applySecurityConstraints(instance: V8Instance, config: ExecutionConfig): void {
    const { permissions } = config;

    // Apply memory limit
    if (config.memoryLimit > 0) {
      // Memory limit is set at isolate creation
    }

    // Block capabilities based on trust level
    if (permissions.trustLevel === TrustLevel.Low) {
      // Most restrictive - no external access
      this.blockAllExternalAccess(instance);
    } else if (permissions.trustLevel === TrustLevel.Medium) {
      // Allow some capabilities
      if (!permissions.capabilities.has(Capability.NetworkAccess)) {
        this.blockNetworkAccess(instance);
      }
      if (!permissions.capabilities.has(Capability.FileSystemRead)) {
        this.blockFileSystemAccess(instance);
      }
    }
    // TrustLevel.High has fewer restrictions
  }

  private blockAllExternalAccess(instance: V8Instance): void {
    // Remove/override dangerous globals
    try {
      instance.context.evalSync(`
        delete global.process;
        delete global.require;
        global.fetch = undefined;
        global.XMLHttpRequest = undefined;
        global.WebSocket = undefined;
      `);
    } catch (error) {
      console.warn('Failed to block external access:', error);
    }
  }

  private blockNetworkAccess(instance: V8Instance): void {
    try {
      instance.context.evalSync(`
        global.fetch = undefined;
        global.XMLHttpRequest = undefined;
        global.WebSocket = undefined;
      `);
    } catch (error) {
      console.warn('Failed to block network access:', error);
    }
  }

  private blockFileSystemAccess(instance: V8Instance): void {
    try {
      instance.context.evalSync(`
        delete global.process;
        delete global.require;
        if (global.fs) delete global.fs;
      `);
    } catch (error) {
      console.warn('Failed to block filesystem access:', error);
    }
  }
}