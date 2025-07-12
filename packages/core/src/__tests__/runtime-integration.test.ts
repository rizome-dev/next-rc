import { RuntimeController } from '../runtime-controller';
import { Language, TrustLevel, RuntimeType, Capability } from '@rizome/next-rc-types';

describe('Runtime Integration Tests', () => {
  let controller: RuntimeController;

  beforeAll(async () => {
    controller = RuntimeController.getInstance({
      enableScheduler: true,
      runtimes: {
        v8: { enabled: true },
        wasm: { enabled: true },
        ebpf: { enabled: true },
        python: { enabled: true },
      },
      concurrency: 10,
    });
    
    await controller.initialize();
  });

  afterAll(async () => {
    await controller.shutdown();
  });

  describe('Multi-language Execution', () => {
    it('should execute JavaScript code in V8 runtime', async () => {
      const jsCode = `
        function fibonacci(n) {
          if (n <= 1) return n;
          return fibonacci(n - 1) + fibonacci(n - 2);
        }
        
        fibonacci(10);
      `;

      const result = await controller.executeWithScheduler(
        jsCode,
        Language.JavaScript,
        {
          timeout: 5000,
          memoryLimit: 64 * 1024 * 1024, // 64MB
          permissions: {
            capabilities: new Set([Capability.CpuIntensive]),
            trustLevel: TrustLevel.High,
          },
        }
      );

      expect(result.success).toBe(true);
      expect(result.runtime).toBe(RuntimeType.V8Isolate);
      expect(result.output).toBe(55); // 10th Fibonacci number
    });

    it('should execute WASM-compatible code in WASM runtime', async () => {
      const wasmCode = `
        (module
          (func $add (param $a i32) (param $b i32) (result i32)
            local.get $a
            local.get $b
            i32.add
          )
          (func $_start (result i32)
            i32.const 10
            i32.const 20
            call $add
          )
          (export "_start" (func $_start))
          (export "add" (func $add))
        )
      `;

      const result = await controller.executeWithScheduler(
        wasmCode,
        Language.Wasm,
        {
          timeout: 5000,
          memoryLimit: 32 * 1024 * 1024, // 32MB
          permissions: {
            capabilities: new Set([Capability.CpuIntensive]),
            trustLevel: TrustLevel.Medium,
          },
        },
        {
          expectedDuration: 100, // 100ms
          latencyRequirement: 'low',
          complexity: 'simple',
        }
      );

      expect(result.success).toBe(true);
      expect(result.runtime).toBe(RuntimeType.Wasm);
      expect(result.output).toBeDefined();
      expect(result.executionTime).toBeLessThan(100); // Should be under 100ms
    });

    it('should execute eBPF filter in eBPF runtime', async () => {
      const ebpfCode = `
        // Simple eBPF filter that allows all packets
        int filter(void *data) {
          return 1; // Allow packet
        }
      `;

      const result = await controller.executeWithScheduler(
        ebpfCode,
        Language.C,
        {
          timeout: 1000,
          memoryLimit: 512 * 1024, // 512KB - eBPF max memory
          permissions: {
            capabilities: new Set([Capability.NetworkAccess]),
            trustLevel: TrustLevel.Low,
          },
        },
        {
          expectedDuration: 1, // 1ms
          latencyRequirement: 'ultra-low',
          complexity: 'simple',
        }
      );

      expect(result.success).toBe(true);
      expect(result.runtime).toBe(RuntimeType.Ebpf);
      expect(result.executionTime).toBeLessThan(10); // Should be under 10ms
    });

    it('should execute Python code using language-agnostic interface', async () => {
      const pythonCode = `
        def calculate_sum(numbers):
          return sum(numbers)
        
        numbers = [1, 2, 3, 4, 5]
        result = calculate_sum(numbers)
        result
      `;

      const result = await controller.executeWithScheduler(
        pythonCode,
        Language.Python,
        {
          timeout: 10000,
          memoryLimit: 128 * 1024 * 1024, // 128MB
          permissions: {
            capabilities: new Set([Capability.CpuIntensive]),
            trustLevel: TrustLevel.High,
          },
        }
      );

      expect(result.success).toBe(true);
      // Python could be executed in Python, WASM or V8 runtime depending on scheduling
      expect([RuntimeType.Python, RuntimeType.Wasm, RuntimeType.V8Isolate]).toContain(result.runtime);
      expect(result.output).toBe(15);
    });
  });

  describe('Runtime Selection', () => {
    it('should select optimal runtime based on latency requirements', async () => {
      const simpleCode = 'return 42;';

      // Ultra-low latency should prefer eBPF
      const ebpfResult = await controller.executeWithScheduler(
        simpleCode,
        Language.C,
        {
          timeout: 1000,
          memoryLimit: 512 * 1024, // 512KB - eBPF max memory
          permissions: {
            capabilities: new Set(),
            trustLevel: TrustLevel.Low,
          },
        },
        {
          latencyRequirement: 'ultra-low',
          complexity: 'simple',
        }
      );

      expect(ebpfResult.runtime).toBe(RuntimeType.Ebpf);

      // Normal latency for JS should use V8
      const v8Result = await controller.executeWithScheduler(
        'return 42;',
        Language.JavaScript,
        {
          timeout: 5000,
          memoryLimit: 64 * 1024 * 1024,
          permissions: {
            capabilities: new Set(),
            trustLevel: TrustLevel.Medium,
          },
        },
        {
          latencyRequirement: 'normal',
          complexity: 'simple',
        }
      );

      expect(v8Result.runtime).toBe(RuntimeType.V8Isolate);
    });

    it('should handle runtime selection fallback', async () => {
      const complexCode = `
        function heavyComputation() {
          let result = 0;
          for (let i = 0; i < 1000000; i++) {
            result += Math.sqrt(i);
          }
          return result;
        }
        
        heavyComputation();
      `;

      const result = await controller.executeWithScheduler(
        complexCode,
        Language.JavaScript,
        {
          timeout: 10000,
          memoryLimit: 128 * 1024 * 1024,
          permissions: {
            capabilities: new Set([Capability.CpuIntensive]),
            trustLevel: TrustLevel.High,
          },
        },
        {
          complexity: 'complex',
          expectedDuration: 1000,
        }
      );

      expect(result.success).toBe(true);
      expect(result.runtime).toBe(RuntimeType.V8Isolate);
    });
  });

  describe('Performance Metrics', () => {
    it('should report runtime metrics', async () => {
      const metrics = controller.getMetrics();
      
      expect(metrics.initialized).toBe(true);
      expect(metrics.availableRuntimes).toContain('v8isolate');
      expect(metrics.availableRuntimes).toContain('wasm');
      expect(metrics.availableRuntimes).toContain('ebpf');
      expect(metrics.queueSize).toBeGreaterThanOrEqual(0);
      expect(metrics.queuePending).toBeGreaterThanOrEqual(0);
    });
  });
});