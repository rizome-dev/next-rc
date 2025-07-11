use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use next_rc_ebpf::{EbpfRuntime, program::*};

fn benchmark_filter_execution(c: &mut Criterion) {
    let runtime = EbpfRuntime::new().unwrap();
    
    // Simple accept filter
    let accept_program = EbpfProgram::from_bytecode(
        vec![
            0xb7, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
            0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        ProgramType::Filter,
    );
    
    // Warm up JIT
    let test_data = vec![0u8; 64];
    let _ = runtime.execute_filter(&accept_program, &test_data);
    
    let mut group = c.benchmark_group("ebpf_filters");
    
    for size in [64, 256, 1024, 4096].iter() {
        let data = vec![0u8; *size];
        
        group.bench_with_input(
            BenchmarkId::new("simple_filter", size),
            &data,
            |b, data| {
                b.iter(|| {
                    runtime.execute_filter(
                        black_box(&accept_program),
                        black_box(data)
                    ).unwrap()
                });
            },
        );
    }
    
    group.finish();
}

fn benchmark_optimized_filters(c: &mut Criterion) {
    use next_rc_ebpf::jit::OptimizedFilters;
    
    let mut packet = vec![0u8; 1500];
    packet[9] = 6; // TCP
    packet[22] = 0x00;
    packet[23] = 0x50; // Port 80
    
    c.bench_function("optimized_port_filter", |b| {
        b.iter(|| {
            OptimizedFilters::port_filter(black_box(&packet), black_box(80))
        });
    });
    
    c.bench_function("optimized_protocol_filter", |b| {
        b.iter(|| {
            OptimizedFilters::protocol_filter(black_box(&packet), black_box(6))
        });
    });
    
    c.bench_function("optimized_size_filter", |b| {
        b.iter(|| {
            OptimizedFilters::size_filter(black_box(&packet), black_box(64), black_box(1600))
        });
    });
}

fn benchmark_jit_compilation(c: &mut Criterion) {
    use next_rc_ebpf::jit::JitCompiler;
    
    let compiler = JitCompiler::new();
    
    let programs = vec![
        ("minimal", vec![
            0xb7, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
            0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]),
        ("small", vec![
            0x71, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x15, 0x00, 0x01, 0x00, 0x45, 0x00, 0x00, 0x00,
            0xb7, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
            0xb7, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
            0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]),
    ];
    
    let mut group = c.benchmark_group("jit_compilation");
    
    for (name, bytecode) in programs {
        group.bench_function(name, |b| {
            b.iter(|| {
                compiler.compile(black_box(&bytecode)).unwrap()
            });
        });
    }
    
    group.finish();
}

fn benchmark_verifier(c: &mut Criterion) {
    use next_rc_ebpf::verifier::Verifier;
    
    let verifier = Verifier::new();
    
    let programs = vec![
        ("minimal", vec![
            0xb7, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
            0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]),
        ("medium", {
            let mut prog = Vec::new();
            for i in 0..10 {
                // Add some ALU operations
                prog.extend_from_slice(&[0xb7, 0x01, 0x00, 0x00]);
                prog.extend_from_slice(&(i as i32).to_le_bytes());
                prog.extend_from_slice(&[0x07, 0x00, 0x00, 0x00]);
                prog.extend_from_slice(&(1i32).to_le_bytes());
            }
            prog.extend_from_slice(&[0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
            prog
        }),
    ];
    
    let mut group = c.benchmark_group("verifier");
    
    for (name, bytecode) in programs {
        group.bench_function(name, |b| {
            b.iter(|| {
                verifier.verify(black_box(&bytecode)).unwrap()
            });
        });
    }
    
    group.finish();
}

criterion_group!(
    benches,
    benchmark_filter_execution,
    benchmark_optimized_filters,
    benchmark_jit_compilation,
    benchmark_verifier
);
criterion_main!(benches);