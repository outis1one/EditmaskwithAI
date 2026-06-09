/**
 * Upscale — increase image resolution.
 * Fetches available methods from /api/print/upscale/available on first open.
 * Auto-selects the recommended method; user can override.
 *
 * Methods (in priority order, server picks best):
 *   auto               — server picks best available
 *   realesrgan_pytorch — Real-ESRGAN via PyTorch (CUDA > MPS > CPU)
 *   realesrgan_ncnn    — Real-ESRGAN NCNN Vulkan binary (any GPU)
 *   lanczos            — always available, instant
 *
 * Menu target: image/upscale.upscale
 */

import app from './../../app.js';
import config from './../../config.js';
import Base_layers_class from './../../core/base-layers.js';
import Dialog_class from './../../libs/popup.js';
import alertify from './../../../../node_modules/alertifyjs/build/alertify.min.js';

var instance = null;

// Method display labels
const METHOD_LABELS = {
    auto:                'Auto (best available)',
    realesrgan_pytorch:  'Real-ESRGAN — PyTorch',
    realesrgan_ncnn:     'Real-ESRGAN — NCNN Vulkan',
    lanczos:             'Lanczos (fast, no AI)',
};

class Image_upscale_class {

    constructor() {
        if (instance) return instance;
        instance = this;
        this.Base_layers = new Base_layers_class();
        this.Dialog = new Dialog_class();
        this.isProcessing = false;
        this._caps = null;
    }

    async upscale() {
        if (!config.layer || config.layer.type !== 'image') {
            alertify.error('Select an image layer first.');
            return;
        }

        var caps = await this._fetchCaps();
        var W = config.layer.width_original;
        var H = config.layer.height_original;

        // Build method selector — only show what's available + auto
        var available = ['auto', ...caps.methods];
        var methodValues = [...new Set(available)]; // dedupe

        // Label each option, mark recommended
        var methodLabels = methodValues.map(m => {
            var label = METHOD_LABELS[m] || m;
            if (m === 'auto') {
                label = `Auto → ${caps.recommended_label}`;
            } else if (m === caps.recommended && m !== 'auto') {
                label += ' ★';
            }
            return label;
        });

        // Annotate with device info
        var deviceNote = '';
        if (caps.realesrgan_pytorch) {
            var dev = caps.realesrgan_pytorch_device;
            var devLabel = dev === 'cuda' ? 'CUDA GPU'
                         : dev === 'mps'  ? 'Apple Silicon'
                         : 'CPU (slow — ~1–3 min for large images)';
            deviceNote += `PyTorch: ${devLabel}. `;
        }
        if (caps.realesrgan_ncnn) {
            deviceNote += 'NCNN Vulkan binary found. ';
        }
        if (!caps.realesrgan_pytorch && !caps.realesrgan_ncnn) {
            deviceNote = 'No AI upscaler detected — Lanczos only. ' +
                'Install Real-ESRGAN for AI quality (see docs).';
        }

        var _this = this;

        this.Dialog.show({
            title: 'Upscale Image',
            params: [
                {
                    title: '',
                    html: `<div style="font-size:11px;color:#888;margin:0 0 8px;">
                        Current: ${W}×${H}px<br>
                        ${deviceNote}
                    </div>`,
                },
                {
                    name: 'scale',
                    title: 'Scale factor:',
                    value: '2×',
                    values: ['1.5×', '2×', '3×', '4×'],
                    type: 'select',
                },
                {
                    name: 'method',
                    title: 'Method:',
                    value: methodLabels[0],   // auto
                    values: methodLabels,
                    type: 'select',
                },
                {
                    name: 'new_layer',
                    title: 'Result as new layer (keep original):',
                    value: false,
                },
            ],
            on_finish: async function (params) {
                // Map label back to method key
                var labelIdx = methodLabels.indexOf(params.method);
                var methodKey = labelIdx >= 0 ? methodValues[labelIdx] : 'auto';
                var scale = parseFloat(params.scale);
                await _this._run(scale, methodKey, params.new_layer);
            },
        });
    }

    async _fetchCaps() {
        if (this._caps) return this._caps;
        try {
            var base = window.API_BASE_URL || '';
            var r = await fetch(`${base}/api/print/upscale/available`);
            if (r.ok) {
                this._caps = await r.json();
            }
        } catch { /* ignore */ }

        // Safe default if fetch failed
        if (!this._caps) {
            this._caps = {
                lanczos: true,
                realesrgan_pytorch: false,
                realesrgan_ncnn: false,
                recommended: 'lanczos',
                recommended_label: 'Lanczos',
                methods: ['lanczos'],
            };
        }
        return this._caps;
    }

    async _run(scale, method, newLayer) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        var caps = this._caps || {};
        var methodLabel = method === 'auto'
            ? `Auto (${caps.recommended_label || 'best available'})`
            : (METHOD_LABELS[method] || method);

        alertify.message(`Upscaling ${scale}× · ${methodLabel}...`, 0);

        try {
            var layerCanvas = document.createElement('canvas');
            layerCanvas.width  = config.layer.width_original;
            layerCanvas.height = config.layer.height_original;
            layerCanvas.getContext('2d').drawImage(config.layer.link, 0, 0);
            var imageB64 = layerCanvas.toDataURL('image/png').split(',')[1];

            var base = window.API_BASE_URL || '';
            var r = await fetch(`${base}/api/print/upscale`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: imageB64, scale, method }),
            });

            if (!r.ok) {
                var err = await r.json().catch(() => ({ detail: 'Server error' }));
                throw new Error(err.detail || 'Upscale failed');
            }
            var result = await r.json();

            var img = new Image();
            img.onload = () => {
                var resultCanvas = document.createElement('canvas');
                resultCanvas.width  = img.naturalWidth;
                resultCanvas.height = img.naturalHeight;
                resultCanvas.getContext('2d').drawImage(img, 0, 0);

                // Human-readable method label for undo history
                var usedLabel = result.method.replace('realesrgan_pytorch_', 'ESRGAN/')
                                             .replace('realesrgan_ncnn', 'ESRGAN/NCNN');

                if (newLayer) {
                    app.State.do_action(
                        new app.Actions.Bundle_action('upscale_layer', 'Upscale', [
                            new app.Actions.Insert_layer_action({
                                name: `${scale}× ${usedLabel}`,
                                type: 'image',
                                data: img.src,
                                x: 0, y: 0,
                                width: img.naturalWidth,
                                height: img.naturalHeight,
                                width_original: img.naturalWidth,
                                height_original: img.naturalHeight,
                            })
                        ])
                    );
                } else {
                    app.State.do_action(
                        new app.Actions.Bundle_action('upscale', 'Upscale', [
                            new app.Actions.Update_layer_image_action(resultCanvas)
                        ])
                    );
                }

                alertify.dismissAll();
                alertify.success(
                    `${result.output.width}×${result.output.height}px · ${usedLabel}`
                );
                this.isProcessing = false;
            };
            img.onerror = () => {
                alertify.dismissAll();
                alertify.error('Failed to load upscaled image.');
                this.isProcessing = false;
            };
            img.src = 'data:image/png;base64,' + result.result;

        } catch (err) {
            alertify.dismissAll();
            alertify.error('Upscale failed: ' + (err.message || err));
            this.isProcessing = false;
        }
    }
}

export default Image_upscale_class;
