/**
 * SelectionActions — floating quick-action panel that appears after a SAM selection.
 *
 * Surfaces high-value real-world workflows directly in the UI:
 *   • Scale by %   — make object 3% (or any %) bigger/smaller, gap AI-filled
 *   • Make less symmetrical — AI redraws the region with organic variation
 *   • Replace with clipboard — paste clipboard image into the selection shape
 *   • Copy / Cut to layer — classic Photoshop workflow
 *   • AI Edit (custom prompt) — full inpaint with user text
 *
 * Usage:
 *   this.selectionActions = new SelectionActions(this);
 *   // after successful selection:
 *   this.selectionActions.show(imageBase64, maskBase64);
 */

import app from './../app.js';
import config from './../config.js';
import Base_layers_class from './../core/base-layers.js';
import alertify from './../../../node_modules/alertifyjs/build/alertify.min.js';

const BASE = window.API_BASE_URL || '';

export class SelectionActions {
    constructor(tool) {
        this.tool = tool;
        this.Base_layers = new Base_layers_class();
        this._panel = null;
        this._imageData = null;
        this._maskData  = null;
        this._escHandler = null;
    }

    show(imageBase64, maskBase64) {
        this.hide();
        this._imageData = imageBase64;
        this._maskData  = maskBase64;

        var panel = document.createElement('div');
        panel.id = 'sel-actions-panel';
        panel.style.cssText = [
            'position:fixed',
            'bottom:80px',
            'left:50%',
            'transform:translateX(-50%)',
            'background:#1a1a2e',
            'border:1px solid #3a3a6a',
            'border-radius:12px',
            'padding:14px 16px',
            'z-index:10000',
            'font-family:sans-serif',
            'font-size:12px',
            'color:#d0d0e0',
            'min-width:340px',
            'box-shadow:0 8px 32px rgba(0,0,0,0.7)',
            'display:flex',
            'flex-direction:column',
            'gap:6px',
        ].join(';');

        // ── Title row ────────────────────────────────────────────────────────
        var titleRow = document.createElement('div');
        titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px';
        var title = document.createElement('span');
        title.textContent = 'Selection Actions';
        title.style.cssText = 'font-size:13px;font-weight:bold;color:#aaaaff';
        var closeX = document.createElement('button');
        closeX.textContent = '✕';
        closeX.style.cssText = 'background:none;border:none;color:#666;cursor:pointer;font-size:14px;padding:0;line-height:1';
        closeX.title = 'Close panel (keep selection)';
        closeX.onclick = () => this.hide();
        titleRow.appendChild(title);
        titleRow.appendChild(closeX);
        panel.appendChild(titleRow);

        // ── Scale by % ───────────────────────────────────────────────────────
        var scaleRow = document.createElement('div');
        scaleRow.style.cssText = 'display:flex;align-items:center;gap:6px;background:#16213e;border-radius:7px;padding:7px 10px';
        var scaleLabel = document.createElement('span');
        scaleLabel.textContent = 'Scale by';
        scaleLabel.style.color = '#aaa';
        var scaleInput = document.createElement('input');
        scaleInput.type = 'number';
        scaleInput.value = '103';
        scaleInput.min = '1';
        scaleInput.max = '500';
        scaleInput.title = '103 = 3% bigger · 95 = 5% smaller';
        scaleInput.style.cssText = 'width:52px;background:#0f0f1a;color:#fff;border:1px solid #4a4a8a;border-radius:4px;padding:2px 5px;font-size:12px';
        var scaleUnit = document.createElement('span');
        scaleUnit.textContent = '%';
        scaleUnit.style.color = '#888';
        var scaleBtn = _btn('Apply', '#1a2a4a', '#8aacff');
        scaleBtn.style.marginLeft = 'auto';
        scaleBtn.onclick = () => {
            var pct = parseFloat(scaleInput.value) || 103;
            this._scaleSelection(pct);
        };
        scaleRow.appendChild(scaleLabel);
        scaleRow.appendChild(scaleInput);
        scaleRow.appendChild(scaleUnit);
        scaleRow.appendChild(scaleBtn);
        panel.appendChild(scaleRow);

        // ── AI actions ───────────────────────────────────────────────────────
        panel.appendChild(
            _actionBtn('Make less symmetrical', '#1c1a2e', '#cc99ff',
                '⟳ AI redraws the region with natural, organic asymmetry',
                () => this._makeAsymmetric())
        );
        panel.appendChild(
            _actionBtn('Replace with clipboard', '#1a2a1a', '#88dd88',
                '📋 Scales your clipboard image into the selection shape',
                () => this._pasteFromClipboard())
        );

        // ── Custom AI edit prompt ─────────────────────────────────────────────
        var aiRow = document.createElement('div');
        aiRow.style.cssText = 'display:flex;align-items:center;gap:6px;background:#16213e;border-radius:7px;padding:7px 10px';
        var aiInput = document.createElement('input');
        aiInput.type = 'text';
        aiInput.placeholder = 'AI edit: "add a scar", "make it look aged", …';
        aiInput.style.cssText = 'flex:1;background:#0f0f1a;color:#fff;border:1px solid #4a4a8a;border-radius:4px;padding:3px 7px;font-size:11px';
        var aiBtn = _btn('Edit', '#1a2a4a', '#8aacff');
        aiBtn.onclick = () => {
            var instruction = aiInput.value.trim();
            if (!instruction) { alertify.warning('Enter an AI edit instruction first.'); return; }
            this._aiEditRegion(instruction);
        };
        aiRow.appendChild(aiInput);
        aiRow.appendChild(aiBtn);
        panel.appendChild(aiRow);

        // ── Divider ──────────────────────────────────────────────────────────
        var hr = document.createElement('div');
        hr.style.cssText = 'border-top:1px solid #2a2a4a;margin:2px 0';
        panel.appendChild(hr);

        // ── Classic selection ops ─────────────────────────────────────────────
        var classicRow = document.createElement('div');
        classicRow.style.cssText = 'display:flex;gap:6px';
        var copyBtn = _btn('Copy to layer', '#1a2a1a', '#88cc88');
        copyBtn.style.flex = '1';
        copyBtn.title = 'Ctrl+C';
        copyBtn.onclick = () => { this.tool.copyToLayer(); this.hide(); };
        var cutBtn  = _btn('Cut to layer', '#2a1a1a', '#cc8888');
        cutBtn.style.flex = '1';
        cutBtn.title = 'Ctrl+X';
        cutBtn.onclick = () => { this.tool.cutToLayer(); this.hide(); };
        var delBtn  = _btn('Erase', '#2a1a1a', '#ff7766');
        delBtn.style.flex = '0 0 auto';
        delBtn.title = 'Delete key';
        delBtn.onclick = () => { this.tool.deleteSelection(); this.hide(); };
        classicRow.appendChild(copyBtn);
        classicRow.appendChild(cutBtn);
        classicRow.appendChild(delBtn);
        panel.appendChild(classicRow);

        document.body.appendChild(panel);
        this._panel = panel;

        this._escHandler = (e) => { if (e.key === 'Escape') this.hide(); };
        document.addEventListener('keydown', this._escHandler);
    }

    hide() {
        if (this._panel) { this._panel.remove(); this._panel = null; }
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
            this._escHandler = null;
        }
    }

    // ── Actions ─────────────────────────────────────────────────────────────

    async _scaleSelection(scalePct) {
        if (!this._check()) return;
        this.hide();
        alertify.message('Scaling object and filling gap…');
        try {
            var res = await _post('/api/image/scale-selection', {
                image: this._imageData,
                mask:  this._maskData,
                scale_pct: scalePct,
            });
            this.tool.updateLayerWithResult(res.result);
            this.tool.clearSelection();
            alertify.success('Scaled by ' + scalePct + '%!');
        } catch (e) {
            alertify.error('Scale failed: ' + e.message);
        }
    }

    async _makeAsymmetric() {
        if (!this._check()) return;
        this.hide();
        alertify.message('AI is adding natural asymmetry…');
        try {
            var res = await _post('/api/image/ai-edit-region', {
                image:          this._imageData,
                mask:           this._maskData,
                instruction:    'natural asymmetry, slight organic variation, realistic, subtle imperfection',
                negative_prompt:'perfectly symmetric, mirror image, artificial, identical halves',
                steps: 30,
                cfg_scale: 7.5,
            });
            this.tool.updateLayerWithResult(res.result);
            this.tool.clearSelection();
            alertify.success('Made less symmetrical!');
        } catch (e) {
            alertify.error('AI edit failed: ' + e.message);
        }
    }

    async _aiEditRegion(instruction) {
        if (!this._check()) return;
        this.hide();
        alertify.message('AI is editing the region…');
        try {
            var res = await _post('/api/image/ai-edit-region', {
                image:       this._imageData,
                mask:        this._maskData,
                instruction: instruction,
                steps: 30,
                cfg_scale: 7.5,
            });
            this.tool.updateLayerWithResult(res.result);
            this.tool.clearSelection();
            alertify.success('Done!');
        } catch (e) {
            alertify.error('AI edit failed: ' + e.message);
        }
    }

    async _pasteFromClipboard() {
        if (!this._check()) return;

        if (!navigator.clipboard || !navigator.clipboard.read) {
            alertify.error('Clipboard API not available. Use HTTPS or enable clipboard permissions.');
            return;
        }
        try {
            var items = await navigator.clipboard.read();
            var clipBlob = null;
            for (var item of items) {
                for (var type of item.types) {
                    if (type.startsWith('image/')) {
                        clipBlob = await item.getType(type);
                        break;
                    }
                }
                if (clipBlob) break;
            }
            if (!clipBlob) {
                alertify.error('No image in clipboard. Copy an image first (e.g., right-click → Copy image).');
                return;
            }

            var clipBase64 = await _blobToBase64(clipBlob);
            this.hide();
            alertify.message('Pasting clipboard into selection…');

            var res = await _post('/api/image/paste-into-selection', {
                image:       this._imageData,
                mask:        this._maskData,
                paste_image: clipBase64,
            });
            this.tool.updateLayerWithResult(res.result);
            this.tool.clearSelection();
            alertify.success('Clipboard pasted into selection!');
        } catch (e) {
            alertify.error('Paste failed: ' + e.message);
        }
    }

    _check() {
        if (!this._imageData || !this._maskData) {
            alertify.error('No selection data. Make a new selection first.');
            return false;
        }
        return true;
    }
}

// ── Shared method: patch into both smart_select and brush_select instances ───

/**
 * Update the active layer canvas with a base64 result image from the backend.
 * Call as `this.updateLayerWithResult(base64)` on any tool that extends Base_tools_class.
 */
export function updateLayerWithResult(base64, tool) {
    var img = new Image();
    img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width  = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);

        app.State.do_action(
            new app.Actions.Bundle_action('ai_transform', 'AI Transform', [
                new app.Actions.Update_layer_image_action(canvas, config.layer.id)
            ])
        );
        // Trigger re-render
        config.need_render = true;
    };
    img.src = 'data:image/png;base64,' + base64;
}

// ── Private helpers ──────────────────────────────────────────────────────────

function _btn(text, bg, color) {
    var b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = 'background:' + bg + ';color:' + color + ';border:1px solid #3a3a6a;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:11px;white-space:nowrap';
    return b;
}

function _actionBtn(text, bg, color, tooltip, handler) {
    var b = _btn(text, bg, color);
    b.style.cssText += ';display:block;width:100%;text-align:left;padding:7px 10px;border-radius:7px;font-size:12px';
    if (tooltip) b.title = tooltip;
    b.onclick = handler;
    return b;
}

async function _post(path, body) {
    var r = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!r.ok) {
        var err = await r.json().catch(() => ({ detail: r.statusText }));
        throw new Error(err.detail || 'Request failed');
    }
    return r.json();
}

function _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        var reader = new FileReader();
        reader.onload  = (e) => resolve(e.target.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
