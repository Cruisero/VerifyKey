import { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../stores/LanguageContext';
import './Verify.css';

// API base URL
const API_BASE = import.meta.env.DEV ? 'http://localhost:3002' : '';




export default function Verify() {
    const [input, setInput] = useState('');
    const [verifyStatus, setVerifyStatus] = useState('ready');
    const [results, setResults] = useState([]);
    const [lastSuccess, setLastSuccess] = useState(null);
    const [statusData, setStatusData] = useState([]);
    const [hoveredItem, setHoveredItem] = useState(null);
    const [botStatus, setBotStatus] = useState(null);
    const [provider, setProvider] = useState('telegram');
    const [browserMode, setBrowserMode] = useState(false);
    const [program, setProgram] = useState('google-student');

    // CDK state
    const [cdkCode, setCdkCode] = useState(() => localStorage.getItem('verifykey-cdk') || '');
    const [cdkValid, setCdkValid] = useState(false);
    const [cdkRemaining, setCdkRemaining] = useState(0);
    const [cdkQuota, setCdkQuota] = useState(0);
    const [cdkChecking, setCdkChecking] = useState(false);

    const { t } = useLang();

    const programs = [
        { value: 'google-student', label: 'Google Student' },
        { value: 'gemini-advanced', label: 'Gemini Advanced' },
        { value: 'youtube-premium', label: 'YouTube Premium' },
        { value: 'apple-unidays', label: 'Apple UNiDAYS' },
        { value: 'github-education', label: 'GitHub Education' },
        { value: 'notion-education', label: 'Notion Education' },
    ];

    // Fetch verification history from API
    const fetchHistory = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/verify/history`);
            if (res.ok) {
                const data = await res.json();
                if (data.history && Array.isArray(data.history)) {
                    setStatusData(data.history);
                }
            }
        } catch (e) {
            console.warn('Failed to fetch verification history:', e);
        }
    }, []);

    useEffect(() => {
        fetchHistory();
        const interval = setInterval(fetchHistory, 30000);
        return () => clearInterval(interval);
    }, [fetchHistory]);

    // 获取配置和 Bot 状态
    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const res = await fetch(`${API_BASE}/api/config`);
                if (res.ok) {
                    const data = await res.json();
                    setProvider(data.aiGenerator?.provider || 'telegram');
                    setBrowserMode(data.verification?.browserMode === true);
                }
            } catch (e) {
                console.warn('Failed to fetch config:', e);
            }
        };
        const fetchBotStatus = async () => {
            try {
                const res = await fetch(`${API_BASE}/api/telegram/status`);
                if (res.ok) {
                    const data = await res.json();
                    setBotStatus(data);
                }
            } catch (e) {
                console.warn('Failed to fetch bot status:', e);
            }
        };
        fetchConfig();
        fetchBotStatus();
        const interval = setInterval(fetchBotStatus, 60000);
        return () => clearInterval(interval);
    }, []);

    // 验证 CDK（当 cdkCode 变化时）
    useEffect(() => {
        if (!cdkCode.trim()) {
            setCdkValid(false);
            setCdkRemaining(0);
            return;
        }
        const validateCdk = async () => {
            setCdkChecking(true);
            try {
                const res = await fetch(`${API_BASE}/api/cdk/validate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: cdkCode })
                });
                if (res.ok) {
                    const data = await res.json();
                    setCdkValid(data.valid);
                    setCdkRemaining(data.remaining || 0);
                    setCdkQuota(data.quota || 0);
                    if (data.valid) {
                        localStorage.setItem('verifykey-cdk', cdkCode);
                    }
                } else {
                    setCdkValid(false);
                    setCdkRemaining(0);
                }
            } catch (e) {
                console.warn('CDK validation failed:', e);
            } finally {
                setCdkChecking(false);
            }
        };
        // Debounce
        const timer = setTimeout(validateCdk, 500);
        return () => clearTimeout(timer);
    }, [cdkCode]);

    const isTelegramMode = provider === 'telegram';

    // 提取输入内容（链接或ID）
    const extractItems = (text) => {
        const lines = text.split('\n').filter(line => line.trim());
        return lines.map(line => line.trim()).filter(line => line.length > 0);
    };

    // 统一验证入口
    const handleVerify = async () => {
        if (!cdkValid) {
            alert(t('invalidCdk'));
            return;
        }
        if (!input.trim()) return;
        if (cdkRemaining <= 0) {
            alert(t('notActivated'));
            return;
        }

        const items = extractItems(input);
        if (items.length === 0) {
            alert(isTelegramMode ? 'Please enter valid verification links' : 'Please enter verification IDs or links');
            return;
        }

        setVerifyStatus('processing');

        if (isTelegramMode) {
            await handleTelegramVerify(items);
        } else {
            await handleApiVerify(items);
        }

        setVerifyStatus('ready');
        setInput('');
    };

    // Telegram Bot 验证（发送完整链接）
    const handleTelegramVerify = async (links) => {
        const resultItems = links.map((link, i) => {
            const vidMatch = link.match(/verificationId=([a-zA-Z0-9-]+)/);
            const displayId = vidMatch ? vidMatch[1] : link.substring(0, 30) + '...';
            return {
                id: Date.now() + i,
                verificationId: displayId,
                fullLink: link,
                status: 'processing',
                timestamp: new Date().toISOString(),
                message: `⏳ ${t('processing')}`
            };
        });
        setResults(prev => [...resultItems, ...prev]);

        try {
            const response = await fetch(`${API_BASE}/api/verify/telegram`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ links, cdk: cdkCode })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ detail: response.statusText }));
                throw new Error(err.detail || `Request failed: ${response.status}`);
            }

            const data = await response.json();
            if (data.results && Array.isArray(data.results)) {
                for (const result of data.results) {
                    const resultItem = resultItems.find(r =>
                        r.fullLink === result.link || r.verificationId === result.verificationId
                    );
                    if (resultItem) {
                        let status = 'processing';
                        let message = result.message || t('processing');
                        if (result.status === 'approved') {
                            status = 'success';
                            message = result.message || t('msgApproved');
                            setLastSuccess(new Date().toISOString());
                            fetchHistory();
                        } else if (result.status === 'rejected') {
                            status = 'failed';
                            message = result.message || t('msgRejected');
                        } else if (result.status === 'error' || result.status === 'timeout') {
                            status = 'failed';
                            message = result.message || t('msgError');
                        } else if (result.status === 'no_credits') {
                            status = 'failed';
                            message = t('msgNoCredits');
                        }
                        setResults(prev => prev.map(r =>
                            r.id === resultItem.id
                                ? {
                                    ...r, status, message, verificationId: result.verificationId || r.verificationId,
                                    credits: result.credits, claimLink: result.claimLink, reason: result.reason
                                }
                                : r
                        ));
                    }
                }
            }
            // Update CDK remaining from response
            if (data.cdkRemaining !== undefined) {
                setCdkRemaining(data.cdkRemaining);
            }
        } catch (error) {
            console.error('Telegram verify error:', error);
            setResults(prev => prev.map(r =>
                resultItems.find(ri => ri.id === r.id) && r.status === 'processing'
                    ? { ...r, status: 'failed', message: '❌ ' + error.message }
                    : r
            ));
        }
    };

    // 传统 API/Browser 验证（发送 ID）
    const handleApiVerify = async (items) => {
        // 从 URL 或纯 ID 中提取 verificationId
        const verificationIds = items.map(item => {
            const urlMatch = item.match(/verificationId=([a-zA-Z0-9-]+)/);
            return urlMatch ? urlMatch[1] : item.trim();
        }).filter(id => id.length > 0);

        const resultItems = verificationIds.map((vid, i) => ({
            id: Date.now() + i,
            verificationId: vid,
            status: 'processing',
            timestamp: new Date().toISOString(),
            message: `⏳ ${t('processing')}`
        }));
        setResults(prev => [...resultItems, ...prev]);

        const endpoint = browserMode ? '/api/verify-puppeteer' : '/api/verify';

        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ verificationIds, programId: program })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ detail: response.statusText }));
                throw new Error(err.detail || `Request failed: ${response.status}`);
            }

            const data = await response.json();
            if (data.results && Array.isArray(data.results)) {
                for (const result of data.results) {
                    const resultItem = resultItems.find(r => r.verificationId === result.verificationId);
                    if (resultItem) {
                        const status = result.success ? 'success' : 'failed';
                        const message = result.success ? t('msgApiSuccess') : (t('msgApiFail') + (result.message || ''));
                        if (result.success) {
                            setLastSuccess(new Date().toISOString());
                            fetchHistory();
                        }
                        setResults(prev => prev.map(r =>
                            r.id === resultItem.id
                                ? { ...r, status, message, verificationId: result.verificationId }
                                : r
                        ));
                    }
                }
            }
        } catch (error) {
            console.error('API verify error:', error);
            setResults(prev => prev.map(r =>
                resultItems.find(ri => ri.id === r.id) && r.status === 'processing'
                    ? { ...r, status: 'failed', message: '❌ ' + error.message }
                    : r
            ));
        }
    };

    const handleClear = () => setResults([]);

    const handleExport = () => {
        const successResults = results.filter(r => r.status === 'success');
        const text = successResults.map(r => {
            let line = r.verificationId;
            if (r.claimLink) line += '\n' + r.claimLink;
            return line;
        }).join('\n\n');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `verifykey-results-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const getStatusBadge = () => {
        switch (verifyStatus) {
            case 'processing':
                return <span className="badge badge-warning"><span className="pulse-dot"></span>{t('statusProcessing')}...</span>;
            case 'success':
                return <span className="badge badge-success">✓ {t('statusComplete')}</span>;
            case 'error':
                return <span className="badge badge-error">✕ Error</span>;
            default:
                return <span className="badge badge-info">● {t('statusReady')}</span>;
        }
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return '-';
        const diff = Date.now() - (typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp);
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        if (minutes < 1) return t('justNow');
        if (minutes < 60) return `${minutes}${t('minutesAgo')}`;
        return `${Math.floor(minutes / 60)}${t('hoursAgo')}`;
    };

    // 统计
    const liveStats = {
        pass: statusData.filter(d => d.status === 'pass').length,
        failed: statusData.filter(d => d.status === 'failed').length,
        processing: statusData.filter(d => d.status === 'processing').length,
        cancel: statusData.filter(d => d.status === 'cancel').length
    };

    const userStats = [
        { label: 'CDK 额度', value: cdkValid ? `${cdkRemaining} 次` : '未激活', icon: '🔑', color: 'primary' },
        { label: '本月验证', value: liveStats.pass + liveStats.failed + liveStats.processing + liveStats.cancel, icon: '⚡', color: 'success' },
        { label: '成功率', value: statusData.length > 0 ? `${Math.round(liveStats.pass / statusData.length * 100)}%` : '0%', icon: '📈', color: 'info' },
    ];

    return (
        <div className="verify-page">
            <div className="container">
                {/* Header */}
                <div className="welcome-section">
                    <div className="welcome-content">
                        <h1 className="welcome-title">
                            <span className="gradient-text">Verification Console</span>
                        </h1>
                        <p className="welcome-desc">
                            {t('welcomeDesc')}
                        </p>
                    </div>
                    <div className="quick-actions">
                        <div className="status-indicator">
                            {getStatusBadge()}
                            {isTelegramMode && botStatus && (
                                <span className={`bot-status ${botStatus.connected ? 'connected' : 'disconnected'}`}>
                                    {botStatus.connected ? t('programOnline') : t('programOffline')}
                                </span>
                            )}
                            {!isTelegramMode && (
                                <span className="bot-status connected">
                                    {browserMode ? t('browserModeLabel') : t('apiModeLabel')}
                                </span>
                            )}
                            <span className="last-success">
                                {t('lastSuccess')}: {lastSuccess ? formatTime(lastSuccess) : t('none')}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Main Verify Content */}
                <div className="verify-content">
                    {/* Input Panel */}
                    <div className="panel input-panel card">
                        <div className="panel-header">
                            <div className="panel-title">
                                <span className="panel-icon">📝</span>
                                <span>{isTelegramMode ? t('inputVerifyLinks') : t('inputVerifyIds')}</span>
                            </div>
                            {!isTelegramMode && (
                                <select
                                    className="program-select"
                                    value={program}
                                    onChange={(e) => setProgram(e.target.value)}
                                >
                                    {programs.map(p => (
                                        <option key={p.value} value={p.value}>{p.label}</option>
                                    ))}
                                </select>
                            )}
                        </div>

                        <div className="panel-body">
                            <textarea
                                className="input textarea verify-input"
                                placeholder={isTelegramMode
                                    ? t('textareaPlaceholderTelegram')
                                    : t('textareaPlaceholderApi')
                                }
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                disabled={verifyStatus === 'processing'}
                            />

                            {/* CDK Input Row */}
                            <div className="cdk-inline-row">
                                {cdkValid ? (
                                    <>
                                        <div className="cdk-info">
                                            <span className="cdk-info-label">{t('cdkRemaining')}</span>
                                            <span className="cdk-info-code">{cdkCode.length > 12 ? cdkCode.slice(0, 8) + '...' + cdkCode.slice(-4) : cdkCode}</span>
                                        </div>
                                        <span className="cdk-quota-display">{cdkRemaining}/{cdkQuota}</span>
                                        <div className="cdk-actions">
                                            <button
                                                className="cdk-action-btn"
                                                onClick={() => {
                                                    setCdkCode('');
                                                    localStorage.removeItem('verifykey-cdk');
                                                    setCdkValid(false);
                                                    setCdkRemaining(0);
                                                    setCdkQuota(0);
                                                }}
                                            >
                                                {t('change')}
                                            </button>
                                            <a
                                                href="https://haodongxi.shop/products/7cf0bd5e-9b12-45aa-b172-aceb4feb5eaa"
                                                className="cdk-action-btn cdk-buy-btn"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                {t('buy')}
                                            </a>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <span className="cdk-inline-label">🔑 CDK</span>
                                        <input
                                            type="text"
                                            className={`input cdk-input ${cdkCode.trim() ? 'invalid' : ''}`}
                                            placeholder="VK-XXXX-XXXX-XXXX"
                                            value={cdkCode}
                                            onChange={(e) => setCdkCode(e.target.value.toUpperCase())}
                                        />
                                        {cdkChecking && <span className="cdk-checking">{t('verifying')}</span>}
                                        {!cdkChecking && cdkCode.trim() && !cdkValid && <span className="cdk-invalid">{t('invalidCdk')}</span>}
                                        <a
                                            href="https://haodongxi.shop/products/7cf0bd5e-9b12-45aa-b172-aceb4feb5eaa"
                                            className="cdk-buy-btn-inline"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            {t('buyCdk')}
                                        </a>
                                    </>
                                )}
                            </div>

                            <div className="input-footer">
                                <div className="input-info">
                                    <span className="id-count">
                                        {extractItems(input).length} {isTelegramMode ? t('linksCount') : t('idsCount')}
                                    </span>
                                    <span className="slots-info">{t('remainingQuota')}: {cdkValid ? `${cdkRemaining} ${t('quotaTimes')}` : t('notActivated')}</span>
                                </div>

                                <div className="input-actions">
                                    <button
                                        className="btn btn-primary btn-lg"
                                        onClick={handleVerify}
                                        disabled={verifyStatus === 'processing' || !input.trim() || !cdkValid}
                                    >
                                        {verifyStatus === 'processing' ? (
                                            <>
                                                <span className="loading-spinner small"></span>
                                                {t('processing')}
                                            </>
                                        ) : (
                                            t('startVerify')
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Results Panel */}
                    <div className="panel results-panel card">
                        <div className="panel-header">
                            <div className="panel-title">
                                <span className="panel-icon">📋</span>
                                <span>{t('results')}</span>
                                <span className="result-count">({results.length})</span>
                            </div>
                            <div className="panel-actions">
                                <button className="btn btn-sm btn-secondary" onClick={handleClear}>
                                    {t('clear')}
                                </button>
                                <button
                                    className="btn btn-sm btn-secondary"
                                    onClick={handleExport}
                                    disabled={results.filter(r => r.status === 'success').length === 0}
                                >
                                    {t('export')}
                                </button>
                            </div>
                        </div>

                        <div className="panel-body">
                            {results.length === 0 ? (
                                <div className="empty-results">
                                    <div className="empty-icon">📭</div>
                                    <p>{t('noResults')}</p>
                                    <p className="empty-hint">{t('noResultsHint')}</p>
                                </div>
                            ) : (
                                <div className="results-list">
                                    {results.map((result) => (
                                        <div key={result.id} className={`result-item ${result.status}`}>
                                            <div className="result-status">
                                                {result.status === 'processing' && <span className="spinner small"></span>}
                                                {result.status === 'success' && <span className="status-icon success">✓</span>}
                                                {result.status === 'pending' && <span className="status-icon pending">⏳</span>}
                                                {result.status === 'failed' && <span className="status-icon failed">✕</span>}
                                            </div>
                                            <div className="result-info">
                                                <span className="result-id">{result.verificationId}</span>
                                                <span className="result-message">{result.message || t('resultProcessing')}</span>
                                            </div>
                                            <span className="result-time">{formatTime(result.timestamp)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Dashboard Content - Live Status */}
                <div className="live-status-section card">
                    <div className="section-header">
                        <h2>{t('liveStatusTitle')}</h2>
                        <div className="status-legend">
                            <span className="legend-item">
                                <span className="legend-dot pass"></span>
                                {liveStats.pass} Pass
                            </span>
                            <span className="legend-item">
                                <span className="legend-dot failed"></span>
                                {liveStats.failed} Failed
                            </span>
                            <span className="legend-item">
                                <span className="legend-dot processing"></span>
                                {liveStats.processing} Processing
                            </span>
                            <span className="legend-item">
                                <span className="legend-dot cancel"></span>
                                {liveStats.cancel} Cancel
                            </span>
                        </div>
                    </div>
                    <div className="status-grid-container">
                        <div className="status-grid three-rows">
                            {statusData.map((item) => (
                                <div
                                    key={item.id}
                                    className={`status-block ${item.status}`}
                                    onMouseEnter={() => setHoveredItem(item)}
                                    onMouseLeave={() => setHoveredItem(null)}
                                >
                                    {hoveredItem?.id === item.id && (
                                        <div className="status-tooltip">
                                            <span className="tooltip-status">
                                                {item.status === 'pass' ? '✓ Pass' :
                                                    item.status === 'failed' ? '✕ Failed' :
                                                        item.status === 'processing' ? '⏳ Processing' : '◷ Cancel'}
                                            </span>
                                            <span className="tooltip-time">{formatTime(item.timestamp)}</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="tips-inline">

                        <div className="tips-content">
                            <p>{t('tip1pre')}<a href="https://one.google.com/ai-student" target="_blank" rel="noopener noreferrer">{t('tip1link')}</a>{t('tip1post')}<strong>{t('tip1bold')}</strong>{t('tip1end')}</p>
                            <p>{t('tip2')}</p>
                            <p>{t('tip3')}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
