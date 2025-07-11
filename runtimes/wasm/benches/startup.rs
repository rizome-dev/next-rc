use criterion::{black_box, criterion_group, criterion_main, Criterion};
use wasm_runtime::WasmRuntime;
use next_rc_shared::{Language, ExecutionConfig, Permissions, TrustLevel};
use std::time::Duration;

fn benchmark_cold_start(c: &mut Criterion) {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    
    runtime.block_on(async {
        let wasm_runtime = WasmRuntime::new_default().unwrap();
        
        // Pre-compile a minimal module
        let wat = r#"
            (module
                (func (export "_start") (result i32)
                    i32.const 0
                )
            )
        "#;
        
        let wasm_bytes = wat::parse_str(wat).unwrap();
        let module_id = wasm_runtime.compile(&wasm_bytes, Language::Wasm).await.unwrap();
        
        c.bench_function("wasm_cold_start", |b| {
            b.to_async(&runtime).iter(|| async {
                let instance_id = wasm_runtime.instantiate(black_box(module_id.clone())).await.unwrap();
                wasm_runtime.destroy(instance_id).await.unwrap();
            });
        });
    });
}

fn benchmark_execution(c: &mut Criterion) {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    
    runtime.block_on(async {
        let wasm_runtime = WasmRuntime::new_default().unwrap();
        
        // Compile a simple computation module
        let wat = r#"
            (module
                (func (export "_start") (result i32)
                    (local $i i32)
                    (local $sum i32)
                    
                    ;; Sum numbers from 1 to 100
                    (local.set $i (i32.const 1))
                    (local.set $sum (i32.const 0))
                    
                    (loop $loop
                        (local.set $sum 
                            (i32.add (local.get $sum) (local.get $i))
                        )
                        (local.set $i 
                            (i32.add (local.get $i) (i32.const 1))
                        )
                        (br_if $loop 
                            (i32.le_s (local.get $i) (i32.const 100))
                        )
                    )
                    
                    (local.get $sum)
                )
            )
        "#;
        
        let wasm_bytes = wat::parse_str(wat).unwrap();
        let module_id = wasm_runtime.compile(&wasm_bytes, Language::Wasm).await.unwrap();
        let instance_id = lucet_runtime.instantiate(module_id).await.unwrap();
        
        let config = ExecutionConfig {
            timeout: Duration::from_secs(1),
            memory_limit: 1024 * 1024,
            permissions: Permissions::new(TrustLevel::Low),
        };
        
        c.bench_function("lucet_execution", |b| {
            b.to_async(&runtime).iter(|| async {
                lucet_runtime.execute(
                    black_box(instance_id.clone()),
                    black_box(config.clone())
                ).await.unwrap();
            });
        });
        
        lucet_runtime.destroy(instance_id).await.unwrap();
    });
}

fn benchmark_memory_operations(c: &mut Criterion) {
    use next_rc_lucet::memory_pool::LucetMemoryPool;
    
    let pool = LucetMemoryPool::new(100, 4 * 1024 * 1024).unwrap();
    
    c.bench_function("memory_allocation", |b| {
        b.iter(|| {
            let slot = pool.allocate().unwrap();
            black_box(&slot);
            pool.release(slot);
        });
    });
}

criterion_group!(benches, benchmark_cold_start, benchmark_execution, benchmark_memory_operations);
criterion_main!(benches);