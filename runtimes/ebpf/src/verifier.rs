use anyhow::{bail, Result};
// use rbpf::ebpf; // Unused
use tracing::{debug, trace};

pub struct Verifier {
    max_instructions: usize,
    allow_unsafe: bool,
}

impl Verifier {
    pub fn new() -> Self {
        Self {
            max_instructions: 4096,
            allow_unsafe: false,
        }
    }
    
    pub fn with_config(max_instructions: usize, allow_unsafe: bool) -> Self {
        Self {
            max_instructions,
            allow_unsafe,
        }
    }
    
    pub fn verify(&self, bytecode: &[u8]) -> Result<()> {
        debug!("Verifying eBPF program ({} bytes)", bytecode.len());
        
        // Check bytecode length
        if bytecode.len() % 8 != 0 {
            bail!("Invalid bytecode length: must be multiple of 8");
        }
        
        let instruction_count = bytecode.len() / 8;
        if instruction_count > self.max_instructions {
            bail!(
                "Program too large: {} instructions (max: {})",
                instruction_count,
                self.max_instructions
            );
        }
        
        // Verify each instruction
        let mut pc = 0;
        let mut branch_targets = Vec::new();
        
        while pc < bytecode.len() {
            let insn = self.parse_instruction(&bytecode[pc..pc + 8])?;
            trace!("Verifying instruction at pc={}: {:?}", pc, insn);
            
            // Check instruction validity
            self.verify_instruction(&insn, pc)?;
            
            // Track branch targets
            if self.is_branch_instruction(&insn) {
                let target = self.calculate_branch_target(pc, &insn)?;
                branch_targets.push(target);
            }
            
            pc += 8;
        }
        
        // Verify all branch targets are valid
        for target in branch_targets {
            if target >= bytecode.len() || target % 8 != 0 {
                bail!("Invalid branch target: {}", target);
            }
        }
        
        // Additional safety checks
        self.verify_memory_access(bytecode)?;
        self.verify_function_calls(bytecode)?;
        
        debug!("eBPF program verification successful");
        Ok(())
    }
    
    fn parse_instruction(&self, bytes: &[u8]) -> Result<Instruction> {
        if bytes.len() < 8 {
            bail!("Insufficient bytes for instruction");
        }
        
        Ok(Instruction {
            opcode: bytes[0],
            dst_reg: bytes[1] & 0xF,
            src_reg: (bytes[1] >> 4) & 0xF,
            offset: i16::from_le_bytes([bytes[2], bytes[3]]),
            immediate: i32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]),
        })
    }
    
    fn verify_instruction(&self, insn: &Instruction, pc: usize) -> Result<()> {
        // Verify register numbers
        if insn.dst_reg > 10 || insn.src_reg > 10 {
            bail!("Invalid register number at pc={}", pc);
        }
        
        // Verify opcode
        match insn.opcode {
            // ALU operations
            0x07 | 0x0f | 0x17 | 0x1f | 0x27 | 0x2f | 0x37 | 0x3f |
            0x47 | 0x4f | 0x57 | 0x5f | 0x67 | 0x6f | 0x77 | 0x7f |
            0x84 | 0x87 | 0x8f | 0x97 | 0x9f | 0xa7 | 0xaf | 0xb7 |
            0xbf | 0xc7 | 0xcf | 0xd7 | 0xdf => {
                // Valid ALU operations
                Ok(())
            }
            
            // Jump operations
            0x05 | 0x15 | 0x1d | 0x25 | 0x2d | 0x35 | 0x3d | 0x45 |
            0x4d | 0x55 | 0x5d | 0x65 | 0x6d | 0x75 | 0x7d | 0x85 |
            0x8d => {
                // Valid jump operations
                Ok(())
            }
            
            // Load/Store operations
            0x61 | 0x69 | 0x71 | 0x79 | 0x62 | 0x6a | 0x72 | 0x7a |
            0x63 | 0x6b | 0x73 | 0x7b => {
                if !self.allow_unsafe {
                    bail!("Memory access not allowed in safe mode at pc={}", pc);
                }
                Ok(())
            }
            
            // Exit
            0x95 => Ok(()),
            
            _ => bail!("Invalid opcode 0x{:02x} at pc={}", insn.opcode, pc),
        }
    }
    
    fn is_branch_instruction(&self, insn: &Instruction) -> bool {
        matches!(
            insn.opcode,
            0x05 | 0x15 | 0x1d | 0x25 | 0x2d | 0x35 | 0x3d | 0x45 |
            0x4d | 0x55 | 0x5d | 0x65 | 0x6d | 0x75 | 0x7d | 0x85 | 0x8d
        )
    }
    
    fn calculate_branch_target(&self, pc: usize, insn: &Instruction) -> Result<usize> {
        let offset = insn.offset as i32 * 8;
        let target = (pc as i32) + 8 + offset;
        
        if target < 0 {
            bail!("Negative branch target at pc={}", pc);
        }
        
        Ok(target as usize)
    }
    
    fn verify_memory_access(&self, bytecode: &[u8]) -> Result<()> {
        // In a real implementation, this would perform detailed memory access analysis
        // For now, we just check if memory operations are present
        let mut pc = 0;
        while pc < bytecode.len() {
            let insn = self.parse_instruction(&bytecode[pc..pc + 8])?;
            
            // Check for memory operations
            match insn.opcode {
                0x61 | 0x69 | 0x71 | 0x79 | 0x62 | 0x6a | 0x72 | 0x7a |
                0x63 | 0x6b | 0x73 | 0x7b => {
                    // Verify bounds checking is present
                    // This is a simplified check
                    if !self.allow_unsafe {
                        trace!("Memory operation found at pc={}, checking bounds", pc);
                    }
                }
                _ => {}
            }
            
            pc += 8;
        }
        
        Ok(())
    }
    
    fn verify_function_calls(&self, bytecode: &[u8]) -> Result<()> {
        // Verify helper function calls are valid
        let mut pc = 0;
        while pc < bytecode.len() {
            let insn = self.parse_instruction(&bytecode[pc..pc + 8])?;
            
            // Check for call instructions
            if insn.opcode == 0x85 {
                let func_id = insn.immediate;
                
                // Verify helper function ID is valid
                if !self.is_valid_helper(func_id) {
                    bail!("Invalid helper function {} at pc={}", func_id, pc);
                }
            }
            
            pc += 8;
        }
        
        Ok(())
    }
    
    fn is_valid_helper(&self, func_id: i32) -> bool {
        // List of allowed helper functions
        matches!(
            func_id,
            1..=10 | // Basic helpers
            20..=30 | // Map operations
            40..=50   // String operations
        )
    }
}

#[derive(Debug)]
struct Instruction {
    opcode: u8,
    dst_reg: u8,
    src_reg: u8,
    offset: i16,
    immediate: i32,
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_verify_valid_program() {
        let verifier = Verifier::new();
        
        // Simple valid program that returns 1
        let bytecode = vec![
            // BPF_MOV64_IMM(BPF_REG_0, 1)
            0xb7, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
            // BPF_EXIT_INSN()
            0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        
        assert!(verifier.verify(&bytecode).is_ok());
    }
    
    #[test]
    fn test_verify_invalid_length() {
        let verifier = Verifier::new();
        
        // Invalid length (not multiple of 8)
        let bytecode = vec![0x00; 7];
        
        assert!(verifier.verify(&bytecode).is_err());
    }
    
    #[test]
    fn test_verify_invalid_opcode() {
        let verifier = Verifier::new();
        
        // Invalid opcode
        let bytecode = vec![
            0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        
        assert!(verifier.verify(&bytecode).is_err());
    }
}