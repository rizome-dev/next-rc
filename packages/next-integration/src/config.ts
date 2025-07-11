import { RuntimeControllerConfig } from '@rizome/next-rc-core';

export interface NextRCConfig extends RuntimeControllerConfig {
  experimental?: {
    runtimeController?: {
      type?: 'hybrid' | 'wasm' | 'v8' | 'ebpf';
      fluidCompute?: {
        enabled: boolean;
        concurrency?: 'auto' | number;
      };
      edgeRuntime?: {
        engine?: 'wasm' | 'wasmtime' | 'v8';
        preWarm?: boolean;
      };
      lattice?: {
        enabled: boolean;
        natsUrl?: string;
      };
    };
  };
}

export function withRuntimeController(nextConfig: any = {}): any {
  return {
    ...nextConfig,
    
    experimental: {
      ...nextConfig.experimental,
      
      // Enable server components by default
      serverComponents: true,
      
      // Runtime controller configuration
      runtimeController: {
        type: 'hybrid',
        
        fluidCompute: {
          enabled: true,
          concurrency: 'auto',
        },
        
        edgeRuntime: {
          engine: 'wasm',
          preWarm: true,
        },
        
        lattice: {
          enabled: process.env.NATS_URL ? true : false,
          natsUrl: process.env.NATS_URL,
        },
        
        ...nextConfig.experimental?.runtimeController,
      },
    },
    
    // Custom webpack configuration
    webpack: (config: any, options: any) => {
      // Add runtime controller aliases
      config.resolve.alias['@rizome/next-rc'] = '@rizome/next-rc-integration';
      
      // Add WASM support
      config.experiments = {
        ...config.experiments,
        asyncWebAssembly: true,
        layers: true,
      };
      
      // Add rules for WASM files
      config.module.rules.push({
        test: /\.wasm$/,
        type: 'asset/resource',
      });
      
      // Call user's webpack config if provided
      if (typeof nextConfig.webpack === 'function') {
        return nextConfig.webpack(config, options);
      }
      
      return config;
    },
    
    // Environment variables
    env: {
      ...nextConfig.env,
      NEXT_RC_ENABLED: 'true',
      NEXT_RC_TYPE: nextConfig.experimental?.runtimeController?.type || 'hybrid',
    },
  };
}

export function getRuntimeConfig(): NextRCConfig {
  return {
    enableScheduler: true,
    runtimes: {
      wasm: {
        enabled: process.env.NEXT_RC_WASM_ENABLED === 'true',
      },
      ebpf: {
        enabled: process.env.NEXT_RC_EBPF_ENABLED === 'true',
      },
      v8: {
        enabled: process.env.NEXT_RC_V8_ENABLED !== 'false', // Enabled by default
      },
      firecracker: {
        enabled: process.env.NEXT_RC_FIRECRACKER_ENABLED === 'true',
      },
    },
    concurrency: parseInt(process.env.NEXT_RC_CONCURRENCY || '100', 10),
  };
}