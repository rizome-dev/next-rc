import { Permissions, TrustLevel, Capability } from '@rizome/next-rc-types';

export interface SandboxConfig {
  blockNetworkAccess: boolean;
  blockFileSystemAccess: boolean;
  blockProcessSpawn: boolean;
  blockSystemCalls: string[];
  allowedHosts: string[];
  allowedPaths: string[];
  maxMemory: number;
  maxCpu: number;
  timeout: number;
}

export class RuntimeSandbox {
  createConfig(permissions: Permissions): SandboxConfig {
    const config: SandboxConfig = {
      blockNetworkAccess: !permissions.capabilities.has(Capability.NetworkAccess),
      blockFileSystemAccess: !permissions.capabilities.has(Capability.FileSystemRead),
      blockProcessSpawn: !permissions.capabilities.has(Capability.ProcessSpawn),
      blockSystemCalls: this.getBlockedSystemCalls(permissions),
      allowedHosts: this.getAllowedHosts(permissions),
      allowedPaths: this.getAllowedPaths(permissions),
      maxMemory: this.getMemoryLimit(permissions.trustLevel),
      maxCpu: this.getCpuLimit(permissions.trustLevel),
      timeout: this.getTimeout(permissions.trustLevel),
    };

    return config;
  }

  private getBlockedSystemCalls(permissions: Permissions): string[] {
    const blocked = [
      'fork',
      'vfork',
      'clone',
      'execve',
      'execveat',
      'ptrace',
      'process_vm_readv',
      'process_vm_writev',
    ];

    if (!permissions.capabilities.has(Capability.NetworkAccess)) {
      blocked.push(
        'socket',
        'connect',
        'accept',
        'bind',
        'listen',
        'sendto',
        'recvfrom',
        'sendmsg',
        'recvmsg'
      );
    }

    if (!permissions.capabilities.has(Capability.FileSystemWrite)) {
      blocked.push(
        'open', // with write flags
        'openat',
        'creat',
        'unlink',
        'unlinkat',
        'rename',
        'renameat',
        'mkdir',
        'mkdirat',
        'rmdir',
        'chmod',
        'chown'
      );
    }

    return blocked;
  }

  private getAllowedHosts(permissions: Permissions): string[] {
    if (!permissions.capabilities.has(Capability.NetworkAccess)) {
      return [];
    }

    switch (permissions.trustLevel) {
      case TrustLevel.Low:
        return []; // No network access
      
      case TrustLevel.Medium:
        return [
          'localhost',
          '127.0.0.1',
          '::1',
        ];
      
      case TrustLevel.High:
        return ['*']; // All hosts allowed
      
      default:
        return [];
    }
  }

  private getAllowedPaths(permissions: Permissions): string[] {
    if (!permissions.capabilities.has(Capability.FileSystemRead)) {
      return [];
    }

    switch (permissions.trustLevel) {
      case TrustLevel.Low:
        return ['/tmp/sandbox/*'];
      
      case TrustLevel.Medium:
        return [
          '/tmp/sandbox/*',
          '/usr/share/*',
          '/etc/ssl/*',
        ];
      
      case TrustLevel.High:
        return [
          '/tmp/*',
          '/home/sandbox/*',
          '/usr/*',
          '/etc/*',
        ];
      
      default:
        return [];
    }
  }

  private getMemoryLimit(trustLevel: TrustLevel): number {
    switch (trustLevel) {
      case TrustLevel.Low:
        return 128 * 1024 * 1024; // 128 MB
      
      case TrustLevel.Medium:
        return 512 * 1024 * 1024; // 512 MB
      
      case TrustLevel.High:
        return 2 * 1024 * 1024 * 1024; // 2 GB
      
      default:
        return 128 * 1024 * 1024;
    }
  }

  private getCpuLimit(trustLevel: TrustLevel): number {
    // CPU limit as percentage (0-100)
    switch (trustLevel) {
      case TrustLevel.Low:
        return 25; // 25% of one CPU
      
      case TrustLevel.Medium:
        return 50; // 50% of one CPU
      
      case TrustLevel.High:
        return 100; // 100% of one CPU
      
      default:
        return 25;
    }
  }

  private getTimeout(trustLevel: TrustLevel): number {
    // Execution timeout in milliseconds
    switch (trustLevel) {
      case TrustLevel.Low:
        return 30 * 1000; // 30 seconds
      
      case TrustLevel.Medium:
        return 5 * 60 * 1000; // 5 minutes
      
      case TrustLevel.High:
        return 30 * 60 * 1000; // 30 minutes
      
      default:
        return 30 * 1000;
    }
  }

  applyToV8Isolate(isolate: any, config: SandboxConfig): void {
    // Apply sandbox configuration to V8 isolate
    // This would integrate with the V8 runtime
    
    if (config.blockNetworkAccess) {
      // Remove network-related globals
      const script = `
        delete global.fetch;
        delete global.XMLHttpRequest;
        delete global.WebSocket;
        global.fetch = undefined;
        global.XMLHttpRequest = undefined;
        global.WebSocket = undefined;
      `;
      isolate.compileScriptSync(script).runSync(isolate.createContextSync());
    }

    if (config.blockFileSystemAccess) {
      // Remove file system access
      const script = `
        delete global.require;
        delete global.process;
        delete global.__dirname;
        delete global.__filename;
      `;
      isolate.compileScriptSync(script).runSync(isolate.createContextSync());
    }
  }

  applyToWasmInstance(_instance: any, _config: SandboxConfig): void {
    // Apply sandbox configuration to WASM instance
    // This would integrate with the WASM runtime
    
    // WASM is already sandboxed by design, but we can add additional restrictions
    // through the import object and memory limits
  }

  validateOperation(
    operation: string,
    config: SandboxConfig,
    context?: any
  ): boolean {
    switch (operation) {
      case 'network:connect':
        if (config.blockNetworkAccess) return false;
        if (context?.host && config.allowedHosts.length > 0) {
          return config.allowedHosts.includes('*') || 
                 config.allowedHosts.includes(context.host);
        }
        return true;

      case 'filesystem:read':
        if (config.blockFileSystemAccess) return false;
        if (context?.path && config.allowedPaths.length > 0) {
          return config.allowedPaths.some(allowed => 
            context.path.startsWith(allowed.replace('/*', ''))
          );
        }
        return true;

      case 'filesystem:write':
        return !config.blockFileSystemAccess && 
               config.allowedPaths.length > 0;

      case 'process:spawn':
        return !config.blockProcessSpawn;

      default:
        return false;
    }
  }
}