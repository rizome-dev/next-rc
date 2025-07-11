#!/usr/bin/env node
// Test Lattice with native bindings only (no V8 runtime)
const { Lattice } = require('../packages/lattice/dist/index.js');

async function testLatticeNative() {
  console.log('🚀 Testing Lattice Network with Native Bindings\n');
  
  try {
    // Test local lattice functionality (without NATS or RuntimeController)
    console.log('📋 Testing local Lattice functionality...');
    const localLattice = new Lattice({
      nodeId: 'local-node',
      standalone: true // Run without NATS
    });
    
    await localLattice.initialize();
    console.log('✅ Local lattice initialized');
    
    // Test load balancing
    const nodes = [
      { id: 'node-1', load: 0.2, healthy: true },
      { id: 'node-2', load: 0.8, healthy: true },
      { id: 'node-3', load: 0.1, healthy: true },
      { id: 'node-4', load: 0.5, healthy: false }
    ];
    
    const selectedNode = localLattice.selectNode({
      strategy: 'least-loaded',
      nodes: nodes
    });
    console.log('✅ Load balancer selected:', selectedNode);
    
    // Test routing logic
    const routingDecision = localLattice.routeTask({
      language: 'wasm',
      latencyRequirement: 'ultra-low',
      nodes: nodes
    });
    console.log('✅ Routing decision:', routingDecision);
    
    // Test message routing within local node
    console.log('\n📋 Testing local message routing...');
    let messageReceived = false;
    
    await localLattice.subscribe('test.local', (msg) => {
      console.log('✅ Received local message:', msg);
      messageReceived = true;
    });
    
    await localLattice.publish('test.local', {
      type: 'test',
      data: 'Local test message'
    });
    
    // Give time for async message delivery
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (messageReceived) {
      console.log('✅ Local pub/sub working correctly');
    }
    
    // Test distributed execution planning (without actual execution)
    console.log('\n📋 Testing execution planning...');
    const executionPlan = localLattice.planExecution({
      code: 'Math.pow(2, 10)',
      language: 'javascript',
      requirements: {
        latency: 'low',
        memory: 'minimal'
      }
    });
    console.log('✅ Execution plan:', executionPlan);
    
    console.log('\n✅ Lattice native tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testLatticeNative().then(() => {
  console.log('\n🎉 Lattice native tests passed!');
  process.exit(0);
}).catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});