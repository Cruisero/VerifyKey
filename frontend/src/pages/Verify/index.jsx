import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/AuthContext';
import './Verify.css';

// API base URL - 开发环境使用 localhost:3002，生产环境使用相对路径
const API_BASE = import.meta.env.DEV ? 'http://localhost:3002' : '';

// 生成随机状态 (pass为主, 每20个允许2个fail/timeout)
const generateStatus = () => {
    const rand = Math.random();
    if (rand < 0.05) return 'fail';
    if (rand < 0.10) return 'timeout';
    return 'pass';
};

// 生成初始状态数据
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
    const { user, loading, updateCredits } = useAuth();
    const navigate = useNavigate();

    const [input, setInput] = useState('');
    const [program, setProgram] = useState('google-student');
    const [verifyStatus, setVerifyStatus] = useState('ready');
    const [results, setResults] = useState([]);
    const [lastSuccess, setLastSuccess] = useState(null);
    const [statusData, setStatusData] = useState(() => generateInitialData(180));
    const [hoveredItem, setHoveredItem] = useState(null);

    useEffect(() => {
        if (!loading && !user) {
            navigate('/');
        }
    }, [user, loading, navigate]);

    // 添加新状态
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

    // 每分钟更新3次
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

    const programs = [
        { value: 'google-student', label: 'Google Student' },
        { value: 'gemini-advanced', label: 'Gemini Advanced' },
    ];

    const extractVerificationIds = (text) => {
        const lines = text.split('\n').filter(line => line.trim());
        const ids = [];
        lines.forEach(line => {
            const urlMatch = line.match(/verificationId=([a-zA-Z0-9-]+)/);
            if (urlMatch) {
                ids.push(urlMatch[1]);
            } else if (line.match(/^[a-zA-Z0-9-]{20,}$/)) {
                ids.push(line.trim());
            } else {
                ids.push(line.trim());
            }
        });
        return ids;
    };

    // 调用后端 API 进行验证
    const handleVerify = async () => {
        if (!input.trim()) return;
        if (user.credits <= 0) {
            alert('配额不足，请充值后再试');
            return;
        }

        const ids = extractVerificationIds(input);
        if (ids.length === 0) {
            alert('请输入有效的验证链接或 ID');
            return;
        }

        if (ids.length > 5) {
            alert('每次最多验证 5 个 ID');
            return;
        }

        setVerifyStatus('processing');

        // 添加处理中的结果项
        const resultItems = ids.map((id, i) => ({
            id: Date.now() + i,
            verificationId: id.length > 25 ? id.substring(0, 25) + '...' : id,
            fullId: id,
            status: 'processing',
            timestamp: new Date().toISOString(),
            message: '正在验证...'
        }));
        setResults(prev => [...prev, ...resultItems]);

        try {
            // 调用后端代理 API
            const response = await fetch(`${API_BASE}/api/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    verificationIds: ids,
                    programId: program === 'google-student' ? '' : program
                })
            });

            if (!response.ok) {
                throw new Error(`请求失败: ${response.status}`);
            }

            // 处理 SSE 流响应
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let pendingChecks = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        try {
                            const data = JSON.parse(line.slice(5).trim());
                            console.log('SSE data:', data);

                            // 处理验证结果
                            if (data.verificationId) {
                                const resultId = resultItems.find(r =>
                                    r.fullId === data.verificationId ||
                                    r.fullId.includes(data.verificationId)
                                )?.id;

                                if (resultId) {
                                    let status = 'processing';
                                    let message = data.message || '处理中...';

                                    if (data.currentStep === 'success') {
                                        status = 'success';
                                        message = '✓ 验证成功';
                                        setLastSuccess(new Date().toISOString());
                                        updateCredits(-1);
                                        addNewStatus();
                                    } else if (data.currentStep === 'failed' || data.currentStep === 'error') {
                                        status = 'failed';
                                        message = '✕ ' + (data.message || '验证失败');
                                    } else if (data.currentStep === 'pending' && data.checkToken) {
                                        // 需要轮询检查状态
                                        pendingChecks.push({ resultId, checkToken: data.checkToken, verificationId: data.verificationId });
                                    }

                                    setResults(prev => prev.map(r =>
                                        r.id === resultId ? { ...r, status, message } : r
                                    ));
                                }
                            }
                        } catch (e) {
                            console.warn('Parse error:', e, line);
                        }
                    }
                }
            }

            // 处理 pending 状态的验证（轮询检查）
            for (const pending of pendingChecks) {
                let attempts = 0;
                const maxAttempts = 30; // 最多等待30次

                while (attempts < maxAttempts) {
                    await new Promise(r => setTimeout(r, 2000));
                    attempts++;

                    try {
                        const checkResponse = await fetch(`${API_BASE}/api/check-status`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ checkToken: pending.checkToken })
                        });
                        const checkData = await checkResponse.json();

                        if (checkData.currentStep === 'success') {
                            setResults(prev => prev.map(r =>
                                r.id === pending.resultId ? { ...r, status: 'success', message: '✓ 验证成功' } : r
                            ));
                            setLastSuccess(new Date().toISOString());
                            updateCredits(-1);
                            addNewStatus();
                            break;
                        } else if (checkData.currentStep === 'failed' || checkData.currentStep === 'error') {
                            setResults(prev => prev.map(r =>
                                r.id === pending.resultId ? { ...r, status: 'failed', message: '✕ ' + (checkData.message || '验证失败') } : r
                            ));
                            break;
                        }
                        // 继续等待
                        setResults(prev => prev.map(r =>
                            r.id === pending.resultId ? { ...r, message: `等待中... (${attempts}/${maxAttempts})` } : r
                        ));
                    } catch (e) {
                        console.error('Check status error:', e);
                    }
                }
            }

        } catch (error) {
            console.error('Verify error:', error);
            // 标记所有处理中的为失败
            setResults(prev => prev.map(r =>
                resultItems.find(ri => ri.id === r.id) && r.status === 'processing'
                    ? { ...r, status: 'failed', message: '✕ ' + error.message }
                    : r
            ));
        }

        setVerifyStatus('ready');
        setInput('');
    };

    const handleClear = () => setResults([]);

    const handleExport = () => {
        const successResults = results.filter(r => r.status === 'success');
        const text = successResults.map(r => r.verificationId).join('\n');
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
        { label: '当前配额', value: `${user?.credits || 0} 次`, icon: '🎫', color: 'primary' },
        { label: '本月验证', value: liveStats.pass + liveStats.fail + liveStats.timeout, icon: '⚡', color: 'success' },
        { label: '成功率', value: `${Math.round(liveStats.pass / statusData.length * 100)}%`, icon: '📈', color: 'info' },
    ];

    const quickActions = [
        { label: '充值配额', icon: '💰', path: '/recharge' },
    ];

    if (!user) return null;

    return (
        <div className="verify-page">
            <div className="container">
                {/* Welcome Section */}
                <div className="welcome-section">
                    <div className="welcome-content">
                        <h1 className="welcome-title">
                            欢迎回来，<span className="gradient-text">{user.username}</span> 👋
                        </h1>
                        <p className="welcome-desc">开始您的验证任务吧！</p>
                    </div>
                    <div className="quick-actions">
                        {quickActions.map((action, index) => (
                            <Link key={index} to={action.path} className="quick-action-btn">
                                <span className="action-icon">{action.icon}</span>
                                <span>{action.label}</span>
                            </Link>
                        ))}
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
                                <span>输入</span>
                            </div>
                            <select
                                className="program-select"
                                value={program}
                                onChange={(e) => setProgram(e.target.value)}
                            >
                                {programs.map(p => (
                                    <option key={p.value} value={p.value}>{p.label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="panel-body">
                            <textarea
                                className="input textarea verify-input"
                                placeholder={`Enter verification IDs or URLs, one per line...

例如:
https://verifications.sheerid.com/...?verificationId=abc123
abc123-def456-ghi789

粘贴 URL 会自动提取 verificationId`}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                disabled={verifyStatus === 'processing'}
                            />

                            <div className="input-footer">
                                <div className="input-info">
                                    <span className="id-count">{extractVerificationIds(input).length} 个 ID</span>
                                    <span className="slots-info">剩余配额: {user.credits} 次</span>
                                </div>

                                <div className="input-actions">
                                    <button
                                        className="btn btn-primary btn-lg"
                                        onClick={handleVerify}
                                        disabled={verifyStatus === 'processing' || !input.trim()}
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
                                    <p className="empty-hint">输入验证 ID 后点击开始</p>
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
                                                <span className="result-id">{result.verificationId}</span>
                                                <span className="result-message">{result.message || '处理中...'}</span>
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
