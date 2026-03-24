import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLang } from '../../stores/LanguageContext';
import { useAuth } from '../../stores/AuthContext';
import './Verify.css';

// API base URL
const API_BASE = import.meta.env.DEV ? 'http://localhost:3002' : '';

// Error code descriptions
const ERROR_DESCRIPTIONS = {
    INTERNAL_ERROR: '系统内部错误',
    DEVICE_UNAVAILABLE: '设备不可用',
    DEVICE_PREP_FAILED: '设备准备失败',
    PROXY_ERROR: '代理连接错误',
    PASSKEY_BLOCKED: '账号要求 Passkey 验证',
    CAPTCHA: '遇到人机验证',
    ACCOUNT_DISABLED: '账号已被停用/锁定',
    INVALID_EMAIL: '邮箱地址无效',
    WRONG_PASSWORD: '密码错误',
    TOTP_ERROR: 'TOTP 验证码错误',
    NO_AUTHENTICATOR: '账号未启用 TOTP 验证器',
    SIGNIN_PAGE_FAILED: '登录页面加载失败',
    TWOFACTOR_PAGE_ERROR: '两步验证页面异常',
    GOOGLE_LOGIN_ERROR: 'Google 登录异常',
    GOOGLE_ONE_UNAVAILABLE: '该账号不可使用 Google One',
    URL_CAPTURE_FAILED: '链接获取失败',
    SIGNIN_FAILED: '登录失败',
    ACCOUNT_NOT_DETECTED: '未检测到账号',
    BROWSER_LOGIN_FAILED: '浏览器登录失败',
    UNKNOWN_ERROR: '未知错误',
};

// Sanitize error messages to hide supplier info from users
const sanitizeError = (msg) => {
    if (!msg || typeof msg !== 'string') return '操作失败，请稍后重试';
    // Check if the error code has a known description
    if (ERROR_DESCRIPTIONS[msg]) return ERROR_DESCRIPTIONS[msg];
    // Strip supplier references
    const blocked = /pixel|iqless|kckc|1688ai|vpixel|kpixel|upixel|api\s*key|cdkey|X-API/i;
    if (blocked.test(msg)) return '服务暂时不可用，请稍后重试';
    // Keep user-relevant messages (Chinese messages are usually safe)
    if (/积分|余额|登录|过期|参数|不足|未启用|未配置|密码|验证|账号|邮箱/.test(msg)) return msg;
    // Generic long English errors → hide
    if (msg.length > 60 && /[a-zA-Z]/.test(msg)) return '操作失败，请稍后重试';
    return msg;
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
    const [historyData, setHistoryData] = useState(() => {
        try { return JSON.parse(localStorage.getItem('verifykey-history') || '[]'); } catch { return []; }
    });
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
            setCdkRedeemMsg('请先登录后再兑换积分');
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
                setCdkRedeemMsg(data.detail || data.message || '兑换失败');
                setCdkRedeemStatus('error');
            }
        } catch (e) {
            setCdkRedeemMsg('网络错误，请稍后重试');
            setCdkRedeemStatus('error');
        } finally {
            setCdkChecking(false);
        }
    };

    // Parse batch input into account entries
    const parseBatchInput = (text) => {
        return text.split('\n')
            .map(line => line.trim())
            .filter(line => line && line.includes('----'))
            .map(line => {
                const parts = line.split('----').map(p => p.trim());
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
                    message: `⏳ 已提交，排队中...`,
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

                if (status === 'Success') {
                    clearInterval(intervalId);
                    delete pollingRefs.current[resultId];
                    const resultUrl = info.url || '';
                    setResults(prev => prev.map(r =>
                        r.id === resultId ? {
                            ...r,
                            status: 'success',
                            message: `✅ ${message || '验证成功'}`,
                            url: resultUrl,
                            stageLabel: 'DONE',
                            totalStages: 0,
                        } : r
                    ));
                    // Deduct appropriate credits based on source
                    setResults(prev => {
                        const result = prev.find(r => r.id === resultId);
                        const cost = result?.source === 'ypixel' ? 1.0 : 1.5;
                        setCdkRemaining(p => Math.max(0, p - cost));
                        return prev;
                    });
                } else if (status === 'Failed') {
                    clearInterval(intervalId);
                    delete pollingRefs.current[resultId];
                    setResults(prev => prev.map(r =>
                        r.id === resultId ? {
                            ...r,
                            status: 'failed',
                            message: `❌ ${sanitizeError(message) || '验证失败'}`,
                        } : r
                    ));
                } else {
                    // Pending or Running
                    setResults(prev => prev.map(r =>
                        r.id === resultId ? {
                            ...r,
                            message: status === 'Running'
                                ? `🔄 ${message || '运行中...'}`
                                : `⏳ 排队中...`,
                            stageLabel: status === 'Running' ? '运行中' : '排队中',
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
                    const url = data.url || '';
                    setResults(prev => prev.map(r =>
                        r.id === resultId ? {
                            ...r,
                            status: 'success',
                            message: '✅ 获取成功',
                            url,
                            stage,
                            totalStages,
                            stageLabel: 'DONE',
                            elapsed: Math.round(elapsed),
                        } : r
                    ));
                    setCdkRemaining(prev => Math.max(0, prev - 1));
                    fetchHistory();
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
                                : `⏳ 排队中 (位置: ${data.queue_position >= 0 ? data.queue_position : '-'})`,
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
            alert('请先登录后再提交验证');
            return;
        }
        if ((user.credits || 0) < tierCost) {
            alert(`账户积分不足（需要 ${tierCost} 积分，当前 ${user.credits || 0}）`);
            return;
        }

        let accounts = [];

        if (submitMode === 'single') {
            if (!singleEmail.trim() || !singlePassword.trim() || !singleTotp.trim()) {
                alert('请填写所有字段');
                return;
            }
            accounts = [{ email: singleEmail.trim(), password: singlePassword.trim(), totp_secret: singleTotp.trim() }];
        } else {
            accounts = parseBatchInput(batchInput);
            if (accounts.length === 0) {
                alert('请输入有效的账号信息，格式：邮箱----密码----2FA密钥');
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
            message: '⏳ 提交中...',
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

    // Save completed results to history
    useEffect(() => {
        const completed = results.filter(r => r.status === 'success' || r.status === 'failed');
        if (completed.length === 0) return;
        setHistoryData(prev => {
            const existingIds = new Set(prev.map(h => h.id));
            const newEntries = completed.filter(r => !existingIds.has(r.id)).map(r => ({
                id: r.id, email: r.email, status: r.status, message: r.message,
                url: r.url || '', elapsed: r.elapsed || 0, timestamp: r.timestamp || Date.now(),
            }));
            if (newEntries.length === 0) return prev;
            const updated = [...newEntries, ...prev].slice(0, 100);
            localStorage.setItem('verifykey-history', JSON.stringify(updated));
            return updated;
        });
    }, [results]);

    const clearHistory = () => {
        setHistoryData([]);
        localStorage.removeItem('verifykey-history');
    };

    const handleExport = () => {
        const successResults = results.filter(r => r.status === 'success');
        const text = successResults.map(r => {
            let line = r.email;
            if (r.url) line += '\n' + r.url;
            return line;
        }).join('\n\n');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pixel-results-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const getStatusBadge = () => {
        switch (verifyStatus) {
            case 'processing':
                return <span className="badge badge-warning"><span className="pulse-dot"></span>提交中...</span>;
            case 'success':
                return <span className="badge badge-success">✓ 完成</span>;
            default:
                return <span className="badge badge-info">● 就绪</span>;
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
                            <span className="gradient-text">Google One Console</span>
                        </h1>
                        <p className="welcome-desc">
                            提交 Google 账号信息，自动获取 Google One 合作伙伴试用链接
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
                        <span className="service-tab-icon">📡</span>
                        <span>Gemini 验证</span>
                    </button>
                    <button
                        className={`service-tab service-tab-gpt ${serviceTab === 'gpt' ? 'active' : ''}`}
                        onClick={() => setServiceTab('gpt')}
                    >
                        <span className="service-tab-icon">🤖</span>
                        <span>ChatGPT 充值</span>
                        {serviceStatus?.gpt?.available === false && (
                            <span style={{ fontSize: '10px', color: '#dc2626', fontWeight: 600, marginLeft: '6px' }}>🔧 维护中</span>
                        )}
                    </button>
                </div>

                {/* Guide / Tutorial Toggle */}
                <div className="guide-toggle-bar" onClick={() => setShowGuide(!showGuide)}>
                    <span className="guide-toggle-label">
                        <span className="guide-toggle-icon">📖</span>
                        使用教程 & 积分规则
                    </span>
                    <span className={`guide-toggle-arrow ${showGuide ? 'open' : ''}`}>▾</span>
                </div>

                {showGuide && (
                    <div className="guide-section">
                        {/* Credits Rules + Invite (merged) */}
                        <div className="guide-card guide-card-credits">
                            <div className="guide-card-header">
                                <span className="guide-card-icon">💰</span>
                                <h3>积分规则 & 邀请奖励</h3>
                            </div>
                            <div className="guide-card-body">
                                <div className="credits-price-grid">
                                    <div className="credits-price-item">
                                        <div className="credits-price-service">
                                            <span className="credits-dot gemini"></span>
                                            Gemini 普通认证
                                        </div>
                                        <span className="credits-price-val">-1 积分</span>
                                    </div>
                                    <div className="credits-price-item">
                                        <div className="credits-price-service">
                                            <span className="credits-dot pro"></span>
                                            Gemini 高级认证
                                        </div>
                                        <span className="credits-price-val">-1.5 积分</span>
                                    </div>
                                    <div className="credits-price-item">
                                        <div className="credits-price-service">
                                            <span className="credits-dot gpt"></span>
                                            ChatGPT 月度充值
                                        </div>
                                        <span className="credits-price-val">-2 积分</span>
                                    </div>
                                    <div className="credits-price-item invite">
                                        <div className="credits-price-service">
                                            <span className="credits-dot invite"></span>
                                            邀请奖励
                                        </div>
                                        <span className="credits-price-val positive">+0.2 积分 / 人</span>
                                    </div>
                                </div>
                                <p className="guide-note warn">⚠️ 被邀请用户注册后需首次兑换卡密，邀请人才能获得奖励积分</p>
                                <p className="guide-note" style={{ marginTop: '6px' }}>✨ 所有服务积分通用，可通过 CDK 兑换或邀请获取</p>
                            </div>
                        </div>

                        {/* Service Guide — conditional on tab */}
                        {serviceTab === 'pixel' ? (
                            <div className="guide-card guide-card-gemini">
                                <div className="guide-card-header">
                                    <span className="guide-card-icon">📡</span>
                                    <h3>Gemini 验证服务</h3>
                                </div>
                                <div className="guide-card-body">
                                    <p className="guide-desc">此服务为通过 Pixel 获取 <strong>Gemini Advanced 1 年 Pro 订阅</strong>，由 OnePASS 全自动完成。</p>
                                    <ul className="guide-checklist">
                                        <li>
                                            <span className="check-icon required">🔐</span>
                                            <span><strong>2FA 验证：</strong>必须开启，并设置好 Google Authenticator
                                                <a href="https://www.notion.so/2FA-32cfb1c3c17c807e83bdcb371212e287?source=copy_link"
                                                    target="_blank" rel="noopener noreferrer"
                                                    style={{
                                                        background: 'rgba(99,102,241,0.1)', color: '#6366f1',
                                                        border: 'none', borderRadius: '6px', padding: '1px 8px',
                                                        fontSize: '11px', fontWeight: 600, textDecoration: 'none',
                                                        marginLeft: '6px', verticalAlign: 'middle',
                                                    }}
                                                >查看教程 ▸</a>
                                            </span>
                                        </li>
                                        <li>
                                            <span className="check-icon required">🌍</span>
                                            <span>
                                                <strong>地区要求：</strong>需在支持区域内
                                                <button
                                                    onClick={(e) => { e.preventDefault(); document.querySelector('.region-popover').classList.toggle('show'); document.querySelector('.region-backdrop').classList.toggle('show'); }}
                                                    style={{
                                                        background: 'rgba(99,102,241,0.1)', color: '#6366f1',
                                                        border: 'none', borderRadius: '6px', padding: '1px 8px',
                                                        fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                                                        marginLeft: '6px', verticalAlign: 'middle',
                                                    }}
                                                >查看支持地区 ▸</button>
                                                <div className="region-backdrop" onClick={() => { document.querySelector('.region-popover').classList.remove('show'); document.querySelector('.region-backdrop').classList.remove('show'); }} />
                                                <div className="region-popover">
                                                    <div className="region-popover-title">
                                                        <span>🌍 支持的国家和地区</span>
                                                        <small>共 33 个</small>
                                                    </div>
                                                    <div className="region-tags-grid">
                                                        {['🇦🇺 澳洲','🇦🇹 奥地利','🇧🇪 比利时','🇨🇦 加拿大','🇨🇿 捷克','🇩🇰 丹麦','🇪🇪 爱沙尼亚','🇫🇮 芬兰',
                                                          '🇫🇷 法国','🇩🇪 德国','🇭🇺 匈牙利','🇮🇳 印度','🇮🇪 爱尔兰','🇮🇹 意大利','🇯🇵 日本','🇱🇻 拉脱维亚',
                                                          '🇱🇹 立陶宛','🇲🇾 马来西亚','🇲🇽 墨西哥','🇳🇱 荷兰','🇳🇴 挪威','🇵🇱 波兰','🇵🇹 葡萄牙','🇷🇴 罗马尼亚',
                                                          '🇸🇬 新加坡','🇸🇰 斯洛伐克','🇸🇮 斯洛维尼亚','🇪🇸 西班牙','🇸🇪 瑞典','🇨🇭 瑞士','🇹🇼 台湾','🇬🇧 英国','🇺🇸 美国'
                                                        ].map((c, i) => (
                                                            <span key={i} className="region-tag">{c}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </span>
                                        </li>
                                        <li>
                                            <span className="check-icon required">👨‍👩‍👦</span>
                                            <span><strong>家庭组：</strong>必须退出，确保无订阅过</span>
                                        </li>
                                        <li>
                                            <span className="check-icon warn">💡</span>
                                            <span><strong>账号建议：</strong>建议使用老号，新号极其容易封控，导致账号无法登录</span>
                                        </li>
                                        <li>
                                            <span className="check-icon warn">🌐</span>
                                            <span><strong>绑卡注意：</strong>绑卡时浏览器只能登录你要升级的账号，请先退出其他 Google 账号</span>
                                        </li>
                                    </ul>
                                    <div className="guide-tier-info">
                                        <div className="tier-item">
                                            <span className="tier-badge normal">普通</span>
                                            <span>认证完成后需 <strong>自行绑卡</strong>，如无信用卡可往商城购买</span>
                                        </div>
                                        <div className="tier-item">
                                            <span className="tier-badge pro">高级</span>
                                            <span>一条龙服务，认证完成后 <strong>自动绑卡</strong></span>
                                        </div>
                                    </div>

                                </div>
                            </div>
                        ) : (
                            <div className="guide-card guide-card-chatgpt">
                                <div className="guide-card-header">
                                    <span className="guide-card-icon">🤖</span>
                                    <h3>ChatGPT 充值服务</h3>
                                </div>
                                <div className="guide-card-body">
                                    <p className="guide-desc">应用户需求，现推出 <strong>ChatGPT Plus 月度自动充值</strong>服务，产品无质保。</p>
                                    <ul className="guide-checklist">
                                        <li>
                                            <span className="check-icon success">✅</span>
                                            <span>获取Session的前提是浏览器已经登陆ChatGPT</span>
                                        </li>
                                        <li>
                                            <span className="check-icon success">✅</span>
                                            <span>新号 / 老号均可充值</span>
                                        </li>
                                        <li>
                                            <span className="check-icon success">✅</span>
                                            <span>提前续费，时间会直接覆盖并非延续</span>
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
                                        <span>{verifyTier === 'pro' ? '高级提交-自动完成绑卡' : '普通提交-验证完成之后需自行绑卡'}</span>
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
                                            📦 普通验证 <span className="tier-cost">1 积分</span>
                                            {serviceStatus?.upixel?.standardAvailable === false && (
                                                <span style={{ display: 'block', fontSize: '11px', color: '#dc2626', fontWeight: 600 }}>🔧 维护中</span>
                                            )}
                                        </button>
                                        <button
                                            className={`tier-tab tier-tab-pro ${verifyTier === 'pro' ? 'active' : ''}`}
                                            onClick={() => !serviceStatus?.kpixel || serviceStatus.kpixel.available ? setVerifyTier('pro') : null}
                                            style={serviceStatus?.kpixel?.available === false ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                                        >
                                            ⚡ 高级验证 <span className="tier-cost">1.5 积分</span>
                                            {serviceStatus?.kpixel?.available === false && (
                                                <span style={{ display: 'block', fontSize: '11px', color: '#dc2626', fontWeight: 600 }}>🔧 维护中</span>
                                            )}
                                        </button>
                                    </div>

                                    {/* Submit Mode Tabs */}
                                    <div className="submit-mode-tabs">
                                        <button
                                            className={`submit-mode-tab ${submitMode === 'single' ? 'active' : ''}`}
                                            onClick={() => setSubmitMode('single')}
                                        >
                                            <span className="tab-icon-sm">📝</span> 单个提交
                                        </button>
                                        <button
                                            className={`submit-mode-tab ${submitMode === 'batch' ? 'active' : ''}`}
                                            onClick={() => setSubmitMode('batch')}
                                        >
                                            <span className="tab-icon-sm">📋</span> 批量提交
                                        </button>
                                    </div>

                                    {/* Single Mode */}
                                    {submitMode === 'single' && (
                                        <div className="single-input-form">
                                            <div className="pixel-input-group">
                                                <label className="pixel-input-label">
                                                    <span className="label-icon">📧</span> 账号邮箱
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
                                                    <span className="label-icon">🔒</span> 账号密码
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
                                                    <span className="label-icon">🔑</span> 2FA 密钥
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
                                                placeholder={`邮箱----密码----辅助邮箱----2FA密钥\n或：邮箱----密码----2FA密钥\n\n示例：\ntest@gmail.com----password----backup@mail.com----JBSWY3DPEHPK3PXP\ntest@gmail.com----password----JBSWY3DPEHPK3PXP`}
                                                value={batchInput}
                                                onChange={e => setBatchInput(e.target.value)}
                                                disabled={verifyStatus === 'processing'}
                                            />
                                            <div className="batch-count-hint">
                                                已识别 <strong>{batchCount}</strong> 个账号
                                            </div>
                                        </div>
                                    )}

                                    <div className="input-footer">
                                        <div className="input-info">
                                            <span className="id-count">
                                                {submitMode === 'single' ? '1 个账号' : `${batchCount} 个账号`}
                                            </span>
                                            <span className="slots-info">剩余: {user ? `${typeof user.credits === 'number' ? user.credits.toFixed(1) : user.credits} 积分` : '未登录'}</span>
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
                                                        提交中...
                                                    </>
                                                ) : (
                                                    '🚀 提交验证'
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
                                        <span>{showHistory ? '历史记录' : '验证结果'}</span>
                                        <span className="result-count">({showHistory ? historyData.length : results.length})</span>
                                    </div>
                                    <div className="panel-actions">
                                        <button
                                            className={`btn btn-sm ${showHistory ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => setShowHistory(!showHistory)}
                                        >
                                            {showHistory ? '← 返回' : '📜 历史'}
                                        </button>
                                        {showHistory ? (
                                            <button className="btn btn-sm btn-secondary" onClick={clearHistory} disabled={historyData.length === 0}>
                                                清除历史
                                            </button>
                                        ) : (
                                            <>
                                                <button className="btn btn-sm btn-secondary" onClick={handleClear}>
                                                    清除
                                                </button>
                                                <button
                                                    className="btn btn-sm btn-secondary"
                                                    onClick={handleExport}
                                                    disabled={results.filter(r => r.status === 'success').length === 0}
                                                >
                                                    导出
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="panel-body">
                                    {showHistory ? (
                                        /* History View */
                                        historyData.length === 0 ? (
                                            <div className="empty-results">
                                                <div className="empty-icon">📜</div>
                                                <p>暂无历史记录</p>
                                                <p className="empty-hint">提交完成后的结果会自动保存在这里</p>
                                            </div>
                                        ) : (
                                            <div className="results-list">
                                                {historyData.map((item) => (
                                                    <div key={item.id} className={`result-item ${item.status}`}>
                                                        <div className="result-status">
                                                            {item.status === 'success' && <span className="status-icon success">✓</span>}
                                                            {item.status === 'failed' && <span className="status-icon failed">✕</span>}
                                                        </div>
                                                        <div className="result-info">
                                                            <div className="result-main-row">
                                                                <span className="result-id">{maskEmail(item.email)}</span>
                                                            </div>
                                                            <span className="result-message">
                                                                {(item.message || '').replace(/^[❌✅✓✕❗⚠️🔴🟢☑️☒\s]+/, '') || (item.status === 'success' ? '验证成功' : '验证失败')}
                                                            </span>
                                                            {item.status === 'success' && item.url && (
                                                                <div className="result-url-row">
                                                                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="result-url-link">
                                                                        🔗 {item.url.length > 60 ? item.url.slice(0, 57) + '...' : item.url}
                                                                    </a>
                                                                    <button
                                                                        className="copy-url-btn"
                                                                        onClick={() => navigator.clipboard.writeText(item.url)}
                                                                        title="复制链接"
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
                                                                {item.timestamp ? new Date(item.timestamp).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )
                                    ) : (
                                        /* Current Results View */
                                        results.length === 0 ? (
                                            <div className="empty-results">
                                                <div className="empty-icon">📭</div>
                                                <p>暂无结果</p>
                                                <p className="empty-hint">提交账号信息后，结果将显示在这里</p>
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
                                                                {(result.message || '处理中...').replace(/^[❌✅✓✕❗⚠️🔴🟢☑️☒\s]+/, '')}
                                                            </span>
                                                            {result.status === 'success' && result.url && (
                                                                <div className="result-url-row">
                                                                    <a href={result.url} target="_blank" rel="noopener noreferrer" className="result-url-link">
                                                                        🔗 {result.url.length > 60 ? result.url.slice(0, 57) + '...' : result.url}
                                                                    </a>
                                                                    <button
                                                                        className="copy-url-btn"
                                                                        onClick={() => navigator.clipboard.writeText(result.url)}
                                                                        title="复制链接"
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
                                        <span>ChatGPT Plus 月度充值</span>
                                    </div>
                                    <span className="gpt-cost-badge">⚡ 2 积分 / 次</span>
                                </div>
                                <div className="panel-body">
                                    <div className="gpt-panel-body-inner">

                                        {/* Phase 1: Session Input (before account identified) */}
                                        {!gptEmail && !gptSuccess && (
                                            <div className="gpt-session-section">
                                                <div className="gpt-session-header">
                                                    <div className="gpt-session-title">
                                                        <span>📋</span>
                                                        <span>粘贴 ChatGPT Session</span>
                                                    </div>
                                                    <a
                                                        href="https://chatgpt.com/api/auth/session"
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="gpt-get-session-btn"
                                                    >
                                                        🔗 获取 Session
                                                    </a>
                                                </div>
                                                <div className="gpt-session-help">
                                                    <span className="gpt-help-num">①</span> 在浏览器登录 ChatGPT
                                                    <span className="gpt-help-sep">→</span>
                                                    <span className="gpt-help-num">②</span> 点击上方「获取 Session」按钮
                                                    <span className="gpt-help-sep">→</span>
                                                    <span className="gpt-help-num">③</span> 复制内容粘贴到下方
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
                                                        <span>⚠️</span> 无法识别账号，请确保粘贴了完整的 Session JSON
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
                                                    <div className="gpt-account-label">已绑定 ChatGPT 账号</div>
                                                    <div className="gpt-account-email">{gptEmail}</div>
                                                </div>
                                                <button
                                                    className="gpt-account-change"
                                                    onClick={() => { setGptSession(''); setGptEmail(''); setGptSessionError(false); }}
                                                    disabled={gptRecharging}
                                                >
                                                    更换
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
                                                            setGptError(sanitizeError(exData.detail) || '卡密兑换失败');
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
                                                            setGptResultMsg('充值成功！');
                                                            await refreshUser();
                                                        } else {
                                                            setGptError(sanitizeError(reData.detail) || '充值失败，请稍后重试');
                                                        }
                                                    } catch (e) {
                                                        setGptError(sanitizeError(e.message));
                                                    } finally {
                                                        setGptRecharging(false);
                                                    }
                                                }}
                                            >
                                                {gptRecharging ? (
                                                    <><span className="loading-spinner small"></span> 正在充值，请稍候...</>
                                                ) : (
                                                    <>⚡ 开始充值</>
                                                )}
                                            </button>
                                        )}

                                        {/* Insufficient points warning */}
                                        {user && (user.credits || 0) < 2 && !gptSuccess && (
                                            <div className="gpt-error-msg">
                                                <span>⚠️</span> 积分不足，需要 2 积分，当前剩余 {user.credits || 0} 积分
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* GPT Results Panel */}
                            <div className="panel results-panel card">
                                <div className="panel-header">
                                    <div className="panel-title">
                                        <span className="panel-icon">📋</span>
                                        <span>充值结果</span>
                                    </div>
                                </div>
                                <div className="panel-body">
                                    {!gptSuccess && !gptRecharging && !gptResultMsg && (
                                        <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-tertiary)' }}>
                                            <p>📡 粘贴 ChatGPT Session 信息后点击充值按钮</p>
                                            <p style={{ fontSize: '13px', marginTop: '8px' }}>⚠️ 请确保 ChatGPT 已登录，充值成功后扣除 2 积分</p>
                                        </div>
                                    )}
                                    {gptRecharging && (
                                        <div style={{ textAlign: 'center', padding: '32px' }}>
                                            <span className="loading-spinner"></span>
                                            <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>充值进行中，请稍候...</p>
                                        </div>
                                    )}
                                    {gptSuccess && (
                                        <div style={{ textAlign: 'center', padding: '24px' }}>
                                            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎉</div>
                                            <h3 style={{ color: '#059669', marginBottom: '8px' }}>充值成功！</h3>
                                            <p style={{ color: 'var(--text-secondary)' }}>账号 <strong>{gptEmail}</strong> 已成功充值 ChatGPT Plus</p>
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
                                                继续充值
                                            </button>
                                        </div>
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
                            <span>兑换积分</span>
                        </button>
                        <a
                            href="https://haodongxi.shop"
                            className="credits-action-btn purchase"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <span className="credits-action-icon">🛒</span>
                            <span>购买积分</span>
                        </a>
                    </div>

                    {/* CDK Redeem Card */}
                    {showCdkInput && (
                        <div className="cdk-redeem-card">
                            <div className="cdk-redeem-header">
                                <div className="cdk-redeem-glow"></div>
                                <span className="cdk-redeem-icon">🎫</span>
                                <div className="cdk-redeem-title-group">
                                    <span className="cdk-redeem-title">兑换积分</span>
                                    <span className="cdk-redeem-subtitle">输入 CDK 卡密，积分将充入您的账户</span>
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
                                                兑换
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

                                <div className="cdk-redeem-hint">
                                    <span>💡</span>
                                    <span>从 <a href="https://haodongxi.shop" target="_blank" rel="noopener noreferrer">haodongxi.shop</a> 购买 CDK 卡密后在此兑换</span>
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
                                    <span className="legend-item">
                                        <span className="legend-dot cancel"></span>
                                        {liveStats.cancel} Cancel
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
                                    {statusData.slice(-60).map((item) => (
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
                                            <p>📡 提交 Google 账号信息（邮箱、密码、2FA密钥），系统将自动登录并获取 Google One 合作伙伴链接。</p>
                                            <p>⚠️ 2FA 密钥必须是 Base32 编码的原始密钥（不是 6 位数字验证码）。</p>
                                            <p>💰 一次消耗一个 CDK 配额，仅在任务成功后扣除。</p>
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
