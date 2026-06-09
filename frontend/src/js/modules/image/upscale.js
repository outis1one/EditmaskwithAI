/**
 * Upscale — increase image resolution.
 *
 * Lanczos: always available, fast, good for clean/sharp images.
 * AI (Real-ESRGAN): much better for photos — restores texture, sharpness.
 *   Requires `realesrgan-ncnn-vulkan` or `basicsr` + `realesrgan` Python packages.
 *
 * Menu target: image/upscale.upscale
 */

import app from './../../app.js';
import config from './../../config.js';
import Base_layers_class from './../../core/base-layers.js';
import Dialog_class from './../../libs/popup.js';
import alertify from './../../../../node_modules/alertifyjs/build/alertify.min.js';

var instance = null;

class Image_upscale_class {

    constructor() {
        if (instance) return instance;
        instance = this;
        this.Base_layers = new Base_layers_class();
        this.Dialog = new Dialog_class();
        this.isProcessing = false;
        this._aiAvailable = null;
    }

    async upscale() {
        if (!config.layer || config.layer.type !== 'image') {
            alertify.error('Select an image layer first.');
            return;
        }

        var W = config.layer.width_original;
        var H = config.layer.height_original;

        // Check AI availability once, cache it
        if (this._aiAvailable === null) {
            try {
                var base = window.API_BASE_URL || '';
                var r = await fetch(`${base}/api/print/upscale/available`);
                var data = r.ok ? await r.json() : {};
                this._aiAvailable = data.realesrgan || false;
            } catch {
                this._aiAvailable = false;
            }
        }

        var aiNote = this._aiAvailable
            ? 'Real-ESRGAN AI upscaling available.'
            : 'AI upscaling not installed (Real-ESRGAN). Using Lanczos only.';

        var _this = this;

        this.Dialog.show({
            title: 'Upscale Image',
            params: [
                {
                    title: '',
                    html: `<div style="font-size:11px;color:#888;margin:0 0 8px;">
                        Current size: ${W}×${H}px<br>${aiNote}
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
                    value: this._aiAvailable ? 'ai' : 'lanczos',
                    values: this._aiAvailable ? ['lanczos', 'ai'] : ['lanczos'],
                    type: 'select',
                },
                {
                    name: 'new_layer',
                    title: 'Result as new layer (keep original):',
                    value: false,
                },
            ],
            on_finish: async function (params) {
                var scale = parseFloat(params.scale);
                var newW = Math.round(W * scale);
                var newH = Math.round(H * scale);
                await _this._run(scale, params.method, params.new_layer, newW, newH);
            },
        });
    }

    async _run(scale, method, newLayer, newW, newH) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        alertify.message(
            `Upscaling ${scale}× with ${method}... please wait`, 0
        );

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
                body: JSON.stringify({
                    image: imageB64,
                    scale: scale,
                    method: method,
                }),
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

                if (newLayer) {
                    app.State.do_action(
                        new app.Actions.Bundle_action('upscale_layer', 'Upscale', [
                            new app.Actions.Insert_layer_action({
                                name: `${scale}× upscale (${result.method})`,
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
                    `Upscaled to ${result.output.width}×${result.output.height}px` +
                    ` (${result.method})`
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
