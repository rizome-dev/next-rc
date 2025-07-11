(module
  ;; Memory for Python execution
  (memory $memory (export "memory") 16 256)
  
  ;; Global variables
  (global $output_ptr (mut i32) (i32.const 0))
  (global $output_len (mut i32) (i32.const 0))
  (global $heap_ptr (mut i32) (i32.const 1024))
  
  ;; Simple allocator
  (func $allocate (export "allocate") (param $size i32) (result i32)
    (local $ptr i32)
    
    ;; Get current heap pointer
    (local.set $ptr (global.get $heap_ptr))
    
    ;; Advance heap pointer
    (global.set $heap_ptr 
      (i32.add (global.get $heap_ptr) (local.get $size)))
    
    ;; Return allocated pointer
    (local.get $ptr)
  )
  
  ;; Simple Python interpreter stub
  (func $python_exec (export "python_exec") (param $code_ptr i32) (param $code_len i32) (result i32)
    (local $output_str i32)
    
    ;; For now, just return a success message
    ;; In a real implementation, this would interpret Python code
    
    ;; Allocate space for output
    (local.set $output_str (call $allocate (i32.const 13)))
    
    ;; Write "Hello, World!" to output
    (i32.store8 (local.get $output_str) (i32.const 72))  ;; 'H'
    (i32.store8 (i32.add (local.get $output_str) (i32.const 1)) (i32.const 101)) ;; 'e'
    (i32.store8 (i32.add (local.get $output_str) (i32.const 2)) (i32.const 108)) ;; 'l'
    (i32.store8 (i32.add (local.get $output_str) (i32.const 3)) (i32.const 108)) ;; 'l'
    (i32.store8 (i32.add (local.get $output_str) (i32.const 4)) (i32.const 111)) ;; 'o'
    (i32.store8 (i32.add (local.get $output_str) (i32.const 5)) (i32.const 44))  ;; ','
    (i32.store8 (i32.add (local.get $output_str) (i32.const 6)) (i32.const 32))  ;; ' '
    (i32.store8 (i32.add (local.get $output_str) (i32.const 7)) (i32.const 87))  ;; 'W'
    (i32.store8 (i32.add (local.get $output_str) (i32.const 8)) (i32.const 111)) ;; 'o'
    (i32.store8 (i32.add (local.get $output_str) (i32.const 9)) (i32.const 114)) ;; 'r'
    (i32.store8 (i32.add (local.get $output_str) (i32.const 10)) (i32.const 108)) ;; 'l'
    (i32.store8 (i32.add (local.get $output_str) (i32.const 11)) (i32.const 100)) ;; 'd'
    (i32.store8 (i32.add (local.get $output_str) (i32.const 12)) (i32.const 33))  ;; '!'
    
    ;; Set output globals
    (global.set $output_ptr (local.get $output_str))
    (global.set $output_len (i32.const 13))
    
    ;; Return success (0)
    (i32.const 0)
  )
  
  ;; Get output function
  (func $get_output (export "get_output") (result i32 i32)
    (global.get $output_ptr)
    (global.get $output_len)
  )
)