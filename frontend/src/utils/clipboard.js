/**
 * Universal clipboard copy helper that works across all environments:
 * 1. navigator.clipboard.writeText (when window.isSecureContext is true, e.g. HTTPS or localhost)
 * 2. Fallback using temporary textarea + document.execCommand('copy') (for HTTP, LAN IP, older browsers)
 * 3. Fallback prompt if all else fails
 */
export async function copyToClipboard(text) {
    if (text === null || text === undefined || text === '') {
        return false;
    }
    const str = String(text);

    // 1. Try modern asynchronous Clipboard API if available in secure context
    if (typeof window !== 'undefined' && window.isSecureContext && navigator?.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(str);
            return true;
        } catch (err) {
            console.warn('[Clipboard] navigator.clipboard.writeText failed, trying fallback:', err);
        }
    }

    // 2. Fallback: document.execCommand('copy') with hidden textarea
    try {
        const textArea = document.createElement('textarea');
        textArea.value = str;
        // Make it invisible, fixed position, out of visible viewport
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.top = '0';
        textArea.style.left = '-9999px';
        textArea.style.width = '2em';
        textArea.style.height = '2em';
        textArea.style.padding = '0';
        textArea.style.border = 'none';
        textArea.style.outline = 'none';
        textArea.style.boxShadow = 'none';
        textArea.style.background = 'transparent';
        textArea.style.opacity = '0';
        textArea.style.zIndex = '-9999';
        document.body.appendChild(textArea);

        textArea.focus({ preventScroll: true });
        textArea.select();
        textArea.setSelectionRange(0, str.length);

        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (successful) {
            return true;
        }
    } catch (err) {
        console.warn('[Clipboard] execCommand copy failed:', err);
    }

    // 3. Last-resort fallback prompt for manual copy
    try {
        window.prompt('请按 Ctrl+C (Mac 请按 ⌘+C) 复制内容：', str);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Truncate long URLs (like SheerID with redirectUrl) into a clean, human-friendly display string.
 */
export function formatDisplayUrl(url, maxLen = 48) {
    if (!url) return '';
    try {
        const u = new URL(url);
        const vid = u.searchParams.get('verificationId');
        if (vid) {
            const shortPath = u.pathname.length > 22 ? `${u.pathname.slice(0, 15)}.../` : u.pathname;
            return `${u.origin}${shortPath}?verificationId=${vid.slice(0, 8)}...`;
        }
        const clean = `${u.origin}${u.pathname}`;
        if (clean.length > maxLen) {
            return `${clean.slice(0, maxLen - 12)}...${clean.slice(-8)}`;
        }
        return clean;
    } catch (e) {
        if (url.length > maxLen) {
            return `${url.slice(0, maxLen - 12)}...${url.slice(-8)}`;
        }
        return url;
    }
}
