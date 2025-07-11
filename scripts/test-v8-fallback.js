#!/usr/bin/env node
// Test V8 runtime with fallback
const { V8Runtime } = require('../packages/v8-runtime/dist/index.js');
const { Language, TrustLevel, Capability } = require('../packages/types/dist/index.js');

async function testV8Fallback() {
  console.log('🚀 Testing V8 Fallback Runtime\n');
  
  try {
    // Initialize runtime
    console.log('📋 Initializing V8 runtime...');
    const runtime = new V8Runtime();
    await runtime.initialize();
    console.log('✅ V8 runtime initialized');
    
    // Test 1: Simple JavaScript execution
    console.log('\n📋 Test 1: Simple JavaScript');
    const simpleCode = '2 + 2';
    const module1 = await runtime.compile(simpleCode, Language.JavaScript);
    console.log('✅ Module compiled:', module1);
    
    const instance1 = await runtime.instantiate(module1);
    console.log('✅ Instance created:', instance1);
    
    const result1 = await runtime.execute(instance1, {
      timeout: 1000,
      memoryLimit: 10 * 1024 * 1024,
      permissions: {
        trustLevel: 'medium',
        capabilities: new Set([Capability.CpuIntensive])
      }
    });
    console.log('✅ Result:', result1);
    
    // Test 2: Function execution
    console.log('\n📋 Test 2: Function execution');
    const functionCode = `
      function fibonacci(n) {
        if (n <= 1) return n;
        return fibonacci(n - 1) + fibonacci(n - 2);
      }
      fibonacci(10);
    `;
    
    const module2 = await runtime.compile(functionCode, Language.JavaScript);
    const instance2 = await runtime.instantiate(module2);
    const result2 = await runtime.execute(instance2, {
      timeout: 1000,
      memoryLimit: 10 * 1024 * 1024,
      permissions: {
        trustLevel: 'medium',
        capabilities: new Set([Capability.CpuIntensive])
      }
    });
    console.log('✅ Fibonacci(10) result:', result2);
    
    // Test 3: TypeScript (simplified)
    console.log('\n📋 Test 3: TypeScript support');
    const tsCode = `
      const add = (a: number, b: number): number => a + b;
      add(5, 3);
    `;
    
    const module3 = await runtime.compile(tsCode, Language.TypeScript);
    const instance3 = await runtime.instantiate(module3);
    const result3 = await runtime.execute(instance3, {
      timeout: 1000,
      memoryLimit: 10 * 1024 * 1024,
      permissions: {
        trustLevel: 'medium',
        capabilities: new Set()
      }
    });
    console.log('✅ TypeScript result:', result3);
    
    // Test 4: Security restrictions
    console.log('\n📋 Test 4: Security restrictions');
    const dangerousCode = `
      try {
        eval('1 + 1');
      } catch (e) {
        'eval blocked: ' + e.message;
      }
    `;
    
    const module4 = await runtime.compile(dangerousCode, Language.JavaScript);
    const instance4 = await runtime.instantiate(module4);
    const result4 = await runtime.execute(instance4, {
      timeout: 1000,
      memoryLimit: 10 * 1024 * 1024,
      permissions: {
        trustLevel: 'low',
        capabilities: new Set()
      }
    });
    console.log('✅ Security test result:', result4);
    
    // Test 5: Performance measurement
    console.log('\n📋 Test 5: Performance measurement');
    const perfCode = `
      const start = performance.now();
      let sum = 0;
      for (let i = 0; i < 1000000; i++) {
        sum += i;
      }
      const end = performance.now();
      { sum, time: end - start };
    `;
    
    const module5 = await runtime.compile(perfCode, Language.JavaScript);
    const instance5 = await runtime.instantiate(module5);
    const result5 = await runtime.execute(instance5, {
      timeout: 2000,
      memoryLimit: 10 * 1024 * 1024,
      permissions: {
        trustLevel: 'high',
        capabilities: new Set([Capability.CpuIntensive])
      }
    });
    console.log('✅ Performance test result:', result5);
    
    // Get runtime status
    const status = await runtime.getStatus();
    console.log('\n📊 Runtime status:', status);
    
    // Clean up
    await runtime.destroy(instance1);
    await runtime.destroy(instance2);
    await runtime.destroy(instance3);
    await runtime.destroy(instance4);
    await runtime.destroy(instance5);
    
    console.log('\n✅ All V8 tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testV8Fallback().then(() => {
  console.log('\n🎉 V8 fallback tests passed!');
  process.exit(0);
}).catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});