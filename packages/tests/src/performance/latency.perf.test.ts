import {
  RuntimeController,
  Language,
  TrustLevel,
  ExecutionConfig,
} from '@rizome/next-rc-core';
import { V8Runtime, V8IsolatePool } from '@rizome/next-rc-v8';

describe('Performance Tests - Latency', () => {
  describe('V8 Isolate Performance', () => {
    let runtime: V8Runtime;

    beforeAll(async () => {
      // Create pre-warmed pool
      const pool = new V8IsolatePool({
        enabled: true,
        poolSize: 10,
        maxIdleTime: 60000,
      });
      
      runtime = new V8Runtime(pool);
      await runtime.initialize();
    });

    afterAll(async () => {
      await runtime.shutdown();
    });

    it('should achieve <5ms cold start with pre-warming', async () => {
      const code = 'function main() { return 42; }';
      
      // Compile module
      const moduleId = await runtime.compile(code, Language.JavaScript);
      
      // Measure instantiation time (should be near-zero with pre-warming)
      const iterations = 50;
      const times: number[] = [];
      
      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        const instanceId = await runtime.instantiate(moduleId);
        const instantiationTime = Date.now() - start;
        times.push(instantiationTime);
        
        await runtime.destroy(instanceId);
      }
      
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);
      
      console.log(`V8 Instantiation - Avg: ${avgTime.toFixed(2)}ms, Max: ${maxTime}ms`);
      
      expect(avgTime).toBeLessThan(5); // Average should be under 5ms
      expect(maxTime).toBeLessThan(10); // Max should be under 10ms
    });

    it('should execute simple functions quickly', async () => {
      const code = 'function main() { return { result: 1 + 1 }; }';
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
      
      // Warm up
      await runtime.execute(instanceId, config);
      
      // Measure execution time
      const times: number[] = [];
      const iterations = 100;
      
      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        const result = await runtime.execute(instanceId, config);
        const end = process.hrtime.bigint();
        
        const executionTime = Number(end - start) / 1_000_000; // Convert to ms
        times.push(executionTime);
        
        expect(result.success).toBe(true);
      }
      
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const p95Time = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];
      
      console.log(`V8 Execution - Avg: ${avgTime.toFixed(3)}ms, P95: ${p95Time.toFixed(3)}ms`);
      
      expect(avgTime).toBeLessThan(1); // Average under 1ms
      expect(p95Time).toBeLessThan(2); // P95 under 2ms
      
      await runtime.destroy(instanceId);
    });
  });

  describe('End-to-End Latency', () => {
    let controller: RuntimeController;

    beforeAll(async () => {
      controller = RuntimeController.getInstance({
        enableScheduler: true,
        runtimes: {
          v8: { enabled: true },
        },
      });
      
      await controller.initialize();
    });

    afterAll(async () => {
      await controller.shutdown();
    });

    it('should handle complete request cycle efficiently', async () => {
      const code = `
        function main() {
          const data = [];
          for (let i = 0; i < 100; i++) {
            data.push(i * i);
          }
          return {
            sum: data.reduce((a, b) => a + b, 0),
            count: data.length,
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

      // Warm up
      await controller.executeWithScheduler(code, Language.JavaScript, config);

      // Measure end-to-end latency
      const times: number[] = [];
      const iterations = 50;

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        const result = await controller.executeWithScheduler(
          code,
          Language.JavaScript,
          config
        );
        const totalTime = Date.now() - start;
        
        times.push(totalTime);
        expect(result.success).toBe(true);
        expect(result.output.sum).toBe(328350);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);

      console.log(
        `End-to-End - Min: ${minTime}ms, Avg: ${avgTime.toFixed(2)}ms, Max: ${maxTime}ms`
      );

      expect(avgTime).toBeLessThan(20); // Average under 20ms for complete cycle
      expect(minTime).toBeLessThan(10); // Best case under 10ms
    });

    it('should handle concurrent requests efficiently', async () => {
      const code = 'function main() { return { id: Math.random() }; }';
      
      const config: ExecutionConfig = {
        timeout: 1000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      // Measure concurrent execution
      const concurrentRequests = 20;
      const start = Date.now();

      const promises = Array(concurrentRequests).fill(0).map(() =>
        controller.executeWithScheduler(code, Language.JavaScript, config)
      );

      const results = await Promise.all(promises);
      const totalTime = Date.now() - start;

      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      const avgTimePerRequest = totalTime / concurrentRequests;
      console.log(
        `Concurrent Execution - Total: ${totalTime}ms, Avg per request: ${avgTimePerRequest.toFixed(2)}ms`
      );

      // Should handle concurrent requests efficiently
      expect(avgTimePerRequest).toBeLessThan(10);
    });
  });

  describe('Memory Performance', () => {
    let controller: RuntimeController;

    beforeAll(async () => {
      controller = RuntimeController.getInstance({
        runtimes: {
          v8: { enabled: true },
        },
      });
      
      await controller.initialize();
    });

    afterAll(async () => {
      await controller.shutdown();
    });

    it('should have low memory overhead per instance', async () => {
      const code = 'function main() { return { data: new Array(1000).fill(0) }; }';
      
      const config: ExecutionConfig = {
        timeout: 5000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      // Get baseline memory
      if (global.gc) global.gc();
      const baselineMemory = process.memoryUsage().heapUsed;

      // Create multiple instances
      const instances = 10;
      const results = [];

      for (let i = 0; i < instances; i++) {
        const result = await controller.executeWithScheduler(
          code,
          Language.JavaScript,
          config
        );
        results.push(result);
      }

      // Measure memory after instances
      const afterMemory = process.memoryUsage().heapUsed;
      const memoryPerInstance = (afterMemory - baselineMemory) / instances / 1024 / 1024;

      console.log(`Memory per instance: ${memoryPerInstance.toFixed(2)}MB`);

      // Should have reasonable memory overhead
      expect(memoryPerInstance).toBeLessThan(5); // Less than 5MB per instance
    });
  });
});