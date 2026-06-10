/**
 * AI Edit — unified inpainting tool.
 *
 * Workflow:
 *   1. Brush over the area you want to change (red overlay)
 *   2. Floating action bar appears: Erase | Replace | Upscale | Expand | Clear
 *   3. Erase    → LaMa-removes masked content
 *      Replace  → inline prompt → AI replaces masked area
 *      Upscale  → opens upscale dialog (whole image)
 *      Expand   → opens outpaint/expand dialog (whole image)
 *      Clear    → wipe the mask and start over
 *
 * Tool target: tools/ai_edit  (auto-registered by webpack require.context)
 */

import app from './../app.js';
import config from './../config.js';
import Base_layers_class from './../core/base-layers.js';
import alertify from './../../../node_modules/alertifyjs/build/alertify.min.js';

var instance = null;

// ── constants ──────────────────────────────────────────────────────────────
const BRUSH_COLOR   = 'rgba(255, 60, 60, 0.55)';
const BRUSH_DEFAULT = 30;

class Tools_ai_edit_class {

    constructor() {
        if (instance) return instance;
        instance = this;
        this.Base_layers = new Base_layers_class();
        this.name        = 'ai_edit';
        this.title       = 'AI Edit';
        // brush state
        this._painting   = false;
        this._maskCanvas = null;   // same size as layer original
        this._maskCtx    = null;
        this._overlayEl  = null;   // red overlay <canvas> on top of main canvas
        this._panel      = null;   // floating action bar DOM element
        this._hasMask    = false;
        this._isRunning  = false;
    }

    // ── Tool lifecycle ───────────────────────────────────────────────────────

    on_activate() {
        if (!config.layer || config.layer.type !== 'image') {
            alertify.error('Select an image layer first.');
            return;
        }
        this._initMask();
        this._mountOverlay();
        this._mountPanel();
    }

    on_leave() {
        this._removeOverlay();
        this._removePanel();
        this._painting = false;
    }

    // ── Mouse / touch ────────────────────────────────────────────────────────

    mousedown(e) {
        if (!config.layer || config.layer.type !== 'image') return;
        this._painting = true;
        this._paint(e);
    }

    mousemove(e) {
        if (!this._painting) return;
        this._paint(e);
    }

    mouseup() {
        this._painting = false;
        if (this._hasMask) this._showPanel();
    }

    // ── Mask painting ────────────────────────────────────────────────────────

    _initMask() {
        const w = config.layer.width_original;
        const h = config.layer.height_original;
        this._maskCanvas = document.createElement('canvas');
        this._maskCanvas.width  = w;
        this._maskCanvas.height = h;
        this._maskCtx = this._maskCanvas.getContext('2d');
        this._hasMask = false;
    }

    _paint(e) {
        if (!this._maskCtx || !this._overlayEl) return;

        // Map screen coords → original image coords
        const canvasEl = document.getElementById('canvas_minipaint') || document.querySelector('canvas');
        if (!canvasEl) return;
        const rect   = canvasEl.getBoundingClientRect();
        const scaleX = config.layer.width_original  / (config.WIDTH  * config.ZOOM);
        const scaleY = config.layer.height_original / (config.HEIGHT * config.ZOOM);
        const x = ((e.clientX - rect.left) - config.layer.x * config.ZOOM) * scaleX;
        const y = ((e.clientY - rect.top)  - config.layer.y * config.ZOOM) * scaleY;

        const r = (config.tools[this.name]?.size ?? BRUSH_DEFAULT) / 2;

        // Draw on mask (white = area to process)
        this._maskCtx.fillStyle = '#ffffff';
        this._maskCtx.beginPath();
        this._maskCtx.arc(x, y, r, 0, Math.PI * 2);
        this._maskCtx.fill();

        // Mirror onto overlay canvas (red tint for user feedback)
        const oc  = this._overlayEl;
        const oct = oc.getContext('2d');
        oct.fillStyle = BRUSH_COLOR;
        // Map back: overlay is sized to the visible canvas area
        const ox = (x / scaleX) + config.layer.x * config.ZOOM;
        const oy = (y / scaleY) + config.layer.y * config.ZOOM;
        const or_ = r / scaleX;
        oct.beginPath();
        oct.arc(ox, oy, or_, 0, Math.PI * 2);
        oct.fill();

        this._hasMask = true;
    }

    // ── Overlay canvas (red mask feedback) ───────────────────────────────────

    _mountOverlay() {
        this._removeOverlay();
        const base = document.getElementById('canvas_minipaint') || document.querySelector('canvas');
        if (!base) return;
        const oc = document.createElement('canvas');
        oc.id     = 'ai_edit_overlay';
        oc.width  = base.offsetWidth;
        oc.height = base.offsetHeight;
        Object.assign(oc.style, {
            position:      'absolute',
            top:           base.offsetTop  + 'px',
            left:          base.offsetLeft + 'px',
            pointerEvents: 'none',
            zIndex:        '50',
        });
        base.parentElement.appendChild(oc);
        this._overlayEl = oc;
    }

    _removeOverlay() {
        if (this._overlayEl) { this._overlayEl.remove(); this._overlayEl = null; }
    }

    // ── Floating action panel ─────────────────────────────────────────────────

    _mountPanel() {
        this._removePanel();
        const panel = document.createElement('div');
        panel.id = 'ai_edit_panel';
        Object.assign(panel.style, {
            position:     'fixed',
            bottom:       '80px',
            left:         '50%',
            transform:    'translateX(-50%)',
            background:   '#1e1e1e',
            border:       '1px solid #444',
            borderRadius: '10px',
            padding:      '10px 14px',
            display:      'flex',
            alignItems:   'center',
            gap:          '8px',
            zIndex:       '9999',
            boxShadow:    '0 4px 20px rgba(0,0,0,0.5)',
            fontFamily:   'sans-serif',
            fontSize:     '13px',
            color:        '#eee',
            userSelect:   'none',
            flexWrap:     'wrap',
            maxWidth:     '600px',
        });
        panel.innerHTML = this._panelHTML();
        document.body.appendChild(panel);
        this._panel = panel;
        this._wirePanel();
    }

    _panelHTML() {
        return `
        <span style="color:#888;font-size:11px;white-space:nowrap;">Paint mask, then:</span>
        <button data-ai-action="erase"   class="ai-panel-btn">✕ Erase</button>
        <div id="ai_replace_wrap" style="display:flex;align-items:center;gap:6px;">
          <button data-ai-action="replace" class="ai-panel-btn ai-panel-btn--primary">✦ Replace</button>
          <input id="ai_replace_prompt" type="text" placeholder="make her smile / replace with a wolf…"
            style="display:none;width:280px;padding:5px 8px;border-radius:6px;border:1px solid #555;
                   background:#2a2a2a;color:#eee;font-size:13px;outline:none;" />
          <button id="ai_replace_go" style="display:none;" class="ai-panel-btn ai-panel-btn--primary">Go</button>
        </div>
        <button data-ai-action="upscale" class="ai-panel-btn">⬆ Upscale</button>
        <button data-ai-action="expand"  class="ai-panel-btn">↔ Expand</button>
        <button data-ai-action="clear"   class="ai-panel-btn ai-panel-btn--danger">↺ Clear</button>
        <style>
          .ai-panel-btn {
            padding:5px 11px;border-radius:6px;border:1px solid #555;
            background:#2a2a2a;color:#ddd;cursor:pointer;font-size:13px;
            transition:background .15s;white-space:nowrap;
          }
          .ai-panel-btn:hover { background:#3a3a3a; }
          .ai-panel-btn--primary { background:#2563eb;border-color:#3b82f6;color:#fff; }
          .ai-panel-btn--primary:hover { background:#1d4ed8; }
          .ai-panel-btn--danger { border-color:#7f1d1d;color:#f87171; }
          .ai-panel-btn--danger:hover { background:#3a1a1a; }
        </style>`;
    }

    _showPanel() {
        if (this._panel) this._panel.style.opacity = '1';
    }

    _wirePanel() {
        if (!this._panel) return;
        const _this = this;

        // Erase / Upscale / Expand / Clear buttons
        this._panel.querySelectorAll('[data-ai-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.aiAction;
                if (action === 'erase')   _this._doErase();
                if (action === 'upscale') _this._doUpscale();
                if (action === 'expand')  _this._doExpand();
                if (action === 'clear')   _this._doClear();
                if (action === 'replace') _this._toggleReplaceInput();
            });
        });

        // Replace → Go
        const goBtn    = this._panel.querySelector('#ai_replace_go');
        const promptEl = this._panel.querySelector('#ai_replace_prompt');
        if (goBtn && promptEl) {
            goBtn.addEventListener('click', () => _this._doReplace(promptEl.value.trim()));
            promptEl.addEventListener('keydown', e => {
                if (e.key === 'Enter') _this._doReplace(promptEl.value.trim());
            });
        }
    }

    _toggleReplaceInput() {
        const promptEl = this._panel && this._panel.querySelector('#ai_replace_prompt');
        const goBtn    = this._panel && this._panel.querySelector('#ai_replace_go');
        if (!promptEl || !goBtn) return;
        const shown = promptEl.style.display !== 'none';
        promptEl.style.display = shown ? 'none' : 'inline-block';
        goBtn.style.display    = shown ? 'none' : 'inline-block';
        if (!shown) setTimeout(() => promptEl.focus(), 50);
    }

    _removePanel() {
        if (this._panel) { this._panel.remove(); this._panel = null; }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _requireMask() {
        if (!this._hasMask) {
            alertify.error('Paint over the area you want to change first.');
            return false;
        }
        return true;
    }

    /** Returns { imageB64, maskB64 } from current layer + painted mask. */
    _getImageAndMask() {
        const layer = config.layer;
        const w = layer.width_original;
        const h = layer.height_original;

        // Image
        const imgCanvas = document.createElement('canvas');
        imgCanvas.width = w; imgCanvas.height = h;
        imgCanvas.getContext('2d').drawImage(layer.link, 0, 0);
        const imageB64 = imgCanvas.toDataURL('image/png').split(',')[1];

        // Mask (white = selected, black = keep)
        const maskB64 = this._maskCanvas.toDataURL('image/png').split(',')[1];

        return { imageB64, maskB64 };
    }

    _applyResult(resultB64, actionLabel) {
        const img = new Image();
        img.onload = () => {
            const rc = document.createElement('canvas');
            rc.width = img.naturalWidth; rc.height = img.naturalHeight;
            rc.getContext('2d').drawImage(img, 0, 0);
            app.State.do_action(
                new app.Actions.Bundle_action('ai_edit', actionLabel, [
                    new app.Actions.Update_layer_image_action(rc)
                ])
            );
            alertify.dismissAll();
            alertify.success(`${actionLabel} applied.`);
            this._isRunning = false;
            this._doClear();
        };
        img.onerror = () => {
            alertify.dismissAll();
            alertify.error('Failed to load result image.');
            this._isRunning = false;
        };
        img.src = 'data:image/png;base64,' + resultB64;
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    async _doErase() {
        if (!this._requireMask() || this._isRunning) return;
        this._isRunning = true;
        alertify.message('Erasing…', 0);
        try {
            const { imageB64, maskB64 } = this._getImageAndMask();
            const base = window.API_BASE_URL || '';
            const r = await fetch(`${base}/api/erase`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: imageB64, mask: maskB64 }),
            });
            if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erase failed');
            const data = await r.json();
            this._applyResult(data.result, 'Erase');
        } catch (err) {
            alertify.dismissAll();
            alertify.error('Erase failed: ' + (err.message || err));
            this._isRunning = false;
        }
    }

    async _doReplace(prompt) {
        if (!this._requireMask() || this._isRunning) return;
        if (!prompt) { alertify.error('Type what you want to put there.'); return; }
        this._isRunning = true;
        alertify.message(`Replacing: "${prompt}"…`, 0);
        try {
            const { imageB64, maskB64 } = this._getImageAndMask();
            const base = window.API_BASE_URL || '';
            const r = await fetch(`${base}/api/inpaint/remote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: imageB64, mask: maskB64, prompt }),
            });
            if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Replace failed');
            const data = await r.json();
            this._applyResult(data.result, `Replace: ${prompt}`);
        } catch (err) {
            alertify.dismissAll();
            alertify.error('Replace failed: ' + (err.message || err));
            this._isRunning = false;
        }
    }

    _doUpscale() {
        // Delegate to the existing Upscale module
        import('./../modules/image/upscale.js').then(m => {
            const cls = m.default;
            new cls().upscale();
        });
    }

    _doExpand() {
        import('./../modules/generate/outpaint.js').then(m => {
            const cls = m.default;
            new cls().outpaint();
        });
    }

    _doClear() {
        if (this._maskCtx) {
            this._maskCtx.clearRect(0, 0, this._maskCanvas.width, this._maskCanvas.height);
        }
        if (this._overlayEl) {
            this._overlayEl.getContext('2d').clearRect(
                0, 0, this._overlayEl.width, this._overlayEl.height
            );
        }
        // Hide the replace input
        const promptEl = this._panel && this._panel.querySelector('#ai_replace_prompt');
        const goBtn    = this._panel && this._panel.querySelector('#ai_replace_go');
        if (promptEl) { promptEl.style.display = 'none'; promptEl.value = ''; }
        if (goBtn)    goBtn.style.display = 'none';
        this._hasMask = false;
    }
}

export default Tools_ai_edit_class;
