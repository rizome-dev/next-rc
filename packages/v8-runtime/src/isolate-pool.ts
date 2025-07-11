import ivm from 'isolated-vm';
import PQueue from 'p-queue';
import { EventEmitter } from 'events';
import { IsolateOptions, PrewarmConfig } from './types';

interface PooledIsolate {
  isolate: ivm.Isolate;
  context: ivm.Context;
  createdAt: number;
  lastUsed: number;
  inUse: boolean;
}

export class V8IsolatePool extends EventEmitter {
  private pool: PooledIsolate[] = [];
  private prewarmConfig: PrewarmConfig;
  private isolateOptions: IsolateOptions;
  private createQueue: PQueue;
  private cleanupInterval?: ReturnType<typeof setInterval>;
  private prewarmTimer?: ReturnType<typeof setTimeout>;
  private isShuttingDown = false;

  constructor(
    prewarmConfig: PrewarmConfig = {
      enabled: true,
      poolSize: 10,
      maxIdleTime: 60000, // 1 minute
    },
    isolateOptions: IsolateOptions = {
      memoryLimit: 128, // 128MB default
    }
  ) {
    super();
    this.prewarmConfig = prewarmConfig;
    this.isolateOptions = isolateOptions;
    this.createQueue = new PQueue({ concurrency: 4 });

    if (this.prewarmConfig.enabled) {
      this.startPrewarming();
    }

    // Cleanup idle isolates
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleIsolates();
    }, 30000); // Every 30 seconds
  }

  async initialize(): Promise<void> {
    if (this.prewarmConfig.enabled) {
      await this.prewarmIsolates();
    }
  }

  private async prewarmIsolates(): Promise<void> {
    const needed = this.prewarmConfig.poolSize - this.pool.filter(p => !p.inUse).length;
    
    if (needed <= 0) return;

    console.log(`Pre-warming ${needed} V8 isolates...`);
    
    const promises: Promise<void>[] = [];
    for (let i = 0; i < needed; i++) {
      promises.push(this.createQueue.add(async () => {
        if (!this.isShuttingDown) {
          await this.createIsolate();
        }
      }));
    }

    await Promise.all(promises);
  }

  private async createIsolate(): Promise<PooledIsolate> {
    const startTime = Date.now();
    
    const isolate = new ivm.Isolate({
      memoryLimit: this.isolateOptions.memoryLimit,
      onCatastrophicError: this.isolateOptions.onCatastrophicError ? 
        (message: string) => this.isolateOptions.onCatastrophicError!(new Error(message)) : 
        undefined,
    });

    const context = await isolate.createContext();

    // Inject minimal globals
    const jail = context.global;
    await jail.set('global', jail.derefInto());
    
    // Add console.log for debugging
    await context.eval(`
      global.console = {
        log: (...args) => {
          _consoleLog(...args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
          ));
        }
      };
    `);

    const consoleLog = new ivm.Reference((...args: string[]) => {
      console.log('[V8]', ...args);
    });
    await context.global.set('_consoleLog', consoleLog);

    // Run warmup script if provided
    if (this.prewarmConfig.warmupScript) {
      try {
        await context.eval(this.prewarmConfig.warmupScript);
      } catch (error) {
        console.warn('Warmup script failed:', error);
      }
    }

    const pooledIsolate: PooledIsolate = {
      isolate,
      context,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      inUse: false,
    };

    this.pool.push(pooledIsolate);
    
    const prewarmTime = Date.now() - startTime;
    this.emit('isolate-created', { prewarmTime });
    
    return pooledIsolate;
  }

  async acquire(): Promise<{ isolate: ivm.Isolate; context: ivm.Context }> {
    // Find available isolate
    let pooledIsolate = this.pool.find(p => !p.inUse && !p.isolate.isDisposed);

    if (!pooledIsolate) {
      // Create new isolate if none available
      pooledIsolate = await this.createIsolate();
    }

    pooledIsolate.inUse = true;
    pooledIsolate.lastUsed = Date.now();

    // Trigger pre-warming if pool is getting low
    const availableCount = this.pool.filter(p => !p.inUse).length;
    if (availableCount < this.prewarmConfig.poolSize / 2) {
      this.triggerPrewarm();
    }

    return {
      isolate: pooledIsolate.isolate,
      context: pooledIsolate.context,
    };
  }

  release(isolate: ivm.Isolate): void {
    const pooledIsolate = this.pool.find(p => p.isolate === isolate);
    
    if (pooledIsolate) {
      pooledIsolate.inUse = false;
      pooledIsolate.lastUsed = Date.now();
    }
  }

  private triggerPrewarm(): void {
    if (this.prewarmTimer) return;

    this.prewarmTimer = setTimeout(() => {
      this.prewarmTimer = undefined;
      if (!this.isShuttingDown) {
        this.prewarmIsolates().catch(err => {
          console.error('Pre-warming failed:', err);
        });
      }
    }, 100);
  }

  private cleanupIdleIsolates(): void {
    const now = Date.now();
    const maxIdleTime = this.prewarmConfig.maxIdleTime;

    this.pool = this.pool.filter(pooledIsolate => {
      if (pooledIsolate.inUse) return true;

      const idleTime = now - pooledIsolate.lastUsed;
      if (idleTime > maxIdleTime) {
        try {
          pooledIsolate.isolate.dispose();
          this.emit('isolate-disposed', { idleTime });
          return false;
        } catch (error) {
          console.error('Failed to dispose isolate:', error);
          return false;
        }
      }

      return true;
    });
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    if (this.prewarmTimer) {
      clearTimeout(this.prewarmTimer);
    }

    await this.createQueue.onIdle();

    // Dispose all isolates
    for (const pooledIsolate of this.pool) {
      try {
        pooledIsolate.isolate.dispose();
      } catch (error) {
        console.error('Failed to dispose isolate during shutdown:', error);
      }
    }

    this.pool = [];
  }

  getMetrics(): {
    totalIsolates: number;
    inUse: number;
    available: number;
    avgAge: number;
  } {
    const now = Date.now();
    const ages = this.pool.map(p => now - p.createdAt);
    const avgAge = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;

    return {
      totalIsolates: this.pool.length,
      inUse: this.pool.filter(p => p.inUse).length,
      available: this.pool.filter(p => !p.inUse).length,
      avgAge,
    };
  }

  private startPrewarming(): void {
    // During TLS handshake simulation for zero cold start
    this.on('tls-client-hello', async (hostname: string) => {
      console.log(`Pre-warming isolate during TLS handshake for ${hostname}`);
      
      // Start creating isolate immediately
      const isolatePromise = this.createIsolate();
      
      // Simulate TLS handshake time (5ms)
      await new Promise(resolve => setTimeout(resolve, 5));
      
      // By now, isolate should be ready
      await isolatePromise;
    });
  }
}

// Example pre-warm during request
export class RequestPrewarmer {
  constructor(private pool: V8IsolatePool) {}

  async handleRequest(req: any): Promise<void> {
    // Start pre-warming as soon as we receive the request
    const prewarmPromise = this.prewarmForRequest(req);
    
    // Process other request setup in parallel
    await this.authenticateRequest(req);
    await this.parseRequestBody(req);
    
    // By the time we need the isolate, it's ready
    await prewarmPromise;
  }

  private async prewarmForRequest(req: any): Promise<void> {
    // Pre-warm based on request characteristics
    const hostname = req.hostname || 'default';
    this.pool.emit('tls-client-hello', hostname);
  }

  private async authenticateRequest(_req: any): Promise<void> {
    // Simulate authentication (2ms)
    await new Promise(resolve => setTimeout(resolve, 2));
  }

  private async parseRequestBody(_req: any): Promise<void> {
    // Simulate parsing (3ms)
    await new Promise(resolve => setTimeout(resolve, 3));
  }
}