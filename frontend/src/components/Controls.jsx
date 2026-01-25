import React from 'react';
import './Controls.css';

const Controls = ({
  selectionMode,
  onSelectionModeChange,
  mode,
  onModeChange,
  feather,
  onFeatherChange,
  prompt,
  onPromptChange,
  onFix,
  onDownload,
  isProcessing,
  hasSelection,
}) => {
  return (
    <div className="controls">
      <div className="control-section">
        <h3>Selection Tool</h3>
        <div className="button-group">
          <button
            className={selectionMode === 'rectangle' ? 'active' : ''}
            onClick={() => onSelectionModeChange('rectangle')}
            disabled={isProcessing}
          >
            Rectangle
          </button>
          <button
            className={selectionMode === 'ellipse' ? 'active' : ''}
            onClick={() => onSelectionModeChange('ellipse')}
            disabled={isProcessing}
          >
            Ellipse
          </button>
          <button
            className={selectionMode === 'lasso' ? 'active' : ''}
            onClick={() => onSelectionModeChange('lasso')}
            disabled={isProcessing}
          >
            Lasso
          </button>
        </div>
      </div>

      <div className="control-section">
        <h3>AI Mode</h3>
        <div className="button-group">
          <button
            className={mode === 'A' ? 'active' : ''}
            onClick={() => onModeChange('A')}
            disabled={isProcessing}
            title="Mode A: Send only the selected patch (faster, cheaper)"
          >
            Mode A (Patch Only)
          </button>
          <button
            className={mode === 'B' ? 'active' : ''}
            onClick={() => onModeChange('B')}
            disabled={isProcessing}
            title="Mode B: Send patch + full image for context (better style consistency)"
          >
            Mode B (With Context)
          </button>
        </div>
        <p className="mode-hint">
          {mode === 'A'
            ? 'Faster and cheaper - sends only the selected area'
            : 'Better style consistency - includes full image for context'}
        </p>
      </div>

      <div className="control-section">
        <h3>Edge Feathering</h3>
        <div className="slider-group">
          <input
            type="range"
            min="0"
            max="50"
            value={feather}
            onChange={(e) => onFeatherChange(parseInt(e.target.value))}
            disabled={isProcessing}
          />
          <span className="slider-value">{feather}px</span>
        </div>
        <p className="hint">Smooth blending at selection edges</p>
      </div>

      <div className="control-section">
        <h3>Prompt</h3>
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="Describe what to fix or change in the selected area..."
          rows={3}
          disabled={isProcessing}
        />
      </div>

      <div className="control-section action-buttons">
        <button
          className="fix-btn"
          onClick={onFix}
          disabled={isProcessing || !hasSelection || !prompt.trim()}
        >
          {isProcessing ? 'Processing...' : 'Fix Selected Area'}
        </button>
      </div>

      <div className="control-section">
        <button
          className="download-btn"
          onClick={onDownload}
          disabled={isProcessing}
        >
          Download Image
        </button>
      </div>
    </div>
  );
};

export default Controls;
