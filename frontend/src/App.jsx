import React, { useState, useEffect, useCallback, useRef } from 'react';
import ImageCanvas from './components/ImageCanvas';
import { projectsApi, editsApi, toolsApi } from './utils/api';
import './App.css';

// Tool definitions
const TOOLS = {
  move: { icon: '✥', name: 'Move', shortcut: 'V' },
  select: { icon: '▢', name: 'Rectangle Select', shortcut: 'R' },
  ellipse: { icon: '○', name: 'Ellipse Select', shortcut: 'E' },
  lasso: { icon: '✎', name: 'Free Select (Lasso)', shortcut: 'F' },
  magic: { icon: '✨', name: 'Smart Select (SAM)', shortcut: 'W' },
  colorPick: { icon: '◉', name: 'Color Select', shortcut: 'U' },
  brush: { icon: '🖌', name: 'Brush', shortcut: 'B' },
  bucket: { icon: '◧', name: 'Bucket Fill', shortcut: 'G' },
  eraser: { icon: '◫', name: 'Eraser', shortcut: 'Shift+E' },
  eyedropper: { icon: '💧', name: 'Color Picker', shortcut: 'O' },
  zoom: { icon: '🔍', name: 'Zoom', shortcut: 'Z' },
  pan: { icon: '✋', name: 'Pan', shortcut: 'H' },
};

function App() {
  // Project state
  const [project, setProject] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [currentImageUrl, setCurrentImageUrl] = useState(null);
  const [showProjectSetup, setShowProjectSetup] = useState(true);
  const [projectName, setProjectName] = useState('');

  // Tool state
  const [activeTool, setActiveTool] = useState('select');
  const [selection, setSelection] = useState(null);

  // Edit state
  const [prompt, setPrompt] = useState('');
  const [feather, setFeather] = useState(5);
  const [mode, setMode] = useState('A');
  const [edits, setEdits] = useState([]);
  const [currentEditIndex, setCurrentEditIndex] = useState(-1);
  const editsRef = useRef([]);

  // Layer state
  const [layers, setLayers] = useState([]);

  // UI state
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [zoom, setZoom] = useState(100);
  const [collapsedPanels, setCollapsedPanels] = useState({});
  const [eyes, setEyes] = useState([]);
  const [selectedEye, setSelectedEye] = useState(null);

  // Canvas ref for tool interactions
  const canvasRef = useRef(null);

  // Map tool to selection mode
  const getSelectionMode = () => {
    switch (activeTool) {
      case 'select': return 'rectangle';
      case 'ellipse': return 'ellipse';
      case 'lasso': return 'lasso';
      case 'magic': return 'smart';
      case 'colorPick': return 'color';
      default: return null;
    }
  };

  // Load eyes catalog
  useEffect(() => {
    const loadEyes = async () => {
      try {
        const patches = await fetch('/patches/?category=eyes').then(r => r.json()).catch(() => []);
        setEyes(patches);
      } catch (err) {
        console.error('Failed to load eyes:', err);
      }
    };
    if (project) loadEyes();
  }, [project]);

  // Create project
  const handleCreateProject = async () => {
    if (!imageFile) {
      setError('Please select an image');
      return;
    }

    try {
      setError(null);
      setIsProcessing(true);

      const defaultName = projectName.trim() ||
        imageFile.name.replace(/\.[^/.]+$/, '') ||
        `Project ${Date.now()}`;

      const newProject = await projectsApi.create(defaultName);
      setProject(newProject);

      await projectsApi.uploadImage(newProject.id, imageFile);
      setCurrentImageUrl(projectsApi.getCurrentImageUrl(newProject.id));
      setShowProjectSetup(false);

      await loadEdits(newProject.id);
    } catch (err) {
      setError(`Failed to create project: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Load edits
  const loadEdits = async (projectId) => {
    try {
      const projectEdits = await projectsApi.getEdits(projectId);
      setEdits(projectEdits);
      editsRef.current = projectEdits;
      const completedEdits = projectEdits.filter(e => e.status === 'completed');
      setCurrentEditIndex(completedEdits.length - 1);
    } catch (err) {
      console.error('Failed to load edits:', err);
    }
  };

  // Poll edit status
  const pollEditStatus = async (editId) => {
    const maxAttempts = 120;
    let attempts = 0;

    const poll = async () => {
      try {
        const edit = await editsApi.get(editId);

        if (edit.status === 'completed') {
          await loadEdits(project.id);
          setCurrentImageUrl(projectsApi.getCurrentImageUrl(project.id) + `?t=${Date.now()}`);
          setIsProcessing(false);
          setSelection(null);
          return;
        } else if (edit.status === 'failed') {
          setError(`Edit failed: ${edit.error_message}`);
          setIsProcessing(false);
          return;
        }

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 1000);
        } else {
          setError('Edit timeout');
          setIsProcessing(false);
        }
      } catch (err) {
        setError(`Status check failed: ${err.message}`);
        setIsProcessing(false);
      }
    };

    poll();
  };

  // Handle AI fix
  const handleFix = async () => {
    if (!selection || !prompt.trim() || !project) {
      setError('Make a selection and enter a prompt');
      return;
    }

    try {
      setError(null);
      setIsProcessing(true);

      const editRequest = {
        prompt: prompt.trim(),
        mode: mode,
        selection_type: selection.type,
        bbox: selection.bbox,
        feather_px: feather,
        selection_data: selection.selectionData,
      };

      const edit = await editsApi.create(project.id, editRequest);
      pollEditStatus(edit.id);
    } catch (err) {
      setError(`Edit failed: ${err.message}`);
      setIsProcessing(false);
    }
  };

  // Undo/Redo
  const handleRevert = useCallback(async (editId) => {
    if (!project) return;
    try {
      setIsProcessing(true);
      await editsApi.revert(project.id, editId);
      setCurrentImageUrl(projectsApi.getCurrentImageUrl(project.id) + `?t=${Date.now()}`);
      await loadEdits(project.id);
    } catch (err) {
      setError(`Revert failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [project]);

  const handleReset = useCallback(async () => {
    if (!project) return;
    try {
      setIsProcessing(true);
      await editsApi.reset(project.id);
      setCurrentImageUrl(projectsApi.getCurrentImageUrl(project.id) + `?t=${Date.now()}`);
      await loadEdits(project.id);
    } catch (err) {
      setError(`Reset failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [project]);

  // Download
  const handleDownload = async () => {
    if (!currentImageUrl) return;
    try {
      const response = await fetch(`${currentImageUrl}&download=1`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${project?.name || 'image'}-${Date.now()}.png`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Download failed: ${err.message}`);
    }
  };

  // Smart Select (SAM)
  const handleSmartSelect = async (x, y) => {
    if (!project) return;
    try {
      setIsProcessing(true);
      const maskBlob = await toolsApi.smartSelect(project.id, x, y);
      // TODO: Display mask on canvas
      console.log('Smart select mask:', maskBlob);
    } catch (err) {
      setError(`Smart select failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Remove background
  const handleRemoveBackground = async () => {
    if (!project) return;
    try {
      setIsProcessing(true);
      await toolsApi.removeBackgroundToLayer(project.id);
      setCurrentImageUrl(projectsApi.getCurrentImageUrl(project.id) + `?t=${Date.now()}`);
    } catch (err) {
      setError(`Background removal failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Apply eye
  const handleApplyEye = async () => {
    if (!project || !selection || !selectedEye) {
      setError('Select an area and an eye to apply');
      return;
    }
    try {
      setIsProcessing(true);
      const formData = new FormData();
      formData.append('project_id', project.id);
      formData.append('patch_id', selectedEye.id);
      formData.append('bbox', JSON.stringify(selection.bbox));
      formData.append('feather_px', feather);

      await fetch('/patches/apply', {
        method: 'POST',
        body: formData,
      });

      setCurrentImageUrl(projectsApi.getCurrentImageUrl(project.id) + `?t=${Date.now()}`);
      await loadEdits(project.id);
    } catch (err) {
      setError(`Apply eye failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Tool shortcuts
      if (!e.ctrlKey && !e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'v': setActiveTool('move'); break;
          case 'r': setActiveTool('select'); break;
          case 'e': setActiveTool('ellipse'); break;
          case 'f': setActiveTool('lasso'); break;
          case 'w': setActiveTool('magic'); break;
          case 'b': setActiveTool('brush'); break;
          case 'g': setActiveTool('bucket'); break;
          case 'z': setActiveTool('zoom'); break;
          case 'h': setActiveTool('pan'); break;
          case 'delete':
          case 'backspace':
            if (selection) {
              // TODO: Delete selected area
            }
            break;
        }
      }

      // Ctrl shortcuts
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) {
              // Redo
              const completed = editsRef.current.filter(ed => ed.status === 'completed');
              if (currentEditIndex < completed.length - 1) {
                handleRevert(completed[currentEditIndex + 1].id);
                setCurrentEditIndex(i => i + 1);
              }
            } else {
              // Undo
              if (currentEditIndex >= 0) {
                if (currentEditIndex === 0) {
                  handleReset();
                } else {
                  const completed = editsRef.current.filter(ed => ed.status === 'completed');
                  handleRevert(completed[currentEditIndex - 1].id);
                }
                setCurrentEditIndex(i => i - 1);
              }
            }
            break;
          case 's':
            e.preventDefault();
            handleDownload();
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, currentEditIndex, handleRevert, handleReset]);

  // Zoom controls
  const handleZoomIn = () => setZoom(z => Math.min(z + 25, 400));
  const handleZoomOut = () => setZoom(z => Math.max(z - 25, 25));
  const handleZoomReset = () => setZoom(100);

  // Panel toggle
  const togglePanel = (panel) => {
    setCollapsedPanels(prev => ({ ...prev, [panel]: !prev[panel] }));
  };

  // Project setup overlay
  if (showProjectSetup) {
    return (
      <div className="app">
        <div className="project-setup-overlay">
          <div className="project-setup">
            <h2>Open Image</h2>
            <div className="setup-form">
              <div className="form-group">
                <label>Select Image</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setImageFile(e.target.files[0])}
                  disabled={isProcessing}
                />
                {imageFile && <p className="file-name">{imageFile.name}</p>}
              </div>
              <div className="form-group">
                <label>Project Name (optional)</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Auto-generated from filename"
                  disabled={isProcessing}
                />
              </div>
              <button
                className="create-project-btn"
                onClick={handleCreateProject}
                disabled={isProcessing || !imageFile}
              >
                {isProcessing ? 'Opening...' : 'Open'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Menu Bar */}
      <div className="menu-bar">
        <h1>AI Photo Edit</h1>
        <div className="menu-actions">
          <button className="menu-btn" onClick={() => setShowProjectSetup(true)}>New</button>
          <button className="menu-btn" onClick={handleDownload}>Save</button>
          <button className="menu-btn" onClick={handleReset}>Reset</button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Main Workspace */}
      <div className="workspace">
        {/* Left Toolbar */}
        <div className="toolbar">
          <button
            className={`tool-btn ${activeTool === 'move' ? 'active' : ''}`}
            onClick={() => setActiveTool('move')}
            title="Move (V)"
          >✥</button>

          <div className="tool-divider" />

          <button
            className={`tool-btn ${activeTool === 'select' ? 'active' : ''}`}
            onClick={() => setActiveTool('select')}
            title="Rectangle Select (R)"
          >▢</button>
          <button
            className={`tool-btn ${activeTool === 'ellipse' ? 'active' : ''}`}
            onClick={() => setActiveTool('ellipse')}
            title="Ellipse Select (E)"
          >○</button>
          <button
            className={`tool-btn ${activeTool === 'lasso' ? 'active' : ''}`}
            onClick={() => setActiveTool('lasso')}
            title="Free Select (F)"
          >✎</button>
          <button
            className={`tool-btn ${activeTool === 'magic' ? 'active' : ''}`}
            onClick={() => setActiveTool('magic')}
            title="Smart Select - SAM (W)"
          >✨</button>
          <button
            className={`tool-btn ${activeTool === 'colorPick' ? 'active' : ''}`}
            onClick={() => setActiveTool('colorPick')}
            title="Color Select (U)"
          >◉</button>

          <div className="tool-divider" />

          <button
            className={`tool-btn ${activeTool === 'brush' ? 'active' : ''}`}
            onClick={() => setActiveTool('brush')}
            title="Brush (B)"
          >🖌</button>
          <button
            className={`tool-btn ${activeTool === 'bucket' ? 'active' : ''}`}
            onClick={() => setActiveTool('bucket')}
            title="Bucket Fill (G)"
          >◧</button>
          <button
            className={`tool-btn ${activeTool === 'eraser' ? 'active' : ''}`}
            onClick={() => setActiveTool('eraser')}
            title="Eraser (Shift+E)"
          >◫</button>

          <div className="tool-divider" />

          <button
            className={`tool-btn ${activeTool === 'eyedropper' ? 'active' : ''}`}
            onClick={() => setActiveTool('eyedropper')}
            title="Color Picker (O)"
          >💧</button>
          <button
            className={`tool-btn ${activeTool === 'zoom' ? 'active' : ''}`}
            onClick={() => setActiveTool('zoom')}
            title="Zoom (Z)"
          >🔍</button>
          <button
            className={`tool-btn ${activeTool === 'pan' ? 'active' : ''}`}
            onClick={() => setActiveTool('pan')}
            title="Pan (H)"
          >✋</button>
        </div>

        {/* Canvas Area */}
        <div className="canvas-area">
          <div className="canvas-wrapper">
            <ImageCanvas
              ref={canvasRef}
              imageUrl={currentImageUrl}
              onSelectionChange={setSelection}
              selectionMode={getSelectionMode()}
              activeTool={activeTool}
              zoom={zoom}
              onSmartSelect={handleSmartSelect}
              isProcessing={isProcessing}
            />
            {isProcessing && (
              <div className="processing-overlay">
                <div className="processing-spinner" />
              </div>
            )}
          </div>
          <div className="canvas-status">
            <div className="zoom-controls">
              <button className="zoom-btn" onClick={handleZoomOut}>−</button>
              <span className="zoom-level">{zoom}%</span>
              <button className="zoom-btn" onClick={handleZoomIn}>+</button>
              <button className="zoom-btn" onClick={handleZoomReset}>⟲</button>
            </div>
            <span>Selection: {selection ? `${selection.bbox?.width || 0}×${selection.bbox?.height || 0}` : 'None'}</span>
            <span>Tool: {TOOLS[activeTool]?.name || activeTool}</span>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="sidebar">
          {/* Tool Options Panel */}
          <div className="sidebar-panel">
            <div className="panel-header" onClick={() => togglePanel('toolOptions')}>
              <h3>Tool Options</h3>
              <span className="panel-toggle">{collapsedPanels.toolOptions ? '▶' : '▼'}</span>
            </div>
            <div className={`panel-content ${collapsedPanels.toolOptions ? 'collapsed' : ''}`}>
              <div className="control-group">
                <label className="control-label">Feather</label>
                <div className="slider-row">
                  <input
                    type="range"
                    min="0"
                    max="50"
                    value={feather}
                    onChange={(e) => setFeather(parseInt(e.target.value))}
                  />
                  <span className="slider-value">{feather}px</span>
                </div>
              </div>
            </div>
          </div>

          {/* AI Edit Panel */}
          <div className="sidebar-panel">
            <div className="panel-header" onClick={() => togglePanel('aiEdit')}>
              <h3>AI Edit</h3>
              <span className="panel-toggle">{collapsedPanels.aiEdit ? '▶' : '▼'}</span>
            </div>
            <div className={`panel-content ${collapsedPanels.aiEdit ? 'collapsed' : ''}`}>
              <div className="control-group">
                <label className="control-label">Mode</label>
                <div className="control-row">
                  <button
                    className={`mode-btn ${mode === 'A' ? 'active' : ''}`}
                    onClick={() => setMode('A')}
                  >Patch Only</button>
                  <button
                    className={`mode-btn ${mode === 'B' ? 'active' : ''}`}
                    onClick={() => setMode('B')}
                  >With Context</button>
                </div>
              </div>
              <div className="control-group">
                <label className="control-label">Prompt</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe what to fix or change..."
                />
              </div>
              <button
                className="action-btn"
                onClick={handleFix}
                disabled={isProcessing || !selection || !prompt.trim()}
              >
                {isProcessing ? 'Processing...' : 'Apply AI Edit'}
              </button>
            </div>
          </div>

          {/* Quick Actions Panel */}
          <div className="sidebar-panel">
            <div className="panel-header" onClick={() => togglePanel('actions')}>
              <h3>Quick Actions</h3>
              <span className="panel-toggle">{collapsedPanels.actions ? '▶' : '▼'}</span>
            </div>
            <div className={`panel-content ${collapsedPanels.actions ? 'collapsed' : ''}`}>
              <button
                className="action-btn secondary"
                onClick={handleRemoveBackground}
                disabled={isProcessing}
              >Remove Background</button>
            </div>
          </div>

          {/* Eyes Panel */}
          <div className="sidebar-panel">
            <div className="panel-header" onClick={() => togglePanel('eyes')}>
              <h3>Eye Catalog</h3>
              <span className="panel-toggle">{collapsedPanels.eyes ? '▶' : '▼'}</span>
            </div>
            <div className={`panel-content ${collapsedPanels.eyes ? 'collapsed' : ''}`}>
              {eyes.length > 0 ? (
                <>
                  <div className="eye-grid">
                    {eyes.map(eye => (
                      <div
                        key={eye.id}
                        className={`eye-item ${selectedEye?.id === eye.id ? 'selected' : ''}`}
                        onClick={() => setSelectedEye(eye)}
                      >
                        <img src={`/patches/${eye.id}/image?thumbnail=true`} alt={eye.name} />
                      </div>
                    ))}
                  </div>
                  <button
                    className="action-btn"
                    onClick={handleApplyEye}
                    disabled={isProcessing || !selection || !selectedEye}
                    style={{ marginTop: '12px' }}
                  >Apply Eye to Selection</button>
                </>
              ) : (
                <p style={{ fontSize: '12px', color: '#888' }}>No eyes in catalog</p>
              )}
            </div>
          </div>

          {/* Layers Panel */}
          <div className="sidebar-panel">
            <div className="panel-header" onClick={() => togglePanel('layers')}>
              <h3>Layers</h3>
              <span className="panel-toggle">{collapsedPanels.layers ? '▶' : '▼'}</span>
            </div>
            <div className={`panel-content ${collapsedPanels.layers ? 'collapsed' : ''}`}>
              <div className="layer-list">
                <div className="layer-item active">
                  <button className="layer-visibility visible">👁</button>
                  <span className="layer-name">Background</span>
                </div>
                {layers.map((layer) => (
                  <div key={layer.id} className="layer-item">
                    <button className="layer-visibility visible">👁</button>
                    <span className="layer-name">{layer.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* History Panel */}
          <div className="sidebar-panel">
            <div className="panel-header" onClick={() => togglePanel('history')}>
              <h3>History</h3>
              <span className="panel-toggle">{collapsedPanels.history ? '▶' : '▼'}</span>
            </div>
            <div className={`panel-content ${collapsedPanels.history ? 'collapsed' : ''}`}>
              <div className="history-list">
                <div
                  className={`history-item ${currentEditIndex === -1 ? 'current' : ''}`}
                  onClick={handleReset}
                >
                  Original
                </div>
                {edits.filter(e => e.status === 'completed').map((edit, i) => (
                  <div
                    key={edit.id}
                    className={`history-item ${currentEditIndex === i ? 'current' : ''}`}
                    onClick={() => handleRevert(edit.id)}
                  >
                    {edit.prompt?.substring(0, 30) || `Edit ${i + 1}`}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
