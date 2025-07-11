use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use rbpf::{self};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{debug, trace};

pub struct JitCompiler {
    cache: Mutex<HashMap<Vec<u8>, Arc<JitProgram>>>,
}

pub struct JitProgram {
    bytecode: Vec<u8>,
    is_jit_compiled: bool,
}

unsafe impl Send for JitProgram {}
unsafe impl Sync for JitProgram {}

impl JitCompiler {
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
        }
    }
    
    pub fn compile(&self, bytecode: &[u8]) -> Result<Arc<JitProgram>> {
        // Check cache first
        {
            let cache = self.cache.lock();
            if let Some(cached) = cache.get(bytecode) {
                debug!("Using cached JIT compilation");
                return Ok(cached.clone());
            }
        }
        
        debug!("JIT compiling {} bytes of eBPF bytecode", bytecode.len());
        
        // Create a copy of bytecode for storage
        let bytecode_owned = bytecode.to_vec();
        
        // Create VM with Mbuff for packet data using the original slice
        let mut vm = rbpf::EbpfVmMbuff::new(Some(bytecode))
            .map_err(|e| anyhow!("Failed to create VM: {}", e))?;
        
        // Add helper functions
        self.register_helpers(&mut vm)?;
        
        // JIT compile the bytecode
        vm.jit_compile()
            .map_err(|e| anyhow!("JIT compilation failed: {}", e))?;
        
        // Drop the VM since we only needed it for verification
        drop(vm);
        
        let program = Arc::new(JitProgram {
            bytecode: bytecode_owned,
            is_jit_compiled: true,
        });
        
        // Cache the compiled program
        {
            let mut cache = self.cache.lock();
            cache.insert(bytecode.to_vec(), program.clone());
        }
        
        Ok(program)
    }
    
    pub fn execute(&self, program: &JitProgram, data: &[u8]) -> Result<u64> {
        trace!("Executing JIT compiled eBPF program on {} bytes", data.len());
        
        // Create a new VM for execution (thread-safe)
        let mut vm = rbpf::EbpfVmMbuff::new(Some(&program.bytecode))
            .map_err(|e| anyhow!("Failed to create VM: {}", e))?;
        
        // Register helpers
        self.register_helpers(&mut vm)?;
        
        // JIT compile if needed
        if program.is_jit_compiled {
            vm.jit_compile()
                .map_err(|e| anyhow!("JIT compilation failed: {}", e))?;
        }
        
        // Create mutable copies of the data
        // mem is the program's memory (empty for packet filters)
        let mut mem = vec![0u8; 0];
        // mbuff is the packet data
        let mut mbuff = data.to_vec();
        
        // Execute the program
        let result = if program.is_jit_compiled {
            unsafe {
                vm.execute_program_jit(&mut mem, &mut mbuff)
                    .map_err(|e| anyhow!("eBPF JIT execution failed: {}", e))?
            }
        } else {
            vm.execute_program(&mut mem, &mbuff)
                .map_err(|e| anyhow!("eBPF execution failed: {}", e))?
        };
        
        Ok(result)
    }
    
    fn register_helpers(&self, vm: &mut rbpf::EbpfVmMbuff) -> Result<()> {
        // Register helper functions that eBPF programs can call
        
        // Helper: get current time
        vm.register_helper(1, ebpf_get_time)
            .map_err(|e| anyhow!("Failed to register helper: {}", e))?;
        
        // Helper: print debug
        vm.register_helper(2, ebpf_print_debug)
            .map_err(|e| anyhow!("Failed to register helper: {}", e))?;
        
        Ok(())
    }
}

// eBPF helper functions
fn ebpf_get_time(_: u64, _: u64, _: u64, _: u64, _: u64) -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64
}

fn ebpf_print_debug(fmt: u64, _: u64, _: u64, _: u64, _: u64) -> u64 {
    // In a real implementation, this would safely read the format string
    trace!("eBPF debug print: fmt_ptr={:#x}", fmt);
    0
}

// Optimized filter execution for common cases
pub struct OptimizedFilters;

impl OptimizedFilters {
    #[inline(always)]
    pub fn port_filter(data: &[u8], port: u16) -> bool {
        if data.len() < 24 {
            return false;
        }
        
        // Check destination port (assuming TCP/UDP at offset 22)
        let dst_port = u16::from_be_bytes([data[22], data[23]]);
        dst_port == port
    }
    
    #[inline(always)]
    pub fn protocol_filter(data: &[u8], protocol: u8) -> bool {
        if data.len() < 10 {
            return false;
        }
        
        // Check IP protocol field at offset 9
        data[9] == protocol
    }
    
    #[inline(always)]
    pub fn size_filter(data: &[u8], min_size: usize, max_size: usize) -> bool {
        data.len() >= min_size && data.len() <= max_size
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_jit_compilation() {
        let compiler = JitCompiler::new();
        
        // Simple program that returns packet length
        let bytecode = vec![
            // BPF_MOV64_REG(BPF_REG_0, BPF_REG_2) - move len to return value
            0xbf, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            // BPF_EXIT_INSN()
            0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        
        let program = compiler.compile(&bytecode).unwrap();
        
        // Test execution
        let test_data = vec![1, 2, 3, 4, 5];
        let result = compiler.execute(&program, &test_data).unwrap();
        
        // Should return the length of the data
        assert_eq!(result, test_data.len() as u64);
    }
    
    #[test]
    fn test_optimized_filters() {
        let data = vec![
            0, 0, 0, 0, 0, 0, 0, 0, 0, 6, // Protocol TCP at offset 9
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0x00, 0x50, // Port 80 at offset 22-23
        ];
        
        assert!(OptimizedFilters::protocol_filter(&data, 6)); // TCP
        assert!(OptimizedFilters::port_filter(&data, 80));
        assert!(!OptimizedFilters::port_filter(&data, 443));
    }
}