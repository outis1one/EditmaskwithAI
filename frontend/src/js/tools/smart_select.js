/**
 * Smart Select Tool - Uses SAM (Segment Anything Model) for AI-powered selection
 * Click on any object to automatically select it
 */

import app from './../app.js';
import config from './../config.js';
import Base_tools_class from './../core/base-tools.js';
import Base_layers_class from './../core/base-layers.js';
import Helper_class from './../libs/helpers.js';
import Dialog_class from './../libs/popup.js';
import alertify from './../../../node_modules/alertifyjs/build/alertify.min.js';
import apiService from './../services/api.js';

class Smart_select_class extends Base_tools_class {

    constructor(ctx) {
        super();
        this.Base_layers = new Base_layers_class();
        this.Helper = new Helper_class();
        this.POP = new Dialog_class();
        this.ctx = ctx;
        this.name = 'smart_select';

        // Store the current mask data
        this.currentMask = null;
        this.maskCanvas = null;
        this.isProcessing = false;
        this.selectionBounds = null;
    }

    load() {
        var _this = this;

        // Mouse click event for selection
        document.addEventListener('mousedown', function (e) {
            _this.mousedown(e);
        });
    }

    async mousedown(e) {
        var mouse = this.get_mouse_info(e);

        if (config.TOOL.name != this.name) return;
        if (mouse.click_valid == false) return;
        if (this.isProcessing) {
            alertify.warning('Processing... please wait');
            return;
        }

        // Check if we have an image layer
        if (config.layer.type != 'image') {
            alertify.error('Please select an image layer first');
            return;
        }

        // Get click coordinates relative to the image
        var x = mouse.x - config.layer.x;
        var y = mouse.y - config.layer.y;

        // Adjust for layer scaling
        if (config.layer.width != config.layer.width_original) {
            x = x * (config.layer.width_original / config.layer.width);
        }
        if (config.layer.height != config.layer.height_original) {
            y = y * (config.layer.height_original / config.layer.height);
        }

        // Make sure click is within image bounds
        if (x < 0 || y < 0 || x > config.layer.width_original || y > config.layer.height_original) {
            alertify.error('Click inside the image');
            return;
        }

        this.isProcessing = true;
        alertify.message('AI is analyzing the image...');

        try {
            // Get image data as base64
            var imageData = this.getLayerImageData();

            // Call SAM API
            var result = await apiService.smartSelect(imageData, Math.round(x), Math.round(y));

            // Apply the mask as selection
            this.applyMask(result.mask, result.bbox);

            alertify.success('Selection complete! Use AI Inpaint to edit.');

        } catch (error) {
            console.error('Smart select error:', error);
            alertify.error('Selection failed: ' + error.message);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Get the current layer's image data as base64
     */
    getLayerImageData() {
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        canvas.width = config.layer.width_original;
        canvas.height = config.layer.height_original;

        // Draw the layer's image
        ctx.drawImage(config.layer.link, 0, 0);

        // Return as base64 (remove data:image/png;base64, prefix)
        return canvas.toDataURL('image/png').split(',')[1];
    }

    /**
     * Apply the SAM mask as a selection
     * @param {string} maskBase64 - Base64 encoded mask image
     * @param {Object} bbox - Bounding box {x, y, width, height}
     */
    applyMask(maskBase64, bbox) {
        var _this = this;

        // Create mask image
        var maskImage = new Image();
        maskImage.onload = function() {
            // Store mask for later use by inpaint tool
            _this.maskCanvas = document.createElement('canvas');
            _this.maskCanvas.width = config.layer.width_original;
            _this.maskCanvas.height = config.layer.height_original;
            var maskCtx = _this.maskCanvas.getContext('2d');
            maskCtx.drawImage(maskImage, 0, 0);

            _this.currentMask = {
                canvas: _this.maskCanvas,
                bbox: bbox
            };

            // Store globally for AI inpaint tool to access
            window.smartSelectMask = _this.currentMask;

            // Calculate selection bounds from mask
            _this.calculateSelectionBounds();

            // Trigger re-render
            config.need_render = true;
            _this.Base_layers.render();
        };
        maskImage.src = 'data:image/png;base64,' + maskBase64;
    }

    /**
     * Calculate the bounding box of the selection from the mask
     */
    calculateSelectionBounds() {
        if (!this.maskCanvas) return;

        var maskCtx = this.maskCanvas.getContext('2d');
        var imageData = maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);

        // Find bounding box of selection
        var minX = this.maskCanvas.width, minY = this.maskCanvas.height;
        var maxX = 0, maxY = 0;
        var hasSelection = false;

        for (var y = 0; y < this.maskCanvas.height; y++) {
            for (var x = 0; x < this.maskCanvas.width; x++) {
                var i = (y * this.maskCanvas.width + x) * 4;
                if (imageData.data[i] > 128) { // White pixel in mask
                    hasSelection = true;
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            }
        }

        if (hasSelection && maxX > minX && maxY > minY) {
            // Scale to current layer dimensions
            var scaleX = config.layer.width / config.layer.width_original;
            var scaleY = config.layer.height / config.layer.height_original;

            this.selectionBounds = {
                x: config.layer.x + minX * scaleX,
                y: config.layer.y + minY * scaleY,
                width: (maxX - minX) * scaleX,
                height: (maxY - minY) * scaleY
            };
        }
    }

    /**
     * Render overlay - called by miniPaint's rendering system
     */
    render_overlay(ctx) {
        if (!this.currentMask || !this.maskCanvas) return;

        // Draw semi-transparent overlay on non-selected areas
        ctx.save();

        // Scale to match layer
        var scaleX = config.layer.width / config.layer.width_original;
        var scaleY = config.layer.height / config.layer.height_original;

        // Create inverse mask canvas (darkens unselected areas)
        var inverseCanvas = document.createElement('canvas');
        inverseCanvas.width = this.maskCanvas.width;
        inverseCanvas.height = this.maskCanvas.height;
        var inverseCtx = inverseCanvas.getContext('2d');

        // Fill with semi-transparent black
        inverseCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        inverseCtx.fillRect(0, 0, inverseCanvas.width, inverseCanvas.height);

        // Cut out the selected area
        inverseCtx.globalCompositeOperation = 'destination-out';
        inverseCtx.drawImage(this.maskCanvas, 0, 0);

        // Draw the overlay on the main canvas
        ctx.drawImage(
            inverseCanvas,
            config.layer.x, config.layer.y,
            config.layer.width, config.layer.height
        );

        // Draw marching ants border around selection
        if (this.selectionBounds) {
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(
                this.selectionBounds.x,
                this.selectionBounds.y,
                this.selectionBounds.width,
                this.selectionBounds.height
            );
        }

        ctx.restore();
    }

    /**
     * Clear the current selection
     */
    clearSelection() {
        this.currentMask = null;
        this.maskCanvas = null;
        this.selectionBounds = null;
        window.smartSelectMask = null;
        config.need_render = true;
    }

    on_leave() {
        // Don't clear mask when switching tools - AI inpaint needs it
        return [];
    }
}

export default Smart_select_class;
