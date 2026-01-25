import React, { useState, useEffect } from 'react';
import { patchesApi } from '../utils/api';
import './EyeCatalog.css';

const EyeCatalog = ({
  projectId,
  selection,
  feather,
  onApply,
  isProcessing,
}) => {
  const [patches, setPatches] = useState([]);
  const [selectedPatch, setSelectedPatch] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadTags, setUploadTags] = useState('');
  const [error, setError] = useState(null);

  // Load patches on mount
  useEffect(() => {
    loadPatches();
  }, []);

  const loadPatches = async () => {
    try {
      const data = await patchesApi.list('eyes');
      setPatches(data);
    } catch (err) {
      console.error('Failed to load patches:', err);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile || !uploadName.trim()) {
      setError('Please provide a name and select a file');
      return;
    }

    try {
      setIsUploading(true);
      setError(null);
      await patchesApi.create(uploadName.trim(), uploadFile, 'eyes', uploadTags);
      await loadPatches();
      setShowUpload(false);
      setUploadName('');
      setUploadFile(null);
      setUploadTags('');
    } catch (err) {
      setError(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleApply = async () => {
    if (!selectedPatch || !selection || !projectId) {
      setError('Please select an eye and make a selection on the image');
      return;
    }

    try {
      setError(null);
      await patchesApi.apply(projectId, selectedPatch.id, selection.bbox, feather);
      onApply();
      setSelectedPatch(null);
    } catch (err) {
      setError(`Failed to apply: ${err.message}`);
    }
  };

  const handleDelete = async (patchId) => {
    if (!window.confirm('Delete this eye from the catalog?')) return;

    try {
      await patchesApi.delete(patchId);
      await loadPatches();
      if (selectedPatch?.id === patchId) {
        setSelectedPatch(null);
      }
    } catch (err) {
      setError(`Delete failed: ${err.message}`);
    }
  };

  return (
    <div className="eye-catalog">
      <div className="catalog-header">
        <h3>Eye Catalog</h3>
        <button
          className="upload-toggle-btn"
          onClick={() => setShowUpload(!showUpload)}
        >
          {showUpload ? 'Cancel' : '+ Add Eye'}
        </button>
      </div>

      {error && (
        <div className="catalog-error">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {showUpload && (
        <div className="upload-form">
          <input
            type="text"
            placeholder="Eye name (e.g., 'Greek Serene Left')"
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
          />
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setUploadFile(e.target.files[0])}
          />
          <input
            type="text"
            placeholder="Tags (e.g., 'greek,serene,left')"
            value={uploadTags}
            onChange={(e) => setUploadTags(e.target.value)}
          />
          <button
            className="upload-btn"
            onClick={handleUpload}
            disabled={isUploading || !uploadFile || !uploadName.trim()}
          >
            {isUploading ? 'Uploading...' : 'Upload Eye'}
          </button>
        </div>
      )}

      <div className="patches-grid">
        {patches.length === 0 ? (
          <div className="no-patches">
            No eyes in catalog yet. Click "+ Add Eye" to upload.
          </div>
        ) : (
          patches.map((patch) => (
            <div
              key={patch.id}
              className={`patch-item ${selectedPatch?.id === patch.id ? 'selected' : ''}`}
              onClick={() => setSelectedPatch(patch)}
            >
              <img
                src={patchesApi.getImageUrl(patch.id, true)}
                alt={patch.name}
                onError={(e) => {
                  e.target.src = patchesApi.getImageUrl(patch.id, false);
                }}
              />
              <div className="patch-info">
                <span className="patch-name">{patch.name}</span>
                {patch.tags && <span className="patch-tags">{patch.tags}</span>}
              </div>
              <button
                className="delete-patch-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(patch.id);
                }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      {selectedPatch && (
        <div className="apply-section">
          <div className="selected-preview">
            <strong>Selected:</strong> {selectedPatch.name}
          </div>
          <button
            className="apply-btn"
            onClick={handleApply}
            disabled={isProcessing || !selection}
          >
            {!selection ? 'Draw selection first' : 'Apply to Selection'}
          </button>
          <p className="apply-hint">
            Draw a rectangle/ellipse where you want to place the eye
          </p>
        </div>
      )}
    </div>
  );
};

export default EyeCatalog;
