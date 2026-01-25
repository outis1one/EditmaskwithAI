import React, { useState, useEffect } from 'react';
import { toolsApi } from '../utils/api';
import './Layers.css';

const Layers = ({
  projectId,
  layers,
  setLayers,
  activeLayer,
  setActiveLayer,
  onLayerVisibilityChange,
  onFlatten,
  isProcessing,
  onError,
}) => {
  const [draggedLayer, setDraggedLayer] = useState(null);

  // Load layers on mount and when projectId changes
  useEffect(() => {
    if (projectId) {
      loadLayers();
    }
  }, [projectId]);

  const loadLayers = async () => {
    if (!projectId) return;
    try {
      const result = await toolsApi.listLayers(projectId);
      setLayers(result.layers || []);
    } catch (err) {
      console.error('Failed to load layers:', err);
    }
  };

  const handleDragStart = (e, index) => {
    setDraggedLayer(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedLayer === null || draggedLayer === index) return;

    // Reorder layers
    const newLayers = [...layers];
    const [removed] = newLayers.splice(draggedLayer, 1);
    newLayers.splice(index, 0, removed);
    setLayers(newLayers);
    setDraggedLayer(index);
  };

  const handleDragEnd = () => {
    setDraggedLayer(null);
  };

  const toggleVisibility = (layerId) => {
    const layer = layers.find((l) => l.id === layerId);
    if (layer) {
      layer.visible = !layer.visible;
      setLayers([...layers]);
      onLayerVisibilityChange?.(layerId, layer.visible);
    }
  };

  const handleFlatten = async () => {
    if (!projectId || layers.length === 0) return;
    const visibleLayers = layers.filter((l) => l.visible !== false);
    const layerOrder = visibleLayers.map((l) => l.id);
    await onFlatten(layerOrder);
    loadLayers();
  };

  const handleNewLayer = async () => {
    if (!projectId) return;
    try {
      // Create a new empty transparent layer
      const newLayer = {
        id: `layer-${Date.now()}`,
        name: `Layer ${layers.length + 1}`,
        visible: true,
        thumbnail: null,
      };
      setLayers([...layers, newLayer]);
      setActiveLayer(newLayer.id);
    } catch (err) {
      onError?.(`Failed to create layer: ${err.message}`);
    }
  };

  const handleDeleteLayer = async () => {
    if (!projectId || activeLayer === 'background') return;
    try {
      const updatedLayers = layers.filter((l) => l.id !== activeLayer);
      setLayers(updatedLayers);
      setActiveLayer(updatedLayers.length > 0 ? updatedLayers[updatedLayers.length - 1].id : 'background');
    } catch (err) {
      onError?.(`Failed to delete layer: ${err.message}`);
    }
  };

  const handleDuplicateLayer = async () => {
    if (!projectId || activeLayer === 'background') return;
    try {
      const layerToDuplicate = layers.find((l) => l.id === activeLayer);
      if (!layerToDuplicate) return;

      const newLayer = {
        ...layerToDuplicate,
        id: `layer-${Date.now()}`,
        name: `${layerToDuplicate.name} copy`,
      };

      const activeIndex = layers.findIndex((l) => l.id === activeLayer);
      const updatedLayers = [...layers];
      updatedLayers.splice(activeIndex + 1, 0, newLayer);
      setLayers(updatedLayers);
      setActiveLayer(newLayer.id);
    } catch (err) {
      onError?.(`Failed to duplicate layer: ${err.message}`);
    }
  };

  return (
    <div className="layers-panel">
      <div className="layers-header">
        <h3>Layers</h3>
        {layers.length > 0 && (
          <button
            className="flatten-btn"
            onClick={handleFlatten}
            disabled={isProcessing}
            title="Merge all visible layers"
          >
            Flatten
          </button>
        )}
      </div>

      <div className="layers-list">
        {/* Background layer (always present) */}
        <div
          className={`layer-item ${activeLayer === 'background' ? 'active' : ''}`}
          onClick={() => setActiveLayer('background')}
        >
          <span className="layer-visibility">
            <input type="checkbox" checked disabled />
          </span>
          <span className="layer-preview background-preview"></span>
          <span className="layer-name">Background</span>
          <span className="layer-lock">🔒</span>
        </div>

        {/* Dynamic layers */}
        {layers.map((layer, index) => (
          <div
            key={layer.id}
            className={`layer-item ${activeLayer === layer.id ? 'active' : ''} ${
              draggedLayer === index ? 'dragging' : ''
            }`}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            onClick={() => setActiveLayer(layer.id)}
          >
            <span className="layer-visibility">
              <input
                type="checkbox"
                checked={layer.visible !== false}
                onChange={() => toggleVisibility(layer.id)}
                onClick={(e) => e.stopPropagation()}
              />
            </span>
            <span className="layer-preview">
              {layer.thumbnail && (
                <img src={layer.thumbnail} alt={layer.name} />
              )}
            </span>
            <span className="layer-name">{layer.name}</span>
            <span className="layer-drag-handle">⋮⋮</span>
          </div>
        ))}

        {layers.length === 0 && (
          <div className="no-layers-hint">
            Use "Remove Background" to create layers
          </div>
        )}
      </div>

      <div className="layers-actions">
        <button
          className="layer-action-btn"
          disabled={isProcessing || !projectId}
          title="Add new empty layer"
          onClick={handleNewLayer}
        >
          + New Layer
        </button>
        <button
          className="layer-action-btn"
          disabled={isProcessing || activeLayer === 'background'}
          title="Delete selected layer"
          onClick={handleDeleteLayer}
        >
          Delete
        </button>
        <button
          className="layer-action-btn"
          disabled={isProcessing || activeLayer === 'background'}
          title="Duplicate selected layer"
          onClick={handleDuplicateLayer}
        >
          Duplicate
        </button>
      </div>
    </div>
  );
};

export default Layers;
