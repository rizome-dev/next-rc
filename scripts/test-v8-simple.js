#!/usr/bin/env node
// Simple test for V8 runtime
const path = require('path');

async function testV8() {
  console.log('🚀 Testing V8 Runtime\n');
  
  try {
    // Test isolated-vm directly
    console.log('📋 Testing isolated-vm module...');
    const ivm = require('isolated-vm');
    console.log('✅ isolated-vm loaded successfully');
    
    // Create an isolate
    const isolate = new ivm.Isolate({ memoryLimit: 128 });
    console.log('✅ Isolate created');
    
    // Create a context
    const context = await isolate.createContext();
    console.log('✅ Context created');
    
    // Execute simple code
    const result = await context.eval('1 + 1');
    console.log('✅ Simple execution result:', result);
    
    // Test with more complex code
    const code = `
      function fibonacci(n) {
        if (n <= 1) return n;
        return fibonacci(n - 1) + fibonacci(n - 2);
      }
      fibonacci(10);
    `;
    
    const fibResult = await context.eval(code);
    console.log('✅ Fibonacci(10) result:', fibResult);
    
    // Clean up
    context.release();
    isolate.dispose();
    
    console.log('\n✅ V8 runtime test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    
    // Try to load the runtime through the package
    console.log('\n📋 Trying to load V8Runtime class...');
    try {
      const { V8Runtime } = require('../packages/v8-runtime/dist/index.js');
      const runtime = new V8Runtime();
      await runtime.initialize();
      console.log('✅ V8Runtime initialized through package');
    } catch (err2) {
      console.error('❌ V8Runtime also failed:', err2);
    }
    
    process.exit(1);
  }
}

// Run the test
testV8().then(() => {
  console.log('\n🎉 V8 tests passed!');
  process.exit(0);
}).catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});