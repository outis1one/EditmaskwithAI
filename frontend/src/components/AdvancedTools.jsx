import React, { useState } from 'react';
import { toolsApi } from '../utils/api';
import './AdvancedTools.css';

const AdvancedTools = ({
  projectId,
  selection,
  onLayerCreated,
  onMaskGenerated,
  onImageUpdate,
  isProcessing,
  setIsProcessing,
  setError,
}) => {
  const [activeToolMode, setActiveToolMode] = useState(null);
  const [colorTolerance, setColorTolerance] = useState(30);

  const handleRemoveBackground = async () => {
    if (!projectId) return;

    try {
      setIsProcessing(true);
      setError(null);
      const result = await toolsApi.removeBackgroundToLayer(projectId);
      onLayerCreated(result.layer);
    } catch (err) {
      setError(`Background removal failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSmartSelect = () => {
    setActiveToolMode(activeToolMode === 'smart-select' ? null : 'smart-select');
  };

  const handleColorSelect = () => {
    setActiveToolMode(activeToolMode === 'color-select' ? null : 'color-select');
  };

  const handleObjectRemove = () => {
    setActiveToolMode(activeToolMode === 'object-remove' ? null : 'object-remove');
  };

  // Called when user clicks on canvas in smart-select mode
  const onCanvasClick = async (x, y) => {
    if (!projectId || !activeToolMode) return;

    if (activeToolMode === 'smart-select') {
      try {
        setIsProcessing(true);
        const maskBlob = await toolsApi.smartSelect(projectId, x, y);
        onMaskGenerated(maskBlob, 'smart-select');
      } catch (err) {
        setError(`Smart select failed: ${err.message}`);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  // Called when user picks a color for color selection
  const onColorPicked = async (r, g, b) => {
    if (!projectId) return;

    try {
      setIsProcessing(true);
      const maskBlob = await toolsApi.colorSelect(projectId, r, g, b, colorTolerance);
      onMaskGenerated(maskBlob, 'color-select');
    } catch (err) {
      setError(`Color select failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExtractObject = async () => {
    if (!projectId || !selection) {
      setError('Make a selection first');
      return;
    }

    // For this we need the mask from the current selection
    // This would be generated from the selection shape
    setError('Extract requires a mask - use Smart Select or Color Select first');
  };

  return (
    <div className="advanced-tools">
      <h3>Advanced Tools</h3>

      <div className="tool-group">
        <h4>Background</h4>
        <button
          className="tool-btn"
          onClick={handleRemoveBackground}
          disabled={isProcessing || !projectId}
          title="Remove background and create new layer"
        >
          Remove Background
        </button>
      </div>

      <div className="tool-group">
        <h4>Selection Tools</h4>
        <div className="tool-buttons">
          <button
            className={`tool-btn ${activeToolMode === 'smart-select' ? 'active' : ''}`}
            onClick={handleSmartSelect}
            disabled={isProcessing || !projectId}
            title="Click on object to select it"
          >
            Smart Select
          </button>
          <button
            className={`tool-btn ${activeToolMode === 'color-select' ? 'active' : ''}`}
            onClick={handleColorSelect}
            disabled={isProcessing || !projectId}
            title="Select all similar colors"
          >
            Color Select
          </button>
        </div>

        {activeToolMode === 'color-select' && (
          <div className="color-tolerance">
            <label>Tolerance: {colorTolerance}</label>
            <input
              type="range"
              min="1"
              max="100"
              value={colorTolerance}
              onChange={(e) => setColorTolerance(parseInt(e.target.value))}
            />
          </div>
        )}

        {activeToolMode && (
          <p className="tool-hint">
            {activeToolMode === 'smart-select'
              ? 'Click on an object to select it'
              : 'Click on a color to select all similar pixels'}
          </p>
        )}
      </div>

      <div className="tool-group">
        <h4>Object Tools</h4>
        <button
          className={`tool-btn ${activeToolMode === 'object-remove' ? 'active' : ''}`}
          onClick={handleObjectRemove}
          disabled={isProcessing || !projectId}
          title="Remove selected object (uses AI)"
        >
          Object Remove
        </button>
        <button
          className="tool-btn"
          onClick={handleExtractObject}
          disabled={isProcessing || !projectId || !selection}
          title="Extract selected area to new layer"
        >
          Extract to Layer
        </button>
      </div>

      {activeToolMode && (
        <button
          className="cancel-mode-btn"
          onClick={() => setActiveToolMode(null)}
        >
          Cancel Tool
        </button>
      )}
    </div>
  );
};

// Export the click handler for parent component to use
AdvancedTools.handleCanvasClick = null;

export default AdvancedTools;
