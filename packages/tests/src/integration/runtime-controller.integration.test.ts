import {
  RuntimeController,
  Language,
  TrustLevel,
  Capability,
  ExecutionConfig,
} from '@rizome/next-rc-core';

describe('RuntimeController Integration Tests', () => {
  let controller: RuntimeController;

  beforeAll(async () => {
    controller = RuntimeController.getInstance({
      enableScheduler: true,
      runtimes: {
        v8: { enabled: true },
        wasm: { enabled: false }, // Disabled for now
        ebpf: { enabled: false }, // Disabled for now
        firecracker: { enabled: false },
      },
    });
    
    await controller.initialize();
  });

  afterAll(async () => {
    await controller.shutdown();
  });

  describe('End-to-End Execution', () => {
    it('should execute JavaScript code with low trust level', async () => {
      const code = `
        function main() {
          const sum = (a, b) => a + b;
          return {
            result: sum(5, 3),
            message: 'Hello from sandbox!'
          };
        }
      `;

      const config: ExecutionConfig = {
        timeout: 5000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      const result = await controller.executeWithScheduler(
        code,
        Language.JavaScript,
        config
      );

      expect(result.success).toBe(true);
      expect(result.output).toEqual({
        result: 8,
        message: 'Hello from sandbox!',
      });
      expect(result.runtime).toBe('v8isolate');
      expect(result.executionTime).toBeLessThan(100);
    });

    it('should execute TypeScript code', async () => {
      const code = `
        interface User {
          id: number;
          name: string;
        }

        function main(): User {
          return {
            id: 123,
            name: 'Test User'
          };
        }
      `;

      const config: ExecutionConfig = {
        timeout: 5000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      const result = await controller.executeWithScheduler(
        code,
        Language.TypeScript,
        config
      );

      expect(result.success).toBe(true);
      expect(result.output).toEqual({
        id: 123,
        name: 'Test User',
      });
    });

    it('should enforce timeouts', async () => {
      const code = `
        async function main() {
          while (true) {
            // Infinite loop
          }
        }
      `;

      const config: ExecutionConfig = {
        timeout: 100, // 100ms timeout
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      const result = await controller.executeWithScheduler(
        code,
        Language.JavaScript,
        config
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });

    it('should handle execution errors', async () => {
      const code = `
        function main() {
          throw new Error('Intentional error for testing');
        }
      `;

      const config: ExecutionConfig = {
        timeout: 5000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      const result = await controller.executeWithScheduler(
        code,
        Language.JavaScript,
        config
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Intentional error for testing');
    });

    it('should respect security permissions', async () => {
      const code = `
        function main() {
          const checks = {
            hasNetworkAccess: typeof fetch !== 'undefined',
            hasFileSystem: typeof require !== 'undefined',
            hasProcess: typeof process !== 'undefined',
          };
          return checks;
        }
      `;

      // Test with low trust level (no capabilities)
      const lowTrustConfig: ExecutionConfig = {
        timeout: 5000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      const lowTrustResult = await controller.executeWithScheduler(
        code,
        Language.JavaScript,
        lowTrustConfig
      );

      expect(lowTrustResult.success).toBe(true);
      expect(lowTrustResult.output.hasNetworkAccess).toBe(false);
      expect(lowTrustResult.output.hasFileSystem).toBe(false);
      expect(lowTrustResult.output.hasProcess).toBe(false);
    });
  });

  describe('Module Management', () => {
    it('should compile and reuse modules', async () => {
      const code = `
        function main() {
          return { timestamp: Date.now() };
        }
      `;

      // Compile once
      const moduleId = await controller.compile(code, Language.JavaScript);
      expect(moduleId.id).toBeTruthy();

      // Create multiple instances from the same module
      const instance1 = await controller.instantiate(moduleId);
      const instance2 = await controller.instantiate(moduleId);

      expect(instance1.id).not.toBe(instance2.id);

      // Execute both instances
      const config: ExecutionConfig = {
        timeout: 1000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set([Capability.SystemTime]),
          trustLevel: TrustLevel.Medium,
        },
      };

      const result1 = await controller.execute(instance1, config);
      const result2 = await controller.execute(instance2, config);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.output.timestamp).toBeLessThanOrEqual(result2.output.timestamp);

      // Cleanup
      await controller.destroy(instance1);
      await controller.destroy(instance2);
    });
  });

  describe('Scheduler Intelligence', () => {
    it('should select appropriate runtime based on hints', async () => {
      const filterCode = `
        function filter(data) {
          return data.port === 80;
        }
      `;

      const result = await controller.executeWithScheduler(
        filterCode,
        Language.JavaScript,
        {
          timeout: 1000,
          memoryLimit: 1024 * 1024,
          permissions: {
            capabilities: new Set(),
            trustLevel: TrustLevel.Low,
          },
        },
        {
          latencyRequirement: 'low',
          complexity: 'simple',
        }
      );

      expect(result.success).toBe(true);
      // V8 is the only runtime available in tests
      expect(result.runtime).toBe('v8isolate');
    });
  });

  describe('Concurrent Execution', () => {
    it('should handle multiple concurrent executions', async () => {
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        const code = `
          function main() {
            return {
              id: ${i},
              square: ${i} * ${i}
            };
          }
        `;

        const promise = controller.executeWithScheduler(
          code,
          Language.JavaScript,
          {
            timeout: 5000,
            memoryLimit: 128 * 1024 * 1024,
            permissions: {
              capabilities: new Set(),
              trustLevel: TrustLevel.Low,
            },
          }
        );

        promises.push(promise);
      }

      const results = await Promise.all(promises);

      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.output.id).toBe(index);
        expect(result.output.square).toBe(index * index);
      });
    });
  });

  describe('Metrics and Monitoring', () => {
    it('should track execution metrics', async () => {
      // Execute some code
      await controller.executeWithScheduler(
        'function main() { return 42; }',
        Language.JavaScript,
        {
          timeout: 1000,
          memoryLimit: 128 * 1024 * 1024,
          permissions: {
            capabilities: new Set(),
            trustLevel: TrustLevel.Low,
          },
        }
      );

      const metrics = controller.getMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.initialized).toBe(true);
      expect(metrics.availableRuntimes).toContain('v8isolate');
      expect(metrics.schedulerMetrics).toBeDefined();
      expect(metrics.schedulerMetrics.totalExecutions).toBeGreaterThan(0);
    });
  });
});