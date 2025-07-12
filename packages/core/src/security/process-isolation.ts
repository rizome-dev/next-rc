import { TrustLevel } from '@rizome/next-rc-types';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

interface ProcessPool {
  trustLevel: TrustLevel;
  processes: WorkerProcess[];
  maxProcesses: number;
  minProcesses: number;
}

interface WorkerProcess {
  id: number;
  process: ChildProcess;
  inUse: boolean;
  createdAt: number;
  lastUsed: number;
  executions: number;
}

interface Agent {
  trustLevel: TrustLevel;
  id?: string;
}

export class ProcessIsolationManager extends EventEmitter {
  private cordons: Map<TrustLevel, ProcessPool>;
  private nextProcessId = 1;
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor() {
    super();
    this.cordons = new Map();
    this.initializeCordons();
    this.startCleanupTimer();
  }

  private initializeCordons(): void {
    // Create process pools for each trust level
    this.cordons.set(TrustLevel.Low, {
      trustLevel: TrustLevel.Low,
      processes: [],
      maxProcesses: 50,
      minProcesses: 5,
    });

    this.cordons.set(TrustLevel.Medium, {
      trustLevel: TrustLevel.Medium,
      processes: [],
      maxProcesses: 30,
      minProcesses: 3,
    });

    this.cordons.set(TrustLevel.High, {
      trustLevel: TrustLevel.High,
      processes: [],
      maxProcesses: 20,
      minProcesses: 2,
    });

    // Pre-spawn minimum processes for each cordon
    for (const pool of this.cordons.values()) {
      this.ensureMinimumProcesses(pool);
    }
  }

  async assignToCordon(agent: Agent): Promise<number> {
    const pool = this.cordons.get(agent.trustLevel);
    if (!pool) {
      throw new Error(`No cordon available for trust level: ${agent.trustLevel}`);
    }

    // Find available process or create new one
    let workerProcess = pool.processes.find(p => !p.inUse && p.process.connected);
    
    if (!workerProcess) {
      if (pool.processes.length < pool.maxProcesses) {
        workerProcess = await this.spawnWorkerProcess(pool.trustLevel);
        pool.processes.push(workerProcess);
      } else {
        // Wait for a process to become available
        workerProcess = await this.waitForAvailableProcess(pool);
      }
    }

    workerProcess.inUse = true;
    workerProcess.lastUsed = Date.now();
    workerProcess.executions++;

    this.emit('process-assigned', {
      processId: workerProcess.id,
      trustLevel: agent.trustLevel,
      agentId: agent.id,
    });

    return workerProcess.id;
  }

  async releaseFromCordon(processId: number): Promise<void> {
    for (const pool of this.cordons.values()) {
      const workerProcess = pool.processes.find(p => p.id === processId);
      if (workerProcess) {
        workerProcess.inUse = false;
        workerProcess.lastUsed = Date.now();

        // Check if process should be recycled
        if (this.shouldRecycleProcess(workerProcess)) {
          await this.recycleProcess(pool, workerProcess);
        }

        this.emit('process-released', {
          processId,
          trustLevel: pool.trustLevel,
        });

        return;
      }
    }

    throw new Error(`Process ${processId} not found in any cordon`);
  }

  private async spawnWorkerProcess(trustLevel: TrustLevel): Promise<WorkerProcess> {
    const processId = this.nextProcessId++;
    
    // Spawn isolated process with appropriate restrictions
    const workerPath = this.getWorkerPath();
    const options = this.getProcessOptions(trustLevel);
    
    // For testing, use inline Node.js code
    const isTest = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID;
    const childProcess = isTest
      ? spawn('node', ['-e', `
          process.on('message', (msg) => {
            if (msg.type === 'init') {
              process.send({ type: 'ready' });
            } else if (msg.type === 'shutdown') {
              process.exit(0);
            }
          });
        `], options)
      : spawn('node', [workerPath], options);

    // Set up process communication
    childProcess.on('error', (error) => {
      console.error(`Worker process ${processId} error:`, error);
      this.emit('process-error', { processId, error });
    });

    childProcess.on('exit', (code, signal) => {
      console.log(`Worker process ${processId} exited with code ${code}, signal ${signal}`);
      this.emit('process-exit', { processId, code, signal });
      this.handleProcessExit(processId);
    });

    // Wait for process to be ready
    await this.waitForProcessReady(childProcess);

    return {
      id: processId,
      process: childProcess,
      inUse: false,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      executions: 0,
    };
  }

  private getWorkerPath(): string {
    // In a real implementation, this would return the path to the worker script
    // For testing, we can use a simple echo command
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
      return 'echo';
    }
    return process.env.WORKER_SCRIPT_PATH || '/usr/local/bin/next-rc-worker';
  }

  private getProcessOptions(trustLevel: TrustLevel): any {
    const baseOptions = {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      detached: false,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        TRUST_LEVEL: trustLevel,
      },
    };

    const isTest = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID;

    // Apply trust-level specific restrictions
    switch (trustLevel) {
      case TrustLevel.Low:
        return {
          ...baseOptions,
          // Skip uid/gid in tests as they require root
          ...(isTest ? {} : {
            uid: 65534, // nobody user
            gid: 65534, // nogroup
          }),
          env: {
            ...baseOptions.env,
            NODE_OPTIONS: '--max-old-space-size=128',
          },
        };

      case TrustLevel.Medium:
        return {
          ...baseOptions,
          env: {
            ...baseOptions.env,
            NODE_OPTIONS: '--max-old-space-size=256',
          },
        };

      case TrustLevel.High:
        return {
          ...baseOptions,
          env: {
            ...baseOptions.env,
            NODE_OPTIONS: '--max-old-space-size=512',
          },
        };
    }
  }

  private async waitForProcessReady(process: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Process failed to become ready'));
      }, 5000);

      const messageHandler = (message: any) => {
        if (message.type === 'ready') {
          clearTimeout(timeout);
          process.off('message', messageHandler);
          resolve();
        }
      };

      process.on('message', messageHandler);
      
      // Send init message
      process.send({ type: 'init' });
    });
  }

  private async waitForAvailableProcess(pool: ProcessPool): Promise<WorkerProcess> {
    // Simple implementation - in production, use a proper queue
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const available = pool.processes.find(p => !p.inUse && p.process.connected);
        if (available) {
          clearInterval(checkInterval);
          resolve(available);
        }
      }, 100);
    });
  }

  private shouldRecycleProcess(process: WorkerProcess): boolean {
    const MAX_EXECUTIONS = 1000;
    const MAX_AGE = 60 * 60 * 1000; // 1 hour

    return process.executions > MAX_EXECUTIONS ||
           (Date.now() - process.createdAt) > MAX_AGE;
  }

  private async recycleProcess(
    pool: ProcessPool,
    workerProcess: WorkerProcess
  ): Promise<void> {
    console.log(`Recycling process ${workerProcess.id}`);
    
    // Remove from pool
    const index = pool.processes.indexOf(workerProcess);
    if (index > -1) {
      pool.processes.splice(index, 1);
    }

    // Terminate process
    if (workerProcess.process.connected) {
      workerProcess.process.send({ type: 'shutdown' });
      
      // Give process time to shutdown gracefully
      setTimeout(() => {
        if (!workerProcess.process.killed) {
          workerProcess.process.kill('SIGTERM');
        }
      }, 1000);
    }

    // Spawn replacement if needed
    this.ensureMinimumProcesses(pool);
  }

  private handleProcessExit(processId: number): void {
    // Remove process from all pools
    for (const pool of this.cordons.values()) {
      const index = pool.processes.findIndex(p => p.id === processId);
      if (index > -1) {
        pool.processes.splice(index, 1);
        this.ensureMinimumProcesses(pool);
        break;
      }
    }
  }

  private async ensureMinimumProcesses(pool: ProcessPool): Promise<void> {
    const activeProcesses = pool.processes.filter(p => p.process.connected).length;
    const needed = pool.minProcesses - activeProcesses;

    for (let i = 0; i < needed; i++) {
      try {
        const workerProcess = await this.spawnWorkerProcess(pool.trustLevel);
        pool.processes.push(workerProcess);
      } catch (error) {
        console.error(`Failed to spawn worker process:`, error);
      }
    }
  }

  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleProcesses();
    }, 30000); // Every 30 seconds
  }

  private cleanupIdleProcesses(): void {
    const MAX_IDLE_TIME = 5 * 60 * 1000; // 5 minutes

    for (const pool of this.cordons.values()) {
      const now = Date.now();
      const idleProcesses = pool.processes.filter(p => 
        !p.inUse && 
        (now - p.lastUsed) > MAX_IDLE_TIME &&
        pool.processes.filter(wp => wp.process.connected).length > pool.minProcesses
      );

      for (const process of idleProcesses) {
        this.recycleProcess(pool, process);
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Shutdown all processes
    for (const pool of this.cordons.values()) {
      for (const workerProcess of pool.processes) {
        if (workerProcess.process.connected) {
          workerProcess.process.send({ type: 'shutdown' });
        }
      }
    }

    // Wait for processes to exit
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Force kill any remaining processes
    for (const pool of this.cordons.values()) {
      for (const workerProcess of pool.processes) {
        if (!workerProcess.process.killed) {
          workerProcess.process.kill('SIGKILL');
        }
      }
    }

    this.cordons.clear();
  }

  getMetrics() {
    const metrics: any = {
      cordons: {},
    };

    for (const [trustLevel, pool] of this.cordons) {
      metrics.cordons[trustLevel] = {
        totalProcesses: pool.processes.length,
        activeProcesses: pool.processes.filter(p => p.inUse).length,
        idleProcesses: pool.processes.filter(p => !p.inUse).length,
        totalExecutions: pool.processes.reduce((sum, p) => sum + p.executions, 0),
      };
    }

    return metrics;
  }
}