use anyhow::Result;
use next_rc_shared::ModuleId;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use wasmtime::{Engine, Module};

#[derive(Clone)]
pub struct CompiledModule {
    pub module: Arc<Module>,
    pub metadata: ModuleMetadata,
}

#[derive(Clone, Debug)]
pub struct ModuleMetadata {
    pub entry_point: Option<String>,
    pub memory_pages: u32,
    pub exports: Vec<String>,
    pub imports: Vec<String>,
}

pub struct ModuleCache {
    engine: Arc<Engine>,
    cache: RwLock<HashMap<ModuleId, CompiledModule>>,
}

impl ModuleCache {
    pub fn new(engine: Arc<Engine>) -> Self {
        Self {
            engine,
            cache: RwLock::new(HashMap::new()),
        }
    }
    
    pub fn insert(&self, id: ModuleId, module: CompiledModule) {
        let mut cache = self.cache.write();
        cache.insert(id, module);
    }
    
    pub fn get(&self, id: &ModuleId) -> Option<CompiledModule> {
        let cache = self.cache.read();
        cache.get(id).cloned()
    }
    
    pub fn remove(&self, id: &ModuleId) -> Option<CompiledModule> {
        let mut cache = self.cache.write();
        cache.remove(id)
    }
    
    pub fn clear(&self) {
        let mut cache = self.cache.write();
        cache.clear();
    }
    
    pub fn size(&self) -> usize {
        let cache = self.cache.read();
        cache.len()
    }
    
    pub fn compile_and_cache(&self, id: ModuleId, wasm_bytes: &[u8]) -> Result<CompiledModule> {
        // Compile the module
        let module = Module::new(&self.engine, wasm_bytes)?;
        
        // Extract metadata
        let metadata = self.extract_metadata(&module)?;
        
        let compiled = CompiledModule {
            module: Arc::new(module),
            metadata,
        };
        
        self.insert(id.clone(), compiled.clone());
        Ok(compiled)
    }
    
    fn extract_metadata(&self, module: &Module) -> Result<ModuleMetadata> {
        let exports: Vec<String> = module.exports()
            .map(|e| e.name().to_string())
            .collect();
        
        let imports: Vec<String> = module.imports()
            .map(|i| format!("{}::{}", i.module(), i.name()))
            .collect();
        
        // Check for memory requirements
        let memory_pages = module.exports()
            .find(|e| e.name() == "memory")
            .and_then(|_| Some(1)) // Default to 1 page if memory is exported
            .unwrap_or(0);
        
        // Look for _start or main as entry point
        let entry_point = exports.iter()
            .find(|&name| name == "_start" || name == "main")
            .cloned();
        
        Ok(ModuleMetadata {
            entry_point,
            memory_pages,
            exports,
            imports,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    
    fn create_test_engine() -> Arc<Engine> {
        Arc::new(Engine::default())
    }
    
    #[test]
    fn test_module_cache_basic_operations() {
        let engine = create_test_engine();
        let cache = ModuleCache::new(engine.clone());
        
        assert_eq!(cache.size(), 0);
        
        // Test WAT module
        let wat = r#"
            (module
                (func (export "add") (param i32 i32) (result i32)
                    local.get 0
                    local.get 1
                    i32.add
                )
            )
        "#;
        
        let wasm_bytes = wat::parse_str(wat).unwrap();
        let id = ModuleId(Uuid::new_v4());
        
        let compiled = cache.compile_and_cache(id.clone(), &wasm_bytes).unwrap();
        assert_eq!(cache.size(), 1);
        
        let retrieved = cache.get(&id).unwrap();
        assert_eq!(retrieved.metadata.exports.len(), compiled.metadata.exports.len());
        
        cache.remove(&id);
        assert_eq!(cache.size(), 0);
    }
}