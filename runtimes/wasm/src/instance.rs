use anyhow::{anyhow, Result};
use next_rc_shared::{ExecutionConfig, ExecutionResult, InstanceId, MemorySlot, ModuleId};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::oneshot;
use tokio::time::timeout;
use wasmtime::{Engine, Linker, Module, Store, TypedFunc};

pub struct Instance {
    pub id: InstanceId,
    pub module_id: ModuleId,
    pub memory_slot: MemorySlot,
    pub store: Store<StoreData>,
    pub entry_func: Option<TypedFunc<(), i32>>,
}

pub struct StoreData {
    pub memory_used: usize,
    pub start_time: Instant,
}

pub struct InstanceManager {
    engine: Arc<Engine>,
    instances: parking_lot::RwLock<std::collections::HashMap<InstanceId, Arc<parking_lot::Mutex<Instance>>>>,
}

impl InstanceManager {
    pub fn new(engine: Arc<Engine>) -> Self {
        Self {
            engine,
            instances: parking_lot::RwLock::new(std::collections::HashMap::new()),
        }
    }
    
    pub fn create_instance(
        &self,
        id: InstanceId,
        module_id: ModuleId,
        module: Arc<Module>,
        memory_slot: MemorySlot,
    ) -> Result<Arc<parking_lot::Mutex<Instance>>> {
        let mut store = Store::new(
            &self.engine,
            StoreData {
                memory_used: 0,
                start_time: Instant::now(),
            },
        );
        
        // Configure store limits
        store.limiter(|data| data as &mut dyn wasmtime::ResourceLimiter);
        
        // Create linker with host functions
        let linker = self.create_linker()?;
        
        // Instantiate the module
        let instance = linker.instantiate(&mut store, &module)?;
        
        // Get entry point function
        let entry_func = instance
            .get_typed_func::<(), i32>(&mut store, "_start")
            .ok();
        
        let instance = Instance {
            id: id.clone(),
            module_id,
            memory_slot,
            store,
            entry_func,
        };
        
        let instance_arc = Arc::new(parking_lot::Mutex::new(instance));
        
        let mut instances = self.instances.write();
        instances.insert(id, instance_arc.clone());
        
        Ok(instance_arc)
    }
    
    pub fn get_instance(&self, id: &InstanceId) -> Option<Arc<parking_lot::Mutex<Instance>>> {
        let instances = self.instances.read();
        instances.get(id).cloned()
    }
    
    pub fn remove_instance(&self, id: &InstanceId) -> Option<Arc<parking_lot::Mutex<Instance>>> {
        let mut instances = self.instances.write();
        instances.remove(id)
    }
    
    pub async fn execute_instance(
        &self,
        instance: Arc<parking_lot::Mutex<Instance>>,
        config: ExecutionConfig,
    ) -> Result<ExecutionResult> {
        let (tx, rx) = oneshot::channel();
        
        // Execute in a separate task with timeout
        let config_clone = config.clone();
        tokio::spawn(async move {
            let result = Self::execute_with_config(instance, config_clone).await;
            let _ = tx.send(result);
        });
        
        match timeout(config.timeout + Duration::from_millis(100), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(anyhow!("Execution task failed")),
            Err(_) => Ok(ExecutionResult {
                success: false,
                output: None,
                error: Some("Execution timeout".to_string()),
                execution_time: config.timeout,
                memory_used: 0,
            }),
        }
    }
    
    async fn execute_with_config(
        instance: Arc<parking_lot::Mutex<Instance>>,
        _config: ExecutionConfig,
    ) -> Result<ExecutionResult> {
        let start_time = Instant::now();
        
        let mut instance_guard = instance.lock();
        
        // Set resource limits
        instance_guard.store.data_mut().memory_used = 0;
        
        let result = if let Some(entry_func) = instance_guard.entry_func {
            match entry_func.call(&mut instance_guard.store, ()) {
                Ok(return_value) => ExecutionResult {
                    success: true,
                    output: Some(return_value.to_string().into_bytes()), // Return the actual value
                    error: None,
                    execution_time: start_time.elapsed(),
                    memory_used: instance_guard.store.data().memory_used,
                },
                Err(e) => ExecutionResult {
                    success: false,
                    output: None,
                    error: Some(format!("Execution error: {}", e)),
                    execution_time: start_time.elapsed(),
                    memory_used: instance_guard.store.data().memory_used,
                },
            }
        } else {
            ExecutionResult {
                success: false,
                output: None,
                error: Some("No entry point found".to_string()),
                execution_time: start_time.elapsed(),
                memory_used: 0,
            }
        };
        
        Ok(result)
    }
    
    fn create_linker(&self) -> Result<Linker<StoreData>> {
        let mut linker = Linker::new(&self.engine);
        
        // Add WASI-like functions for basic I/O
        linker.func_wrap("env", "print", |_caller: wasmtime::Caller<'_, StoreData>, ptr: i32, len: i32| {
            // In real implementation, read from instance memory and print
            println!("WASM print: ptr={}, len={}", ptr, len);
        })?;
        
        Ok(linker)
    }
}

impl wasmtime::ResourceLimiter for StoreData {
    fn memory_growing(&mut self, current: usize, desired: usize, _maximum: Option<usize>) -> Result<bool> {
        let _growth = desired.saturating_sub(current);
        self.memory_used = desired;
        
        // Allow up to 128MB
        Ok(desired <= 128 * 1024 * 1024)
    }
    
    fn table_growing(&mut self, _current: u32, _desired: u32, _maximum: Option<u32>) -> Result<bool> {
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compiler::LucetCompiler;
    use crate::memory_pool::LucetMemoryPool;
    use crate::module_cache::ModuleCache;
    use next_rc_shared::{Language, Permissions, TrustLevel};
    use uuid::Uuid;
    
    #[tokio::test]
    async fn test_instance_creation_and_execution() {
        let compiler = LucetCompiler::new().unwrap();
        let engine = compiler.get_engine();
        let cache = ModuleCache::new(engine.clone());
        let pool = LucetMemoryPool::new(10, 1024 * 1024).unwrap();
        let manager = InstanceManager::new(engine);
        
        // Compile a simple WASM module
        let wat = r#"
            (module
                (func (export "_start") (result i32)
                    i32.const 0
                )
            )
        "#;
        
        let wasm_bytes = wat::parse_str(wat).unwrap();
        let module_id = ModuleId(Uuid::new_v4());
        let compiled = cache.compile_and_cache(module_id.clone(), &wasm_bytes).unwrap();
        
        // Create instance
        let instance_id = InstanceId(Uuid::new_v4());
        let memory_slot = pool.allocate().unwrap();
        
        let instance = manager.create_instance(
            instance_id.clone(),
            module_id,
            compiled.module,
            memory_slot,
        ).unwrap();
        
        // Execute instance
        let config = ExecutionConfig {
            timeout: Duration::from_secs(5),
            memory_limit: 1024 * 1024,
            permissions: Permissions::new(TrustLevel::Low),
        };
        
        let result = manager.execute_instance(instance, config).await.unwrap();
        assert!(result.success);
        assert_eq!(result.error, None);
    }
}