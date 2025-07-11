#!/usr/bin/env ts-node
// End-to-end test of the runtime controller with all available runtimes
import { RuntimeController } from '../packages/core/src/runtime-controller';
import { Language, TrustLevel, Capability } from '../packages/types/src/index';

async function testEndToEnd() {
  console.log('🚀 Testing End-to-End Runtime Execution\n');
  
  try {
    // Initialize the runtime controller
    const controller = RuntimeController.getInstance({
      enableScheduler: true,
      runtimes: {
        v8: { enabled: true },
        wasm: { enabled: true },
        ebpf: { enabled: true }
      },
      concurrency: 10
    });
    
    await controller.initialize();
    console.log('✅ Runtime controller initialized');
    
    // Test 1: V8 Runtime with JavaScript
    console.log('\n📋 Test 1: V8 Runtime (JavaScript)');
    const jsResult = await controller.executeWithScheduler(
      `
        function fibonacci(n) {
          if (n <= 1) return n;
          return fibonacci(n - 1) + fibonacci(n - 2);
        }
        fibonacci(10);
      `,
      Language.JavaScript,
      {
        timeout: 1000,
        memoryLimit: 10 * 1024 * 1024,
        permissions: {
          capabilities: new Set([Capability.CpuIntensive]),
          trustLevel: TrustLevel.Medium
        }
      }
    );
    console.log('✅ JavaScript result:', jsResult);
    
    // Test 2: V8 Runtime with TypeScript  
    console.log('\n📋 Test 2: V8 Runtime (TypeScript)');
    const tsResult = await controller.executeWithScheduler(
      `
        interface Point { x: number; y: number; }
        function distance(p1: Point, p2: Point): number {
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          return Math.sqrt(dx * dx + dy * dy);
        }
        distance({x: 0, y: 0}, {x: 3, y: 4});
      `,
      Language.TypeScript,
      {
        timeout: 1000,
        memoryLimit: 10 * 1024 * 1024,
        permissions: {
          capabilities: new Set([Capability.CpuIntensive]),
          trustLevel: TrustLevel.Medium
        }
      }
    );
    console.log('✅ TypeScript result:', tsResult);
    
    // Test 3: WASM Runtime (using pre-compiled WAT)
    console.log('\n📋 Test 3: WASM Runtime');
    const wasmResult = await controller.executeWithScheduler(
      `
        (module
          (func $add (param $a i32) (param $b i32) (result i32)
            local.get $a
            local.get $b
            i32.add)
          (export "_start" (func $add))
        )
      `,
      Language.Wasm,
      {
        timeout: 1000,
        memoryLimit: 1024 * 1024,
        permissions: {
          capabilities: new Set([Capability.CpuIntensive]),
          trustLevel: TrustLevel.Low
        }
      }
    );
    console.log('✅ WASM result:', wasmResult);
    
    // Test 4: Multiple concurrent executions
    console.log('\n📋 Test 4: Concurrent Executions');
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(controller.executeWithScheduler(
        `Math.pow(2, ${i})`,
        Language.JavaScript,
        {
          timeout: 1000,
          memoryLimit: 1024 * 1024,
          permissions: {
            capabilities: new Set([Capability.CpuIntensive]),
            trustLevel: TrustLevel.Low
          }
        }
      ));
    }
    
    const results = await Promise.all(promises);
    console.log('✅ Concurrent results:', results.map((r: any) => r.output));
    
    // Test 5: Get runtime metrics
    console.log('\n📊 Runtime Metrics:');
    const metrics = await controller.getMetrics();
    console.log(JSON.stringify(metrics, null, 2));
    
    // Test 6: Runtime selection based on workload
    console.log('\n📋 Test 6: Intelligent Runtime Selection');
    const workloadResult = await controller.executeWithScheduler(
      'return 42;',
      Language.JavaScript,
      {
        timeout: 100, // Very low timeout - should select fastest runtime
        memoryLimit: 1024 * 1024,
        permissions: {
          capabilities: new Set([Capability.CpuIntensive]),
          trustLevel: TrustLevel.High
        }
      },
      {
        latencyRequirement: 'ultra-low',
        complexity: 'simple'
      }
    );
    console.log('✅ Workload-optimized result:', workloadResult);
    
    console.log('\n✅ All end-to-end tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testEndToEnd().then(() => {
  console.log('\n🎉 End-to-end tests passed!');
  process.exit(0);
}).catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});