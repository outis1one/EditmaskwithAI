/**
 * AI Inpaint Tool - Edit selected regions using AI with text prompts
 * Works with Smart Select tool's mask or manual selection
 */

import app from './../app.js';
import config from './../config.js';
import Base_tools_class from './../core/base-tools.js';
import Base_layers_class from './../core/base-layers.js';
import Helper_class from './../libs/helpers.js';
import Dialog_class from './../libs/popup.js';
import alertify from './../../../node_modules/alertifyjs/build/alertify.min.js';
import apiService from './../services/api.js';

class Ai_inpaint_class extends Base_tools_class {

    constructor(ctx) {
        super();
        this.Base_layers = new Base_layers_class();
        this.Helper = new Helper_class();
        this.POP = new Dialog_class();
        this.ctx = ctx;
        this.name = 'ai_inpaint';
        this.isProcessing = false;
    }

    load() {
        // No mouse events needed - this tool uses a dialog
    }

    on_activate() {
        this.showInpaintDialog();
    }

    /**
     * Show the inpainting dialog
     */
    showInpaintDialog() {
        var _this = this;

        // Check if we have a selection
        var hasMask = window.smartSelectMask != null;
        var hasRectSelection = this.getRectSelection() != null;

        if (!hasMask && !hasRectSelection) {
            alertify.warning('No selection found. Use Smart Select or Selection tool first.');
            return;
        }

        var settings = {
            title: 'AI Inpaint',
            params: [
                {
                    name: "prompt",
                    title: "Describe what you want:",
                    type: "textarea",
                    value: "",
                    placeholder: "e.g., 'a red rose', 'remove the object', 'blue sky with clouds'"
                },
                {
                    name: "negative_prompt",
                    title: "What to avoid (optional):",
                    value: "",
                    placeholder: "e.g., 'blurry, distorted, low quality'"
                },
                {
                    name: "strength",
                    title: "Edit Strength:",
                    type: "range",
                    value: 80,
                    range: [1, 100],
                    step: 1
                }
            ],
            on_finish: async function (params) {
                await _this.executeInpaint(params);
            },
        };

        this.POP.show(settings);
    }

    /**
     * Execute the inpainting operation
     */
    async executeInpaint(params) {
        if (this.isProcessing) {
            alertify.warning('Already processing... please wait');
            return;
        }

        if (!params.prompt || params.prompt.trim() === '') {
            alertify.error('Please enter a prompt describing what you want');
            return;
        }

        // Check if we have an image layer
        if (config.layer.type != 'image') {
            alertify.error('Please select an image layer');
            return;
        }

        this.isProcessing = true;
        alertify.message('AI is generating... this may take a moment');

        try {
            // Get image data
            var imageData = this.getLayerImageData();

            // Get mask data (from Smart Select or rectangular selection)
            var maskData = this.getMaskData();

            if (!maskData) {
                throw new Error('No valid selection/mask found');
            }

            // Call inpaint API
            var result = await apiService.inpaint(
                imageData,
                maskData,
                params.prompt,
                {
                    negativePrompt: params.negative_prompt || '',
                    strength: params.strength / 100
                }
            );

            // Apply result to layer
            await this.applyResult(result.result);

            alertify.success('Inpainting complete!');

        } catch (error) {
            console.error('Inpaint error:', error);
            alertify.error('Inpainting failed: ' + error.message);
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
        ctx.drawImage(config.layer.link, 0, 0);

        return canvas.toDataURL('image/png').split(',')[1];
    }

    /**
     * Get mask data - either from Smart Select or rectangular selection
     */
    getMaskData() {
        // First try Smart Select mask
        if (window.smartSelectMask && window.smartSelectMask.canvas) {
            var maskCanvas = window.smartSelectMask.canvas;
            return maskCanvas.toDataURL('image/png').split(',')[1];
        }

        // Fall back to rectangular selection
        var selection = this.getRectSelection();
        if (selection) {
            return this.createRectMask(selection);
        }

        return null;
    }

    /**
     * Get rectangular selection from miniPaint's selection tool
     */
    getRectSelection() {
        // Try to get selection from selection tool
        var Selection = null;
        try {
            var GUI_tools = app.GUI?.GUI_tools || this.Base_layers?.Base_gui?.GUI_tools;
            if (GUI_tools && GUI_tools.tools_modules && GUI_tools.tools_modules.selection) {
                Selection = GUI_tools.tools_modules.selection.object;
            }
        } catch (e) {
            // Selection tool not available
        }

        if (Selection && Selection.selection &&
            Selection.selection.width > 0 && Selection.selection.height > 0) {
            return Selection.selection;
        }

        return null;
    }

    /**
     * Create a white rectangle mask from selection coordinates
     */
    createRectMask(selection) {
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        canvas.width = config.layer.width_original;
        canvas.height = config.layer.height_original;

        // Fill with black (unselected)
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Calculate selection position relative to layer
        var x = selection.x - config.layer.x;
        var y = selection.y - config.layer.y;
        var width = selection.width;
        var height = selection.height;

        // Scale to original image size
        var scaleX = config.layer.width_original / config.layer.width;
        var scaleY = config.layer.height_original / config.layer.height;

        x = x * scaleX;
        y = y * scaleY;
        width = width * scaleX;
        height = height * scaleY;

        // Draw white rectangle (selected area)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(x, y, width, height);

        return canvas.toDataURL('image/png').split(',')[1];
    }

    /**
     * Apply the inpainted result to the current layer
     */
    async applyResult(resultBase64) {
        var _this = this;

        return new Promise((resolve, reject) => {
            var img = new Image();
            img.onload = function() {
                // Create canvas with result
                var canvas = document.createElement('canvas');
                canvas.width = config.layer.width_original;
                canvas.height = config.layer.height_original;
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                // Update layer through action system for undo support
                app.State.do_action(
                    new app.Actions.Bundle_action('ai_inpaint', 'AI Inpaint', [
                        new app.Actions.Update_layer_image_action(canvas)
                    ])
                );

                // Clear the smart select mask
                window.smartSelectMask = null;

                config.need_render = true;
                resolve();
            };
            img.onerror = function() {
                reject(new Error('Failed to load result image'));
            };
            img.src = 'data:image/png;base64,' + resultBase64;
        });
    }

    render_overlay(ctx) {
        // Show visual indicator if there's a selection ready for inpainting
        if (window.smartSelectMask && window.smartSelectMask.canvas) {
            // Draw a subtle border around the tool indicating mask is ready
            ctx.save();
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);

            var scaleX = config.layer.width / config.layer.width_original;
            var scaleY = config.layer.height / config.layer.height_original;

            // Get mask bounds
            var maskCanvas = window.smartSelectMask.canvas;
            var maskCtx = maskCanvas.getContext('2d');
            var imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);

            var minX = maskCanvas.width, minY = maskCanvas.height;
            var maxX = 0, maxY = 0;

            for (var y = 0; y < maskCanvas.height; y += 4) { // Sample every 4th pixel for speed
                for (var x = 0; x < maskCanvas.width; x += 4) {
                    var i = (y * maskCanvas.width + x) * 4;
                    if (imageData.data[i] > 128) {
                        minX = Math.min(minX, x);
                        minY = Math.min(minY, y);
                        maxX = Math.max(maxX, x);
                        maxY = Math.max(maxY, y);
                    }
                }
            }

            if (maxX > minX && maxY > minY) {
                ctx.strokeRect(
                    config.layer.x + minX * scaleX,
                    config.layer.y + minY * scaleY,
                    (maxX - minX) * scaleX,
                    (maxY - minY) * scaleY
                );
            }

            ctx.restore();
        }
    }
}

export default Ai_inpaint_class;
