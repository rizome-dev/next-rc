#!/usr/bin/env node

// Test WASM runtime with WebAssembly Text Format (WAT)

const native = require('../runtimes/napi-bridge');

async function testWasmWithWat() {
  console.log('🚀 Testing WASM Runtime with WAT\n');
  
  try {
    // Initialize runtime controller
    native.initializeRuntimeController();
    
    // Create WASM runtime bridge
    const wasmBridge = new native.WasmRuntimeBridge();
    await wasmBridge.initialize();
    console.log('✅ WASM runtime initialized');
    
    // Test 1: Simple WAT module
    console.log('\n--- Test 1: Simple Addition in WAT ---');
    const watCode = `
(module
  (func $add (param $a i32) (param $b i32) (result i32)
    local.get $a
    local.get $b
    i32.add)
  (export "add" (func $add))
  
  (func $main (result i32)
    i32.const 5
    i32.const 3
    call $add)
  (export "main" (func $main))
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
    
    await wasmBridge.destroy(instanceId);
    console.log('✅ Instance destroyed');
    
    // Test 2: Fibonacci in WAT
    console.log('\n--- Test 2: Fibonacci in WAT ---');
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
  (export "fib" (func $fib))
  
  (func $main (result i32)
    i32.const 10
    call $fib)
  (export "main" (func $main))
)
`;
    
    const fibModuleId = await wasmBridge.compile(fibWat, native.Language.Wasm);
    console.log('✅ Fibonacci module compiled:', fibModuleId);
    
    const fibInstanceId = await wasmBridge.instantiate(fibModuleId);
    console.log('✅ Fibonacci instance created:', fibInstanceId);
    
    const fibResult = await wasmBridge.execute(fibInstanceId, {
      timeoutMs: 5000,
      memoryLimitBytes: 10 * 1024 * 1024, // 10MB
      trustLevel: native.TrustLevel.Medium,
      networkAccess: false,
      filesystemAccess: false
    });
    
    console.log('✅ Fibonacci(10) result:', fibResult);
    
    await wasmBridge.destroy(fibInstanceId);
    
    // Test 3: Memory operations
    console.log('\n--- Test 3: Memory Operations ---');
    const memoryWat = `
(module
  (memory 1)
  (func $store_and_load (result i32)
    i32.const 0
    i32.const 42
    i32.store
    i32.const 0
    i32.load)
  (export "main" (func $store_and_load))
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
    
    await wasmBridge.destroy(memInstanceId);
    
    // Test 4: Performance metrics
    console.log('\n--- Test 4: Performance Metrics ---');
    const metrics = await wasmBridge.getPerformanceMetrics();
    console.log('WASM runtime metrics:', metrics);
    
    console.log('\n🎉 All WASM WAT tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the tests
testWasmWithWat().catch(console.error);