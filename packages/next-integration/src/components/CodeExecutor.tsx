import { useState, useCallback } from 'react';
import { useRuntimeController } from '../hooks/useRuntimeController';
import { Language, TrustLevel, Capability } from '@rizome/next-rc-types';

export interface CodeExecutorProps {
  initialCode?: string;
  language?: Language;
  trustLevel?: TrustLevel;
  capabilities?: Capability[];
  onExecute?: (result: any) => void;
  className?: string;
}

export function CodeExecutor({
  initialCode = '',
  language = Language.JavaScript,
  trustLevel = TrustLevel.Low,
  capabilities = [],
  onExecute,
  className = '',
}: CodeExecutorProps) {
  const [code, setCode] = useState(initialCode);
  const [output, setOutput] = useState<any>(null);
  const { execute, loading, error } = useRuntimeController();

  const handleExecute = useCallback(async () => {
    const result = await execute({
      code,
      language,
      trustLevel,
      capabilities,
    });

    setOutput(result);
    
    if (onExecute) {
      onExecute(result);
    }
  }, [code, language, trustLevel, capabilities, execute, onExecute]);

  return (
    <div className={`code-executor ${className}`}>
      <div className="editor-section">
        <div className="editor-header">
          <h3>Code Editor</h3>
          <select
            value={language}
            onChange={() => setCode('')}
            disabled={loading}
          >
            <option value={Language.JavaScript}>JavaScript</option>
            <option value={Language.TypeScript}>TypeScript</option>
            <option value={Language.Python}>Python</option>
            <option value={Language.Rust}>Rust</option>
            <option value={Language.Go}>Go</option>
          </select>
        </div>
        
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter your code here..."
          disabled={loading}
          style={{
            width: '100%',
            minHeight: '300px',
            fontFamily: 'monospace',
            fontSize: '14px',
            padding: '10px',
            border: '1px solid #ccc',
            borderRadius: '4px',
          }}
        />
        
        <div className="controls">
          <button
            onClick={handleExecute}
            disabled={loading || !code.trim()}
            style={{
              padding: '10px 20px',
              fontSize: '16px',
              backgroundColor: loading ? '#ccc' : '#0070f3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Executing...' : 'Execute'}
          </button>
          
          <span style={{ marginLeft: '10px', fontSize: '12px', color: '#666' }}>
            Trust Level: {trustLevel}
          </span>
        </div>
      </div>

      {error && (
        <div className="error-section" style={{
          marginTop: '20px',
          padding: '10px',
          backgroundColor: '#fee',
          border: '1px solid #fcc',
          borderRadius: '4px',
          color: '#c00',
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {output && (
        <div className="output-section" style={{ marginTop: '20px' }}>
          <h3>Output</h3>
          
          <div style={{
            padding: '10px',
            backgroundColor: output.success ? '#efe' : '#fee',
            border: `1px solid ${output.success ? '#cfc' : '#fcc'}`,
            borderRadius: '4px',
          }}>
            {output.success ? (
              <>
                <div style={{ marginBottom: '10px' }}>
                  <strong>Result:</strong>
                  <pre style={{ margin: '5px 0', overflow: 'auto' }}>
                    {JSON.stringify(output.output, null, 2)}
                  </pre>
                </div>
                
                <div style={{ fontSize: '12px', color: '#666' }}>
                  <div>Execution Time: {output.executionTime}ms</div>
                  <div>Memory Used: {(output.memoryUsed / 1024 / 1024).toFixed(2)}MB</div>
                  {output.runtime && <div>Runtime: {output.runtime}</div>}
                </div>
              </>
            ) : (
              <div style={{ color: '#c00' }}>
                <strong>Error:</strong> {output.error}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}