/**
 * ProgressOverlay — shared animated progress indicator for long AI operations.
 *
 * Usage:
 *   import { showProgress, updateProgress, hideProgress } from './progress_overlay.js';
 *
 *   showProgress('Generating image…');
 *   updateProgress(50, 'Denoising step 15/30…');   // optional step updates
 *   hideProgress();
 *
 * When you don't have real step counts, call showProgress() and hideProgress() only —
 * the bar animates automatically with a shimmer to signal activity.
 */

var _overlay = null;
var _bar = null;
var _label = null;
var _shimmerAnim = null;
var _fakeTimer = null;
var _currentPct = 0;

export function showProgress(message, estimatedSeconds) {
    hideProgress();

    _currentPct = 0;

    // ── Backdrop ──────────────────────────────────────────────────────────────
    _overlay = document.createElement('div');
    _overlay.id = 'ai-progress-overlay';
    _overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:99999',
        'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center',
        'background:rgba(0,0,0,0.55)',
        'backdrop-filter:blur(2px)',
        '-webkit-backdrop-filter:blur(2px)',
    ].join(';');

    // ── Card ──────────────────────────────────────────────────────────────────
    var card = document.createElement('div');
    card.style.cssText = [
        'background:#1a1a2e',
        'border:1px solid #3a3a6a',
        'border-radius:14px',
        'padding:28px 36px',
        'min-width:320px', 'max-width:480px',
        'box-shadow:0 12px 48px rgba(0,0,0,0.8)',
        'display:flex', 'flex-direction:column', 'gap:14px',
        'text-align:center',
    ].join(';');

    // ── Label ─────────────────────────────────────────────────────────────────
    _label = document.createElement('div');
    _label.textContent = message || 'Processing…';
    _label.style.cssText = 'font-family:sans-serif;font-size:13px;color:#c0c0e0;line-height:1.4;min-height:2.8em';

    // ── Track ─────────────────────────────────────────────────────────────────
    var track = document.createElement('div');
    track.style.cssText = [
        'width:100%', 'height:6px',
        'background:#0f0f2a',
        'border-radius:3px',
        'overflow:hidden',
        'position:relative',
    ].join(';');

    // ── Shimmer (indeterminate stripe) ────────────────────────────────────────
    var shimmer = document.createElement('div');
    shimmer.style.cssText = [
        'position:absolute', 'inset:0',
        'background:linear-gradient(90deg,transparent 0%,rgba(120,120,255,0.25) 50%,transparent 100%)',
        'transform:translateX(-100%)',
        'will-change:transform',
    ].join(';');

    // ── Filled bar ────────────────────────────────────────────────────────────
    _bar = document.createElement('div');
    _bar.style.cssText = [
        'position:absolute', 'inset-block:0', 'left:0',
        'width:0%',
        'background:linear-gradient(90deg,#5577ff,#88aaff)',
        'border-radius:3px',
        'transition:width 0.35s ease',
    ].join(';');

    // ── Cancel hint ───────────────────────────────────────────────────────────
    var hint = document.createElement('div');
    hint.textContent = 'Press Esc to cancel';
    hint.style.cssText = 'font-family:sans-serif;font-size:10px;color:#444;margin-top:2px';

    track.appendChild(shimmer);
    track.appendChild(_bar);
    card.appendChild(_label);
    card.appendChild(track);
    card.appendChild(hint);
    _overlay.appendChild(card);
    document.body.appendChild(_overlay);

    // Animate shimmer
    var pos = -100;
    _shimmerAnim = setInterval(() => {
        pos += 2.5;
        if (pos > 200) pos = -100;
        shimmer.style.transform = `translateX(${pos}%)`;
    }, 16);

    // Fake progress that creeps toward 90% if no real steps given
    if (estimatedSeconds) {
        var totalMs = estimatedSeconds * 1000;
        var step = 90 / (totalMs / 200);
        _fakeTimer = setInterval(() => {
            if (_currentPct < 90) {
                _currentPct = Math.min(90, _currentPct + step);
                _bar.style.width = _currentPct + '%';
            }
        }, 200);
    }

    // Esc to cancel
    _overlay._escHandler = (e) => { if (e.key === 'Escape') hideProgress(); };
    document.addEventListener('keydown', _overlay._escHandler);
}

export function updateProgress(pct, message) {
    if (!_overlay) return;
    _currentPct = Math.max(_currentPct, Math.min(100, pct));
    if (_bar) _bar.style.width = _currentPct + '%';
    if (_label && message) _label.textContent = message;
}

export function hideProgress() {
    if (_shimmerAnim) { clearInterval(_shimmerAnim); _shimmerAnim = null; }
    if (_fakeTimer)   { clearInterval(_fakeTimer);   _fakeTimer   = null; }
    if (_overlay) {
        document.removeEventListener('keydown', _overlay._escHandler);
        _overlay.remove();
        _overlay = null;
    }
    _bar = null;
    _label = null;
    _currentPct = 0;
}
