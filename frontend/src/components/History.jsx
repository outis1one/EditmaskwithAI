import React from 'react';
import './History.css';

const History = ({ edits, onRevert, onReset, isProcessing }) => {
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return '#00aa00';
      case 'processing':
        return '#ffaa00';
      case 'failed':
        return '#ff0000';
      default:
        return '#666';
    }
  };

  return (
    <div className="history">
      <div className="history-header">
        <h3>Edit History</h3>
        {edits.length > 0 && (
          <button
            className="reset-btn"
            onClick={onReset}
            disabled={isProcessing}
          >
            Reset to Original
          </button>
        )}
      </div>

      {edits.length === 0 ? (
        <p className="empty-message">No edits yet</p>
      ) : (
        <div className="history-list">
          {edits.map((edit) => (
            <div key={edit.id} className="history-item">
              <div className="edit-info">
                <div className="edit-header">
                  <span className="edit-id">Edit #{edit.id}</span>
                  <span
                    className="edit-status"
                    style={{ color: getStatusColor(edit.status) }}
                  >
                    {edit.status}
                  </span>
                </div>
                <p className="edit-prompt">{edit.prompt}</p>
                <div className="edit-details">
                  <span className="edit-mode">Mode {edit.mode}</span>
                  <span className="edit-type">{edit.selection_type}</span>
                  <span className="edit-feather">Feather: {edit.feather_px}px</span>
                </div>
                <p className="edit-date">{formatDate(edit.created_at)}</p>
              </div>
              {edit.status === 'completed' && (
                <button
                  className="revert-btn"
                  onClick={() => onRevert(edit.id)}
                  disabled={isProcessing}
                >
                  Revert to This
                </button>
              )}
              {edit.error_message && (
                <p className="error-message">{edit.error_message}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default History;
