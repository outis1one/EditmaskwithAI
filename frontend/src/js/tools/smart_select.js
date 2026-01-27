/**
 * Smart Select Tool - Uses SAM (Segment Anything Model) for AI-powered selection
 * Click on any object to automatically select it
 * Supports: Copy to layer, Cut to layer, Delete selection, AI Inpaint
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

        // Marching ants animation
        this.marchingAntsOffset = 0;
        this.animationFrame = null;

        // Contour path for drawing the mask outline
        this.contourPath = null;
    }

    load() {
        var _this = this;

        // Mouse click event for selection
        document.addEventListener('mousedown', function (e) {
            _this.mousedown(e);
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', function(e) {
            if (config.TOOL.name != _this.name) return;
            if (_this.Helper.is_input(e.target)) return;

            var code = e.keyCode;

            // Delete - delete selected area
            if (code == 46 && _this.currentMask) {
                e.preventDefault();
                _this.deleteSelection();
            }
            // Escape - clear selection
            if (code == 27 && _this.currentMask) {
                e.preventDefault();
                _this.clearSelection();
            }
            // Ctrl+C - copy to new layer
            if (code == 67 && (e.ctrlKey || e.metaKey) && _this.currentMask) {
                e.preventDefault();
                _this.copyToLayer();
            }
            // Ctrl+X - cut to new layer
            if (code == 88 && (e.ctrlKey || e.metaKey) && _this.currentMask) {
                e.preventDefault();
                _this.cutToLayer();
            }
        });

        // Start marching ants animation
        this.startMarchingAnts();
    }

    startMarchingAnts() {
        var _this = this;

        var animate = function() {
            _this.marchingAntsOffset++;
            if (_this.marchingAntsOffset > 16) {
                _this.marchingAntsOffset = 0;
            }
            if (_this.currentMask) {
                config.need_render = true;
            }
            _this.animationFrame = requestAnimationFrame(animate);
        };

        // Slower animation - every 100ms
        setInterval(function() {
            if (_this.currentMask) {
                _this.marchingAntsOffset++;
                if (_this.marchingAntsOffset > 16) {
                    _this.marchingAntsOffset = 0;
                }
                config.need_render = true;
            }
        }, 100);
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

            alertify.success('Selection complete! Use Ctrl+C to copy, Ctrl+X to cut, Delete to remove, or AI Inpaint to edit.');

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

            // Extract contour path from the mask
            _this.extractContourPath();

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
                height: (maxY - minY) * scaleY,
                // Store original coordinates too
                origMinX: minX,
                origMinY: minY,
                origMaxX: maxX,
                origMaxY: maxY
            };
        }
    }

    /**
     * Extract contour points from the mask for drawing the outline
     * Uses a simple edge detection approach
     */
    extractContourPath() {
        if (!this.maskCanvas) return;

        var maskCtx = this.maskCanvas.getContext('2d');
        var imageData = maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        var width = this.maskCanvas.width;
        var height = this.maskCanvas.height;
        var data = imageData.data;

        // Create edge canvas - pixels that are on the edge of the mask
        this.edgeCanvas = document.createElement('canvas');
        this.edgeCanvas.width = width;
        this.edgeCanvas.height = height;
        var edgeCtx = this.edgeCanvas.getContext('2d');
        var edgeImageData = edgeCtx.createImageData(width, height);
        var edgeData = edgeImageData.data;

        // Find edge pixels (mask pixels adjacent to non-mask pixels)
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var i = (y * width + x) * 4;
                var isMask = data[i] > 128;

                if (isMask) {
                    // Check if any neighbor is NOT mask (edge pixel)
                    var isEdge = false;

                    // Check 4-connected neighbors
                    if (x > 0 && data[i - 4] <= 128) isEdge = true;
                    if (x < width - 1 && data[i + 4] <= 128) isEdge = true;
                    if (y > 0 && data[i - width * 4] <= 128) isEdge = true;
                    if (y < height - 1 && data[i + width * 4] <= 128) isEdge = true;

                    // Also check boundary
                    if (x == 0 || x == width - 1 || y == 0 || y == height - 1) isEdge = true;

                    if (isEdge) {
                        edgeData[i] = 255;
                        edgeData[i + 1] = 255;
                        edgeData[i + 2] = 255;
                        edgeData[i + 3] = 255;
                    }
                }
            }
        }

        edgeCtx.putImageData(edgeImageData, 0, 0);
    }

    /**
     * Render overlay - called by miniPaint's rendering system
     * Shows the mask with marching ants outline
     */
    render_overlay(ctx) {
        if (!this.currentMask || !this.maskCanvas) return;

        ctx.save();

        // Scale to match layer
        var scaleX = config.layer.width / config.layer.width_original;
        var scaleY = config.layer.height / config.layer.height_original;

        // Draw semi-transparent overlay on non-selected areas
        var inverseCanvas = document.createElement('canvas');
        inverseCanvas.width = this.maskCanvas.width;
        inverseCanvas.height = this.maskCanvas.height;
        var inverseCtx = inverseCanvas.getContext('2d');

        // Fill with semi-transparent black
        inverseCtx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        inverseCtx.fillRect(0, 0, inverseCanvas.width, inverseCanvas.height);

        // Cut out the selected area (so selected area is NOT darkened)
        inverseCtx.globalCompositeOperation = 'destination-out';
        inverseCtx.drawImage(this.maskCanvas, 0, 0);

        // Draw the overlay on the main canvas
        ctx.drawImage(
            inverseCanvas,
            config.layer.x, config.layer.y,
            config.layer.width, config.layer.height
        );

        // Draw marching ants border around the actual mask contour
        if (this.edgeCanvas) {
            // Create a canvas for marching ants effect
            var antsCanvas = document.createElement('canvas');
            antsCanvas.width = this.maskCanvas.width;
            antsCanvas.height = this.maskCanvas.height;
            var antsCtx = antsCanvas.getContext('2d');

            // Draw the edge in white (visible part of marching ants)
            antsCtx.drawImage(this.edgeCanvas, 0, 0);

            // Apply marching ants pattern using composite
            antsCtx.globalCompositeOperation = 'source-in';

            // Create marching ants pattern (alternating black and white)
            var pattern = antsCtx.createLinearGradient(0, 0, 16, 16);
            var offset = this.marchingAntsOffset / 16;

            // Create dashed pattern
            for (var i = 0; i < 2; i++) {
                var pos1 = ((i * 0.5) + offset) % 1;
                var pos2 = ((i * 0.5 + 0.25) + offset) % 1;

                if (pos1 < pos2) {
                    pattern.addColorStop(pos1, '#00ff00');
                    pattern.addColorStop(pos2, '#00ff00');
                }
            }

            antsCtx.fillStyle = '#00ff00';
            antsCtx.fillRect(0, 0, antsCanvas.width, antsCanvas.height);

            // Draw the marching ants outline
            ctx.drawImage(
                antsCanvas,
                config.layer.x, config.layer.y,
                config.layer.width, config.layer.height
            );

            // Also draw a second pass with offset for alternating colors
            var antsCanvas2 = document.createElement('canvas');
            antsCanvas2.width = this.maskCanvas.width;
            antsCanvas2.height = this.maskCanvas.height;
            var antsCtx2 = antsCanvas2.getContext('2d');

            // Dilate the edge slightly for the black outline
            antsCtx2.drawImage(this.edgeCanvas, 0, 0);
            antsCtx2.globalCompositeOperation = 'source-in';

            // Alternate pattern
            antsCtx2.fillStyle = ((Math.floor(this.marchingAntsOffset / 4) % 2) === 0) ? '#ffffff' : '#000000';
            antsCtx2.fillRect(0, 0, antsCanvas2.width, antsCanvas2.height);
        }

        ctx.restore();
    }

    /**
     * Copy selected area to a new layer
     */
    copyToLayer() {
        if (!this.currentMask || !this.maskCanvas) {
            alertify.error('No selection to copy');
            return;
        }

        var layer = config.layer;
        if (layer.type != 'image') {
            alertify.error('Layer must be an image');
            return;
        }

        // Create canvas with just the selected pixels
        var canvas = document.createElement('canvas');
        canvas.width = layer.width_original;
        canvas.height = layer.height_original;
        var ctx = canvas.getContext('2d');

        // Draw original image
        ctx.drawImage(layer.link, 0, 0);

        // Apply mask - keep only selected pixels
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(this.maskCanvas, 0, 0);

        // Get the bounds of the selection to crop the canvas
        var bounds = this.selectionBounds;
        if (!bounds) {
            alertify.error('Invalid selection bounds');
            return;
        }

        // Crop to selection bounds
        var croppedCanvas = document.createElement('canvas');
        var cropWidth = bounds.origMaxX - bounds.origMinX;
        var cropHeight = bounds.origMaxY - bounds.origMinY;
        croppedCanvas.width = cropWidth;
        croppedCanvas.height = cropHeight;
        var croppedCtx = croppedCanvas.getContext('2d');

        croppedCtx.drawImage(
            canvas,
            bounds.origMinX, bounds.origMinY, cropWidth, cropHeight,
            0, 0, cropWidth, cropHeight
        );

        // Calculate position for new layer
        var scaleX = layer.width / layer.width_original;
        var scaleY = layer.height / layer.height_original;

        // Create new layer with the selection
        var params = {
            x: Math.round(layer.x + bounds.origMinX * scaleX),
            y: Math.round(layer.y + bounds.origMinY * scaleY),
            width: Math.round(cropWidth * scaleX),
            height: Math.round(cropHeight * scaleY),
            width_original: cropWidth,
            height_original: cropHeight,
            type: 'image',
            name: 'AI Selection Copy',
            data: croppedCanvas.toDataURL('image/png')
        };

        app.State.do_action(
            new app.Actions.Bundle_action('copy_selection_to_layer', 'Copy Selection to Layer', [
                new app.Actions.Insert_layer_action(params, false)
            ])
        );

        alertify.success('Selection copied to new layer!');
    }

    /**
     * Cut selected area to a new layer (copy + delete from original)
     */
    cutToLayer() {
        if (!this.currentMask || !this.maskCanvas) {
            alertify.error('No selection to cut');
            return;
        }

        var layer = config.layer;
        if (layer.type != 'image') {
            alertify.error('Layer must be an image');
            return;
        }

        // First copy to new layer
        var canvas = document.createElement('canvas');
        canvas.width = layer.width_original;
        canvas.height = layer.height_original;
        var ctx = canvas.getContext('2d');

        // Draw original image
        ctx.drawImage(layer.link, 0, 0);

        // Apply mask - keep only selected pixels
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(this.maskCanvas, 0, 0);

        // Get the bounds of the selection
        var bounds = this.selectionBounds;
        if (!bounds) {
            alertify.error('Invalid selection bounds');
            return;
        }

        // Crop to selection bounds
        var croppedCanvas = document.createElement('canvas');
        var cropWidth = bounds.origMaxX - bounds.origMinX;
        var cropHeight = bounds.origMaxY - bounds.origMinY;
        croppedCanvas.width = cropWidth;
        croppedCanvas.height = cropHeight;
        var croppedCtx = croppedCanvas.getContext('2d');

        croppedCtx.drawImage(
            canvas,
            bounds.origMinX, bounds.origMinY, cropWidth, cropHeight,
            0, 0, cropWidth, cropHeight
        );

        // Calculate position for new layer
        var scaleX = layer.width / layer.width_original;
        var scaleY = layer.height / layer.height_original;

        // Create params for new layer
        var params = {
            x: Math.round(layer.x + bounds.origMinX * scaleX),
            y: Math.round(layer.y + bounds.origMinY * scaleY),
            width: Math.round(cropWidth * scaleX),
            height: Math.round(cropHeight * scaleY),
            width_original: cropWidth,
            height_original: cropHeight,
            type: 'image',
            name: 'AI Selection Cut',
            data: croppedCanvas.toDataURL('image/png')
        };

        // Now delete from original - create canvas with hole
        var holeCanvas = document.createElement('canvas');
        holeCanvas.width = layer.width_original;
        holeCanvas.height = layer.height_original;
        var holeCtx = holeCanvas.getContext('2d');

        // Draw original image
        holeCtx.drawImage(layer.link, 0, 0);

        // Cut out the mask area
        holeCtx.globalCompositeOperation = 'destination-out';
        holeCtx.drawImage(this.maskCanvas, 0, 0);

        // Execute both actions
        app.State.do_action(
            new app.Actions.Bundle_action('cut_selection_to_layer', 'Cut Selection to Layer', [
                new app.Actions.Update_layer_image_action(holeCanvas),
                new app.Actions.Insert_layer_action(params, false)
            ])
        );

        // Clear the selection
        this.clearSelection();

        alertify.success('Selection cut to new layer!');
    }

    /**
     * Delete the selected area from the image
     */
    deleteSelection() {
        if (!this.currentMask || !this.maskCanvas) {
            alertify.error('No selection to delete');
            return;
        }

        var layer = config.layer;
        if (layer.type != 'image') {
            alertify.error('Layer must be an image');
            return;
        }

        // Create canvas with hole where selection was
        var holeCanvas = document.createElement('canvas');
        holeCanvas.width = layer.width_original;
        holeCanvas.height = layer.height_original;
        var holeCtx = holeCanvas.getContext('2d');

        // Draw original image
        holeCtx.drawImage(layer.link, 0, 0);

        // Cut out the mask area
        holeCtx.globalCompositeOperation = 'destination-out';
        holeCtx.drawImage(this.maskCanvas, 0, 0);

        app.State.do_action(
            new app.Actions.Bundle_action('delete_selection', 'Delete Selection', [
                new app.Actions.Update_layer_image_action(holeCanvas)
            ])
        );

        // Clear the selection
        this.clearSelection();

        alertify.success('Selection deleted!');
    }

    /**
     * Clear the current selection
     */
    clearSelection() {
        this.currentMask = null;
        this.maskCanvas = null;
        this.edgeCanvas = null;
        this.selectionBounds = null;
        this.contourPath = null;
        window.smartSelectMask = null;
        config.need_render = true;
        this.Base_layers.render();
    }

    on_leave() {
        // Don't clear mask when switching tools - AI inpaint needs it
        return [];
    }
}

export default Smart_select_class;
