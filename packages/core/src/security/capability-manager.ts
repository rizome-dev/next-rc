import { Capability } from '@rizome/next-rc-types';
import { SecurityContext } from './security-manager';

interface CapabilityCheck {
  capability: Capability;
  granted: boolean;
  timestamp: number;
  context?: any;
}

interface CapabilityPolicy {
  capability: Capability;
  validator?: (context: any) => boolean | Promise<boolean>;
  rateLimit?: {
    requests: number;
    window: number; // milliseconds
  };
  requiresAudit?: boolean;
}

export class CapabilityManager {
  private policies: Map<Capability, CapabilityPolicy>;
  private auditLog: CapabilityCheck[] = [];
  private rateLimitCounters: Map<string, { count: number; windowStart: number }> = new Map();

  constructor() {
    this.policies = new Map();
    this.initializePolicies();
  }

  private initializePolicies(): void {
    // Network Access
    this.policies.set(Capability.NetworkAccess, {
      capability: Capability.NetworkAccess,
      validator: async (context) => {
        // Validate network requests
        if (context.host && this.isBlockedHost(context.host)) {
          return false;
        }
        if (context.port && this.isBlockedPort(context.port)) {
          return false;
        }
        return true;
      },
      rateLimit: {
        requests: 100,
        window: 60000, // 100 requests per minute
      },
      requiresAudit: true,
    });

    // File System Read
    this.policies.set(Capability.FileSystemRead, {
      capability: Capability.FileSystemRead,
      validator: async (context) => {
        if (!context.path) return false;
        
        // Check if path is allowed
        const allowedPaths = [
          '/tmp',
          '/usr/share',
          '/etc/ssl/certs',
        ];
        
        return allowedPaths.some(allowed => 
          context.path.startsWith(allowed)
        );
      },
      requiresAudit: true,
    });

    // File System Write
    this.policies.set(Capability.FileSystemWrite, {
      capability: Capability.FileSystemWrite,
      validator: async (context) => {
        if (!context.path) return false;
        
        // Only allow writes to specific directories
        const allowedPaths = ['/tmp/sandbox'];
        
        return allowedPaths.some(allowed => 
          context.path.startsWith(allowed)
        );
      },
      rateLimit: {
        requests: 10,
        window: 60000, // 10 writes per minute
      },
      requiresAudit: true,
    });

    // Process Spawn
    this.policies.set(Capability.ProcessSpawn, {
      capability: Capability.ProcessSpawn,
      validator: async (context) => {
        if (!context.command) return false;
        
        // Whitelist of allowed commands
        const allowedCommands = [
          'node',
          'python',
          'sh',
          'bash',
        ];
        
        const cmd = context.command.split(' ')[0];
        return allowedCommands.includes(cmd);
      },
      rateLimit: {
        requests: 5,
        window: 300000, // 5 processes per 5 minutes
      },
      requiresAudit: true,
    });

    // System Time
    this.policies.set(Capability.SystemTime, {
      capability: Capability.SystemTime,
      // No special validation needed
      requiresAudit: false,
    });

    // Environment Variables
    this.policies.set(Capability.EnvironmentVariables, {
      capability: Capability.EnvironmentVariables,
      validator: async (context) => {
        if (!context.name) return true;
        
        // Block access to sensitive environment variables
        const blockedVars = [
          'AWS_SECRET_ACCESS_KEY',
          'DATABASE_PASSWORD',
          'API_KEY',
          'SECRET',
          'TOKEN',
        ];
        
        return !blockedVars.some(blocked => 
          context.name.toUpperCase().includes(blocked)
        );
      },
      requiresAudit: true,
    });

    // Shared Memory
    this.policies.set(Capability.SharedMemory, {
      capability: Capability.SharedMemory,
      validator: async (context) => {
        // Limit shared memory size
        if (context.size && context.size > 100 * 1024 * 1024) {
          return false; // Max 100MB
        }
        return true;
      },
      requiresAudit: true,
    });

    // CPU Intensive
    this.policies.set(Capability.CpuIntensive, {
      capability: Capability.CpuIntensive,
      // This is more of a hint than a security capability
      requiresAudit: false,
    });

    // GPU Access
    this.policies.set(Capability.GpuAccess, {
      capability: Capability.GpuAccess,
      validator: async (_context) => {
        // Check if GPU is available
        return this.isGpuAvailable();
      },
      rateLimit: {
        requests: 1,
        window: 600000, // 1 GPU allocation per 10 minutes
      },
      requiresAudit: true,
    });
  }

  async enforceCapabilities(capabilities: Set<Capability>): Promise<void> {
    // Pre-validate all capabilities
    for (const capability of capabilities) {
      const policy = this.policies.get(capability);
      if (!policy) {
        throw new Error(`Unknown capability: ${capability}`);
      }
    }
  }

  async checkCapability(
    capability: Capability,
    context: SecurityContext
  ): Promise<boolean> {
    const policy = this.policies.get(capability);
    if (!policy) {
      this.audit(capability, false, context);
      return false;
    }

    // Check if capability is in the security context
    if (!context.permissions.capabilities.has(capability)) {
      this.audit(capability, false, context);
      return false;
    }

    // Check rate limit
    if (policy.rateLimit) {
      const key = `${context.trustLevel}-${capability}`;
      if (!this.checkRateLimit(key, policy.rateLimit)) {
        this.audit(capability, false, { ...context, reason: 'rate_limit' });
        return false;
      }
    }

    // Run custom validator
    if (policy.validator) {
      try {
        const allowed = await policy.validator(context);
        if (!allowed) {
          this.audit(capability, false, context);
          return false;
        }
      } catch (error) {
        console.error(`Capability validator error for ${capability}:`, error);
        this.audit(capability, false, { ...context, error });
        return false;
      }
    }

    // Success
    this.audit(capability, true, context);
    return true;
  }

  private checkRateLimit(
    key: string,
    limit: { requests: number; window: number }
  ): boolean {
    const now = Date.now();
    const counter = this.rateLimitCounters.get(key);

    if (!counter || now - counter.windowStart > limit.window) {
      // New window
      this.rateLimitCounters.set(key, {
        count: 1,
        windowStart: now,
      });
      return true;
    }

    if (counter.count >= limit.requests) {
      return false;
    }

    counter.count++;
    return true;
  }

  private audit(
    capability: Capability,
    granted: boolean,
    context: any
  ): void {
    // Always record checks for metrics, but respect requiresAudit for logging

    const check: CapabilityCheck = {
      capability,
      granted,
      timestamp: Date.now(),
      context: {
        trustLevel: context.trustLevel,
        processId: context.processId,
        ...context,
      },
    };

    this.auditLog.push(check);

    // Keep only last 10000 entries
    if (this.auditLog.length > 10000) {
      this.auditLog.shift();
    }

    // Log denied capabilities
    if (!granted) {
      console.warn(
        `Capability ${capability} denied for trust level ${context.trustLevel}`,
        context
      );
    }
  }

  private isBlockedHost(host: string): boolean {
    const blocked = [
      'metadata.google.internal',
      '169.254.169.254', // AWS metadata
      'localhost',
      '127.0.0.1',
      '::1',
    ];
    
    return blocked.includes(host.toLowerCase());
  }

  private isBlockedPort(port: number): boolean {
    const blocked = [
      22,   // SSH
      23,   // Telnet
      25,   // SMTP
      445,  // SMB
      3389, // RDP
    ];
    
    return blocked.includes(port);
  }

  private isGpuAvailable(): boolean {
    // Check if GPU is available on the system
    // This is a placeholder - real implementation would check actual GPU availability
    return false;
  }

  getAuditLog(
    filters?: {
      capability?: Capability;
      granted?: boolean;
      since?: number;
      trustLevel?: string;
    }
  ): CapabilityCheck[] {
    let logs = [...this.auditLog];

    if (filters) {
      if (filters.capability !== undefined) {
        logs = logs.filter(log => log.capability === filters.capability);
      }
      if (filters.granted !== undefined) {
        logs = logs.filter(log => log.granted === filters.granted);
      }
      if (filters.since !== undefined) {
        logs = logs.filter(log => log.timestamp >= filters.since!);
      }
      if (filters.trustLevel !== undefined) {
        logs = logs.filter(log => log.context?.trustLevel === filters.trustLevel);
      }
    }

    return logs;
  }

  getMetrics() {
    const metrics: any = {
      totalChecks: this.auditLog.length,
      deniedChecks: this.auditLog.filter(check => !check.granted).length,
      byCapability: {},
    };

    // Count by capability
    for (const check of this.auditLog) {
      if (!metrics.byCapability[check.capability]) {
        metrics.byCapability[check.capability] = {
          total: 0,
          granted: 0,
          denied: 0,
        };
      }
      
      metrics.byCapability[check.capability].total++;
      if (check.granted) {
        metrics.byCapability[check.capability].granted++;
      } else {
        metrics.byCapability[check.capability].denied++;
      }
    }

    return metrics;
  }

  clearAuditLog(): void {
    this.auditLog = [];
  }
}