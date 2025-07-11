import { V8Runtime } from '../runtime';
import { V8IsolatePool } from '../isolate-pool';
import {
  Language,
  ExecutionConfig,
  TrustLevel,
} from '@rizome/next-rc-types';

describe('V8Runtime', () => {
  let runtime: V8Runtime;

  beforeEach(async () => {
    runtime = new V8Runtime();
    await runtime.initialize();
  });

  afterEach(async () => {
    await runtime.shutdown();
  });

  describe('compile', () => {
    it('should compile JavaScript code', async () => {
      const code = `
        function main() {
          return { message: 'Hello, World!' };
        }
      `;

      const moduleId = await runtime.compile(code, Language.JavaScript);
      expect(moduleId.id).toBeTruthy();
    });

    it('should compile TypeScript code', async () => {
      const code = `
        interface Result {
          message: string;
          count: number;
        }

        function main(): Result {
          return { message: 'Hello, TypeScript!', count: 42 };
        }
      `;

      const moduleId = await runtime.compile(code, Language.TypeScript);
      expect(moduleId.id).toBeTruthy();
    });

    it('should reject unsupported languages', async () => {
      await expect(
        runtime.compile('print("Hello")', Language.Python)
      ).rejects.toThrow('Unsupported language');
    });
  });

  describe('instantiate', () => {
    it('should instantiate a compiled module', async () => {
      const code = 'function main() { return 42; }';
      const moduleId = await runtime.compile(code, Language.JavaScript);
      
      const instanceId = await runtime.instantiate(moduleId);
      expect(instanceId.id).toBeTruthy();
    });

    it('should fail for non-existent module', async () => {
      await expect(
        runtime.instantiate({ id: 'non-existent' })
      ).rejects.toThrow('Module not found');
    });
  });

  describe('execute', () => {
    it('should execute a simple function', async () => {
      const code = 'function main() { return { result: 42 }; }';
      const moduleId = await runtime.compile(code, Language.JavaScript);
      const instanceId = await runtime.instantiate(moduleId);

      const config: ExecutionConfig = {
        timeout: 1000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      const result = await runtime.execute(instanceId, config);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ result: 42 });
    });

    it('should handle async functions', async () => {
      const code = `
        async function main() {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { async: true };
        }
      `;
      const moduleId = await runtime.compile(code, Language.JavaScript);
      const instanceId = await runtime.instantiate(moduleId);

      const config: ExecutionConfig = {
        timeout: 1000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      const result = await runtime.execute(instanceId, config);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ async: true });
    });

    it('should handle exports.handler pattern', async () => {
      const code = `
        exports.handler = async function() {
          return { handler: 'called' };
        }
      `;
      const moduleId = await runtime.compile(code, Language.JavaScript);
      const instanceId = await runtime.instantiate(moduleId);

      const config: ExecutionConfig = {
        timeout: 1000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      const result = await runtime.execute(instanceId, config);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ handler: 'called' });
    });

    it('should enforce timeout', async () => {
      const code = `
        async function main() {
          while (true) {
            // Infinite loop
          }
        }
      `;
      const moduleId = await runtime.compile(code, Language.JavaScript);
      const instanceId = await runtime.instantiate(moduleId);

      const config: ExecutionConfig = {
        timeout: 100, // 100ms timeout
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      const result = await runtime.execute(instanceId, config);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });

    it('should report execution errors', async () => {
      const code = `
        function main() {
          throw new Error('Intentional error');
        }
      `;
      const moduleId = await runtime.compile(code, Language.JavaScript);
      const instanceId = await runtime.instantiate(moduleId);

      const config: ExecutionConfig = {
        timeout: 1000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      const result = await runtime.execute(instanceId, config);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Intentional error');
    });
  });

  describe('security', () => {
    it('should block network access for low trust level', async () => {
      const code = `
        function main() {
          return {
            hasFetch: typeof fetch !== 'undefined',
            hasXHR: typeof XMLHttpRequest !== 'undefined',
          };
        }
      `;
      const moduleId = await runtime.compile(code, Language.JavaScript);
      const instanceId = await runtime.instantiate(moduleId);

      const config: ExecutionConfig = {
        timeout: 1000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      const result = await runtime.execute(instanceId, config);
      expect(result.success).toBe(true);
      expect(result.output.hasFetch).toBe(false);
      expect(result.output.hasXHR).toBe(false);
    });

    it('should block process access for low trust level', async () => {
      const code = `
        function main() {
          return {
            hasProcess: typeof process !== 'undefined',
            hasRequire: typeof require !== 'undefined',
          };
        }
      `;
      const moduleId = await runtime.compile(code, Language.JavaScript);
      const instanceId = await runtime.instantiate(moduleId);

      const config: ExecutionConfig = {
        timeout: 1000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      const result = await runtime.execute(instanceId, config);
      expect(result.success).toBe(true);
      expect(result.output.hasProcess).toBe(false);
      expect(result.output.hasRequire).toBe(false);
    });
  });

  describe('performance', () => {
    it('should achieve low instantiation time with pre-warming', async () => {
      // Pre-warm the pool
      const pool = new V8IsolatePool({
        enabled: true,
        poolSize: 5,
        maxIdleTime: 60000,
      });
      const runtime = new V8Runtime(pool);
      await runtime.initialize();

      const code = 'function main() { return 42; }';
      const moduleId = await runtime.compile(code, Language.JavaScript);

      // Measure instantiation time
      const startTime = Date.now();
      await runtime.instantiate(moduleId);
      const instantiationTime = Date.now() - startTime;

      console.log(`Instantiation time: ${instantiationTime}ms`);
      expect(instantiationTime).toBeLessThan(10); // Should be under 10ms

      await runtime.shutdown();
    });

    it('should handle concurrent executions', async () => {
      const code = `
        async function main() {
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
          return { id: Math.random() };
        }
      `;
      const moduleId = await runtime.compile(code, Language.JavaScript);

      const config: ExecutionConfig = {
        timeout: 1000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      // Create multiple instances and execute concurrently
      const promises = [];
      for (let i = 0; i < 10; i++) {
        const instanceId = await runtime.instantiate(moduleId);
        promises.push(runtime.execute(instanceId, config));
      }

      const results = await Promise.all(promises);
      
      // All should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.output.id).toBeDefined();
      });

      // All should have different IDs
      const ids = results.map(r => r.output.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);
    });
  });
});