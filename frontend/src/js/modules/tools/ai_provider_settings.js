/**
 * AI Provider Settings — configure remote AI provider in-app without editing .env manually.
 * Settings are persisted to localStorage and sent to the backend config endpoint.
 * Menu target: tools/ai_provider_settings.ai_provider_settings
 */

import Dialog_class from './../../libs/popup.js';
import alertify from './../../../../node_modules/alertifyjs/build/alertify.min.js';
import { getCapabilities } from './../../api/capabilities.js';

// localStorage key prefix
const LS = 'paintplus_ai_';

function ls_get(key, def = '') {
    return localStorage.getItem(LS + key) ?? def;
}
function ls_set(key, val) {
    localStorage.setItem(LS + key, val);
}

var instance = null;

class Tools_ai_provider_settings_class {

    constructor() {
        if (instance) return instance;
        instance = this;
        this.POP = new Dialog_class();
    }

    async ai_provider_settings() {
        var _this = this;
        var caps = await getCapabilities();
        var remote = caps.remote || {};
        var statusHtml = remote.provider
            ? (remote.healthy
                ? `<span style="color:#44cc44">● ${remote.provider} — connected</span>`
                : `<span style="color:#ffaa00">● ${remote.provider} — unreachable</span>`)
            : '<span style="color:#888">No remote provider configured</span>';

        this.POP.show({
            title: 'AI Provider Settings',
            params: [
                {
                    title: 'Status:',
                    html: `<div style="margin:4px 0 8px;font-size:12px;">${statusHtml}</div>`,
                },
                {
                    name: 'provider',
                    title: 'Default provider (used unless overridden below):',
                    value: ls_get('provider', remote.provider || ''),
                    values: ['', 'openai', 'invokeai', 'comfyui', 'replicate'],
                    type: 'select',
                },
                // ── Per-operation overrides ───────────────────────────────
                {
                    title: '',
                    html: '<div style="font-size:11px;color:#888;margin:2px 0 6px;">Per-operation overrides — blank = use default above</div>',
                },
                {
                    name: 'provider_inpaint',
                    title: 'Inpaint / Replace Selection:',
                    value: ls_get('provider_inpaint', remote.overrides?.inpaint || ''),
                    values: ['', 'openai', 'invokeai', 'comfyui', 'replicate'],
                    type: 'select',
                },
                {
                    name: 'provider_txt2img',
                    title: 'Text → Image:',
                    value: ls_get('provider_txt2img', remote.overrides?.txt2img || ''),
                    values: ['', 'openai', 'invokeai', 'comfyui', 'replicate'],
                    type: 'select',
                },
                {
                    name: 'provider_img2img',
                    title: 'Image → Image:',
                    value: ls_get('provider_img2img', remote.overrides?.img2img || ''),
                    values: ['', 'openai', 'invokeai', 'comfyui', 'replicate'],
                    type: 'select',
                },
                {
                    name: 'provider_outpaint',
                    title: 'Expand Canvas (Outpaint):',
                    value: ls_get('provider_outpaint', remote.overrides?.outpaint || ''),
                    values: ['', 'openai', 'invokeai', 'comfyui', 'replicate'],
                    type: 'select',
                },
                // ── OpenAI ────────────────────────────────────────────────
                {
                    name: 'openai_key',
                    title: 'OpenAI API key:',
                    value: ls_get('openai_key'),
                    placeholder: 'sk-...',
                },
                {
                    name: 'openai_model',
                    title: 'OpenAI model:',
                    value: ls_get('openai_model', 'dall-e-3'),
                    values: ['dall-e-3', 'dall-e-2'],
                    type: 'select',
                },
                // ── InvokeAI ──────────────────────────────────────────────
                {
                    name: 'invokeai_url',
                    title: 'InvokeAI URL:',
                    value: ls_get('invokeai_url'),
                    placeholder: 'http://192.168.1.x:9090',
                },
                {
                    name: 'invokeai_model',
                    title: 'InvokeAI default model:',
                    value: ls_get('invokeai_model', 'flux-dev'),
                    placeholder: 'flux-dev',
                },
                // ── ComfyUI ───────────────────────────────────────────────
                {
                    name: 'comfyui_url',
                    title: 'ComfyUI URL:',
                    value: ls_get('comfyui_url'),
                    placeholder: 'http://192.168.1.x:8188',
                },
                {
                    name: 'comfyui_model',
                    title: 'ComfyUI default checkpoint:',
                    value: ls_get('comfyui_model', 'v1-5-pruned-emaonly.ckpt'),
                    placeholder: 'v1-5-pruned-emaonly.ckpt',
                },
                // ── Replicate ─────────────────────────────────────────────
                {
                    name: 'replicate_key',
                    title: 'Replicate API key:',
                    value: ls_get('replicate_key'),
                    placeholder: 'r8_...',
                },
            ],
            on_finish: async function (params) {
                await _this._save(params);
            },
        });
    }

    async _save(params) {
        // Persist to localStorage
        ls_set('provider',          params.provider || '');
        ls_set('provider_inpaint',  params.provider_inpaint  || '');
        ls_set('provider_txt2img',  params.provider_txt2img  || '');
        ls_set('provider_img2img',  params.provider_img2img  || '');
        ls_set('provider_outpaint', params.provider_outpaint || '');
        ls_set('openai_key',     params.openai_key || '');
        ls_set('openai_model',   params.openai_model || 'dall-e-3');
        ls_set('invokeai_url',   params.invokeai_url || '');
        ls_set('invokeai_model', params.invokeai_model || 'flux-dev');
        ls_set('comfyui_url',    params.comfyui_url || '');
        ls_set('comfyui_model',  params.comfyui_model || 'v1-5-pruned-emaonly.ckpt');
        ls_set('replicate_key',  params.replicate_key || '');

        // Push to backend
        try {
            var payload = {
                ai_provider:              params.provider || '',
                ai_provider_inpaint:      params.provider_inpaint  || '',
                ai_provider_txt2img:      params.provider_txt2img  || '',
                ai_provider_img2img:      params.provider_img2img  || '',
                ai_provider_outpaint:     params.provider_outpaint || '',
                openai_api_key:           params.openai_key || '',
                openai_model:             params.openai_model || 'dall-e-3',
                invokeai_url:             params.invokeai_url || '',
                invokeai_default_model:   params.invokeai_model || 'flux-dev',
                comfyui_url:              params.comfyui_url || '',
                comfyui_default_model:    params.comfyui_model || '',
                replicate_api_key:        params.replicate_key || '',
            };
            var base = window.API_BASE_URL || '';
            var r = await fetch(`${base}/api/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (r.ok) {
                alertify.success('AI provider settings saved. Testing connection...');
                var { refreshCapabilities } = await import('./../../api/capabilities.js');
                var caps = await refreshCapabilities();
                if (caps?.remote?.healthy) {
                    alertify.success(`Connected to ${caps.remote.provider}!`);
                } else if (params.provider) {
                    alertify.warning('Settings saved but provider is not reachable. Check URL/key.');
                }
            } else {
                // Server-side config update not supported — inform user to set .env
                alertify.warning(
                    'Settings saved locally. To make them permanent, ' +
                    'set these values in your .env file and restart the server.'
                );
            }
        } catch {
            alertify.warning(
                'Settings saved locally. Set AI_PROVIDER and related keys in .env to make permanent.'
            );
        }
    }
}

export default Tools_ai_provider_settings_class;
