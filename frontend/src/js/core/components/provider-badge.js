/**
 * ProviderBadge — small DOM element showing the active AI provider.
 * Inserted into the toolbar footer on app load.
 *
 * Green  = remote provider healthy
 * Yellow = provider configured but unhealthy/unreachable
 * Grey   = local only (LaMa + OpenCV)
 */

import { getCapabilities } from '../../api/capabilities.js';

export async function mountProviderBadge(container) {
    var caps = await getCapabilities();

    var badge = document.createElement('div');
    badge.id = 'provider-badge';
    badge.style.cssText = [
        'display:inline-flex', 'align-items:center', 'gap:5px',
        'padding:3px 8px', 'border-radius:10px',
        'font-size:11px', 'font-family:sans-serif',
        'cursor:default', 'user-select:none',
        'margin:4px', 'opacity:0.85',
    ].join(';');

    var dot = document.createElement('span');
    dot.style.cssText = 'width:7px;height:7px;border-radius:50%;display:inline-block;';

    var label = document.createElement('span');

    var remote = caps.remote || {};
    var local  = caps.local  || {};

    if (remote.provider && remote.healthy) {
        dot.style.background = '#44cc44';
        badge.style.background = '#1a2a1a';
        badge.style.color = '#aaffaa';
        label.textContent = remote.provider + (local.gpu_detected ? ' · GPU' : ' · CPU');
        badge.title = 'Remote provider: ' + remote.provider + '\nCapabilities: ' + (remote.capabilities || []).join(', ');
    } else if (remote.provider && !remote.healthy) {
        dot.style.background = '#ffaa00';
        badge.style.background = '#2a2000';
        badge.style.color = '#ffdd88';
        label.textContent = remote.provider + ' (offline)';
        badge.title = remote.provider + ' is configured but not reachable. Check your .env URL.';
    } else {
        dot.style.background = '#888888';
        badge.style.background = '#1a1a1a';
        badge.style.color = '#aaaaaa';
        label.textContent = 'Local' + (local.lama ? ' · LaMa' : '') + (local.gpu_detected ? ' · GPU' : '');
        badge.title = 'Local only. Set AI_PROVIDER in .env to enable generative tools.';
    }

    badge.appendChild(dot);
    badge.appendChild(label);

    if (container) {
        container.appendChild(badge);
    }

    return badge;
}
