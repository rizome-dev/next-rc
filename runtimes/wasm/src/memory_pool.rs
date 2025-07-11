use anyhow::{anyhow, Result};
use memmap2::{MmapMut, MmapOptions};
use next_rc_shared::{MemoryPool as MemoryPoolTrait, MemorySlot};
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicUsize, Ordering};

const DEFAULT_SLOT_SIZE: usize = 4 * 1024 * 1024; // 4MB per slot
const DEFAULT_POOL_SIZE: usize = 100; // 100 slots = 400MB total

pub struct WasmMemoryPool {
    slots: Mutex<VecDeque<MemorySlot>>,
    total_slots: usize,
    slot_size: usize,
    available_count: AtomicUsize,
    mmaps: Mutex<Vec<MmapMut>>,
}

impl WasmMemoryPool {
    pub fn new(total_slots: usize, slot_size: usize) -> Result<Self> {
        let mut slots = VecDeque::with_capacity(total_slots);
        let mut mmaps = Vec::with_capacity(total_slots);
        
        // Pre-allocate all memory slots
        for slot_id in 0..total_slots {
            let mut mmap = MmapOptions::new()
                .len(slot_size)
                .map_anon()?;
            
            // Pre-fault pages to avoid page faults during execution
            mmap.as_mut().fill(0);
            
            let ptr = NonNull::new(mmap.as_mut_ptr())
                .ok_or_else(|| anyhow!("Failed to create non-null pointer"))?;
            
            slots.push_back(MemorySlot {
                ptr,
                size: slot_size,
                slot_id,
            });
            
            mmaps.push(mmap);
        }
        
        Ok(Self {
            slots: Mutex::new(slots),
            total_slots,
            slot_size,
            available_count: AtomicUsize::new(total_slots),
            mmaps: Mutex::new(mmaps),
        })
    }
    
    pub fn with_defaults() -> Result<Self> {
        Self::new(DEFAULT_POOL_SIZE, DEFAULT_SLOT_SIZE)
    }
}

impl MemoryPoolTrait for WasmMemoryPool {
    fn allocate(&self) -> Result<MemorySlot> {
        let mut slots = self.slots.lock();
        
        if let Some(slot) = slots.pop_front() {
            self.available_count.fetch_sub(1, Ordering::SeqCst);
            Ok(slot)
        } else {
            Err(anyhow!("No available memory slots"))
        }
    }
    
    fn release(&self, slot: MemorySlot) {
        // Zero memory using madvise for fast clearing
        unsafe {
            libc::madvise(
                slot.ptr.as_ptr() as *mut libc::c_void,
                slot.size,
                libc::MADV_DONTNEED,
            );
        }
        
        let mut slots = self.slots.lock();
        slots.push_back(slot);
        self.available_count.fetch_add(1, Ordering::SeqCst);
    }
    
    fn total_slots(&self) -> usize {
        self.total_slots
    }
    
    fn available_slots(&self) -> usize {
        self.available_count.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_memory_pool_allocation() {
        let pool = WasmMemoryPool::new(10, 1024 * 1024).unwrap();
        
        assert_eq!(pool.total_slots(), 10);
        assert_eq!(pool.available_slots(), 10);
        
        let slot = pool.allocate().unwrap();
        assert_eq!(pool.available_slots(), 9);
        
        pool.release(slot);
        assert_eq!(pool.available_slots(), 10);
    }
    
    #[test]
    fn test_memory_pool_exhaustion() {
        let pool = WasmMemoryPool::new(2, 1024).unwrap();
        
        let slot1 = pool.allocate().unwrap();
        let slot2 = pool.allocate().unwrap();
        
        assert!(pool.allocate().is_err());
        
        pool.release(slot1);
        assert!(pool.allocate().is_ok());
        
        pool.release(slot2);
    }
}