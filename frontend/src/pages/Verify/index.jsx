import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLang } from '../../stores/LanguageContext';
import { useAuth } from '../../stores/AuthContext';
import './Verify.css';

// API base URL
const API_BASE = import.meta.env.DEV ? 'http://localhost:3002' : '';

// Error code → i18n key mapping
const ERROR_KEY_MAP = {
    INTERNAL_ERROR: 'errInternalError',
    DEVICE_UNAVAILABLE: 'errDeviceUnavailable',
    DEVICE_PREP_FAILED: 'errDevicePrepFailed',
    PROXY_ERROR: 'errProxyError',
    PASSKEY_BLOCKED: 'errPasskeyBlocked',
    CAPTCHA: 'errCaptcha',
    ACCOUNT_DISABLED: 'errAccountDisabled',
    INVALID_EMAIL: 'errInvalidEmail',
    WRONG_PASSWORD: 'errWrongPassword',
    TOTP_ERROR: 'errTotpError',
    NO_AUTHENTICATOR: 'errNoAuthenticator',
    SIGNIN_PAGE_FAILED: 'errSigninPageFailed',
    TWOFACTOR_PAGE_ERROR: 'errTwofactorPageError',
    GOOGLE_LOGIN_ERROR: 'errGoogleLoginError',
    GOOGLE_ONE_UNAVAILABLE: 'errGoogleOneUnavailable',
    URL_CAPTURE_FAILED: 'errUrlCaptureFailed',
    SIGNIN_FAILED: 'errSigninFailed',
    ACCOUNT_NOT_DETECTED: 'errAccountNotDetected',
    BROWSER_LOGIN_FAILED: 'errBrowserLoginFailed',
    UNKNOWN_ERROR: 'errUnknownError',
};

export default function Verify() {
    const { user, getToken, refreshUser } = useAuth();
    const navigate = useNavigate();

    // Verify tier: 'standard' (UPixel 1pt) | 'pro' (KPixel 1.5pt)
    const [verifyTier, setVerifyTier] = useState('standard');
    const tierCost = verifyTier === 'pro' ? 1.5 : 1;

    // Top-level service tab: 'pixel' | 'gpt'
    const [serviceTab, setServiceTab] = useState('pixel');
    const [showGuide, setShowGuide] = useState(false);

    // GPT Recharge wizard state
    const [gptStep, setGptStep] = useState(1);
    const [gptCdk, setGptCdk] = useState('');
    const [gptCardKey, setGptCardKey] = useState('');
    const [gptKeyId, setGptKeyId] = useState(null);
    const [gptLoading, setGptLoading] = useState(false);
    const [gptError, setGptError] = useState('');
    const [gptSession, setGptSession] = useState('');
    const [gptEmail, setGptEmail] = useState('');
    const [gptSessionError, setGptSessionError] = useState(false);
    const [gptRecharging, setGptRecharging] = useState(false);
    const [gptSuccess, setGptSuccess] = useState(false);
    const [gptResultMsg, setGptResultMsg] = useState('');
    const [gptChannel, setGptChannel] = useState('sbs');

    // Submission mode: 'single' | 'batch'
    const [submitMode, setSubmitMode] = useState('single');

    // Single mode fields
    const [singleEmail, setSingleEmail] = useState('');
    const [singlePassword, setSinglePassword] = useState('');
    const [singleTotp, setSingleTotp] = useState('');

    // Batch mode field
    const [batchInput, setBatchInput] = useState('');

    // Common state
    const [verifyStatus, setVerifyStatus] = useState('ready');
    const [results, setResults] = useState([]);
    const [statusData, setStatusData] = useState([]);
    const [showHistory, setShowHistory] = useState(false);
    const [historyData, setHistoryData] = useState([]);
    const [showGptHistory, setShowGptHistory] = useState(false);
    const [gptHistoryData, setGptHistoryData] = useState([]);
    const [hoveredItem, setHoveredItem] = useState(null);

    // Tips inline state (loaded from config)
    const [tipsContent, setTipsContent] = useState(null);

    // CDK redeem state
    const [cdkCode, setCdkCode] = useState('');
    const [showCdkInput, setShowCdkInput] = useState(false);
    const [cdkChecking, setCdkChecking] = useState(false);
    const [cdkRedeemMsg, setCdkRedeemMsg] = useState('');
    const [cdkRedeemStatus, setCdkRedeemStatus] = useState(''); // 'success' | 'error'

    // Service maintenance status
    const [serviceStatus, setServiceStatus] = useState(null);

    // Polling refs
    const pollingRefs = useRef({});

    const { t, lang } = useLang();

    // Build localized error descriptions
    const ERROR_DESCRIPTIONS = Object.fromEntries(
        Object.entries(ERROR_KEY_MAP).map(([code, key]) => [code, t(key)])
    );

    // Sanitize error messages to hide supplier info from users
    const sanitizeError = (msg) => {
        if (!msg || typeof msg !== 'string') return t('errGenericFailed');
        if (ERROR_DESCRIPTIONS[msg]) return ERROR_DESCRIPTIONS[msg];
        const blocked = /pixel|iqless|kckc|1688ai|vpixel|kpixel|upixel|api\s*key|cdkey|X-API/i;
        if (blocked.test(msg)) return t('errServiceUnavailable');
        if (/积分|余额|登录|过期|参数|不足|未启用|未配置|密码|验证|账号|邮箱|credits|balance|login|expired|password|verify|account|email/i.test(msg)) return msg;
        if (msg.length > 60 && /[a-zA-Z]/.test(msg)) return t('errGenericFailed');
        return msg;
    };

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

    // Fetch config
    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const res = await fetch(`${API_BASE}/api/config`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.tipsInline?.content) {
                        setTipsContent(data.tipsInline.content);
                    }
                }
            } catch (e) {
                console.warn('Failed to fetch config:', e);
            }
        };
        fetchConfig();
    }, []);

    // Fetch service maintenance status
    useEffect(() => {
        const fetchServiceStatus = async () => {
            try {
                const res = await fetch(`${API_BASE}/api/service-status`);
                if (res.ok) setServiceStatus(await res.json());
            } catch (e) {
                console.warn('Failed to fetch service status:', e);
            }
        };
        fetchServiceStatus();
        const interval = setInterval(fetchServiceStatus, 60000);
        return () => clearInterval(interval);
    }, []);

    // Redeem CDK — transfer credits to user account
    const handleRedeemCdk = async () => {
        if (!cdkCode.trim()) return;
        const token = getToken();
        if (!token || !user) {
            setCdkRedeemMsg(t('cdkLoginFirst'));
            setCdkRedeemStatus('error');
            return;
        }
        setCdkChecking(true);
        setCdkRedeemMsg('');
        setCdkRedeemStatus('');
        try {
            const res = await fetch(`${API_BASE}/api/cdk/redeem`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ code: cdkCode })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setCdkRedeemMsg(data.message);
                setCdkRedeemStatus('success');
                setCdkCode('');
                await refreshUser(); // refresh user credits
                setTimeout(() => {
                    setShowCdkInput(false);
                    setCdkRedeemMsg('');
                    setCdkRedeemStatus('');
                }, 2000);
            } else {
                setCdkRedeemMsg(data.detail || data.message || t('cdkRedeemFailed'));
                setCdkRedeemStatus('error');
            }
        } catch (e) {
            setCdkRedeemMsg(t('cdkNetworkError'));
            setCdkRedeemStatus('error');
        } finally {
            setCdkChecking(false);
        }
    };

    // Parse batch input into account entries
    const parseBatchInput = (text) => {
        return text.split('\n')
            .map(line => line.trim())
            .filter(line => line && /-/.test(line))
            .map(line => {
                // Normalize: collapse spaces around dashes (e.g. "- - -" → "---")
                const normalized = line.replace(/\s*-\s*/g, '-');
                const parts = normalized.split(/-+/).map(p => p.trim()).filter(Boolean);
                if (parts.length === 4) {
                    return { email: parts[0], password: parts[1], backupEmail: parts[2], totp_secret: parts[3] };
                } else if (parts.length === 3) {
                    return { email: parts[0], password: parts[1], totp_secret: parts[2] };
                }
                return null;
            })
            .filter(Boolean);
    };

    // Submit a single account — routes to UPixel, YPixel, or KPixel/VPixel based on tier
    const submitOneJob = async (account, resultId) => {
        const isKPixel = verifyTier === 'pro';

        // Standard tier: prefer UPixel, fallback to YPixel
        let apiUrl, payload, jobSourceDefault;
        if (isKPixel) {
            apiUrl = `${API_BASE}/api/kpixel/jobs`;
            payload = { email: account.email, password: account.password, twofa: account.totp_secret };
            jobSourceDefault = 'kpixel';
        } else if (!serviceStatus?.upixel?.available && serviceStatus?.upixel?.ypixelUp) {
            // UPixel down, YPixel up → use YPixel
            apiUrl = `${API_BASE}/api/ypixel/jobs`;
            payload = { email: account.email, password: account.password, twofa: account.totp_secret || '', recovery_email: account.backupEmail || '' };
            jobSourceDefault = 'ypixel';
        } else {
            apiUrl = `${API_BASE}/api/pixel/jobs`;
            payload = { email: account.email, password: account.password, totp_secret: account.totp_secret };
            jobSourceDefault = 'pixel';
        }

        const token = getToken();

        try {
            const resp = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify(payload)
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ detail: resp.statusText }));
                const rawMsg = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail);
                setResults(prev => prev.map(r =>
                    r.id === resultId ? { ...r, status: 'failed', message: `❌ ${sanitizeError(rawMsg)}` } : r
                ));
                return;
            }

            const data = await resp.json();
            const jobId = data.job_id || String(data.task_id || '');
            const jobSource = data.source || jobSourceDefault;

            // Update with job ID and start polling
            setResults(prev => prev.map(r =>
                r.id === resultId ? {
                    ...r,
                    jobId,
                    tier: verifyTier,
                    source: jobSource,
                    message: t('submitted'),
                    queuePosition: data.queue_position >= 0 ? data.queue_position : -1,
                    estimatedWait: data.estimated_wait_seconds,
                } : r
            ));

            // Start polling this job based on source
            if (jobSource === 'kpixel' || jobSource === 'vpixel' || jobSource === 'ypixel') {
                const statusUrl = jobSource === 'vpixel'
                    ? `${API_BASE}/api/vpixel/jobs/${jobId}/status`
                    : jobSource === 'ypixel'
                        ? `${API_BASE}/api/ypixel/jobs/${jobId}/status`
                        : `${API_BASE}/api/kpixel/jobs/${jobId}/status`;
                pollKPixelJob(jobId, resultId, statusUrl);
            } else {
                pollJob(jobId, resultId);
            }

        } catch (e) {
            setResults(prev => prev.map(r =>
                r.id === resultId ? { ...r, status: 'failed', message: `❌ ${e.message}` } : r
            ));
        }
    };

    // Poll KPixel/VPixel job status (same response format)
    const pollKPixelJob = (taskId, resultId, statusUrl) => {
        const url = statusUrl || `${API_BASE}/api/kpixel/jobs/${taskId}/status`;
        const intervalId = setInterval(async () => {
            try {
                const resp = await fetch(url, { method: 'POST' });
                if (!resp.ok) return;
                const data = await resp.json();
                if (!data.success) return;

                const info = data.data || {};
                const status = info.status || '';
                const message = info.message || '';
                const source = statusUrl?.includes('/vpixel/')
                    ? 'vpixel'
                    : statusUrl?.includes('/ypixel/')
                        ? 'ypixel'
                        : 'kpixel';

                if (status === 'Success') {
                    clearInterval(intervalId);
                    delete pollingRefs.current[resultId];
                    await confirmRemoteSuccess(source, taskId);
                    const resultUrl = info.url || '';
                    setResults(prev => prev.map(r =>
                        r.id === resultId ? {
                            ...r,
                            status: 'success',
                            message: `✅ ${message || t('verifySuccess')}`,
                            url: resultUrl,
                            stageLabel: 'DONE',
                            totalStages: 0,
                        } : r
                    ));
                    await refreshUser();
                    fetchUserHistory('pixel');
                } else if (status === 'Failed') {
                    clearInterval(intervalId);
                    delete pollingRefs.current[resultId];
                    setResults(prev => prev.map(r =>
                        r.id === resultId ? {
                            ...r,
                            status: 'failed',
                            message: `❌ ${sanitizeError(message) || t('verifyFailed')}`,
                        } : r
                    ));
                } else {
                    // Pending or Running
                    setResults(prev => prev.map(r =>
                        r.id === resultId ? {
                            ...r,
                            message: status === 'Running'
                                ? `🔄 ${message || t('running') + '...'}`
                                : t('queueing'),
                            stageLabel: status === 'Running' ? t('running') : t('queuePosition'),
                        } : r
                    ));
                }
            } catch (e) {
                console.warn('KPixel poll error:', e);
            }
        }, 3000);
        pollingRefs.current[resultId] = intervalId;
    };

    // Poll a job until success/failed
    const pollJob = (jobId, resultId) => {
        const intervalId = setInterval(async () => {
            try {
                const resp = await fetch(`${API_BASE}/api/pixel/jobs/${jobId}`);
                if (!resp.ok) return;
                const data = await resp.json();

                const status = data.status;
                const stage = data.stage || 0;
                const totalStages = data.total_stages || 8;
                const stageLabel = data.stage_label || '';
                const elapsed = data.elapsed_seconds || 0;

                if (status === 'success') {
                    clearInterval(intervalId);
                    delete pollingRefs.current[resultId];
                    await confirmRemoteSuccess('pixel', jobId);
                    const url = data.url || '';
                    setResults(prev => prev.map(r =>
                        r.id === resultId ? {
                            ...r,
                            status: 'success',
                            message: t('fetchSuccess'),
                            url,
                            stage,
                            totalStages,
                            stageLabel: 'DONE',
                            elapsed: Math.round(elapsed),
                        } : r
                    ));
                    await refreshUser();
                    fetchHistory();
                    fetchUserHistory('pixel');
                } else if (status === 'failed') {
                    clearInterval(intervalId);
                    delete pollingRefs.current[resultId];
                    const error = data.error || 'UNKNOWN_ERROR';
                    const errorDesc = ERROR_DESCRIPTIONS[error] || sanitizeError(error);
                    setResults(prev => prev.map(r =>
                        r.id === resultId ? {
                            ...r,
                            status: 'failed',
                            message: `❌ ${errorDesc}`,
                            errorCode: error,
                            stage,
                            totalStages,
                            stageLabel,
                            elapsed: Math.round(elapsed),
                        } : r
                    ));
                } else {
                    // queued or running — update progress
                    setResults(prev => prev.map(r =>
                        r.id === resultId ? {
                            ...r,
                            stage,
                            totalStages,
                            stageLabel,
                            elapsed: Math.round(elapsed),
                            queuePosition: data.queue_position,
                            estimatedWait: data.estimated_wait_seconds,
                            message: status === 'running'
                                ? `🔄 [${stage}/${totalStages}] ${stageLabel}`
                                : t('queueWaiting').replace('{pos}', data.queue_position >= 0 ? data.queue_position : '-'),
                        } : r
                    ));
                }
            } catch (e) {
                console.warn('Poll error:', e);
            }
        }, 3000);

        pollingRefs.current[resultId] = intervalId;
    };

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            Object.values(pollingRefs.current).forEach(id => clearInterval(id));
        };
    }, []);

    // Handle submit
    const handleVerify = async () => {
        if (!user) {
            alert(t('alertLoginFirst'));
            return;
        }
        if ((user.credits || 0) < tierCost) {
            alert(t('alertInsufficientCredits').replace('{cost}', tierCost).replace('{current}', user.credits || 0));
            return;
        }

        let accounts = [];

        if (submitMode === 'single') {
            if (!singleEmail.trim() || !singlePassword.trim() || !singleTotp.trim()) {
                alert(t('alertFillAll'));
                return;
            }
            accounts = [{ email: singleEmail.trim(), password: singlePassword.trim(), totp_secret: singleTotp.trim() }];
        } else {
            accounts = parseBatchInput(batchInput);
            if (accounts.length === 0) {
                alert(t('alertInvalidFormat'));
                return;
            }
        }

        setVerifyStatus('processing');

        // Create result items
        const isYPixelRoute = verifyTier !== 'pro' && !serviceStatus?.upixel?.available && serviceStatus?.upixel?.ypixelUp;
        const resultItems = accounts.map((acc, i) => ({
            id: Date.now() + i,
            email: acc.email,
            status: 'processing',
            timestamp: new Date().toISOString(),
            message: `⏳ ${t('submitting')}`,
            stage: 0,
            totalStages: (verifyTier === 'pro' || isYPixelRoute) ? 0 : 8,
            stageLabel: '',
            url: '',
            jobId: '',
            source: verifyTier === 'pro' ? 'kpixel' : (isYPixelRoute ? 'ypixel' : 'pixel'),
        }));
        setResults(prev => [...resultItems, ...prev]);

        // Submit all jobs
        for (let i = 0; i < accounts.length; i++) {
            await submitOneJob(accounts[i], resultItems[i].id);
            // Small delay between batch submissions
            if (i < accounts.length - 1) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        setVerifyStatus('ready');
        if (submitMode === 'single') {
            setSingleEmail('');
            setSinglePassword('');
            setSingleTotp('');
        } else {
            setBatchInput('');
        }
    };

    const handleClear = () => {
        // Stop all polling
        Object.values(pollingRefs.current).forEach(id => clearInterval(id));
        pollingRefs.current = {};
        setResults([]);
    };

    const confirmRemoteSuccess = useCallback(async (source, jobId) => {
        const token = getToken();
        if (!token || !source || !jobId) return null;
        const confirmUrl = source === 'pixel'
            ? `${API_BASE}/api/pixel/jobs/${jobId}/confirm`
            : source === 'vpixel'
                ? `${API_BASE}/api/vpixel/jobs/${jobId}/confirm`
                : source === 'ypixel'
                    ? `${API_BASE}/api/ypixel/jobs/${jobId}/confirm`
                    : `${API_BASE}/api/kpixel/jobs/${jobId}/confirm`;
        try {
            const resp = await fetch(confirmUrl, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
            return await resp.json().catch(() => null);
        } catch (e) {
            console.warn('confirm success failed:', e);
            return null;
        }
    }, [getToken]);

    // Save completed results to history
    useEffect(() => {
        // no-op: history is now fetched from API
    }, [results]);

    // Fetch user history from API
    const fetchUserHistory = useCallback(async (type) => {
        const token = getToken();
        if (!token) return;
        try {
            const res = await fetch(`${API_BASE}/api/user/verify-history`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                const all = data.history || [];
                if (type === 'pixel') {
                    setHistoryData(all.filter(h => h.type === 'pixel'));
                } else if (type === 'gpt') {
                    setGptHistoryData(all.filter(h => h.type === 'gpt'));
                } else {
                    setHistoryData(all.filter(h => h.type === 'pixel'));
                    setGptHistoryData(all.filter(h => h.type === 'gpt'));
                }
            }
        } catch (e) {
            console.warn('Failed to fetch user history:', e);
        }
    }, [getToken]);

    const clearHistory = () => {
        setHistoryData([]);
        setShowHistory(false);
    };

    const clearGptHistory = () => {
        setGptHistoryData([]);
        setShowGptHistory(false);
    };

    const getStatusBadge = () => {
        switch (verifyStatus) {
            case 'processing':
                return <span className="badge badge-warning"><span className="pulse-dot"></span>{t('statusSubmitting')}</span>;
            case 'success':
                return <span className="badge badge-success">✓ {t('statusComplete')}</span>;
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

    const maskEmail = (email) => {
        if (!email) return '';
        const [user, domain] = email.split('@');
        if (!user || !domain) return email;
        const masked = user.length > 3
            ? user.slice(0, 2) + '***' + user.slice(-1)
            : user[0] + '***';
        return `${masked}@${domain}`;
    };

    // Stats
    const liveStats = {
        pass: statusData.filter(d => d.status === 'pass').length,
        failed: statusData.filter(d => d.status === 'failed').length,
        processing: statusData.filter(d => d.status === 'processing').length,
        cancel: statusData.filter(d => d.status === 'cancel').length
    };

    const batchCount = submitMode === 'batch' ? parseBatchInput(batchInput).length : 0;

    return (
        <div className="verify-page">
            <div className="container">
                {/* Header */}
                <div className="welcome-section">
                    <div className="welcome-content">
                        <h1 className="welcome-title">
                            <span className="gradient-text">{t('welcomeTitle')}</span>
                        </h1>
                        <p className="welcome-desc">
                            {t('welcomeDesc')}
                        </p>
                    </div>
                    <div className="quick-actions">
                        <div className="status-indicator">
                            {getStatusBadge()}
                        </div>
                        <Link to="/api-docs" className="api-entry-pill">
                            <span className="api-entry-dot"></span>
                            API
                        </Link>
                    </div>
                </div>

                {/* Top-level Service Tabs */}
                <div className="service-tabs">
                    <button
                        className={`service-tab ${serviceTab === 'pixel' ? 'active' : ''}`}
                        onClick={() => setServiceTab('pixel')}
                    >

                        <span>{t('geminiVerify')}</span>
                    </button>
                    <button
                        className={`service-tab service-tab-gpt ${serviceTab === 'gpt' ? 'active' : ''}`}
                        onClick={() => setServiceTab('gpt')}
                    >

                        <span>{t('gptRecharge')}</span>
                        {serviceStatus?.gpt?.available === false && (
                            <span style={{ fontSize: '10px', color: '#dc2626', fontWeight: 600, marginLeft: '6px' }}>{t('maintenance')}</span>
                        )}
                    </button>
                </div>

                {/* Guide / Tutorial Toggle */}
                <div className="guide-toggle-bar" onClick={() => setShowGuide(!showGuide)}>
                    <span className="guide-toggle-label">
                        <span className="guide-toggle-icon">📖</span>
                        {t('guideToggle')}
                    </span>
                    <span className={`guide-toggle-arrow ${showGuide ? 'open' : ''}`}>▾</span>
                </div>

                {showGuide && (
                    <div className="guide-section">
                        {/* Credits Rules + Invite (merged) */}
                        <div className="guide-card guide-card-credits">
                            <div className="guide-card-header">
                                <span className="guide-card-icon">💰</span>
                                <h3>{t('creditsRulesTitle')}</h3>
                            </div>
                            <div className="guide-card-body">
                                <div className="credits-price-grid">
                                    <div className="credits-price-item">
                                        <div className="credits-price-service">
                                            <span className="credits-dot gemini"></span>
                                            {t('geminiStandard')}
                                        </div>
                                        <span className="credits-price-val">-1 {t('credits')}</span>
                                    </div>
                                    <div className="credits-price-item">
                                        <div className="credits-price-service">
                                            <span className="credits-dot pro"></span>
                                            {t('geminiPro')}
                                        </div>
                                        <span className="credits-price-val">-1.5 {t('credits')}</span>
                                    </div>
                                    <div className="credits-price-item">
                                        <div className="credits-price-service">
                                            <span className="credits-dot gpt"></span>
                                            {t('gptMonthly')}
                                        </div>
                                        <span className="credits-price-val">-2 {t('credits')}</span>
                                    </div>
                                    <div className="credits-price-item invite">
                                        <div className="credits-price-service">
                                            <span className="credits-dot invite"></span>
                                            {t('inviteReward')}
                                        </div>
                                        <span className="credits-price-val positive">{t('inviteRewardVal')}</span>
                                    </div>
                                </div>
                                <p className="guide-note warn">{t('inviteNote')}</p>
                                <p className="guide-note" style={{ marginTop: '6px' }}>{t('creditsUniversal')}</p>
                            </div>
                        </div>

                        {/* Service Guide — conditional on tab */}
                        {serviceTab === 'pixel' ? (
                            <div className="guide-card guide-card-gemini">
                                <div className="guide-card-header">
                                    <span className="guide-card-icon">📡</span>
                                    <h3>{t('geminiServiceTitle')}</h3>
                                </div>
                                <div className="guide-card-body">
                                    <p className="guide-desc" dangerouslySetInnerHTML={{ __html: t('geminiServiceDesc') }} />
                                    <ul className="guide-checklist">
                                        <li>
                                            <span className="check-icon required">🔐</span>
                                            <span><strong>{t('guide2faTitle')}</strong>{t('guide2faDesc')}
                                                <a href="https://www.notion.so/2FA-32cfb1c3c17c807e83bdcb371212e287?source=copy_link"
                                                    target="_blank" rel="noopener noreferrer"
                                                    style={{
                                                        background: 'rgba(99,102,241,0.1)', color: '#6366f1',
                                                        border: 'none', borderRadius: '6px', padding: '1px 8px',
                                                        fontSize: '11px', fontWeight: 600, textDecoration: 'none',
                                                        marginLeft: '6px', verticalAlign: 'middle',
                                                    }}
                                                >{t('guide2faTutorial')}</a>
                                            </span>
                                        </li>
                                        <li>
                                            <span className="check-icon required">🌍</span>
                                            <span>
                                                <strong>{t('guideRegion')}</strong>{t('guideRegionDesc')}
                                                <button
                                                    onClick={(e) => { e.preventDefault(); document.querySelector('.region-popover').classList.toggle('show'); document.querySelector('.region-backdrop').classList.toggle('show'); }}
                                                    style={{
                                                        background: 'rgba(99,102,241,0.1)', color: '#6366f1',
                                                        border: 'none', borderRadius: '6px', padding: '1px 8px',
                                                        fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                                                        marginLeft: '6px', verticalAlign: 'middle',
                                                    }}
                                                >{t('guideRegionBtn')}</button>
                                                <div className="region-backdrop" onClick={() => { document.querySelector('.region-popover').classList.remove('show'); document.querySelector('.region-backdrop').classList.remove('show'); }} />
                                                <div className="region-popover">
                                                    <div className="region-popover-title">
                                                        <span>{t('guideRegionTitle')}</span>
                                                        <small>{t('guideRegionCount')}</small>
                                                    </div>
                                                    <div className="region-tags-grid">
                                                        {['regionAustralia', 'regionAustria', 'regionBelgium', 'regionCanada', 'regionCzechia', 'regionDenmark', 'regionEstonia', 'regionFinland',
                                                            'regionFrance', 'regionGermany', 'regionHungary', 'regionIndia', 'regionIreland', 'regionItaly', 'regionJapan', 'regionLatvia',
                                                            'regionLithuania', 'regionMalaysia', 'regionMexico', 'regionNetherlands', 'regionNorway', 'regionPoland', 'regionPortugal', 'regionRomania',
                                                            'regionSingapore', 'regionSlovakia', 'regionSlovenia', 'regionSpain', 'regionSweden', 'regionSwitzerland', 'regionTaiwan', 'regionUK', 'regionUS'
                                                        ].map((key, i) => (
                                                            <span key={i} className="region-tag">{t(key)}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </span>
                                        </li>
                                        <li>
                                            <span className="check-icon required">👨‍👩‍👦</span>
                                            <span><strong>{t('guideFamily')}</strong>{t('guideFamilyDesc')}</span>
                                        </li>
                                        <li>
                                            <span className="check-icon warn">💡</span>
                                            <span><strong>{t('guideAccount')}</strong>{t('guideAccountDesc')}</span>
                                        </li>
                                        <li>
                                            <span className="check-icon warn">🌐</span>
                                            <span><strong>{t('guideBindCard')}</strong>{t('guideBindCardDesc')}</span>
                                        </li>
                                    </ul>
                                    <div className="guide-tier-info">
                                        <div className="tier-item">
                                            <span className="tier-badge normal">{t('tierNormal')}</span>
                                            <span dangerouslySetInnerHTML={{ __html: t('tierNormalDesc') }} />
                                        </div>
                                        <div className="tier-item">
                                            <span className="tier-badge pro">{t('tierPro')}</span>
                                            <span dangerouslySetInnerHTML={{ __html: t('tierProDesc') }} />
                                        </div>
                                    </div>

                                </div>
                            </div>
                        ) : (
                            <div className="guide-card guide-card-chatgpt">
                                <div className="guide-card-header">
                                    <span className="guide-card-icon">🤖</span>
                                    <h3>{t('gptServiceTitle')}</h3>
                                </div>
                                <div className="guide-card-body">
                                    <p className="guide-desc" dangerouslySetInnerHTML={{ __html: t('gptServiceDesc') }} />
                                    <ul className="guide-checklist">
                                        <li>
                                            <span className="check-icon success">✅</span>
                                            <span>{t('gptGuide1')}</span>
                                        </li>
                                        <li>
                                            <span className="check-icon success">✅</span>
                                            <span>{t('gptGuide2')}</span>
                                        </li>
                                        <li>
                                            <span className="check-icon success">✅</span>
                                            <span>{t('gptGuide3')}</span>
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Main Verify Content */}
                <div className="verify-content">

                    {/* ===== PIXEL VERIFICATION ===== */}
                    {serviceTab === 'pixel' && (
                        <>
                            {/* Input Panel */}
                            <div className="panel input-panel card">
                                <div className="panel-header">
                                    <div className="panel-title">
                                        <span className="panel-icon">📡</span>
                                        <span>{verifyTier === 'pro' ? t('panelTitlePro') : t('panelTitleStandard')}</span>
                                    </div>
                                </div>

                                <div className="panel-body">
                                    {/* Verify Tier Tabs */}
                                    <div className="tier-tabs">
                                        <button
                                            className={`tier-tab ${verifyTier === 'standard' ? 'active' : ''}`}
                                            onClick={() => {
                                                const stdAvail = serviceStatus?.upixel?.standardAvailable !== false;
                                                if (stdAvail) setVerifyTier('standard');
                                            }}
                                            style={serviceStatus?.upixel?.standardAvailable === false ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                                        >
                                            {t('tierStandardTab')} <span className="tier-cost">1 {t('credits')}</span>
                                            {serviceStatus?.upixel?.standardAvailable === false && (
                                                <span style={{ display: 'block', fontSize: '11px', color: '#dc2626', fontWeight: 600 }}>{t('maintenance')}</span>
                                            )}
                                        </button>
                                        <button
                                            className={`tier-tab tier-tab-pro ${verifyTier === 'pro' ? 'active' : ''}`}
                                            onClick={() => !serviceStatus?.kpixel || serviceStatus.kpixel.available ? setVerifyTier('pro') : null}
                                            style={serviceStatus?.kpixel?.available === false ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                                        >
                                            {t('tierProTab')} <span className="tier-cost">1.5 {t('credits')}</span>
                                            {serviceStatus?.kpixel?.available === false && (
                                                <span style={{ display: 'block', fontSize: '11px', color: '#dc2626', fontWeight: 600 }}>{t('maintenance')}</span>
                                            )}
                                        </button>
                                    </div>

                                    {/* Submit Mode Tabs */}
                                    <div className="submit-mode-tabs">
                                        <button
                                            className={`submit-mode-tab ${submitMode === 'single' ? 'active' : ''}`}
                                            onClick={() => setSubmitMode('single')}
                                        >
                                            <span className="tab-icon-sm">📝</span> {t('singleSubmit')}
                                        </button>
                                        <button
                                            className={`submit-mode-tab ${submitMode === 'batch' ? 'active' : ''}`}
                                            onClick={() => setSubmitMode('batch')}
                                        >
                                            <span className="tab-icon-sm">📋</span> {t('batchSubmit')}
                                        </button>
                                    </div>

                                    {/* Single Mode */}
                                    {submitMode === 'single' && (
                                        <div className="single-input-form">
                                            <div className="pixel-input-group">
                                                <label className="pixel-input-label">
                                                    <span className="label-icon">📧</span> {t('emailLabel')}
                                                </label>
                                                <input
                                                    type="email"
                                                    className="input pixel-field"
                                                    placeholder="user@gmail.com"
                                                    value={singleEmail}
                                                    onChange={e => setSingleEmail(e.target.value)}
                                                    disabled={verifyStatus === 'processing'}
                                                    autoComplete="off"
                                                />
                                            </div>
                                            <div className="pixel-input-group">
                                                <label className="pixel-input-label">
                                                    <span className="label-icon">🔒</span> {t('passwordLabel')}
                                                </label>
                                                <input
                                                    type="password"
                                                    className="input pixel-field"
                                                    placeholder="••••••••"
                                                    value={singlePassword}
                                                    onChange={e => setSinglePassword(e.target.value)}
                                                    disabled={verifyStatus === 'processing'}
                                                    autoComplete="one-time-code"
                                                />
                                            </div>
                                            <div className="pixel-input-group">
                                                <label className="pixel-input-label">
                                                    <span className="label-icon">🔑</span> {t('totpLabel')}
                                                </label>
                                                <input
                                                    type="text"
                                                    className="input pixel-field"
                                                    placeholder="JBSWY3DPEHPK3PXP (Base32)"
                                                    value={singleTotp}
                                                    onChange={e => setSingleTotp(e.target.value.toUpperCase())}
                                                    disabled={verifyStatus === 'processing'}
                                                    autoComplete="off"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Batch Mode */}
                                    {submitMode === 'batch' && (
                                        <div className="batch-input-form">
                                            <textarea
                                                className="input textarea verify-input"
                                                placeholder={t('batchPlaceholder')}
                                                value={batchInput}
                                                onChange={e => setBatchInput(e.target.value)}
                                                disabled={verifyStatus === 'processing'}
                                            />
                                            <div className="batch-count-hint">
                                                {t('batchRecognized')} <strong>{batchCount}</strong> {t('accountUnit')}
                                            </div>
                                        </div>
                                    )}

                                    <div className="input-footer">
                                        <div className="input-info">
                                            <span className="id-count">
                                                {submitMode === 'single' ? `1 ${t('accountUnit')}` : `${batchCount} ${t('accountUnit')}`}
                                            </span>
                                            <span className="slots-info">{t('remaining')} {user ? `${typeof user.credits === 'number' ? user.credits.toFixed(1) : user.credits} ${t('credits')}` : t('notLoggedIn')}</span>
                                        </div>

                                        <div className="input-actions">
                                            <button
                                                className="btn btn-primary btn-lg"
                                                onClick={handleVerify}
                                                disabled={verifyStatus === 'processing' || !user || (user.credits || 0) < tierCost || (submitMode === 'single' ? (!singleEmail.trim() || !singlePassword.trim() || !singleTotp.trim()) : batchCount === 0)}
                                            >
                                                {verifyStatus === 'processing' ? (
                                                    <>
                                                        <span className="loading-spinner small"></span>
                                                        {t('submitting')}
                                                    </>
                                                ) : (
                                                    t('submitVerify')
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
                                        <span className="panel-icon">{showHistory ? '📜' : '📋'}</span>
                                        <span>{showHistory ? t('historyTitle') : t('verifyResults')}</span>
                                        <span className="result-count">({showHistory ? historyData.length : results.length})</span>
                                    </div>
                                    <div className="panel-actions">
                                        <button
                                            className={`btn btn-sm ${showHistory ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => {
                                                const next = !showHistory;
                                                setShowHistory(next);
                                                if (next) fetchUserHistory('pixel');
                                            }}
                                        >
                                            {showHistory ? t('backBtn') : t('historyBtn')}
                                        </button>
                                        {showHistory ? (
                                            <button className="btn btn-sm btn-secondary" onClick={clearHistory} disabled={historyData.length === 0}>
                                                {t('clearBtn')}
                                            </button>
                                        ) : (
                                            <button className="btn btn-sm btn-secondary" onClick={handleClear}>
                                                {t('clearBtn')}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="panel-body">
                                    {showHistory ? (
                                        /* History View */
                                        historyData.length === 0 ? (
                                            <div className="empty-results">
                                                <div className="empty-icon">📜</div>
                                                <p>{t('noHistory')}</p>
                                                <p className="empty-hint">{t('noHistoryHint')}</p>
                                            </div>
                                        ) : (
                                            <div className="results-list">
                                                {historyData.map((item) => {
                                                    let displayStatus = item.status === 'pass' ? 'success' : item.status;
                                                    let displayMsg = item.message || '';
                                                    let displayUrl = item.url;
                                                    if (!displayUrl) {
                                                        const urlMatch = displayMsg.match(/(https?:\/\/[^\s]+)/);
                                                        if (urlMatch) {
                                                            displayUrl = urlMatch[1];
                                                            displayMsg = displayMsg.replace(displayUrl, '').trim();
                                                        }
                                                    }
                                                    displayMsg = displayMsg.replace(/^[A-Za-z]*Pixel\s*(成功|失败)?[:：]?\s*/i, '').trim();
                                                    displayMsg = displayMsg.replace(/^Google One URL:?\s*/i, '').trim();
                                                    displayMsg = displayMsg.replace(/^获取成功[:：]?\s*/i, '').trim();
                                                    displayMsg = displayMsg.replace(/^[❌✅✓✕❗⚠️🔴🟢☑️\s]+/, '').trim();
                                                    
                                                    return (
                                                    <div key={item.id} className={`result-item ${displayStatus}`}>
                                                        <div className="result-status">
                                                            {displayStatus === 'success' && <span className="status-icon success">✓</span>}
                                                            {displayStatus === 'failed' && <span className="status-icon failed">✕</span>}
                                                        </div>
                                                        <div className="result-info">
                                                            <div className="result-main-row">
                                                                <span className="result-id">{maskEmail(item.email)}</span>
                                                            </div>
                                                            <span className="result-message">
                                                                {displayMsg || (displayStatus === 'success' ? t('verifySuccess') : t('verifyFailed'))}
                                                            </span>
                                                            {displayStatus === 'success' && displayUrl && (
                                                                <div className="result-url-row">
                                                                    <a href={displayUrl} target="_blank" rel="noopener noreferrer" className="result-url-link">
                                                                        🔗 {displayUrl.length > 60 ? displayUrl.slice(0, 57) + '...' : displayUrl}
                                                                    </a>
                                                                    <button
                                                                        className="copy-url-btn"
                                                                        onClick={() => navigator.clipboard.writeText(item.url)}
                                                                        title={t('copyLink')}
                                                                    >
                                                                        📋
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="result-meta">
                                                            {item.elapsed > 0 && (
                                                                <span className="result-elapsed">{item.elapsed}s</span>
                                                            )}
                                                            <span className="result-time">
                                                                {item.timestamp ? new Date(item.timestamp).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                )})}
                                            </div>
                                        )
                                    ) : (
                                        /* Current Results View */
                                        results.length === 0 ? (
                                            <div className="empty-results">
                                                <div className="empty-icon">📭</div>
                                                <p>{t('noResultsMsg')}</p>
                                                <p className="empty-hint">{t('noResultsHintAlt')}</p>
                                            </div>
                                        ) : (
                                            <div className="results-list">
                                                {results.map((result) => (
                                                    <div key={result.id} className={`result-item ${result.status}`}>
                                                        <div className="result-status">
                                                            {result.status === 'processing' && <span className="spinner small"></span>}
                                                            {result.status === 'success' && <span className="status-icon success">✓</span>}
                                                            {result.status === 'failed' && <span className="status-icon failed">✕</span>}
                                                        </div>
                                                        <div className="result-info">
                                                            <div className="result-main-row">
                                                                <span className="result-id">{maskEmail(result.email)}</span>

                                                            </div>

                                                            <span className="result-message">
                                                                {(result.message || t('processingMsg')).replace(/^[❌✅✓✕❗⚠️🔴🟢☑️☒🔄⏳◈💎⚡✨🔗\u200d\ufe0f\s]+/, '')}
                                                            </span>
                                                            {result.status === 'success' && result.url && (
                                                                <div className="result-url-row">
                                                                    <a href={result.url} target="_blank" rel="noopener noreferrer" className="result-url-link">
                                                                        🔗 {result.url.length > 60 ? result.url.slice(0, 57) + '...' : result.url}
                                                                    </a>
                                                                    <button
                                                                        className="copy-url-btn"
                                                                        onClick={() => navigator.clipboard.writeText(result.url)}
                                                                        title={t('copyLink')}
                                                                    >
                                                                        📋
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="result-meta">
                                                            {result.elapsed > 0 && (
                                                                <span className="result-elapsed">{result.elapsed}s</span>
                                                            )}
                                                            <span className="result-time">{formatTime(result.timestamp)}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {/* ===== GPT RECHARGE ===== */}
                    {serviceTab === 'gpt' && (
                        <>
                            {/* GPT Input Panel */}
                            <div className="panel input-panel card">
                                <div className="panel-header">
                                    <div className="panel-title">
                                        <span className="panel-icon">🤖</span>
                                        <span>{t('gptPanelTitle')}</span>
                                    </div>
                                    <span className="gpt-cost-badge">{t('gptCostBadge')}</span>
                                </div>
                                <div className="panel-body">
                                    <div className="gpt-panel-body-inner">

                                        {/* Phase 1: Session Input (before account identified) */}
                                        {!gptEmail && !gptSuccess && (
                                            <div className="gpt-session-section">
                                                <div className="gpt-session-header">
                                                    <div className="gpt-session-title">
                                                        <span>📋</span>
                                                        <span>{t('gptPasteSession')}</span>
                                                    </div>
                                                    <a
                                                        href="https://chatgpt.com/api/auth/session"
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="gpt-get-session-btn"
                                                    >
                                                        {t('gptGetSession')}
                                                    </a>
                                                </div>
                                                <div className="gpt-session-help">
                                                    <span className="gpt-help-num">①</span> {t('gptHelp1')}
                                                    <span className="gpt-help-sep">→</span>
                                                    <span className="gpt-help-num">②</span> {t('gptHelp2')}
                                                    <span className="gpt-help-sep">→</span>
                                                    <span className="gpt-help-num">③</span> {t('gptHelp3')}
                                                </div>
                                                <textarea
                                                    className="gpt-session-textarea"
                                                    placeholder='{"user":{"id":"...","name":"...","email":"..."},...}'
                                                    value={gptSession}
                                                    onChange={e => {
                                                        const val = e.target.value;
                                                        setGptSession(val);
                                                        setGptSessionError(false);
                                                        setGptEmail('');
                                                        if (val.trim()) {
                                                            try {
                                                                const parsed = JSON.parse(val);
                                                                if (parsed?.user?.email) {
                                                                    setGptEmail(parsed.user.email);
                                                                } else if (parsed?.user?.name) {
                                                                    setGptEmail(parsed.user.name);
                                                                } else {
                                                                    setGptSessionError(true);
                                                                }
                                                            } catch {
                                                                setGptSessionError(true);
                                                            }
                                                        }
                                                    }}
                                                    disabled={gptRecharging}
                                                />
                                                {gptSessionError && (
                                                    <div className="gpt-parse-error">
                                                        <span>⚠️</span> {t('gptParseError')}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Phase 2: Account Confirmed Card */}
                                        {gptEmail && !gptSuccess && (
                                            <div className="gpt-account-card">
                                                <div className="gpt-account-avatar">
                                                    {gptEmail.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="gpt-account-info">
                                                    <div className="gpt-account-label">{t('gptAccountLinked')}</div>
                                                    <div className="gpt-account-email">{gptEmail}</div>
                                                </div>
                                                <button
                                                    className="gpt-account-change"
                                                    onClick={() => { setGptSession(''); setGptEmail(''); setGptSessionError(false); }}
                                                    disabled={gptRecharging}
                                                >
                                                    {t('gptChangeAccount')}
                                                </button>
                                            </div>
                                        )}

                                        {/* Error Messages */}
                                        {gptError && (
                                            <div className="gpt-error-msg">
                                                <span>❌</span> {gptError}
                                            </div>
                                        )}

                                        {/* Recharge Button */}
                                        {!gptSuccess && (
                                            <button
                                                className="gpt-recharge-btn"
                                                disabled={!gptEmail || !user || gptRecharging || (user?.credits || 0) < 2}
                                                onClick={async () => {
                                                    setGptRecharging(true);
                                                    setGptError('');
                                                    setGptResultMsg('');
                                                    const token = getToken();
                                                    try {
                                                        const exRes = await fetch(`${API_BASE}/api/gpt/exchange`, {
                                                            method: 'POST',
                                                            headers: {
                                                                'Content-Type': 'application/json',
                                                                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                                                            },
                                                            body: JSON.stringify({}),
                                                        });
                                                        const exData = await exRes.json();
                                                        if (!exRes.ok || !exData.success) {
                                                            setGptError(sanitizeError(exData.detail) || t('gptCardExchangeFailed'));
                                                            setGptRecharging(false);
                                                            return;
                                                        }
                                                        setGptCardKey(exData.card_key);
                                                        setGptChannel(exData.channel || 'sbs');
                                                        const reRes = await fetch(`${API_BASE}/api/gpt/recharge`, {
                                                            method: 'POST',
                                                            headers: {
                                                                'Content-Type': 'application/json',
                                                                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                                                            },
                                                            body: JSON.stringify({
                                                                card_key: exData.card_key,
                                                                account: gptSession,
                                                                email: gptEmail,
                                                                channel: exData.channel || 'sbs',
                                                            }),
                                                        });
                                                        const reData = await reRes.json();
                                                        if (reRes.ok && reData.success) {
                                                            setGptSuccess(true);
                                                            setGptResultMsg(t('gptRechargeSuccess'));
                                                            await refreshUser();
                                                            fetchUserHistory('gpt');
                                                        } else {
                                                            setGptError(sanitizeError(reData.detail) || t('gptRechargeFailed'));
                                                        }
                                                    } catch (e) {
                                                        setGptError(sanitizeError(e.message));
                                                    } finally {
                                                        setGptRecharging(false);
                                                    }
                                                }}
                                            >
                                                {gptRecharging ? (
                                                    <><span className="loading-spinner small"></span> {t('gptRecharging')}</>
                                                ) : (
                                                    <>{t('gptStartRecharge')}</>
                                                )}
                                            </button>
                                        )}

                                        {/* Insufficient points warning */}
                                        {user && (user.credits || 0) < 2 && !gptSuccess && (
                                            <div className="gpt-error-msg">
                                                <span>⚠️</span> {t('gptInsufficientCredits').replace('{credits}', user.credits || 0)}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* GPT Results Panel */}
                            <div className="panel results-panel card">
                                <div className="panel-header">
                                    <div className="panel-title">
                                        <span className="panel-icon">{showGptHistory ? '📜' : '📋'}</span>
                                        <span>{showGptHistory ? t('gptRechargeHistoryTitle') : t('gptRechargeResultTitle')}</span>
                                        {showGptHistory && <span className="result-count">({gptHistoryData.length})</span>}
                                    </div>
                                    <div className="panel-actions">
                                        <button
                                            className={`btn btn-sm ${showGptHistory ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => {
                                                const next = !showGptHistory;
                                                setShowGptHistory(next);
                                                if (next) fetchUserHistory('gpt');
                                            }}
                                        >
                                            {showGptHistory ? t('backBtn') : t('historyBtn')}
                                        </button>
                                        {showGptHistory && (
                                            <button className="btn btn-sm btn-secondary" onClick={clearGptHistory} disabled={gptHistoryData.length === 0}>
                                                {t('clearBtn')}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="panel-body">
                                    {showGptHistory ? (
                                        gptHistoryData.length === 0 ? (
                                            <div className="empty-results">
                                                <div className="empty-icon">📜</div>
                                                <p>{t('gptNoHistory')}</p>
                                                <p className="empty-hint">{t('gptNoHistoryHint')}</p>
                                            </div>
                                        ) : (
                                            <div className="results-list">
                                                {gptHistoryData.map((item) => {
                                                    let displayStatus = item.status === 'pass' || item.status === 'success' ? 'success' : 'failed';
                                                    let displayMsg = (item.message || '').replace(/^[❌✅✓✕❗⚠️🔴🟢☑️\s]+/, '').trim();
                                                    
                                                    return (
                                                    <div key={item.id} className={`result-item ${displayStatus}`}>
                                                        <div className="result-status">
                                                            {displayStatus === 'success' && <span className="status-icon success">✓</span>}
                                                            {displayStatus !== 'success' && <span className="status-icon failed">✕</span>}
                                                        </div>
                                                        <div className="result-info">
                                                            <div className="result-main-row">
                                                                <span className="result-id">{item.email || 'ChatGPT'}</span>
                                                            </div>
                                                            <span className="result-message">{displayMsg || (displayStatus === 'success' ? t('rechargeSuccess') : t('rechargeFailed'))}</span>
                                                        </div>
                                                        <div className="result-meta">
                                                            <span className="result-time">{formatTime(item.timestamp)}</span>
                                                        </div>
                                                    </div>
                                                )})}
                                            </div>
                                        )
                                    ) : (
                                        <>
                                            {!gptSuccess && !gptRecharging && !gptResultMsg && (
                                                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-tertiary)' }}>
                                                    <p>{t('gptResultHint')}</p>
                                                    <p style={{ fontSize: '13px', marginTop: '8px' }}>{t('gptResultNote')}</p>
                                                </div>
                                            )}
                                            {gptRecharging && (
                                                <div style={{ textAlign: 'center', padding: '32px' }}>
                                                    <span className="loading-spinner"></span>
                                                    <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>{t('gptRechargingMsg')}</p>
                                                </div>
                                            )}
                                            {gptSuccess && (
                                                <div style={{ textAlign: 'center', padding: '24px' }}>
                                                    <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎉</div>
                                                    <h3 style={{ color: '#059669', marginBottom: '8px' }}>{t('gptSuccessTitle')}</h3>
                                                    <p style={{ color: 'var(--text-secondary)' }} dangerouslySetInnerHTML={{ __html: t('gptSuccessDesc').replace('{email}', gptEmail) }} />
                                                    <button
                                                        className="btn btn-primary"
                                                        style={{ marginTop: '16px' }}
                                                        onClick={() => {
                                                            setGptSession('');
                                                            setGptEmail('');
                                                            setGptSuccess(false);
                                                            setGptResultMsg('');
                                                            setGptError('');
                                                            setGptCardKey('');
                                                        }}
                                                    >
                                                        {t('gptContinue')}
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                    {/* Credits Action Buttons (shared across tabs) */}
                    <div className="credits-actions-row">
                        <button
                            className="credits-action-btn redeem"
                            onClick={() => setShowCdkInput(!showCdkInput)}
                        >
                            <span className="credits-action-icon">🎁</span>
                            <span>{t('redeemCredits')}</span>
                        </button>
                        <a
                            href="https://haodongxi.shop"
                            className="credits-action-btn purchase"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <span className="credits-action-icon">🛒</span>
                            <span>{t('purchaseCredits')}</span>
                        </a>
                    </div>

                    {/* CDK Redeem Card */}
                    {showCdkInput && (
                        <div className="cdk-redeem-card">
                            <div className="cdk-redeem-header">
                                <div className="cdk-redeem-glow"></div>
                                <span className="cdk-redeem-icon">🎫</span>
                                <div className="cdk-redeem-title-group">
                                    <span className="cdk-redeem-title">{t('cdkRedeemTitle')}</span>
                                    <span className="cdk-redeem-subtitle">{t('cdkRedeemSubtitle')}</span>
                                </div>
                            </div>
                            <div className="cdk-redeem-body">
                                <div className="cdk-redeem-input-wrapper">
                                    <div className={`cdk-redeem-input-box ${cdkRedeemStatus === 'error' ? 'error' : ''} ${cdkChecking ? 'checking' : ''} ${cdkRedeemStatus === 'success' ? 'success' : ''}`}>
                                        <span className="cdk-redeem-key-icon">🔑</span>
                                        <input
                                            type="text"
                                            className="cdk-redeem-input"
                                            placeholder="VK-XXXX-XXXX-XXXX"
                                            value={cdkCode}
                                            onChange={(e) => {
                                                const val = e.target.value.toUpperCase().replace(/O/g, '0').replace(/I/g, '1');
                                                setCdkCode(val);
                                                setCdkRedeemMsg('');
                                                setCdkRedeemStatus('');
                                            }}
                                            onKeyDown={(e) => e.key === 'Enter' && handleRedeemCdk()}
                                            autoFocus
                                            spellCheck={false}
                                        />
                                        {cdkChecking && <span className="cdk-redeem-spinner"></span>}
                                        {!cdkChecking && cdkCode.trim() && (
                                            <button
                                                className="cdk-redeem-submit-btn"
                                                onClick={handleRedeemCdk}
                                                disabled={!cdkCode.trim()}
                                            >
                                                {t('cdkRedeem')}
                                            </button>
                                        )}
                                    </div>
                                    {cdkRedeemMsg && (
                                        <div className={`cdk-redeem-msg ${cdkRedeemStatus}`}>
                                            <span>{cdkRedeemStatus === 'success' ? '✅' : '⚠️'}</span>
                                            <span>{cdkRedeemMsg}</span>
                                        </div>
                                    )}
                                </div>


                            </div>
                        </div>
                    )}
                    {/* Dashboard Content - Live Status (pixel tab only) */}
                    {serviceTab === 'pixel' && (
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
                                </div>
                                {statusData.length > 0 && (
                                    <span className="status-updated-time">
                                        updated: {formatTime(statusData[statusData.length - 1]?.timestamp)}
                                    </span>
                                )}
                            </div>
                            <div className="status-grid-container">
                                <div className="status-grid three-rows">
                                    {statusData.slice(-120).map((item) => (
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
                                                                '⏳ Processing'}
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
                                    {tipsContent ? (
                                        tipsContent.split('\n').filter(line => line.trim()).map((line, i) => (
                                            <p key={i}>
                                                {line.split(/(https?:\/\/[^\s]+)/g).map((part, j) =>
                                                    /^https?:\/\//.test(part)
                                                        ? <a key={j} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
                                                        : part
                                                )}
                                            </p>
                                        ))
                                    ) : (
                                        <>
                                            <p>{t('defaultTip1')}</p>
                                            <p>{t('defaultTip2')}</p>
                                            <p>{t('defaultTip3')}</p>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}
