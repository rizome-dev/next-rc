use anyhow::{anyhow, Result};
use cranelift_codegen::settings::{self, Configurable};
use next_rc_shared::{Language, ModuleId};
use std::sync::Arc;
use uuid::Uuid;
use wasmtime::{Config, Engine, OptLevel};

pub struct WasmCompiler {
    engine: Arc<Engine>,
}

impl WasmCompiler {
    pub fn new() -> Result<Self> {
        let mut config = Config::new();
        
        // Optimize for fast instantiation
        config.cranelift_opt_level(OptLevel::Speed);
        config.parallel_compilation(true);
        config.cranelift_nan_canonicalization(false);
        
        // Enable SIMD for better performance
        config.wasm_simd(true);
        config.wasm_bulk_memory(true);
        config.wasm_multi_value(true);
        config.wasm_reference_types(true);
        
        // Disable features we don't need for faster compilation
        config.wasm_threads(false);
        config.wasm_multi_memory(false);
        
        // Memory configuration for fast allocation
        config.static_memory_maximum_size(4 * 1024 * 1024); // 4MB
        config.static_memory_guard_size(64 * 1024); // 64KB guard pages
        config.dynamic_memory_guard_size(64 * 1024);
        
        // Enable memory protection keys if available
        config.memory_init_cow(true);
        
        let engine = Engine::new(&config)?;
        
        Ok(Self {
            engine: Arc::new(engine),
        })
    }
    
    pub fn get_engine(&self) -> Arc<Engine> {
        self.engine.clone()
    }
    
    pub fn compile(&self, code: &[u8], language: Language) -> Result<(ModuleId, Vec<u8>)> {
        let wasm_bytes = match language {
            Language::Wasm => code.to_vec(),
            Language::Rust => self.compile_rust_to_wasm(code)?,
            Language::C | Language::Cpp => self.compile_c_to_wasm(code)?,
            _ => return Err(anyhow!("Unsupported language for WASM compilation: {:?}", language)),
        };
        
        // Pre-compile and validate
        let _ = wasmtime::Module::new(&self.engine, &wasm_bytes)?;
        
        let module_id = ModuleId(Uuid::new_v4());
        Ok((module_id, wasm_bytes))
    }
    
    fn compile_rust_to_wasm(&self, _code: &[u8]) -> Result<Vec<u8>> {
        // In a real implementation, this would invoke rustc with wasm32-unknown-unknown target
        // For now, return a simple test module
        let wat = r#"
            (module
                (memory (export "memory") 1)
                (func (export "_start")
                    nop
                )
            )
        "#;
        
        wat::parse_str(wat).map_err(|e| anyhow!("Failed to parse WAT: {}", e))
    }
    
    fn compile_c_to_wasm(&self, _code: &[u8]) -> Result<Vec<u8>> {
        // In a real implementation, this would invoke clang with wasm32 target
        // For now, return a simple test module
        let wat = r#"
            (module
                (memory (export "memory") 1)
                (func (export "main") (result i32)
                    i32.const 0
                )
            )
        "#;
        
        wat::parse_str(wat).map_err(|e| anyhow!("Failed to parse WAT: {}", e))
    }
    
    pub fn create_optimized_cranelift_flags() -> settings::Flags {
        let mut flags = settings::builder();
        
        // Optimize for speed
        flags.set("opt_level", "speed").unwrap();
        
        // Enable all CPU features for maximum performance
        flags.set("has_sse3", "true").unwrap();
        flags.set("has_ssse3", "true").unwrap();
        flags.set("has_sse41", "true").unwrap();
        flags.set("has_sse42", "true").unwrap();
        flags.set("has_avx", "true").unwrap();
        flags.set("has_avx2", "true").unwrap();
        flags.set("has_bmi1", "true").unwrap();
        flags.set("has_bmi2", "true").unwrap();
        flags.set("has_lzcnt", "true").unwrap();
        flags.set("has_popcnt", "true").unwrap();
        
        settings::Flags::new(flags)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_compiler_creation() {
        let compiler = LucetCompiler::new().unwrap();
        assert!(Arc::strong_count(&compiler.engine) == 1);
    }
    
    #[test]
    fn test_wasm_compilation() {
        let compiler = LucetCompiler::new().unwrap();
        
        let wat = r#"
            (module
                (func (export "test") (result i32)
                    i32.const 42
                )
            )
        "#;
        
        let wasm_bytes = wat::parse_str(wat).unwrap();
        let (module_id, compiled_bytes) = compiler.compile(&wasm_bytes, Language::Wasm).unwrap();
        
        assert!(!compiled_bytes.is_empty());
        assert_ne!(module_id.0, Uuid::nil());
    }
}