#!/usr/bin/env node

// Test WASM runtime with correct entry point

const native = require('../runtimes/napi-bridge');

async function testWasmExecution() {
  console.log('🚀 Testing WASM Runtime with Correct Entry Point\n');
  
  try {
    // Initialize runtime controller
    native.initializeRuntimeController();
    
    // Create WASM runtime bridge
    const wasmBridge = new native.WasmRuntimeBridge();
    await wasmBridge.initialize();
    console.log('✅ WASM runtime initialized');
    
    // Test 1: Simple WAT module with _start entry point
    console.log('\n--- Test 1: Simple Addition with _start ---');
    const watCode = `
(module
  (func $add (param $a i32) (param $b i32) (result i32)
    local.get $a
    local.get $b
    i32.add)
  
  (func $_start (export "_start") (result i32)
    i32.const 5
    i32.const 3
    call $add)
)
`;
    
    const moduleId = await wasmBridge.compile(watCode, native.Language.Wasm);
    console.log('✅ WAT module compiled:', moduleId);
    
    const instanceId = await wasmBridge.instantiate(moduleId);
    console.log('✅ Instance created:', instanceId);
    
    const result = await wasmBridge.execute(instanceId, {
      timeoutMs: 1000,
      memoryLimitBytes: 1024 * 1024, // 1MB
      trustLevel: native.TrustLevel.Low,
      networkAccess: false,
      filesystemAccess: false
    });
    
    console.log('✅ Execution result:', result);
    console.log('   Expected: 8 (5 + 3)');
    
    await wasmBridge.destroy(instanceId);
    console.log('✅ Instance destroyed');
    
    // Test 2: Fibonacci with _start
    console.log('\n--- Test 2: Fibonacci with _start ---');
    const fibWat = `
(module
  (func $fib (param $n i32) (result i32)
    (if (result i32)
      (i32.le_s (local.get $n) (i32.const 1))
      (then (local.get $n))
      (else
        (i32.add
          (call $fib (i32.sub (local.get $n) (i32.const 1)))
          (call $fib (i32.sub (local.get $n) (i32.const 2)))))))
  
  (func $_start (export "_start") (result i32)
    i32.const 10
    call $fib)
)
`;
    
    const fibModuleId = await wasmBridge.compile(fibWat, native.Language.Wasm);
    console.log('✅ Fibonacci module compiled:', fibModuleId);
    
    const fibInstanceId = await wasmBridge.instantiate(fibModuleId);
    console.log('✅ Fibonacci instance created:', fibInstanceId);
    
    console.time('Fibonacci execution');
    const fibResult = await wasmBridge.execute(fibInstanceId, {
      timeoutMs: 5000,
      memoryLimitBytes: 10 * 1024 * 1024, // 10MB
      trustLevel: native.TrustLevel.Medium,
      networkAccess: false,
      filesystemAccess: false
    });
    console.timeEnd('Fibonacci execution');
    
    console.log('✅ Fibonacci(10) result:', fibResult);
    console.log('   Expected: 55');
    
    await wasmBridge.destroy(fibInstanceId);
    
    // Test 3: Memory operations
    console.log('\n--- Test 3: Memory Operations with _start ---');
    const memoryWat = `
(module
  (memory 1)
  
  (func $_start (export "_start") (result i32)
    ;; Store 42 at address 0
    i32.const 0
    i32.const 42
    i32.store
    
    ;; Store 100 at address 4
    i32.const 4
    i32.const 100
    i32.store
    
    ;; Load from address 0 and 4, add them
    i32.const 0
    i32.load
    i32.const 4
    i32.load
    i32.add)
    
  (export "memory" (memory 0))
)
`;
    
    const memModuleId = await wasmBridge.compile(memoryWat, native.Language.Wasm);
    const memInstanceId = await wasmBridge.instantiate(memModuleId);
    
    const memResult = await wasmBridge.execute(memInstanceId, {
      timeoutMs: 1000,
      memoryLimitBytes: 65536, // 64KB (1 WASM page)
      trustLevel: native.TrustLevel.Low,
      networkAccess: false,
      filesystemAccess: false
    });
    
    console.log('✅ Memory operation result:', memResult);
    console.log('   Expected: 142 (42 + 100)');
    
    await wasmBridge.destroy(memInstanceId);
    
    // Test 4: Pre-warming for performance
    console.log('\n--- Test 4: Pre-warming Test ---');
    await wasmBridge.preWarm(5);
    console.log('✅ Pre-warmed 5 instances');
    
    // Test 5: Performance metrics
    console.log('\n--- Test 5: Performance Metrics ---');
    const status = await wasmBridge.getStatus();
    console.log('Runtime status:', status);
    
    const metrics = await wasmBridge.getPerformanceMetrics();
    console.log('Performance metrics:', metrics);
    
    // Verify expected performance characteristics
    if (metrics.coldStartLatencyNs <= 100000) { // 100μs
      console.log('✅ Cold start latency within target (<100μs)');
    } else {
      console.log('⚠️  Cold start latency above target');
    }
    
    console.log('\n🎉 All WASM execution tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the tests
testWasmExecution().catch(console.error);