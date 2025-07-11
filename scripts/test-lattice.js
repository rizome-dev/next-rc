#!/usr/bin/env node
// Test distributed Lattice network functionality
const { Lattice } = require('../packages/lattice/dist/index.js');
const { RuntimeController } = require('../packages/core/dist/runtime-controller.js');

async function testLattice() {
  console.log('🚀 Testing Distributed Lattice Network\n');
  
  try {
    // Initialize runtime controller
    const controller = RuntimeController.getInstance({
      enableScheduler: true,
      runtimes: {
        v8: { enabled: true },
        wasm: { enabled: true },
        ebpf: { enabled: true }
      },
      concurrency: 10
    });
    
    // Initialize first lattice node
    console.log('📋 Initializing Lattice Node 1...');
    const lattice1 = new Lattice({
      nodeId: 'node-1',
      natsUrl: 'nats://localhost:4222',
      controller: controller
    });
    
    try {
      await lattice1.connect();
      console.log('✅ Lattice Node 1 connected to NATS');
      
      // Subscribe to messages
      await lattice1.subscribe('test.topic', async (msg) => {
        console.log('📨 Node 1 received:', msg);
      });
      
      // Publish a test message
      await lattice1.publish('test.topic', {
        type: 'test',
        data: 'Hello from Node 1'
      });
      
      // Get network status
      const status = await lattice1.getNetworkStatus();
      console.log('📊 Network status:', status);
      
      // Test distributed execution
      console.log('\n📋 Testing distributed execution...');
      const result = await lattice1.executeDistributed({
        code: 'Math.pow(2, 10)',
        language: 'javascript',
        nodePreference: 'least-loaded'
      });
      console.log('✅ Distributed execution result:', result);
      
    } catch (error) {
      if (error.message.includes('NATS') || error.code === 'ECONNREFUSED') {
        console.log('⚠️  NATS server not available - skipping distributed tests');
        console.log('    To test distributed functionality, start NATS server with:');
        console.log('    docker run -p 4222:4222 nats:latest');
      } else {
        throw error;
      }
    }
    
    // Test local lattice functionality (without NATS)
    console.log('\n📋 Testing local Lattice functionality...');
    const localLattice = new Lattice({
      nodeId: 'local-node',
      controller: controller,
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
    
    console.log('\n✅ Lattice tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testLattice().then(() => {
  console.log('\n🎉 Lattice tests passed!');
  process.exit(0);
}).catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});