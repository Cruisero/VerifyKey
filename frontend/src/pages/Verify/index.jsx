import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../stores/AuthContext';
import './Verify.css';

// API base URL
const API_BASE = import.meta.env.DEV ? 'http://localhost:3002' : '';

// 生成随机状态 (视觉装饰用)
const generateStatus = () => {
    const rand = Math.random();
    if (rand < 0.05) return 'fail';
    if (rand < 0.10) return 'timeout';
    return 'pass';
};

const generateInitialData = (count) => {
    const data = [];
    const now = Date.now();
    for (let i = 0; i < count; i++) {
        data.push({
            id: i,
            status: generateStatus(),
            timestamp: now - (count - i) * 20000
        });
    }
    return data;
};

export default function Verify() {
    const { user, updateCredits } = useAuth();

    const [input, setInput] = useState('');
    const [verifyStatus, setVerifyStatus] = useState('ready');
    const [results, setResults] = useState([]);
    const [lastSuccess, setLastSuccess] = useState(null);
    const [statusData, setStatusData] = useState(() => generateInitialData(180));
    const [hoveredItem, setHoveredItem] = useState(null);
    const [botStatus, setBotStatus] = useState(null);
    const [provider, setProvider] = useState('telegram'); // Current AI provider
    const [browserMode, setBrowserMode] = useState(false); // API vs Browser mode
    const [program, setProgram] = useState('google-student');

    const programs = [
        { value: 'google-student', label: 'Google Student' },
        { value: 'gemini-advanced', label: 'Gemini Advanced' },
        { value: 'youtube-premium', label: 'YouTube Premium' },
        { value: 'apple-unidays', label: 'Apple UNiDAYS' },
        { value: 'github-education', label: 'GitHub Education' },
        { value: 'notion-education', label: 'Notion Education' },
    ];

    // 添加新状态点
    const addNewStatus = useCallback(() => {
        setStatusData(prev => {
            const newData = [...prev];
            newData.push({
                id: Date.now(),
                status: generateStatus(),
                timestamp: Date.now()
            });
            if (newData.length > 200) newData.shift();
            return newData;
        });
    }, []);

    // 定时更新状态
    useEffect(() => {
        const scheduleNextUpdate = () => {
            const delay = 5000 + Math.random() * 20000;
            return setTimeout(() => {
                addNewStatus();
                scheduleNextUpdate();
            }, delay);
        };
        const timeoutId = scheduleNextUpdate();
        return () => clearTimeout(timeoutId);
    }, [addNewStatus]);

    // 获取配置 (provider, browserMode) 和 Bot 状态
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

    const isTelegramMode = provider === 'telegram';

    // 提取输入内容（链接或ID）
    const extractItems = (text) => {
        const lines = text.split('\n').filter(line => line.trim());
        return lines.map(line => line.trim()).filter(line => line.length > 0);
    };

    // 统一验证入口
    const handleVerify = async () => {
        if (!user) {
            alert('请先登录后再验证');
            return;
        }
        if (!input.trim()) return;
        if (user.credits <= 0) {
            alert('配额不足，请充值后再试');
            return;
        }

        const items = extractItems(input);
        if (items.length === 0) {
            alert(isTelegramMode ? '请输入有效的验证链接' : '请输入验证 ID 或链接');
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
                message: '⏳ 正在处理...'
            };
        });
        setResults(prev => [...resultItems, ...prev]);

        try {
            const response = await fetch(`${API_BASE}/api/verify/telegram`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ links })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ detail: response.statusText }));
                throw new Error(err.detail || `请求失败: ${response.status}`);
            }

            const data = await response.json();
            if (data.results && Array.isArray(data.results)) {
                for (const result of data.results) {
                    const resultItem = resultItems.find(r =>
                        r.fullLink === result.link || r.verificationId === result.verificationId
                    );
                    if (resultItem) {
                        let status = 'processing';
                        let message = result.message || '处理中...';
                        if (result.status === 'approved') {
                            status = 'success';
                            message = result.message || '✅ 验证通过！';
                            setLastSuccess(new Date().toISOString());
                            updateCredits(-1);
                            addNewStatus();
                        } else if (result.status === 'rejected') {
                            status = 'failed';
                            message = result.message || '❌ 验证被拒绝';
                        } else if (result.status === 'error' || result.status === 'timeout') {
                            status = 'failed';
                            message = result.message || '❌ 验证出错';
                        } else if (result.status === 'no_credits') {
                            status = 'failed';
                            message = '❌ Bot 额度不足';
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
            message: '⏳ 正在处理...'
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
                throw new Error(err.detail || `请求失败: ${response.status}`);
            }

            const data = await response.json();
            if (data.results && Array.isArray(data.results)) {
                for (const result of data.results) {
                    const resultItem = resultItems.find(r => r.verificationId === result.verificationId);
                    if (resultItem) {
                        const status = result.success ? 'success' : 'failed';
                        const message = result.success ? '✅ 验证通过' : ('❌ ' + (result.message || '验证失败'));
                        if (result.success) {
                            setLastSuccess(new Date().toISOString());
                            updateCredits(-1);
                            addNewStatus();
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
                return <span className="badge badge-warning"><span className="pulse-dot"></span>处理中...</span>;
            case 'success':
                return <span className="badge badge-success">✓ 完成</span>;
            case 'error':
                return <span className="badge badge-error">✕ 错误</span>;
            default:
                return <span className="badge badge-info">● 就绪</span>;
        }
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return '-';
        const diff = Date.now() - (typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp);
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes}分钟前`;
        return `${Math.floor(minutes / 60)}小时前`;
    };

    // 统计
    const liveStats = {
        pass: statusData.filter(d => d.status === 'pass').length,
        fail: statusData.filter(d => d.status === 'fail').length,
        timeout: statusData.filter(d => d.status === 'timeout').length
    };

    const userStats = [
        { label: '当前配额', value: user ? `${user.credits} 次` : '未登录', icon: '🎫', color: 'primary' },
        { label: '本月验证', value: liveStats.pass + liveStats.fail + liveStats.timeout, icon: '⚡', color: 'success' },
        { label: '成功率', value: `${Math.round(liveStats.pass / statusData.length * 100)}%`, icon: '📈', color: 'info' },
    ];

    const quickActions = [
        { label: '充值配额', icon: '💰', path: '/recharge' },
    ];

    return (
        <div className="verify-page">
            <div className="container">
                {/* Welcome Section */}
                <div className="welcome-section">
                    <div className="welcome-content">
                        <h1 className="welcome-title">
                            {user ? (
                                <>欢迎回来，<span className="gradient-text">{user.username}</span> 👋</>
                            ) : (
                                <>欢迎使用 <span className="gradient-text">OnePASS</span> 🚀</>
                            )}
                        </h1>
                        <p className="welcome-desc">
                            {user ? '开始您的验证任务吧！' : '请登录后开始验证任务'}
                        </p>
                    </div>
                    <div className="quick-actions">
                        {user ? (
                            quickActions.map((action, index) => (
                                <Link key={index} to={action.path} className="quick-action-btn">
                                    <span className="action-icon">{action.icon}</span>
                                    <span>{action.label}</span>
                                </Link>
                            ))
                        ) : (
                            <Link to="/login" className="quick-action-btn">
                                <span className="action-icon">🔐</span>
                                <span>登录 / 注册</span>
                            </Link>
                        )}
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="stats-grid">
                    {userStats.map((stat, index) => (
                        <div key={index} className={`stat-card card ${stat.color}`}>
                            <div className="stat-icon">{stat.icon}</div>
                            <div className="stat-info">
                                <span className="stat-value">{stat.value}</span>
                                <span className="stat-label">{stat.label}</span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Verify Header */}
                <div className="verify-header">
                    <div className="header-left">
                        <h2 className="section-title">⚡ 批量验证工具</h2>
                    </div>
                    <div className="header-right">
                        <div className="status-indicator">
                            {getStatusBadge()}
                            {isTelegramMode && botStatus && (
                                <span className={`bot-status ${botStatus.connected ? 'connected' : 'disconnected'}`}>
                                    {botStatus.connected ? '🤖 Bot 在线' : '🔴 Bot 离线'}
                                </span>
                            )}
                            {!isTelegramMode && (
                                <span className="bot-status connected">
                                    {browserMode ? '🌐 浏览器模式' : '⚡ API 模式'}
                                </span>
                            )}
                            <span className="last-success">
                                上次成功: {lastSuccess ? formatTime(lastSuccess) : '无'}
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
                                <span>{isTelegramMode ? '输入验证链接' : '输入验证 ID'}</span>
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
                                    ? `粘贴验证链接，每行一个...

例如：
https://services.sheerid.com/verify/67c8c14f5f17a83b745e3f82/?verificationId=699528d723c407520aeadc45

⚠️ 注意：右键复制链接，不要点击打开！`
                                    : `粘贴验证 ID 或链接，每行一个...

例如：
699528d723c407520aeadc45
https://services.sheerid.com/verify/...?verificationId=699528d723c407520aeadc45`
                                }
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                disabled={verifyStatus === 'processing'}
                            />

                            <div className="input-footer">
                                <div className="input-info">
                                    <span className="id-count">
                                        {extractItems(input).length} 个{isTelegramMode ? '链接' : 'ID'}
                                    </span>
                                    <span className="slots-info">剩余配额: {user ? `${user.credits} 次` : '未登录'}</span>
                                </div>

                                <div className="input-actions">
                                    <button
                                        className="btn btn-primary btn-lg"
                                        onClick={handleVerify}
                                        disabled={verifyStatus === 'processing' || !input.trim() || !user}
                                    >
                                        {verifyStatus === 'processing' ? (
                                            <>
                                                <span className="loading-spinner small"></span>
                                                处理中...
                                            </>
                                        ) : (
                                            '🚀 开始验证'
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
                                <span>结果</span>
                                <span className="result-count">({results.length})</span>
                            </div>
                            <div className="panel-actions">
                                <button className="btn btn-sm btn-secondary" onClick={handleClear}>
                                    🗑️ 清空
                                </button>
                                <button
                                    className="btn btn-sm btn-secondary"
                                    onClick={handleExport}
                                    disabled={results.filter(r => r.status === 'success').length === 0}
                                >
                                    📤 导出
                                </button>
                            </div>
                        </div>

                        <div className="panel-body">
                            {results.length === 0 ? (
                                <div className="empty-results">
                                    <div className="empty-icon">📭</div>
                                    <p>暂无结果</p>
                                    <p className="empty-hint">粘贴验证链接后点击开始</p>
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
                                                <span className="result-message">{result.message || '处理中...'}</span>
                                                {result.credits && (
                                                    <span className="result-credits">💎 剩余 {result.credits} credits</span>
                                                )}
                                                {result.claimLink && (
                                                    <a
                                                        className="result-claim-link"
                                                        href={result.claimLink}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                    >
                                                        🎁 领取链接
                                                    </a>
                                                )}
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
                        <h2>📊 实时验证状态 (最近10分钟)</h2>
                        <div className="status-legend">
                            <span className="legend-item">
                                <span className="legend-dot pass"></span>
                                {liveStats.pass} Pass
                            </span>
                            <span className="legend-item">
                                <span className="legend-dot fail"></span>
                                {liveStats.fail} Fail
                            </span>
                            <span className="legend-item">
                                <span className="legend-dot timeout"></span>
                                {liveStats.timeout} Timeout
                            </span>
                        </div>
                    </div>
                    <div className="status-grid-container">
                        <div className="status-grid">
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
                                                    item.status === 'fail' ? '✕ Fail' : '◷ Timeout'}
                                            </span>
                                            <span className="tooltip-time">{formatTime(item.timestamp)}</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="status-timeline">
                            <span>10分钟前</span>
                            <span>NOW</span>
                        </div>
                    </div>
                    <div className="tips-inline">

                        <div className="tips-content">
                            <p>在 <a href="https://one.google.com/ai-student" target="_blank" rel="noopener noreferrer">one.google.com/ai-student</a> 的蓝色按钮上<strong>右键复制链接</strong>，不要点进去！建议用无痕窗口登录账户获取。</p>
                            <p>如果验证链接中 verificationId= 后面是空的，建议直接换号。</p>
                            <p>一次消耗一个配额，成功后自动扣除。</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
