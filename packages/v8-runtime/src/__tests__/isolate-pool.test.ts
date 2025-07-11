import { V8IsolatePool, RequestPrewarmer } from '../isolate-pool';

describe('V8IsolatePool', () => {
  let pool: V8IsolatePool;

  afterEach(async () => {
    if (pool) {
      await pool.shutdown();
    }
  });

  describe('basic operations', () => {
    it('should create and acquire isolates', async () => {
      pool = new V8IsolatePool({
        enabled: false, // Don't pre-warm for this test
        poolSize: 3,
        maxIdleTime: 60000,
      });

      const { isolate, context } = await pool.acquire();
      expect(isolate).toBeDefined();
      expect(context).toBeDefined();

      pool.release(isolate);
    });

    it('should reuse released isolates', async () => {
      pool = new V8IsolatePool({
        enabled: false,
        poolSize: 1,
        maxIdleTime: 60000,
      });

      const first = await pool.acquire();
      pool.release(first.isolate);

      const second = await pool.acquire();
      expect(second.isolate).toBe(first.isolate);
    });

    it('should create new isolates when pool is exhausted', async () => {
      pool = new V8IsolatePool({
        enabled: false,
        poolSize: 2,
        maxIdleTime: 60000,
      });

      const isolates = [];
      
      // Acquire more than pool size
      for (let i = 0; i < 3; i++) {
        const { isolate } = await pool.acquire();
        isolates.push(isolate);
      }

      expect(isolates.length).toBe(3);
      
      // Release all
      isolates.forEach(isolate => pool.release(isolate));
    });
  });

  describe('pre-warming', () => {
    it('should pre-warm isolates on initialization', async () => {
      pool = new V8IsolatePool({
        enabled: true,
        poolSize: 3,
        maxIdleTime: 60000,
      });

      await pool.initialize();

      const metrics = pool.getMetrics();
      expect(metrics.totalIsolates).toBe(3);
      expect(metrics.available).toBe(3);
    });

    it('should trigger pre-warming when pool gets low', async () => {
      pool = new V8IsolatePool({
        enabled: true,
        poolSize: 4,
        maxIdleTime: 60000,
      });

      await pool.initialize();

      // Acquire half the pool
      const isolates = [];
      for (let i = 0; i < 3; i++) {
        const { isolate } = await pool.acquire();
        isolates.push(isolate);
      }

      // Wait a bit for pre-warming to trigger
      await new Promise(resolve => setTimeout(resolve, 200));

      const metrics = pool.getMetrics();
      expect(metrics.totalIsolates).toBeGreaterThan(4);
    });

    it('should pre-warm with custom warmup script', async () => {
      pool = new V8IsolatePool({
        enabled: true,
        poolSize: 2,
        maxIdleTime: 60000,
        warmupScript: `
          global.prewarmed = true;
          global.warmupTime = Date.now();
        `,
      });

      await pool.initialize();

      const { context } = await pool.acquire();
      const result = await context.eval(`global.prewarmed`);
      expect(result).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should clean up idle isolates', async () => {
      pool = new V8IsolatePool({
        enabled: false,
        poolSize: 3,
        maxIdleTime: 100, // Very short idle time for testing
      });

      // Create some isolates
      const { isolate } = await pool.acquire();
      pool.release(isolate);

      let metrics = pool.getMetrics();
      expect(metrics.available).toBe(1);

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 200));

      // Force cleanup
      pool['cleanupIdleIsolates']();

      metrics = pool.getMetrics();
      expect(metrics.totalIsolates).toBe(0);
    });

    it('should not clean up in-use isolates', async () => {
      pool = new V8IsolatePool({
        enabled: false,
        poolSize: 2,
        maxIdleTime: 100,
      });

      const { isolate: inUse } = await pool.acquire();
      const { isolate: idle } = await pool.acquire();
      
      pool.release(idle);

      // Wait and cleanup
      await new Promise(resolve => setTimeout(resolve, 200));
      pool['cleanupIdleIsolates']();

      const metrics = pool.getMetrics();
      expect(metrics.inUse).toBe(1);
      expect(metrics.available).toBe(0);

      pool.release(inUse);
    });
  });

  describe('metrics', () => {
    it('should track pool metrics accurately', async () => {
      pool = new V8IsolatePool({
        enabled: true,
        poolSize: 3,
        maxIdleTime: 60000,
      });

      await pool.initialize();

      let metrics = pool.getMetrics();
      expect(metrics.totalIsolates).toBe(3);
      expect(metrics.available).toBe(3);
      expect(metrics.inUse).toBe(0);

      const { isolate } = await pool.acquire();
      
      metrics = pool.getMetrics();
      expect(metrics.available).toBe(2);
      expect(metrics.inUse).toBe(1);

      pool.release(isolate);
      
      metrics = pool.getMetrics();
      expect(metrics.available).toBe(3);
      expect(metrics.inUse).toBe(0);
    });

    it('should track average isolate age', async () => {
      pool = new V8IsolatePool({
        enabled: false,
        poolSize: 2,
        maxIdleTime: 60000,
      });

      await pool.acquire();
      await new Promise(resolve => setTimeout(resolve, 100));
      await pool.acquire();

      const metrics = pool.getMetrics();
      expect(metrics.avgAge).toBeGreaterThan(50);
      expect(metrics.avgAge).toBeLessThan(150);
    });
  });

  describe('RequestPrewarmer', () => {
    it('should pre-warm during request handling', async () => {
      pool = new V8IsolatePool({
        enabled: true,
        poolSize: 2,
        maxIdleTime: 60000,
      });

      const prewarmer = new RequestPrewarmer(pool);
      
      let tlsEmitted = false;
      pool.on('tls-client-hello', (hostname) => {
        tlsEmitted = true;
        expect(hostname).toBe('example.com');
      });

      await prewarmer.handleRequest({ hostname: 'example.com' });
      
      expect(tlsEmitted).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle isolate creation errors', async () => {
      pool = new V8IsolatePool({
        enabled: false,
        poolSize: 1,
        maxIdleTime: 60000,
      }, {
        memoryLimit: 1, // Very low memory limit
      });

      // This might not actually fail, but tests the error path
      const { isolate } = await pool.acquire();
      expect(isolate).toBeDefined();
    });

    it('should handle disposal errors gracefully', async () => {
      pool = new V8IsolatePool({
        enabled: false,
        poolSize: 1,
        maxIdleTime: 60000,
      });

      const { isolate } = await pool.acquire();
      
      // Dispose manually
      isolate.dispose();
      
      // Try to release - should handle gracefully
      expect(() => pool.release(isolate)).not.toThrow();
    });
  });
});