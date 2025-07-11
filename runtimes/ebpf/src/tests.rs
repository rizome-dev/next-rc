#[cfg(test)]
mod integration_tests {
    use crate::{EbpfRuntime, program::*, verifier::Verifier};
    use next_rc_shared::*;
    use std::time::{Duration, Instant};
    
    #[test]
    fn test_100_nanosecond_execution() {
        let runtime = EbpfRuntime::new().unwrap();
        
        // Create a minimal filter program
        let program = EbpfProgram::from_bytecode(
            vec![
                // BPF_MOV64_IMM(BPF_REG_0, 1)
                0xb7, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
                // BPF_EXIT_INSN()
                0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            ],
            ProgramType::Filter,
        );
        
        // Warm up JIT
        let test_data = vec![0u8; 64];
        let _ = runtime.execute_filter(&program, &test_data);
        
        // Measure execution time
        let mut total_time = Duration::ZERO;
        let iterations = 10000;
        
        for _ in 0..iterations {
            let start = Instant::now();
            let _ = runtime.execute_filter(&program, &test_data).unwrap();
            total_time += start.elapsed();
        }
        
        let avg_time = total_time / iterations;
        println!("Average eBPF execution time: {:?}", avg_time);
        
        // Should be under 500 nanoseconds (allowing overhead)
        assert!(avg_time.as_nanos() < 500);
    }
    
    #[test]
    fn test_complex_filter() {
        let runtime = EbpfRuntime::new().unwrap();
        
        // More complex filter that checks packet fields
        let bytecode = vec![
            // Load first byte of packet
            0x71, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            // Compare with 0x45 (IPv4)
            0x15, 0x00, 0x01, 0x00, 0x45, 0x00, 0x00, 0x00,
            // Return 0 (drop) if not IPv4
            0xb7, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
            // Return 1 (accept) if IPv4
            0xb7, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
            // Exit
            0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        
        let verifier = Verifier::with_config(100, true);
        assert!(verifier.verify(&bytecode).is_ok());
        
        let program = EbpfProgram::from_bytecode(bytecode, ProgramType::Filter);
        
        // Test with IPv4 packet
        let ipv4_packet = vec![0x45, 0x00, 0x00, 0x28]; // IPv4 header start
        let result = runtime.execute_filter(&program, &ipv4_packet).unwrap();
        assert_eq!(result.action, crate::runtime::FilterAction::Accept);
        
        // Test with non-IPv4 packet
        let other_packet = vec![0x60, 0x00, 0x00, 0x00]; // IPv6 header start
        let result = runtime.execute_filter(&program, &other_packet).unwrap();
        assert_eq!(result.action, crate::runtime::FilterAction::Drop);
    }
    
    #[tokio::test]
    async fn test_concurrent_filter_execution() {
        let runtime = Arc::new(EbpfRuntime::new().unwrap());
        
        // Create a simple filter
        let bytecode = vec![
            0xb7, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
            0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        
        let module_id = runtime.compile(&bytecode, Language::C).await.unwrap();
        
        // Create multiple instances
        let mut handles = vec![];
        
        for i in 0..100 {
            let runtime_clone = runtime.clone();
            let module_id_clone = module_id.clone();
            
            let handle = tokio::spawn(async move {
                let instance_id = runtime_clone.instantiate(module_id_clone).await.unwrap();
                
                let config = ExecutionConfig {
                    timeout: Duration::from_millis(1),
                    memory_limit: 1024,
                    permissions: Permissions::new(TrustLevel::Low),
                };
                
                let start = Instant::now();
                let result = runtime_clone.execute(instance_id.clone(), config).await.unwrap();
                let elapsed = start.elapsed();
                
                runtime_clone.destroy(instance_id).await.unwrap();
                
                (i, result, elapsed)
            });
            
            handles.push(handle);
        }
        
        // Wait for all executions
        let results: Vec<_> = futures::future::join_all(handles).await;
        
        // All should succeed with low latency
        for result in results {
            let (idx, exec_result, elapsed) = result.unwrap();
            assert!(exec_result.success);
            assert!(elapsed.as_micros() < 100, "Execution {} took {:?}", idx, elapsed);
        }
    }
    
    #[test]
    fn test_verifier_safety() {
        let verifier = Verifier::new(); // Safe mode
        
        // Program with memory access (should fail in safe mode)
        let unsafe_program = vec![
            // Load from memory
            0x61, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            // Return
            0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        
        assert!(verifier.verify(&unsafe_program).is_err());
        
        // Safe program (should pass)
        let safe_program = vec![
            0xb7, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
            0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        
        assert!(verifier.verify(&safe_program).is_ok());
    }
    
    #[test]
    fn test_optimized_filters() {
        use crate::jit::OptimizedFilters;
        
        // Create a mock packet
        let mut packet = vec![0u8; 30];
        packet[9] = 6; // TCP protocol
        packet[22] = 0x00;
        packet[23] = 0x50; // Port 80
        
        // Test optimized filters
        let start = Instant::now();
        for _ in 0..100000 {
            assert!(OptimizedFilters::protocol_filter(&packet, 6));
            assert!(OptimizedFilters::port_filter(&packet, 80));
        }
        let elapsed = start.elapsed();
        
        let avg_time = elapsed.as_nanos() / 200000; // Two filters per iteration
        println!("Average optimized filter time: {}ns", avg_time);
        
        // Should be well under 100ns
        assert!(avg_time < 100);
    }
}