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
import * as vm from 'vm';
import { v4 as uuidv4 } from 'uuid';

interface V8Module {
  id: string;
  code: string;
  language: Language;
}

interface V8Instance {
  id: string;
  moduleId: string;
  context: vm.Context;
  startTime: number;
}

export class FallbackV8Runtime implements Runtime {
  private modules = new Map<string, V8Module>();
  private instances = new Map<string, V8Instance>();
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    console.log('Initializing Fallback V8 Runtime (using Node.js vm module)');
    this.isInitialized = true;
  }

  async compile(code: string, language: Language): Promise<ModuleId> {
    if (!this.isInitialized) {
      throw new RuntimeError('Runtime not initialized', 'NOT_INITIALIZED');
    }

    // Only support JavaScript and TypeScript
    if (language !== Language.JavaScript && language !== Language.TypeScript) {
      throw new RuntimeError(
        `Unsupported language: ${language}`,
        'UNSUPPORTED_LANGUAGE'
      );
    }

    const moduleId = uuidv4();
    const processedCode = language === Language.TypeScript 
      ? this.transpileTypeScript(code)
      : code;

    this.modules.set(moduleId, {
      id: moduleId,
      code: processedCode,
      language
    });

    return { id: moduleId };
  }

  async instantiate(moduleId: ModuleId): Promise<InstanceId> {
    const module = this.modules.get(moduleId.id);
    if (!module) {
      throw new RuntimeError('Module not found', 'MODULE_NOT_FOUND');
    }

    const instanceId = uuidv4();
    
    // Create a new context with limited globals
    const sandbox = this.createSandbox();
    const context = vm.createContext(sandbox);

    this.instances.set(instanceId, {
      id: instanceId,
      moduleId: moduleId.id,
      context,
      startTime: Date.now()
    });

    return { id: instanceId };
  }

  async execute(
    instanceId: InstanceId,
    config: ExecutionConfig
  ): Promise<ExecutionResult> {
    const instance = this.instances.get(instanceId.id);
    if (!instance) {
      throw new RuntimeError('Instance not found', 'INSTANCE_NOT_FOUND');
    }

    const module = this.modules.get(instance.moduleId);
    if (!module) {
      throw new RuntimeError('Module not found', 'MODULE_NOT_FOUND');
    }

    const startTime = process.hrtime.bigint();
    const startMemory = process.memoryUsage().heapUsed;

    try {
      // Apply security restrictions
      this.applySecurityRestrictions(instance.context, config);

      // Execute with timeout
      const options: vm.RunningScriptOptions = {
        timeout: config.timeout,
        displayErrors: true
      };

      const script = new vm.Script(module.code);
      const result = script.runInContext(instance.context, options);

      const endTime = process.hrtime.bigint();
      const endMemory = process.memoryUsage().heapUsed;

      const executionTime = Number(endTime - startTime) / 1_000_000; // Convert to ms
      const memoryUsed = Math.max(0, endMemory - startMemory);

      return {
        success: true,
        output: result !== undefined ? [result] : undefined,
        executionTime,
        memoryUsed
      };
    } catch (error: any) {
      const endTime = process.hrtime.bigint();
      const executionTime = Number(endTime - startTime) / 1_000_000;

      return {
        success: false,
        error: error.message || 'Unknown error',
        executionTime,
        memoryUsed: 0
      };
    }
  }

  async destroy(instanceId: InstanceId): Promise<void> {
    const instance = this.instances.get(instanceId.id);
    if (!instance) {
      throw new RuntimeError('Instance not found', 'INSTANCE_NOT_FOUND');
    }

    // Clean up the instance
    this.instances.delete(instanceId.id);
  }

  async getStatus() {
    return {
      runtime: 'v8',
      initialized: this.isInitialized,
      activeInstances: this.instances.size,
      totalModules: this.modules.size
    };
  }

  private createSandbox(): any {
    // Create a minimal sandbox with safe globals
    return {
      console: {
        log: (...args: any[]) => console.log('[V8]', ...args),
        error: (...args: any[]) => console.error('[V8]', ...args),
        warn: (...args: any[]) => console.warn('[V8]', ...args),
        info: (...args: any[]) => console.info('[V8]', ...args)
      },
      Math,
      Date,
      JSON,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURI,
      decodeURI,
      encodeURIComponent,
      decodeURIComponent,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Error,
      TypeError,
      RangeError,
      ReferenceError,
      SyntaxError,
      URIError,
      // Add performance for benchmarking
      performance: {
        now: () => performance.now()
      }
    };
  }

  private applySecurityRestrictions(context: vm.Context, config: ExecutionConfig): void {
    const sandbox = context as any;

    // Remove dangerous globals based on permissions
    if (!config.permissions.capabilities.has(Capability.NetworkAccess)) {
      sandbox.fetch = undefined;
      sandbox.XMLHttpRequest = undefined;
    }

    if (!config.permissions.capabilities.has(Capability.FileSystemRead) && 
        !config.permissions.capabilities.has(Capability.FileSystemWrite)) {
      sandbox.require = undefined;
      sandbox.process = undefined;
      sandbox.__dirname = undefined;
      sandbox.__filename = undefined;
    }

    // Always remove dangerous globals
    sandbox.eval = undefined;
    sandbox.Function = undefined;
    sandbox.setTimeout = undefined;
    sandbox.setInterval = undefined;
    sandbox.setImmediate = undefined;
  }

  private transpileTypeScript(code: string): string {
    // Very basic TypeScript stripping - just remove type annotations
    // In production, use proper TypeScript compiler
    return code
      .replace(/:\s*\w+(\[\])?/g, '') // Remove type annotations
      .replace(/interface\s+\w+\s*{[^}]*}/g, '') // Remove interfaces
      .replace(/type\s+\w+\s*=\s*[^;]+;/g, '') // Remove type aliases
      .replace(/<[^>]+>/g, ''); // Remove generics
  }
}

export default FallbackV8Runtime;