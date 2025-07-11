/**
 * End-to-End Tests for all 4 runtimes
 * Tests actual execution capabilities and performance characteristics
 */

import {
  RuntimeController,
  Language,
  TrustLevel,
  Capability,
  ExecutionConfig,
} from '@rizome/next-rc-core';

describe('Runtime Controller E2E Tests', () => {
  let controller: RuntimeController;

  beforeAll(async () => {
    controller = await RuntimeController.create();
    await controller.initialize();
  });

  afterAll(async () => {
    await controller.shutdown();
  });

  describe('V8 Isolate Runtime', () => {
    it('should execute JavaScript code with sub-10ms latency', async () => {
      const code = `
        function fibonacci(n) {
          if (n <= 1) return n;
          return fibonacci(n - 1) + fibonacci(n - 2);
        }
        return fibonacci(10);
      `;

      const start = Date.now();
      const result = await controller.execute({
        code,
        language: Language.JavaScript,
        config: {
          timeout: 1000,
          memoryLimit: 50 * 1024 * 1024,
          permissions: {
            capabilities: new Set(),
            trustLevel: TrustLevel.Medium,
          },
        },
      });
      const latency = Date.now() - start;

      expect(result.success).toBe(true);
      expect(result.output).toBe(55);
      expect(latency).toBeLessThan(10); // V8 should be < 10ms
    });

    it('should handle TypeScript with type checking', async () => {
      const code = `
        interface User {
          name: string;
          age: number;
        }
        
        const user: User = { name: "Alice", age: 30 };
        return user.age * 2;
      `;

      const result = await controller.execute({
        code,
        language: Language.TypeScript,
        config: {
          timeout: 1000,
          memoryLimit: 50 * 1024 * 1024,
          permissions: {
            capabilities: new Set(),
            trustLevel: TrustLevel.Medium,
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe(60);
    });

    it('should enforce memory limits', async () => {
      const code = `
        const arr = [];
        for (let i = 0; i < 1000000; i++) {
          arr.push(new Array(1000).fill(i));
        }
        return arr.length;
      `;

      const result = await controller.execute({
        code,
        language: Language.JavaScript,
        config: {
          timeout: 1000,
          memoryLimit: 10 * 1024 * 1024, // 10MB limit
          permissions: {
            capabilities: new Set(),
            trustLevel: TrustLevel.Low,
          },
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('memory');
    });
  });

  describe('WebAssembly Runtime', () => {
    it('should execute WASM with microsecond latency', async () => {
      // Simple WASM module that adds two numbers
      const wasmCode = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01,
        0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01,
        0x03, 0x61, 0x64, 0x64, 0x00, 0x00, 0x0a, 0x09,
        0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a,
        0x0b
      ]);

      const start = Date.now();
      const result = await controller.execute({
        code: wasmCode.toString(),
        language: Language.Wasm,
        config: {
          timeout: 100,
          memoryLimit: 1024 * 1024,
          permissions: {
            capabilities: new Set(),
            trustLevel: TrustLevel.Low,
          },
        },
      });
      const latency = Date.now() - start;

      expect(result.success).toBe(true);
      expect(latency).toBeLessThan(1); // WASM should be < 1ms
    });

    it('should support Rust compiled to WASM', async () => {
      const rustCode = `
        #[no_mangle]
        pub extern "C" fn factorial(n: i32) -> i32 {
            match n {
                0 | 1 => 1,
                _ => n * factorial(n - 1),
            }
        }
      `;

      const result = await controller.execute({
        code: rustCode,
        language: Language.Rust,
        config: {
          timeout: 5000,
          memoryLimit: 10 * 1024 * 1024,
          permissions: {
            capabilities: new Set(),
            trustLevel: TrustLevel.Medium,
          },
        },
      });

      expect(result.success).toBe(true);
    });
  });

  describe('eBPF Runtime', () => {
    it('should execute filters with nanosecond latency', async () => {
      // Simple eBPF filter that allows packets
      const ebpfCode = `
        return 1; // Allow all
      `;

      const start = process.hrtime.bigint();
      const result = await controller.execute({
        code: ebpfCode,
        language: Language.C,
        config: {
          timeout: 1,
          memoryLimit: 4096,
          permissions: {
            capabilities: new Set([Capability.NetworkAccess]),
            trustLevel: TrustLevel.Low,
          },
        },
      });
      const latency = Number(process.hrtime.bigint() - start) / 1000000;

      expect(result.success).toBe(true);
      expect(latency).toBeLessThan(0.001); // eBPF should be < 1μs
    });

    it('should validate bytecode before execution', async () => {
      const invalidCode = `
        // Invalid eBPF code
        *(u32 *)(0) = 0; // Null pointer dereference
      `;

      const result = await controller.execute({
        code: invalidCode,
        language: Language.C,
        config: {
          timeout: 1,
          memoryLimit: 4096,
          permissions: {
            capabilities: new Set(),
            trustLevel: TrustLevel.Low,
          },
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('verif');
    });
  });

  describe('Python Runtime', () => {
    it('should execute Python with PyO3 for ML workloads', async () => {
      const pythonCode = `
import numpy as np

def matrix_multiply():
    a = np.array([[1, 2], [3, 4]])
    b = np.array([[5, 6], [7, 8]])
    return np.dot(a, b).tolist()

result = matrix_multiply()
      `;

      const start = Date.now();
      const result = await controller.execute({
        code: pythonCode,
        language: Language.Python,
        config: {
          timeout: 5000,
          memoryLimit: 100 * 1024 * 1024,
          permissions: {
            capabilities: new Set([Capability.CpuIntensive]),
            trustLevel: TrustLevel.High,
          },
        },
      });
      const latency = Date.now() - start;

      expect(result.success).toBe(true);
      expect(result.output).toEqual([[19, 22], [43, 50]]);
      expect(latency).toBeLessThan(100); // Python should be < 100ms
    });

    it('should support data science libraries', async () => {
      const code = `
import pandas as pd
import json

data = {'A': [1, 2, 3], 'B': [4, 5, 6]}
df = pd.DataFrame(data)
result = df.sum().to_dict()
json.dumps(result)
      `;

      const result = await controller.execute({
        code,
        language: Language.Python,
        config: {
          timeout: 5000,
          memoryLimit: 100 * 1024 * 1024,
          permissions: {
            capabilities: new Set([Capability.CpuIntensive]),
            trustLevel: TrustLevel.Medium,
          },
        },
      });

      expect(result.success).toBe(true);
      expect(JSON.parse(result.output)).toEqual({ A: 6, B: 15 });
    });

    it('should fall back to WASM Python for low trust', async () => {
      const code = `
def add(a, b):
    return a + b

result = add(10, 20)
      `;

      const result = await controller.execute({
        code,
        language: Language.Python,
        config: {
          timeout: 1000,
          memoryLimit: 10 * 1024 * 1024,
          permissions: {
            capabilities: new Set(),
            trustLevel: TrustLevel.Low, // Forces WASM runtime
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe(30);
    });
  });

  describe('Cross-Runtime Features', () => {
    it('should automatically select optimal runtime based on workload', async () => {
      const testCases = [
        {
          code: 'return 1 + 1;',
          language: Language.JavaScript,
          expectedRuntime: 'v8isolate',
        },
        {
          code: 'pub fn add(a: i32, b: i32) -> i32 { a + b }',
          language: Language.Rust,
          expectedRuntime: 'wasm',
        },
        {
          code: 'return packet.len > 100;',
          language: Language.C,
          expectedRuntime: 'ebpf',
        },
        {
          code: 'import numpy as np; np.array([1,2,3])',
          language: Language.Python,
          expectedRuntime: 'python',
        },
      ];

      for (const test of testCases) {
        const result = await controller.execute({
          code: test.code,
          language: test.language,
          config: {
            timeout: 1000,
            memoryLimit: 10 * 1024 * 1024,
            permissions: {
              capabilities: new Set(),
              trustLevel: TrustLevel.Medium,
            },
          },
        });

        expect(result.runtimeUsed).toBe(test.expectedRuntime);
      }
    });

    it('should handle concurrent executions across runtimes', async () => {
      const executions = [
        controller.execute({
          code: 'return 42;',
          language: Language.JavaScript,
          config: {
            timeout: 1000,
            memoryLimit: 10 * 1024 * 1024,
            permissions: {
              capabilities: new Set(),
              trustLevel: TrustLevel.Medium,
            },
          },
        }),
        controller.execute({
          code: 'fn main() -> i32 { 84 }',
          language: Language.Rust,
          config: {
            timeout: 1000,
            memoryLimit: 10 * 1024 * 1024,
            permissions: {
              capabilities: new Set(),
              trustLevel: TrustLevel.Medium,
            },
          },
        }),
        controller.execute({
          code: 'return 1;',
          language: Language.C,
          config: {
            timeout: 1000,
            memoryLimit: 4096,
            permissions: {
              capabilities: new Set(),
              trustLevel: TrustLevel.Low,
            },
          },
        }),
        controller.execute({
          code: 'result = 168',
          language: Language.Python,
          config: {
            timeout: 1000,
            memoryLimit: 10 * 1024 * 1024,
            permissions: {
              capabilities: new Set(),
              trustLevel: TrustLevel.High,
            },
          },
        }),
      ];

      const results = await Promise.all(executions);
      
      expect(results).toHaveLength(4);
      expect(results.every(r => r.success)).toBe(true);
      expect(results[0].output).toBe(42);
      expect(results[1].output).toBe(84);
      expect(results[2].output).toBe(1);
      expect(results[3].output).toBe(168);
    });

    it('should enforce security boundaries', async () => {
      const maliciousCode = `
        const fs = require('fs');
        fs.readFileSync('/etc/passwd');
      `;

      const result = await controller.execute({
        code: maliciousCode,
        language: Language.JavaScript,
        config: {
          timeout: 1000,
          memoryLimit: 10 * 1024 * 1024,
          permissions: {
            capabilities: new Set(), // No filesystem access
            trustLevel: TrustLevel.Low,
          },
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('permission');
    });
  });

  describe('Performance Characteristics', () => {
    it('should meet latency targets from paper', async () => {
      const latencyTests = [
        {
          name: 'eBPF',
          code: 'return 1;',
          language: Language.C,
          maxLatency: 0.001, // 1μs
          trustLevel: TrustLevel.Low,
        },
        {
          name: 'WASM',
          code: 'fn main() { }',
          language: Language.Rust,
          maxLatency: 1, // 1ms
          trustLevel: TrustLevel.Medium,
        },
        {
          name: 'V8',
          code: 'return true;',
          language: Language.JavaScript,
          maxLatency: 10, // 10ms
          trustLevel: TrustLevel.Medium,
        },
        {
          name: 'Python',
          code: 'pass',
          language: Language.Python,
          maxLatency: 100, // 100ms
          trustLevel: TrustLevel.High,
        },
      ];

      for (const test of latencyTests) {
        const start = process.hrtime.bigint();
        const result = await controller.execute({
          code: test.code,
          language: test.language,
          config: {
            timeout: 1000,
            memoryLimit: 10 * 1024 * 1024,
            permissions: {
              capabilities: new Set(),
              trustLevel: test.trustLevel,
            },
          },
        });
        const latency = Number(process.hrtime.bigint() - start) / 1000000;

        expect(result.success).toBe(true);
        expect(latency).toBeLessThan(test.maxLatency);
        console.log(`${test.name} latency: ${latency.toFixed(3)}ms`);
      }
    });
  });
});