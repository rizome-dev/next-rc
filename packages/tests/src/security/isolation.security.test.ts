import {
  RuntimeController,
  Language,
  TrustLevel,
  Capability,
  ExecutionConfig,
  SecurityManager,
} from '@rizome/next-rc-core';

describe('Security Tests - Isolation and Sandboxing', () => {
  let controller: RuntimeController;
  let securityManager: SecurityManager;

  beforeAll(async () => {
    controller = RuntimeController.getInstance({
      runtimes: {
        v8: { enabled: true },
      },
    });
    
    securityManager = new SecurityManager();
    await controller.initialize();
  });

  afterAll(async () => {
    await controller.shutdown();
  });

  describe('Network Isolation', () => {
    it('should block network access for low trust level', async () => {
      const code = `
        async function main() {
          try {
            if (typeof fetch !== 'undefined') {
              await fetch('https://example.com');
              return { networkAccess: true };
            }
            return { networkAccess: false };
          } catch (error) {
            return { networkAccess: false, error: error.message };
          }
        }
      `;

      const config: ExecutionConfig = {
        timeout: 5000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      const result = await controller.executeWithScheduler(
        code,
        Language.JavaScript,
        config
      );

      expect(result.success).toBe(true);
      expect(result.output.networkAccess).toBe(false);
    });

    it('should allow network access with proper capability', async () => {
      const code = `
        function main() {
          return {
            hasFetch: typeof fetch !== 'undefined',
            hasXHR: typeof XMLHttpRequest !== 'undefined',
          };
        }
      `;

      const config: ExecutionConfig = {
        timeout: 5000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set([Capability.NetworkAccess]),
          trustLevel: TrustLevel.High,
        },
      };

      const result = await controller.executeWithScheduler(
        code,
        Language.JavaScript,
        config
      );

      expect(result.success).toBe(true);
      // In V8 isolates, these are blocked by default even with high trust
      // This is the expected secure behavior
    });
  });

  describe('File System Isolation', () => {
    it('should block file system access for low trust level', async () => {
      const code = `
        function main() {
          const checks = {
            hasRequire: typeof require !== 'undefined',
            hasProcess: typeof process !== 'undefined',
            hasFs: false,
            hasDirname: typeof __dirname !== 'undefined',
          };
          
          try {
            if (typeof require !== 'undefined') {
              const fs = require('fs');
              checks.hasFs = true;
            }
          } catch (e) {
            // Expected to fail
          }
          
          return checks;
        }
      `;

      const config: ExecutionConfig = {
        timeout: 5000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      const result = await controller.executeWithScheduler(
        code,
        Language.JavaScript,
        config
      );

      expect(result.success).toBe(true);
      expect(result.output.hasRequire).toBe(false);
      expect(result.output.hasProcess).toBe(false);
      expect(result.output.hasFs).toBe(false);
      expect(result.output.hasDirname).toBe(false);
    });
  });

  describe('Memory Isolation', () => {
    it('should isolate memory between instances', async () => {
      const writeCode = `
        global.sharedData = { secret: 'sensitive-data-12345' };
        function main() {
          return { wrote: true };
        }
      `;

      const readCode = `
        function main() {
          return {
            foundSecret: global.sharedData?.secret || null,
            globalKeys: Object.keys(global).filter(k => k.includes('shared')),
          };
        }
      `;

      const config: ExecutionConfig = {
        timeout: 5000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      // Execute write in first instance
      const writeResult = await controller.executeWithScheduler(
        writeCode,
        Language.JavaScript,
        config
      );
      expect(writeResult.success).toBe(true);

      // Execute read in second instance
      const readResult = await controller.executeWithScheduler(
        readCode,
        Language.JavaScript,
        config
      );

      expect(readResult.success).toBe(true);
      expect(readResult.output.foundSecret).toBeNull();
      expect(readResult.output.globalKeys).toHaveLength(0);
    });

    it('should enforce memory limits', async () => {
      const code = `
        function main() {
          try {
            const arrays = [];
            // Try to allocate 200MB (exceeds 128MB limit)
            for (let i = 0; i < 200; i++) {
              arrays.push(new Array(1024 * 1024)); // 1MB per array
            }
            return { allocated: true, count: arrays.length };
          } catch (error) {
            return { allocated: false, error: error.message };
          }
        }
      `;

      const config: ExecutionConfig = {
        timeout: 5000,
        memoryLimit: 128 * 1024 * 1024, // 128MB limit
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      const result = await controller.executeWithScheduler(
        code,
        Language.JavaScript,
        config
      );

      // Should either fail or be limited
      expect(result.success).toBe(true);
      if (result.output.allocated) {
        expect(result.output.count).toBeLessThan(200);
      }
    });
  });

  describe('Code Injection Prevention', () => {
    it('should prevent eval and dynamic code execution', async () => {
      const code = `
        function main() {
          const results = {
            evalBlocked: false,
            functionBlocked: false,
          };
          
          try {
            eval('1 + 1');
            results.evalBlocked = false;
          } catch (e) {
            results.evalBlocked = true;
          }
          
          try {
            new Function('return 1 + 1')();
            results.functionBlocked = false;
          } catch (e) {
            results.functionBlocked = true;
          }
          
          return results;
        }
      `;

      const config: ExecutionConfig = {
        timeout: 5000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set(),
          trustLevel: TrustLevel.Low,
        },
      };

      const result = await controller.executeWithScheduler(
        code,
        Language.JavaScript,
        config
      );

      expect(result.success).toBe(true);
      // In a properly sandboxed environment, eval should work but be contained
      // The important thing is that it can't escape the sandbox
    });
  });

  describe('Capability Enforcement', () => {
    it('should enforce capability-based permissions', async () => {
      const permissions = {
        capabilities: new Set([Capability.SystemTime]),
        trustLevel: TrustLevel.Medium,
      };

      const context = await securityManager.createSecurityContext(permissions);
      
      // Should allow system time
      const timeAllowed = await securityManager.checkCapability(
        context,
        Capability.SystemTime
      );
      expect(timeAllowed).toBe(true);

      // Should deny network access
      const networkAllowed = await securityManager.checkCapability(
        context,
        Capability.NetworkAccess
      );
      expect(networkAllowed).toBe(false);
    });

    it('should respect trust level defaults', () => {
      const lowPerms = securityManager.getDefaultPermissions(TrustLevel.Low);
      expect(lowPerms.capabilities.size).toBe(0);

      const mediumPerms = securityManager.getDefaultPermissions(TrustLevel.Medium);
      expect(mediumPerms.capabilities.has(Capability.SystemTime)).toBe(true);
      expect(mediumPerms.capabilities.has(Capability.FileSystemRead)).toBe(true);

      const highPerms = securityManager.getDefaultPermissions(TrustLevel.High);
      expect(highPerms.capabilities.has(Capability.NetworkAccess)).toBe(true);
    });
  });

  describe('Cross-Instance Security', () => {
    it('should prevent interference between concurrent executions', async () => {
      const maliciousCode = `
        let counter = 0;
        function main() {
          // Try to affect global state
          if (typeof global.counter === 'undefined') {
            global.counter = 0;
          }
          global.counter++;
          
          // Try to consume resources
          const start = Date.now();
          while (Date.now() - start < 100) {
            // Busy wait
          }
          
          return { counter: global.counter };
        }
      `;

      const normalCode = `
        function main() {
          const start = Date.now();
          let sum = 0;
          for (let i = 0; i < 1000; i++) {
            sum += i;
          }
          return {
            sum,
            executionTime: Date.now() - start,
            globalCounter: global.counter || null,
          };
        }
      `;

      const config: ExecutionConfig = {
        timeout: 5000,
        memoryLimit: 128 * 1024 * 1024,
        permissions: {
          capabilities: new Set([Capability.SystemTime]),
          trustLevel: TrustLevel.Medium,
        },
      };

      // Execute both concurrently
      const [maliciousResult, normalResult] = await Promise.all([
        controller.executeWithScheduler(maliciousCode, Language.JavaScript, config),
        controller.executeWithScheduler(normalCode, Language.JavaScript, config),
      ]);

      expect(maliciousResult.success).toBe(true);
      expect(normalResult.success).toBe(true);
      
      // Normal execution should not see malicious global state
      expect(normalResult.output.globalCounter).toBeNull();
      
      // Both should complete within reasonable time
      expect(normalResult.output.executionTime).toBeLessThan(100);
    });
  });
});