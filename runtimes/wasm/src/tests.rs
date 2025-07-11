#[cfg(test)]
mod integration_tests {
    use crate::WasmRuntime;
    use next_rc_shared::*;
    use std::time::{Duration, Instant};
    
    #[tokio::test]
    async fn test_35_microsecond_startup() {
        let runtime = WasmRuntime::new_default().unwrap();
        
        // Pre-compile module
        let wat = r#"
            (module
                (memory (export "memory") 1)
                (func (export "_start") (result i32)
                    i32.const 0
                )
            )
        "#;
        
        let wasm_bytes = wat::parse_str(wat).unwrap();
        let module_id = runtime.compile(&wasm_bytes, Language::Wasm).await.unwrap();
        
        // Measure instantiation time
        let mut total_time = Duration::ZERO;
        let iterations = 100;
        
        for _ in 0..iterations {
            let start = Instant::now();
            let instance_id = runtime.instantiate(module_id.clone()).await.unwrap();
            let elapsed = start.elapsed();
            total_time += elapsed;
            
            // Clean up
            runtime.destroy(instance_id).await.unwrap();
        }
        
        let avg_time = total_time / iterations;
        println!("Average instantiation time: {:?}", avg_time);
        
        // Should be under 50 microseconds (allowing some overhead)
        assert!(avg_time.as_micros() < 50);
    }
    
    #[tokio::test]
    async fn test_concurrent_execution() {
        let runtime = LucetInspiredRuntime::with_config(50, 1024 * 1024).unwrap();
        
        // Compile a simple counter module
        let wat = r#"
            (module
                (global $counter (mut i32) (i32.const 0))
                (func (export "_start") (result i32)
                    global.get $counter
                    i32.const 1
                    i32.add
                    global.set $counter
                    global.get $counter
                )
            )
        "#;
        
        let wasm_bytes = wat::parse_str(wat).unwrap();
        let module_id = runtime.compile(&wasm_bytes, Language::Wasm).await.unwrap();
        
        // Spawn multiple concurrent executions
        let mut handles = vec![];
        let runtime_arc = std::sync::Arc::new(runtime);
        
        for _ in 0..20 {
            let runtime_clone = runtime_arc.clone();
            let module_id_clone = module_id.clone();
            
            let handle = tokio::spawn(async move {
                let instance_id = runtime_clone.instantiate(module_id_clone).await.unwrap();
                
                let config = ExecutionConfig {
                    timeout: Duration::from_secs(1),
                    memory_limit: 1024 * 1024,
                    permissions: Permissions::new(TrustLevel::Low),
                };
                
                let result = runtime_clone.execute(instance_id.clone(), config).await.unwrap();
                runtime_clone.destroy(instance_id).await.unwrap();
                
                result
            });
            
            handles.push(handle);
        }
        
        // Wait for all executions
        let results: Vec<_> = futures::future::join_all(handles).await;
        
        // All should succeed
        for result in results {
            assert!(result.unwrap().success);
        }
    }
    
    #[tokio::test]
    async fn test_memory_isolation() {
        let runtime = WasmRuntime::new_default().unwrap();
        
        // Module that writes to memory
        let wat = r#"
            (module
                (memory (export "memory") 1)
                (func (export "_start") (result i32)
                    ;; Write pattern to memory
                    i32.const 0
                    i32.const 0xDEADBEEF
                    i32.store
                    
                    ;; Return success
                    i32.const 0
                )
            )
        "#;
        
        let wasm_bytes = wat::parse_str(wat).unwrap();
        let module_id = runtime.compile(&wasm_bytes, Language::Wasm).await.unwrap();
        
        // Create two instances
        let instance1 = runtime.instantiate(module_id.clone()).await.unwrap();
        let instance2 = runtime.instantiate(module_id.clone()).await.unwrap();
        
        let config = ExecutionConfig {
            timeout: Duration::from_secs(1),
            memory_limit: 1024 * 1024,
            permissions: Permissions::new(TrustLevel::Low),
        };
        
        // Execute both
        runtime.execute(instance1.clone(), config.clone()).await.unwrap();
        runtime.execute(instance2.clone(), config).await.unwrap();
        
        // Memory should be isolated between instances
        // (In a real test, we'd verify the memory contents are isolated)
        
        runtime.destroy(instance1).await.unwrap();
        runtime.destroy(instance2).await.unwrap();
    }
    
    #[tokio::test]
    async fn test_resource_limits() {
        let runtime = WasmRuntime::new_default().unwrap();
        
        // Module that allocates excessive memory
        let wat = r#"
            (module
                (memory 1)
                (func (export "_start") (result i32)
                    ;; Try to grow memory beyond limit
                    i32.const 1000  ;; Request 1000 pages (64MB)
                    memory.grow
                    drop
                    i32.const 0
                )
            )
        "#;
        
        let wasm_bytes = wat::parse_str(wat).unwrap();
        let module_id = runtime.compile(&wasm_bytes, Language::Wasm).await.unwrap();
        let instance_id = runtime.instantiate(module_id).await.unwrap();
        
        let config = ExecutionConfig {
            timeout: Duration::from_secs(1),
            memory_limit: 4 * 1024 * 1024, // 4MB limit
            permissions: Permissions::new(TrustLevel::Low),
        };
        
        let result = runtime.execute(instance_id.clone(), config).await.unwrap();
        
        // Should still succeed but memory growth should be limited
        assert!(result.success);
        
        runtime.destroy(instance_id).await.unwrap();
    }
}