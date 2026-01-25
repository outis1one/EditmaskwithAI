import React, { useState, useEffect, useCallback, useRef } from 'react';
import ImageCanvas from './components/ImageCanvas';
import Controls from './components/Controls';
import History from './components/History';
import { projectsApi, editsApi } from './utils/api';
import './App.css';

function App() {
  const [project, setProject] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [currentImageUrl, setCurrentImageUrl] = useState(null);
  const [selection, setSelection] = useState(null);
  const [selectionMode, setSelectionMode] = useState('rectangle');
  const [mode, setMode] = useState('A');
  const [feather, setFeather] = useState(5);
  const [prompt, setPrompt] = useState('');
  const [edits, setEdits] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [showProjectInput, setShowProjectInput] = useState(true);
  const [currentEditIndex, setCurrentEditIndex] = useState(-1);
  const editsRef = useRef([]);

  // Create project and upload image
  const handleCreateProject = async () => {
    if (!imageFile) {
      setError('Please select an image');
      return;
    }

    try {
      setError(null);
      setIsProcessing(true);

      // Generate default project name from file name or timestamp
      const defaultName = projectName.trim() ||
        imageFile.name.replace(/\.[^/.]+$/, '') ||
        `Project ${Date.now()}`;

      // Create project
      const newProject = await projectsApi.create(defaultName);
      setProject(newProject);

      // Upload image
      await projectsApi.uploadImage(newProject.id, imageFile);

      // Set current image URL
      setCurrentImageUrl(projectsApi.getCurrentImageUrl(newProject.id));

      // Hide project input
      setShowProjectInput(false);

      // Load edits
      await loadEdits(newProject.id);
    } catch (err) {
      setError(`Failed to create project: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Load edits for the project
  const loadEdits = async (projectId) => {
    try {
      const projectEdits = await projectsApi.getEdits(projectId);
      setEdits(projectEdits);
      editsRef.current = projectEdits;
      // Set index to latest completed edit
      const completedEdits = projectEdits.filter(e => e.status === 'completed');
      setCurrentEditIndex(completedEdits.length - 1);
    } catch (err) {
      console.error('Failed to load edits:', err);
    }
  };

  // Poll for edit status
  const pollEditStatus = async (editId) => {
    const maxAttempts = 60; // 60 attempts = 1 minute with 1 second interval
    let attempts = 0;

    const poll = async () => {
      try {
        const edit = await editsApi.get(editId);

        if (edit.status === 'completed') {
          // Reload edits and update image
          await loadEdits(project.id);
          setCurrentImageUrl(projectsApi.getCurrentImageUrl(project.id));
          setIsProcessing(false);
          setSelection(null);
          return;
        } else if (edit.status === 'failed') {
          setError(`Edit failed: ${edit.error_message}`);
          setIsProcessing(false);
          await loadEdits(project.id);
          return;
        }

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 1000); // Poll every 1 second
        } else {
          setError('Edit timeout - please check edit history');
          setIsProcessing(false);
        }
      } catch (err) {
        setError(`Failed to check edit status: ${err.message}`);
        setIsProcessing(false);
      }
    };

    poll();
  };

  // Handle fix button
  const handleFix = async () => {
    if (!selection || !prompt.trim() || !project) {
      setError('Please make a selection and enter a prompt');
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

      // Start polling for status
      pollEditStatus(edit.id);
    } catch (err) {
      setError(`Failed to process edit: ${err.message}`);
      setIsProcessing(false);
    }
  };

  // Handle revert
  const handleRevert = async (editId) => {
    if (!project) return;

    try {
      setError(null);
      setIsProcessing(true);

      await editsApi.revert(project.id, editId);

      // Update image
      setCurrentImageUrl(projectsApi.getCurrentImageUrl(project.id));

      await loadEdits(project.id);
    } catch (err) {
      setError(`Failed to revert: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle reset
  const handleReset = async () => {
    if (!project) return;

    try {
      setError(null);
      setIsProcessing(true);

      await editsApi.reset(project.id);

      // Update image
      setCurrentImageUrl(projectsApi.getCurrentImageUrl(project.id));

      await loadEdits(project.id);
    } catch (err) {
      setError(`Failed to reset: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle download
  const handleDownload = async () => {
    if (!currentImageUrl) return;

    try {
      // Fetch the current image
      const response = await fetch(`${currentImageUrl}?t=${Date.now()}`);
      const blob = await response.blob();

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `edited-image-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Failed to download: ${err.message}`);
    }
  };

  // Handle undo (Ctrl+Z)
  const handleUndo = useCallback(async () => {
    if (!project || isProcessing) return;

    const completedEdits = editsRef.current.filter(e => e.status === 'completed');
    if (completedEdits.length === 0) return;

    if (currentEditIndex <= 0) {
      // Revert to original
      await handleReset();
      setCurrentEditIndex(-1);
    } else {
      // Revert to previous edit
      const previousEdit = completedEdits[currentEditIndex - 1];
      await handleRevert(previousEdit.id);
      setCurrentEditIndex(currentEditIndex - 1);
    }
  }, [project, isProcessing, currentEditIndex]);

  // Handle redo (Ctrl+Y)
  const handleRedo = useCallback(async () => {
    if (!project || isProcessing) return;

    const completedEdits = editsRef.current.filter(e => e.status === 'completed');
    if (currentEditIndex >= completedEdits.length - 1) return;

    const nextEdit = completedEdits[currentEditIndex + 1];
    await handleRevert(nextEdit.id);
    setCurrentEditIndex(currentEditIndex + 1);
  }, [project, isProcessing, currentEditIndex]);

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger shortcuts when typing in input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  // Warn before leaving page when there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (project && edits.length > 0) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [project, edits]);

  return (
    <div className="app">
      <div className="container">
        <div className="header">
          <h1>AI Photo Edit</h1>
          <p>Have AI regenerate only a selected area of your photo</p>
        </div>

        {error && (
          <div className="error-banner">
            <strong>Error:</strong> {error}
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {showProjectInput ? (
          <div className="project-setup">
            <h2>Start Editing</h2>
            <div className="setup-form">
              <div className="form-group">
                <label>Upload Image</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setImageFile(e.target.files[0])}
                  disabled={isProcessing}
                />
                {imageFile && (
                  <p className="file-name">Selected: {imageFile.name}</p>
                )}
              </div>
              <div className="form-group optional-field">
                <label>Project Name (optional)</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Uses filename if left empty"
                  disabled={isProcessing}
                />
              </div>
              <button
                className="create-project-btn"
                onClick={handleCreateProject}
                disabled={isProcessing || !imageFile}
              >
                {isProcessing ? 'Starting...' : 'Start Editing'}
              </button>
            </div>
          </div>
        ) : (
          <div className="workspace">
            <div className="left-panel">
              <ImageCanvas
                imageUrl={currentImageUrl}
                onSelectionChange={setSelection}
                selectionMode={selectionMode}
              />
            </div>

            <div className="right-panel">
              <Controls
                selectionMode={selectionMode}
                onSelectionModeChange={setSelectionMode}
                mode={mode}
                onModeChange={setMode}
                feather={feather}
                onFeatherChange={setFeather}
                prompt={prompt}
                onPromptChange={setPrompt}
                onFix={handleFix}
                onClear={() => setSelection(null)}
                onDownload={handleDownload}
                isProcessing={isProcessing}
                hasSelection={!!selection}
              />

              <div className="history-wrapper">
                <History
                  edits={edits}
                  onRevert={handleRevert}
                  onReset={handleReset}
                  isProcessing={isProcessing}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
