import { TrustLevel, Capability, Permissions } from '@rizome/next-rc-types';
import { ProcessIsolationManager } from './process-isolation';
import { RuntimeSandbox } from './runtime-sandbox';
import { SystemSandbox } from './system-sandbox';
import { CapabilityManager } from './capability-manager';

export interface SecurityContext {
  trustLevel: TrustLevel;
  permissions: Permissions;
  processId?: number;
  namespaces?: string[];
  seccompProfile?: string;
}

export interface SecurityConfig {
  enableProcessIsolation: boolean;
  enableSystemSandbox: boolean;
  enableCapabilityChecks: boolean;
  defaultTrustLevel: TrustLevel;
}

export class SecurityManager {
  private processIsolation: ProcessIsolationManager;
  private runtimeSandbox: RuntimeSandbox;
  private systemSandbox: SystemSandbox;
  private capabilityManager: CapabilityManager;

  constructor(private config: SecurityConfig = {
    enableProcessIsolation: true,
    enableSystemSandbox: true,
    enableCapabilityChecks: true,
    defaultTrustLevel: TrustLevel.Low,
  }) {
    this.processIsolation = new ProcessIsolationManager();
    this.runtimeSandbox = new RuntimeSandbox();
    this.systemSandbox = new SystemSandbox();
    this.capabilityManager = new CapabilityManager();
  }

  async createSecurityContext(
    permissions: Permissions
  ): Promise<SecurityContext> {
    const context: SecurityContext = {
      trustLevel: permissions.trustLevel,
      permissions,
    };

    // Layer 1: Process isolation by trust level
    if (this.config.enableProcessIsolation) {
      const processId = await this.processIsolation.assignToCordon({
        trustLevel: permissions.trustLevel,
      });
      context.processId = processId;
    }

    // Layer 2: Runtime sandboxing
    this.runtimeSandbox.createConfig(permissions);
    
    // Layer 3: System sandboxing (Linux namespaces + seccomp)
    if (this.config.enableSystemSandbox) {
      const { namespaces, seccompProfile } = await this.systemSandbox.setup(
        permissions.trustLevel
      );
      context.namespaces = namespaces;
      context.seccompProfile = seccompProfile;
    }

    // Layer 4: Capability-based permissions
    if (this.config.enableCapabilityChecks) {
      await this.capabilityManager.enforceCapabilities(permissions.capabilities);
    }

    return context;
  }

  async teardownSecurityContext(context: SecurityContext): Promise<void> {
    // Cleanup in reverse order
    if (context.processId) {
      await this.processIsolation.releaseFromCordon(context.processId);
    }

    if (context.namespaces) {
      await this.systemSandbox.cleanup(context.namespaces);
    }
  }

  validatePermissions(
    requested: Set<Capability>,
    allowed: Permissions
  ): boolean {
    for (const capability of requested) {
      if (!allowed.capabilities.has(capability)) {
        console.warn(
          `Capability ${capability} requested but not allowed for trust level ${allowed.trustLevel}`
        );
        return false;
      }
    }
    return true;
  }

  getDefaultPermissions(trustLevel: TrustLevel): Permissions {
    const capabilities = new Set<Capability>();

    switch (trustLevel) {
      case TrustLevel.Low:
        // Minimal capabilities - computation only
        break;

      case TrustLevel.Medium:
        // Some capabilities
        capabilities.add(Capability.SystemTime);
        capabilities.add(Capability.FileSystemRead);
        break;

      case TrustLevel.High:
        // Most capabilities except dangerous ones
        capabilities.add(Capability.NetworkAccess);
        capabilities.add(Capability.FileSystemRead);
        capabilities.add(Capability.FileSystemWrite);
        capabilities.add(Capability.SystemTime);
        capabilities.add(Capability.EnvironmentVariables);
        capabilities.add(Capability.SharedMemory);
        break;
    }

    return {
      capabilities,
      trustLevel,
    };
  }

  async checkCapability(
    context: SecurityContext,
    capability: Capability
  ): Promise<boolean> {
    // Check if the security context has the requested capability
    if (!context.permissions.capabilities.has(capability)) {
      console.warn(
        `Capability ${capability} not available in security context`
      );
      return false;
    }

    // Additional runtime checks
    return this.capabilityManager.checkCapability(capability, context);
  }

  async enforceResourceLimits(
    context: SecurityContext,
    limits: {
      memory?: number;
      cpu?: number;
      fileDescriptors?: number;
      processes?: number;
    }
  ): Promise<void> {
    if (context.processId) {
      await this.systemSandbox.setResourceLimits(context.processId, limits);
    }
  }

  getSecurityMetrics() {
    return {
      processIsolation: this.processIsolation.getMetrics(),
      capabilityChecks: this.capabilityManager.getMetrics(),
      systemSandbox: this.systemSandbox.getMetrics(),
    };
  }
}