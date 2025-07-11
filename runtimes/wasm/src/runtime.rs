use anyhow::{anyhow, Result};
use async_trait::async_trait;
use next_rc_shared::{
    ExecutionConfig, ExecutionResult, InstanceId, Language, ModuleId, Runtime as RuntimeTrait,
    MemoryPool,
};
use std::sync::Arc;
use std::time::Instant;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::{
    compiler::WasmCompiler,
    context::ContextSwitcher,
    instance::InstanceManager,
    memory_pool::WasmMemoryPool,
    module_cache::ModuleCache,
};

#[derive(Debug, Clone)]
pub struct WasmConfig {
    pub total_slots: usize,
    pub slot_size: usize,
}

impl Default for WasmConfig {
    fn default() -> Self {
        Self {
            total_slots: 100,
            slot_size: 64 * 1024 * 1024, // 64MB per slot
        }
    }
}

pub struct WasmRuntime {
    compiler: WasmCompiler,
    memory_pool: Arc<WasmMemoryPool>,
    module_cache: Arc<ModuleCache>,
    context_switcher: Arc<ContextSwitcher>,
    instance_manager: Arc<InstanceManager>,
}

impl WasmRuntime {
    pub fn new(config: WasmConfig) -> Result<Self> {
        Self::with_config(config.total_slots, config.slot_size)
    }
    
    pub fn new_default() -> Result<Self> {
        info!("Initializing WASM runtime");
        
        let compiler = WasmCompiler::new()?;
        let engine = compiler.get_engine();
        
        let memory_pool = Arc::new(WasmMemoryPool::with_defaults()?);
        let module_cache = Arc::new(ModuleCache::new(engine.clone()));
        let context_switcher = Arc::new(ContextSwitcher::new(100));
        let instance_manager = Arc::new(InstanceManager::new(engine));
        
        Ok(Self {
            compiler,
            memory_pool,
            module_cache,
            context_switcher,
            instance_manager,
        })
    }
    
    pub fn with_config(total_slots: usize, slot_size: usize) -> Result<Self> {
        info!(
            "Initializing WASM runtime with {} slots of {} bytes",
            total_slots, slot_size
        );
        
        let compiler = WasmCompiler::new()?;
        let engine = compiler.get_engine();
        
        let memory_pool = Arc::new(WasmMemoryPool::new(total_slots, slot_size)?);
        let module_cache = Arc::new(ModuleCache::new(engine.clone()));
        let context_switcher = Arc::new(ContextSwitcher::new(total_slots));
        let instance_manager = Arc::new(InstanceManager::new(engine));
        
        Ok(Self {
            compiler,
            memory_pool,
            module_cache,
            context_switcher,
            instance_manager,
        })
    }
    
    pub fn get_metrics(&self) -> RuntimeMetrics {
        RuntimeMetrics {
            available_slots: self.memory_pool.available_slots(),
            total_slots: self.memory_pool.total_slots(),
            cached_modules: self.module_cache.size(),
        }
    }
}

#[async_trait]
impl RuntimeTrait for WasmRuntime {
    async fn compile(&self, code: &[u8], language: Language) -> Result<ModuleId> {
        debug!("Compiling {:?} code ({} bytes)", language, code.len());
        let start = Instant::now();
        
        let (module_id, wasm_bytes) = self.compiler.compile(code, language)?;
        
        // Cache the compiled module
        self.module_cache.compile_and_cache(module_id.clone(), &wasm_bytes)?;
        
        let elapsed = start.elapsed();
        info!("Compiled module {} in {:?}", module_id.0, elapsed);
        
        Ok(module_id)
    }
    
    async fn instantiate(&self, module_id: ModuleId) -> Result<InstanceId> {
        debug!("Instantiating module {}", module_id.0);
        let start = Instant::now();
        
        // Get compiled module from cache
        let compiled = self.module_cache
            .get(&module_id)
            .ok_or_else(|| anyhow!("Module not found: {}", module_id.0))?;
        
        // Allocate memory slot (this should be ~0 time due to pre-allocation)
        let memory_slot = self.memory_pool.allocate()?;
        
        // Create instance
        let instance_id = InstanceId(Uuid::new_v4());
        self.instance_manager.create_instance(
            instance_id.clone(),
            module_id,
            compiled.module,
            memory_slot,
        )?;
        
        let elapsed = start.elapsed();
        info!("Instantiated instance {} in {:?}", instance_id.0, elapsed);
        
        Ok(instance_id)
    }
    
    async fn execute(
        &self,
        instance_id: InstanceId,
        config: ExecutionConfig,
    ) -> Result<ExecutionResult> {
        debug!("Executing instance {} with timeout {:?}", instance_id.0, config.timeout);
        
        let instance = self.instance_manager
            .get_instance(&instance_id)
            .ok_or_else(|| anyhow!("Instance not found: {}", instance_id.0))?;
        
        let result = self.instance_manager.execute_instance(instance, config).await?;
        
        if result.success {
            info!(
                "Instance {} executed successfully in {:?}",
                instance_id.0, result.execution_time
            );
        } else {
            warn!(
                "Instance {} execution failed: {:?}",
                instance_id.0, result.error
            );
        }
        
        Ok(result)
    }
    
    async fn destroy(&self, instance_id: InstanceId) -> Result<()> {
        debug!("Destroying instance {}", instance_id.0);
        
        if let Some(instance) = self.instance_manager.remove_instance(&instance_id) {
            // Get memory slot to release
            let memory_slot = {
                let guard = instance.lock();
                guard.memory_slot.clone()
            };
            
            // Release memory back to pool
            self.memory_pool.release(memory_slot);
            
            info!("Instance {} destroyed", instance_id.0);
            Ok(())
        } else {
            Err(anyhow!("Instance not found: {}", instance_id.0))
        }
    }
}

#[derive(Debug)]
pub struct RuntimeMetrics {
    pub available_slots: usize,
    pub total_slots: usize,
    pub cached_modules: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use next_rc_shared::{Permissions, TrustLevel};
    use std::time::Duration;
    
    #[tokio::test]
    async fn test_runtime_lifecycle() {
        let runtime = WasmRuntime::new_default().unwrap();
        
        // Test compilation
        let wat = r#"
            (module
                (func (export "_start") (result i32)
                    i32.const 42
                )
            )
        "#;
        
        let wasm_bytes = wat::parse_str(wat).unwrap();
        let module_id = runtime.compile(&wasm_bytes, Language::Wasm).await.unwrap();
        
        // Test instantiation
        let instance_id = runtime.instantiate(module_id).await.unwrap();
        
        // Test execution
        let config = ExecutionConfig {
            timeout: Duration::from_secs(1),
            memory_limit: 1024 * 1024,
            permissions: Permissions::new(TrustLevel::Low),
        };
        
        let result = runtime.execute(instance_id.clone(), config).await.unwrap();
        assert!(result.success);
        
        // Test destruction
        runtime.destroy(instance_id).await.unwrap();
    }
    
    #[tokio::test]
    async fn test_runtime_metrics() {
        let runtime = LucetInspiredRuntime::with_config(10, 1024 * 1024).unwrap();
        
        let metrics = runtime.get_metrics();
        assert_eq!(metrics.total_slots, 10);
        assert_eq!(metrics.available_slots, 10);
        assert_eq!(metrics.cached_modules, 0);
    }
}