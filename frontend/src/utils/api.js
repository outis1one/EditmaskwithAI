import axios from 'axios';

// Use relative URLs to go through nginx proxy, or use env variable for direct connection
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const projectsApi = {
  // Create a new project
  create: async (name) => {
    const response = await api.post('/projects/', { name });
    return response.data;
  },

  // List all projects
  list: async () => {
    const response = await api.get('/projects/');
    return response.data;
  },

  // Get a specific project
  get: async (projectId) => {
    const response = await api.get(`/projects/${projectId}`);
    return response.data;
  },

  // Delete a project
  delete: async (projectId) => {
    const response = await api.delete(`/projects/${projectId}`);
    return response.data;
  },

  // Upload image to project
  uploadImage: async (projectId, file) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post(`/projects/${projectId}/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // Get edits for a project
  getEdits: async (projectId) => {
    const response = await api.get(`/projects/${projectId}/edits`);
    return response.data;
  },

  // Get image URLs
  getOriginalImageUrl: (projectId) => `${API_BASE_URL}/projects/${projectId}/original`,
  getCurrentImageUrl: (projectId) => `${API_BASE_URL}/projects/${projectId}/current`,
  getEditResultUrl: (projectId, editId) => `${API_BASE_URL}/projects/${projectId}/history/${editId}/result`,
};

export const editsApi = {
  // Create a new edit (Fix button)
  create: async (projectId, editData) => {
    const response = await api.post(`/edits/projects/${projectId}/fix`, editData);
    return response.data;
  },

  // Get edit status
  get: async (editId) => {
    const response = await api.get(`/edits/${editId}`);
    return response.data;
  },

  // Revert to a specific edit
  revert: async (projectId, editId) => {
    const response = await api.post(`/edits/projects/${projectId}/revert/${editId}`);
    return response.data;
  },

  // Reset to original
  reset: async (projectId) => {
    const response = await api.post(`/edits/projects/${projectId}/reset`);
    return response.data;
  },
};

export default api;
