/**
 * Text → Image — opens a sidebar-style dialog, generates via remote provider,
 * pastes result as a new layer on the current canvas.
 *
 * Menu target: generate/text_to_image.text_to_image
 */

import app from './../../app.js';
import config from './../../config.js';
import Base_layers_class from './../../core/base-layers.js';
import Dialog_class from './../../libs/popup.js';
import alertify from './../../../../node_modules/alertifyjs/build/alertify.min.js';
import apiService from './../../services/api.js';
import { getCapabilities } from './../../api/capabilities.js';

var instance = null;

class Generate_text_to_image_class {

    constructor() {
        if (instance) return instance;
        instance = this;
        this.Base_layers = new Base_layers_class();
        this.Dialog = new Dialog_class();
        this.isProcessing = false;
    }

    async text_to_image() {
        var caps = await getCapabilities();
        if (!caps.remote || !caps.remote.healthy) {
            alertify.error(
                'Text → Image requires a remote AI provider. ' +
                'Set AI_PROVIDER (openai / invokeai / comfyui) in .env and restart.'
            );
            return;
        }

        var _this = this;
        var canvasW = config.WIDTH  || 1024;
        var canvasH = config.HEIGHT || 1024;

        this.Dialog.show({
            title: 'Text → Image',
            params: [
                {
                    name: 'prompt',
                    title: 'Describe your image:',
                    type: 'textarea',
                    value: '',
                    placeholder: "e.g. 'a serene mountain lake at sunset, cinematic lighting'",
                },
                {
                    name: 'negative_prompt',
                    title: 'Avoid (optional):',
                    value: '',
                    placeholder: 'blurry, distorted, watermark',
                },
                {
                    name: 'width',
                    title: 'Width (px):',
                    value: Math.min(canvasW, 1024),
                    range: [256, 2048],
                    step: 64,
                    type: 'range',
                },
                {
                    name: 'height',
                    title: 'Height (px):',
                    value: Math.min(canvasH, 1024),
                    range: [256, 2048],
                    step: 64,
                    type: 'range',
                },
                {
                    name: 'placement',
                    title: 'Add as:',
                    value: 'new_layer',
                    values: ['new_layer', 'replace_canvas'],
                },
                {
                    name: 'steps',
                    title: 'Steps:',
                    type: 'range',
                    value: 30,
                    range: [10, 60],
                    step: 5,
                },
                {
                    name: 'seed',
                    title: 'Seed (0 = random):',
                    value: 0,
                    range: [0, 2147483647],
                    step: 1,
                    type: 'range',
                },
            ],
            on_finish: async function (params) {
                if (!params.prompt || !params.prompt.trim()) {
                    alertify.warning('Please enter a description.');
                    return;
                }
                await _this._generate(params);
            },
        });
    }

    async _generate(params) {
        if (this.isProcessing) return;
        this.isProcessing = true;
        alertify.message('Generating image... please wait', 0);

        try {
            var result = await apiService.textToImage(params.prompt, {
                width: params.width || 1024,
                height: params.height || 1024,
                negativePrompt: params.negative_prompt || '',
                steps: params.steps || 30,
                seed: params.seed || 0,
            });

            var img = new Image();
            img.onload = () => {
                if (params.placement === 'replace_canvas') {
                    // Resize canvas and replace bottom layer
                    config.WIDTH  = img.naturalWidth;
                    config.HEIGHT = img.naturalHeight;
                    var resultCanvas = document.createElement('canvas');
                    resultCanvas.width  = img.naturalWidth;
                    resultCanvas.height = img.naturalHeight;
                    resultCanvas.getContext('2d').drawImage(img, 0, 0);
                    app.State.do_action(
                        new app.Actions.Bundle_action('txt2img_replace', 'Text → Image', [
                            new app.Actions.Update_layer_image_action(resultCanvas)
                        ])
                    );
                } else {
                    // Add as new layer on top
                    var dataURL = img.src;
                    app.State.do_action(
                        new app.Actions.Bundle_action('txt2img_layer', 'Text → Image Layer', [
                            new app.Actions.Insert_layer_action({
                                name: params.prompt.slice(0, 30),
                                type: 'image',
                                data: dataURL,
                                x: 0,
                                y: 0,
                                width: img.naturalWidth,
                                height: img.naturalHeight,
                                width_original: img.naturalWidth,
                                height_original: img.naturalHeight,
                            })
                        ])
                    );
                }
                alertify.dismissAll();
                alertify.success('Image generated!');
                this.isProcessing = false;
            };
            img.onerror = () => {
                alertify.dismissAll();
                alertify.error('Failed to load generated image.');
                this.isProcessing = false;
            };
            img.src = 'data:image/png;base64,' + result.result;

        } catch (err) {
            alertify.dismissAll();
            alertify.error('Generation failed: ' + (err.message || err));
            this.isProcessing = false;
        }
    }
}

export default Generate_text_to_image_class;
