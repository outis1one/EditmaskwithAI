/**
 * API Service for communicating with the FastAPI backend
 * Handles SAM selection and AI inpainting requests
 */

class ApiService {
    constructor() {
        // Backend API base URL
        // In unified container: empty string (same origin)
        // With separate nginx frontend: '/api' (proxied to backend)
        this.baseUrl = window.API_BASE_URL || '';
    }

    /**
     * Call SAM (Segment Anything Model) for smart selection
     * @param {string} imageData - Base64 encoded image data
     * @param {number} pointX - X coordinate of click point
     * @param {number} pointY - Y coordinate of click point
     * @returns {Promise<{mask: ImageData, polygon: Array}>}
     */
    async smartSelect(imageData, pointX, pointY) {
        const response = await fetch(`${this.baseUrl}/tools/smart-select-base64`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                image: imageData,
                point_x: pointX,
                point_y: pointY,
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(error.detail || `SAM request failed: ${response.status}`);
        }

        return response.json();
    }

    /**
     * Call AI inpainting to edit a selected region
     * @param {string} imageData - Base64 encoded image data
     * @param {string} maskData - Base64 encoded mask data (white = area to edit)
     * @param {string} prompt - Text prompt describing desired edit
     * @param {Object} options - Additional options
     * @returns {Promise<{result: string}>} - Base64 encoded result image
     */
    async inpaint(imageData, maskData, prompt, options = {}) {
        const response = await fetch(`${this.baseUrl}/tools/inpaint`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                image: imageData,
                mask: maskData,
                prompt: prompt,
                negative_prompt: options.negativePrompt || '',
                strength: options.strength || 0.8,
                guidance_scale: options.guidanceScale || 7.5,
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(error.detail || `Inpaint request failed: ${response.status}`);
        }

        return response.json();
    }

    /**
     * Remove background from image using AI (rembg)
     * @param {string} imageData - Base64 encoded image data
     * @returns {Promise<{result: string, width: number, height: number}>} - Base64 encoded result with transparency
     */
    async removeBackground(imageData) {
        const response = await fetch(`${this.baseUrl}/tools/remove-background-base64`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                image: imageData,
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(error.detail || `Remove background request failed: ${response.status}`);
        }

        return response.json();
    }

    /**
     * Health check for the backend
     * @returns {Promise<boolean>}
     */
    async healthCheck() {
        try {
            const response = await fetch(`${this.baseUrl}/health`);
            return response.ok;
        } catch {
            return false;
        }
    }
}

// Singleton instance
const apiService = new ApiService();
export default apiService;
