import { SecurityManager } from '../security/security-manager';
import { CapabilityManager } from '../security/capability-manager';
import { RuntimeSandbox } from '../security/runtime-sandbox';
import { TrustLevel, Capability, Permissions } from '@rizome/next-rc-types';

describe('SecurityManager', () => {
  let securityManager: SecurityManager;

  beforeEach(() => {
    securityManager = new SecurityManager({
      enableProcessIsolation: false, // Disable for testing
      enableSystemSandbox: false,    // Disable for testing
      enableCapabilityChecks: true,
      defaultTrustLevel: TrustLevel.Low,
    });
  });

  it('should create security context for low trust level', async () => {
    const permissions: Permissions = {
      capabilities: new Set(),
      trustLevel: TrustLevel.Low,
    };

    const context = await securityManager.createSecurityContext(permissions);
    
    expect(context.trustLevel).toBe(TrustLevel.Low);
    expect(context.permissions).toBe(permissions);
  });

  it('should create security context with capabilities', async () => {
    const permissions: Permissions = {
      capabilities: new Set([Capability.SystemTime, Capability.FileSystemRead]),
      trustLevel: TrustLevel.Medium,
    };

    const context = await securityManager.createSecurityContext(permissions);
    
    expect(context.trustLevel).toBe(TrustLevel.Medium);
    expect(context.permissions.capabilities.has(Capability.SystemTime)).toBe(true);
  });

  it('should validate permissions correctly', () => {
    const allowed: Permissions = {
      capabilities: new Set([Capability.NetworkAccess, Capability.SystemTime]),
      trustLevel: TrustLevel.Medium,
    };

    // Valid request
    expect(
      securityManager.validatePermissions(
        new Set([Capability.NetworkAccess]),
        allowed
      )
    ).toBe(true);

    // Invalid request
    expect(
      securityManager.validatePermissions(
        new Set([Capability.FileSystemWrite]),
        allowed
      )
    ).toBe(false);
  });

  it('should provide default permissions by trust level', () => {
    const lowPerms = securityManager.getDefaultPermissions(TrustLevel.Low);
    expect(lowPerms.capabilities.size).toBe(0);

    const mediumPerms = securityManager.getDefaultPermissions(TrustLevel.Medium);
    expect(mediumPerms.capabilities.has(Capability.SystemTime)).toBe(true);
    expect(mediumPerms.capabilities.has(Capability.FileSystemRead)).toBe(true);

    const highPerms = securityManager.getDefaultPermissions(TrustLevel.High);
    expect(highPerms.capabilities.has(Capability.NetworkAccess)).toBe(true);
    expect(highPerms.capabilities.has(Capability.FileSystemWrite)).toBe(true);
  });
});

describe('CapabilityManager', () => {
  let capabilityManager: CapabilityManager;

  beforeEach(() => {
    capabilityManager = new CapabilityManager();
  });

  it('should check capabilities with context', async () => {
    const context = {
      trustLevel: TrustLevel.Medium,
      permissions: {
        capabilities: new Set([Capability.SystemTime]),
        trustLevel: TrustLevel.Medium,
      },
    };

    // Allowed capability
    const allowed = await capabilityManager.checkCapability(
      Capability.SystemTime,
      context as any
    );
    expect(allowed).toBe(true);

    // Not allowed capability
    const notAllowed = await capabilityManager.checkCapability(
      Capability.NetworkAccess,
      context as any
    );
    expect(notAllowed).toBe(false);
  });

  it('should validate network access', async () => {
    const context = {
      trustLevel: TrustLevel.High,
      permissions: {
        capabilities: new Set([Capability.NetworkAccess]),
        trustLevel: TrustLevel.High,
      },
      host: 'example.com',
      port: 443,
    };

    const allowed = await capabilityManager.checkCapability(
      Capability.NetworkAccess,
      context as any
    );
    expect(allowed).toBe(true);

    // Blocked host
    context.host = '169.254.169.254'; // AWS metadata
    const blocked = await capabilityManager.checkCapability(
      Capability.NetworkAccess,
      context as any
    );
    expect(blocked).toBe(false);
  });

  it('should enforce rate limits', async () => {
    const context = {
      trustLevel: TrustLevel.High,
      permissions: {
        capabilities: new Set([Capability.ProcessSpawn]),
        trustLevel: TrustLevel.High,
      },
      command: 'node script.js',
    };

    // Should allow up to rate limit
    for (let i = 0; i < 5; i++) {
      const allowed = await capabilityManager.checkCapability(
        Capability.ProcessSpawn,
        context as any
      );
      expect(allowed).toBe(true);
    }

    // Should block after rate limit
    const blocked = await capabilityManager.checkCapability(
      Capability.ProcessSpawn,
      context as any
    );
    expect(blocked).toBe(false);
  });

  it('should maintain audit log', async () => {
    const context = {
      trustLevel: TrustLevel.Low,
      permissions: {
        capabilities: new Set(),
        trustLevel: TrustLevel.Low,
      },
    };

    await capabilityManager.checkCapability(Capability.NetworkAccess, context as any);
    
    const auditLog = capabilityManager.getAuditLog({
      capability: Capability.NetworkAccess,
      granted: false,
    });

    expect(auditLog.length).toBeGreaterThan(0);
    expect(auditLog[0].capability).toBe(Capability.NetworkAccess);
    expect(auditLog[0].granted).toBe(false);
  });

  it('should provide metrics', async () => {
    const context = {
      trustLevel: TrustLevel.Medium,
      permissions: {
        capabilities: new Set([Capability.SystemTime]),
        trustLevel: TrustLevel.Medium,
      },
    };

    await capabilityManager.checkCapability(Capability.SystemTime, context as any);
    await capabilityManager.checkCapability(Capability.NetworkAccess, context as any);

    const metrics = capabilityManager.getMetrics();
    expect(metrics.totalChecks).toBeGreaterThanOrEqual(2);
    expect(metrics.deniedChecks).toBeGreaterThanOrEqual(1);
  });
});

describe('RuntimeSandbox', () => {
  let sandbox: RuntimeSandbox;

  beforeEach(() => {
    sandbox = new RuntimeSandbox();
  });

  it('should create sandbox config for low trust', () => {
    const permissions: Permissions = {
      capabilities: new Set(),
      trustLevel: TrustLevel.Low,
    };

    const config = sandbox.createConfig(permissions);

    expect(config.blockNetworkAccess).toBe(true);
    expect(config.blockFileSystemAccess).toBe(true);
    expect(config.blockProcessSpawn).toBe(true);
    expect(config.allowedHosts).toHaveLength(0);
    expect(config.maxMemory).toBe(128 * 1024 * 1024);
  });

  it('should create sandbox config for medium trust', () => {
    const permissions: Permissions = {
      capabilities: new Set([
        Capability.NetworkAccess,
        Capability.FileSystemRead,
      ]),
      trustLevel: TrustLevel.Medium,
    };

    const config = sandbox.createConfig(permissions);

    expect(config.blockNetworkAccess).toBe(false);
    expect(config.blockFileSystemAccess).toBe(false);
    expect(config.blockProcessSpawn).toBe(true);
    expect(config.allowedHosts).toContain('localhost');
    expect(config.maxMemory).toBe(512 * 1024 * 1024);
  });

  it('should validate operations against config', () => {
    const config = {
      blockNetworkAccess: false,
      blockFileSystemAccess: false,
      blockProcessSpawn: true,
      blockSystemCalls: [],
      allowedHosts: ['example.com', '*.trusted.com'],
      allowedPaths: ['/tmp/*'],
      maxMemory: 128 * 1024 * 1024,
      maxCpu: 50,
      timeout: 30000,
    };

    // Network access
    expect(
      sandbox.validateOperation('network:connect', config, { host: 'example.com' })
    ).toBe(true);

    expect(
      sandbox.validateOperation('network:connect', config, { host: 'evil.com' })
    ).toBe(false);

    // File system
    expect(
      sandbox.validateOperation('filesystem:read', config, { path: '/tmp/file.txt' })
    ).toBe(true);

    expect(
      sandbox.validateOperation('filesystem:read', config, { path: '/etc/passwd' })
    ).toBe(false);

    // Process spawn
    expect(
      sandbox.validateOperation('process:spawn', config)
    ).toBe(false);
  });
});