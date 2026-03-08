import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/AuthContext';
import { useLang } from '../../stores/LanguageContext';
import './Admin.css';
import '../Verify/Verify.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Telegram Bot Management Component
function TelegramBotTab() {
    const { user } = useAuth();
    const { t } = useLang();
    const token = user?.token || localStorage.getItem('verifykey-token');
    const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

    const [botConfig, setBotConfig] = useState(null);
    const [botStats, setBotStats] = useState(null);
    const [botUsers, setBotUsers] = useState([]);
    const [botOrders, setBotOrders] = useState([]);
    const [saving, setSaving] = useState(false);
    const [activeSection, setActiveSection] = useState('stats');
    const [newService, setNewService] = useState({ name: '', emoji: '🔹', credits: 5 });
    const [botVerifyLog, setBotVerifyLog] = useState([]);

    const fetchBotConfig = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/admin/bot-config`, { headers: authHeaders });
            if (res.ok) setBotConfig(await res.json());
        } catch (e) { console.error('Failed to fetch bot config:', e); }
    };

    const fetchBotStats = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/admin/bot-stats`, { headers: authHeaders });
            if (res.ok) setBotStats(await res.json());
        } catch (e) { console.error('Failed to fetch bot stats:', e); }
    };

    const fetchBotUsers = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/admin/bot-users`, { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                setBotUsers(data.users || []);
            }
        } catch (e) { console.error('Failed to fetch bot users:', e); }
    };

    const fetchBotOrders = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/admin/bot-orders`, { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                setBotOrders(data.orders || []);
            }
        } catch (e) { console.error('Failed to fetch bot orders:', e); }
    };

    useEffect(() => {
        fetchBotConfig();
        fetchBotStats();
        fetchBotUsers();
        fetchBotOrders();
        const fetchLog = async () => {
            try {
                const res = await fetch(`${API_BASE}/api/admin/bot-verify-log`, { headers: authHeaders });
                if (res.ok) {
                    const data = await res.json();
                    const apiLog = data.log || [];
                    // Merge: preserve SSE "processing"/"submitted" entries that aren't in API data yet
                    setBotVerifyLog(prev => {
                        const sseProcessing = prev.filter(e => (e.status === 'processing' || e.status === 'submitted') && !apiLog.some(a => a.vid === e.vid || a.link === e.link));
                        return sseProcessing.length > 0 ? [...sseProcessing, ...apiLog].slice(0, 300) : apiLog;
                    });
                }
            } catch (e) { console.error('Failed to fetch bot verify log:', e); }
        };
        fetchLog();
        const interval = setInterval(fetchLog, 5000);
        return () => clearInterval(interval);
    }, []);

    // SSE Real-time log updates
    useEffect(() => {
        const sseToken = user?.token || localStorage.getItem('verifykey-token');
        if (!sseToken) return;

        const sseUrl = `${API_BASE}/api/admin/verify-stream?authorization=Bearer ${sseToken}`;
        const es = new EventSource(sseUrl);

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'progress') {
                    setBotVerifyLog(prev => {
                        const existingIdx = prev.findIndex(l => l.vid === data.vid || l.link === data.link);
                        const newEntry = {
                            id: existingIdx >= 0 ? prev[existingIdx].id : Date.now() + Math.random(),
                            link: data.link || '',
                            username: existingIdx >= 0 ? prev[existingIdx].username : 'SSE Update',
                            user_id: existingIdx >= 0 ? prev[existingIdx].user_id : '---',
                            status: data.step === 'failed' ? 'failed' : (data.step === 'submitted' ? 'submitted' : 'processing'),
                            message: data.message || '',
                            vid: data.vid || '',
                            timestamp: new Date().toISOString()
                        };

                        if (existingIdx >= 0) {
                            const newLog = [...prev];
                            newLog[existingIdx] = { ...newLog[existingIdx], ...newEntry };
                            return newLog;
                        } else {
                            return [newEntry, ...prev].slice(0, 300);
                        }
                    });
                } else if (data.type === 'done') {
                    setBotVerifyLog(prev => {
                        let newLog = [...prev];
                        for (const res of data.results || []) {
                            const vid = res.verificationId || res.vid || '';
                            const link = res.link || '';
                            const status = res.success ? 'success' : (res.status === 'error' ? 'error' : (res.status === 'cooldown' ? 'processing' : 'failed'));
                            let msg = res.message || res.reason || '';
                            if (res.status === 'cooldown') msg = 'Cooldown - Waiting';

                            const existingIdx = newLog.findIndex(l => (vid && l.vid === vid) || (link && l.link === link));
                            if (existingIdx >= 0) {
                                newLog[existingIdx] = {
                                    ...newLog[existingIdx],
                                    status: status,
                                    message: msg,
                                    timestamp: new Date().toISOString()
                                };
                            } else {
                                newLog.unshift({
                                    id: Date.now() + Math.random(),
                                    link: link,
                                    username: 'System',
                                    user_id: '---',
                                    status: status,
                                    message: msg,
                                    vid: vid,
                                    timestamp: new Date().toISOString()
                                });
                            }
                        }
                        return newLog.slice(0, 300);
                    });
                }
            } catch (err) {
                console.error("SSE parse error", err);
            }
        };

        es.onerror = (error) => {
            console.error("SSE connection error", error);
            // Will auto-reconnect
        };

        return () => {
            es.close();
        };
    }, []);

    const saveBotConfig = async () => {
        setSaving(true);
        try {
            const configToSave = { ...botConfig };
            if (configToSave.statusConfig) {
                configToSave.statusConfig = { ...configToSave.statusConfig, lastUpdated: new Date().toLocaleString() };
            }
            const res = await fetch(`${API_BASE}/api/admin/bot-config`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(configToSave)
            });
            if (res.ok) {
                const data = await res.json();
                setBotConfig(data.config);
                alert('✅ 配置已保存');
            } else {
                alert('保存失败');
            }
        } catch (e) { alert('保存失败: ' + e.message); }
        finally { setSaving(false); }
    };

    const addService = () => {
        if (!newService.name.trim()) return;
        const updated = { ...botConfig, services: [...(botConfig.services || []), { ...newService }] };
        setBotConfig(updated);
        setNewService({ name: '', emoji: '🔹', credits: 5 });
    };

    const removeService = (index) => {
        const services = [...(botConfig.services || [])];
        services.splice(index, 1);
        setBotConfig({ ...botConfig, services });
    };

    if (!botConfig || !botStats) {
        return <div className="tab-content"><p style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>⏳ 加载中...</p></div>;
    }

    const sections = [
        { id: 'stats', label: t('tgStats'), },
        { id: 'verify-log', label: t('tgVerifyLog') },
        { id: 'config', label: t('tgConfig') },
        { id: 'services', label: t('tgServices') },
        { id: 'users', label: t('tgUsers') },
        { id: 'orders', label: t('tgOrders') },
    ];

    return (
        <div className="tab-content">
            {/* Sub-navigation */}
            <div style={{ display: 'flex', gap: 'var(--spacing-xs)', marginBottom: 'var(--spacing-lg)', flexWrap: 'wrap' }}>
                {sections.map(s => (
                    <button key={s.id}
                        className={`btn btn-sm ${activeSection === s.id ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setActiveSection(s.id)}
                    >{s.label}</button>
                ))}
            </div>

            {/* Stats Section */}
            {activeSection === 'stats' && (
                <>
                    <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="stat-card card primary">
                            <div className="stat-icon">👥</div>
                            <div className="stat-info">
                                <span className="stat-value">{botStats.total_users}</span>
                                <span className="stat-label">总用户</span>
                            </div>
                        </div>
                        <div className="stat-card card success">
                            <div className="stat-icon">✅</div>
                            <div className="stat-info">
                                <span className="stat-value">{botStats.total_verifications}</span>
                                <span className="stat-label">总验证</span>
                            </div>
                        </div>
                        <div className="stat-card card info">
                            <div className="stat-icon">💰</div>
                            <div className="stat-info">
                                <span className="stat-value">${botStats.total_revenue_usdt}</span>
                                <span className="stat-label">USDT 收入</span>
                            </div>
                        </div>
                        <div className="stat-card card warning">
                            <div className="stat-icon">🤝</div>
                            <div className="stat-info">
                                <span className="stat-value">{botStats.referral_rewards_given}</span>
                                <span className="stat-label">邀请奖励</span>
                            </div>
                        </div>
                    </div>
                    <div className="stats-grid">
                        <div className="stat-card card">
                            <div className="stat-icon">📅</div>
                            <div className="stat-info">
                                <span className="stat-value">{botStats.daily_active_users}</span>
                                <span className="stat-label">今日活跃</span>
                            </div>
                        </div>
                        <div className="stat-card card">
                            <div className="stat-icon">🔋</div>
                            <div className="stat-info">
                                <span className="stat-value">{botStats.total_credits_in_circulation}</span>
                                <span className="stat-label">流通积分</span>
                            </div>
                        </div>
                        <div className="stat-card card">
                            <div className="stat-icon">🔥</div>
                            <div className="stat-info">
                                <span className="stat-value">{botStats.total_spent_credits}</span>
                                <span className="stat-label">已消耗积分</span>
                            </div>
                        </div>
                        <div className="stat-card card">
                            <div className="stat-icon">🛒</div>
                            <div className="stat-info">
                                <span className="stat-value">{botStats.pending_orders}</span>
                                <span className="stat-label">待确认订单</span>
                            </div>
                        </div>
                        <div className="stat-card card">
                            <div className="stat-icon">🎓</div>
                            <div className="stat-info">
                                <span className="stat-value">{botStats.site_total_success || 0}</span>
                                <span className="stat-label">总验证成功</span>
                            </div>
                        </div>
                        <div className="stat-card card">
                            <div className="stat-icon">📈</div>
                            <div className="stat-info">
                                <span className="stat-value">{botStats.site_real_success_rate || 0}%</span>
                                <span className="stat-label">真实成功率</span>
                            </div>
                        </div>
                        <div className="stat-card card">
                            <div className="stat-icon">🤖</div>
                            <div className="stat-info">
                                <span className="stat-value">{botStats.site_api_success || 0}</span>
                                <span className="stat-label">API 验证成功</span>
                            </div>
                        </div>
                        <div className="stat-card card">
                            <div className="stat-icon">🔑</div>
                            <div className="stat-info">
                                <span className="stat-value">{botStats.site_cdk_used || 0}</span>
                                <span className="stat-label">CDK 总消耗</span>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Bot Verify Log Section */}
            {activeSection === 'verify-log' && (
                <div className="card" style={{ padding: 'var(--spacing-lg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px', fontSize: '14px', flexWrap: 'wrap' }}>
                        <span>{t('logTotal')} <strong>{botVerifyLog.length}</strong> {t('logEntries')}</span>
                        <span>|</span>
                        <span style={{ color: '#3b82f6', fontWeight: 600 }}>
                            {botVerifyLog.filter(r => r.status === 'submitted').length} 已提交
                        </span>
                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>
                            {botVerifyLog.filter(r => r.status === 'processing').length} 处理中
                        </span>
                        <span style={{ color: '#16a34a', fontWeight: 600 }}>{botVerifyLog.filter(r => r.status === 'success').length} {t('logSuccess')}</span>
                        <span style={{ color: '#dc2626', fontWeight: 600 }}>{botVerifyLog.filter(r => !['success', 'submitted', 'processing'].includes(r.status)).length} {t('logFailed')}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '800px', overflowY: 'auto' }}>
                        {botVerifyLog.length === 0 && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px' }}>{t('tgNoBotLog')}</div>}
                        {botVerifyLog.map((r, i) => {
                            const isPass = r.status === 'success';
                            const isProcessing = r.status === 'processing';
                            const isSubmitted = r.status === 'submitted';
                            const isInProgress = isSubmitted || isProcessing;
                            const vid = r.vid || '';
                            const shortVid = vid.length > 20 ? `${vid.slice(0, 8)}...${vid.slice(-8)}` : vid;
                            const shortLink = !vid && r.link && r.link.length > 60 ? r.link.slice(0, 55) + '...' : (!vid ? (r.link || '') : '');
                            const ts = r.timestamp ? new Date(r.timestamp).toLocaleString('zh-CN', { hour12: false }) : '';

                            const statusConfig = {
                                submitted: { bg: 'rgba(59, 130, 246, 0.06)', border: 'rgba(59, 130, 246, 0.15)', iconBg: '#3b82f6', icon: '◌', color: '#3b82f6' },
                                processing: { bg: 'rgba(245, 158, 11, 0.06)', border: 'rgba(245, 158, 11, 0.15)', iconBg: '#f59e0b', icon: '◎', color: '#f59e0b' },
                                success: { bg: 'rgba(22, 163, 74, 0.06)', border: 'rgba(22, 163, 74, 0.15)', iconBg: '#16a34a', icon: '✓', color: '#16a34a' },
                                failed: { bg: 'rgba(220, 38, 38, 0.06)', border: 'rgba(220, 38, 38, 0.15)', iconBg: '#dc2626', icon: '✕', color: '#dc2626' },
                                error: { bg: 'rgba(220, 38, 38, 0.06)', border: 'rgba(220, 38, 38, 0.15)', iconBg: '#dc2626', icon: '✕', color: '#dc2626' },
                                refunded: { bg: 'rgba(107, 114, 128, 0.06)', border: 'rgba(107, 114, 128, 0.15)', iconBg: '#6b7280', icon: '↩', color: '#6b7280' },
                            };
                            const cfg = statusConfig[r.status] || statusConfig.error;

                            return (
                                <div key={r.id || i} style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '14px',
                                    padding: '14px 18px',
                                    borderRadius: '10px',
                                    background: cfg.bg,
                                    border: `1px solid ${cfg.border}`,
                                }}>
                                    <div style={{
                                        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                                        background: cfg.iconBg,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: '#fff', fontSize: '14px', fontWeight: 700, marginTop: '2px',
                                        ...(isInProgress ? { animation: 'pulse 1.5s ease-in-out infinite' } : {}),
                                    }}>{cfg.icon}</div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                                                    {vid ? `VID: ${shortVid}` : `@${r.username || r.user_id}`}
                                                </span>
                                                {isInProgress && (
                                                    <span style={{
                                                        fontSize: '11px',
                                                        padding: '1px 8px',
                                                        borderRadius: '10px',
                                                        background: cfg.iconBg,
                                                        color: '#fff',
                                                        fontWeight: 600,
                                                    }}>
                                                        {isSubmitted ? '已提交' : '处理中'}
                                                    </span>
                                                )}
                                            </div>
                                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{ts}</span>
                                        </div>
                                        {vid && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>🔑 @{r.username || r.user_id}</div>}
                                        {shortLink && <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', wordBreak: 'break-all' }}>{shortLink}</div>}
                                        {r.message && <div style={{ fontSize: '13px', fontWeight: 600, color: cfg.color, marginTop: '3px', wordBreak: 'break-all' }}>{r.message}</div>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Config Section */}
            {activeSection === 'config' && (
                <div className="card" style={{ padding: 'var(--spacing-lg)' }}>
                    <h3 style={{ marginBottom: 'var(--spacing-lg)' }}>⚙️ Bot 配置</h3>
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        <div>
                            <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Bot 名称</label>
                            <input className="input" value={botConfig.botName || ''} onChange={e => setBotConfig({ ...botConfig, botName: e.target.value })} style={{ width: '100%' }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>欢迎语</label>
                            <input className="input" value={botConfig.welcomeMessage || ''} onChange={e => setBotConfig({ ...botConfig, welcomeMessage: e.target.value })} style={{ width: '100%' }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>客服联系人</label>
                            <input className="input" value={botConfig.contactSupport || ''} onChange={e => setBotConfig({ ...botConfig, contactSupport: e.target.value })} style={{ width: '100%' }} placeholder="@Terato1" />
                        </div>
                        {/* TRC-20 */}
                        <div className="card" style={{ padding: 'var(--spacing-md)', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)' }}>
                                <span>🔴</span>
                                <strong>USDT TRC-20 (TRON)</strong>
                                <label style={{ marginLeft: 'auto', fontSize: 'var(--text-sm)' }}>
                                    <input type="checkbox" checked={botConfig.trc20Enabled || false} onChange={e => setBotConfig({ ...botConfig, trc20Enabled: e.target.checked })} style={{ marginRight: '4px' }} />
                                    启用
                                </label>
                            </div>
                            <input className="input" value={botConfig.trc20WalletAddress || ''} onChange={e => setBotConfig({ ...botConfig, trc20WalletAddress: e.target.value })} style={{ width: '100%' }} placeholder="Txxxxxxxxxx..." />
                        </div>
                        {/* BSC BEP-20 */}
                        <div className="card" style={{ padding: 'var(--spacing-md)', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)' }}>
                                <span>🟡</span>
                                <strong>USDT BEP-20 (BSC)</strong>
                                <label style={{ marginLeft: 'auto', fontSize: 'var(--text-sm)' }}>
                                    <input type="checkbox" checked={botConfig.bscEnabled || false} onChange={e => setBotConfig({ ...botConfig, bscEnabled: e.target.checked })} style={{ marginRight: '4px' }} />
                                    启用
                                </label>
                            </div>
                            <input className="input" value={botConfig.bscWalletAddress || ''} onChange={e => setBotConfig({ ...botConfig, bscWalletAddress: e.target.value })} style={{ width: '100%' }} placeholder="0xxxxxxxxxxx..." />
                        </div>
                        {/* Binance Pay */}
                        <div className="card" style={{ padding: 'var(--spacing-md)', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)' }}>
                                <span>🆔</span>
                                <strong>Binance Pay</strong>
                                <label style={{ marginLeft: 'auto', fontSize: 'var(--text-sm)' }}>
                                    <input type="checkbox" checked={botConfig.binancePayEnabled || false} onChange={e => setBotConfig({ ...botConfig, binancePayEnabled: e.target.checked })} style={{ marginRight: '4px' }} />
                                    启用
                                </label>
                            </div>
                            <input className="input" value={botConfig.binancePayId || ''} onChange={e => setBotConfig({ ...botConfig, binancePayId: e.target.value })} style={{ width: '100%' }} placeholder="Pay ID (e.g. 23137227)" />
                        </div>
                        <div>
                            <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>每日签到积分</label>
                            <input className="input" type="number" min={0} value={botConfig.dailyCredits || 1} onChange={e => setBotConfig({ ...botConfig, dailyCredits: Number(e.target.value) })} style={{ width: '120px' }} />
                        </div>

                        {/* Status Command Config */}
                        <div className="card" style={{ padding: 'var(--spacing-md)', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
                                <span>📊</span>
                                <strong>/status 指令配置</strong>
                                <label style={{ marginLeft: 'auto', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: (botConfig.statusConfig?.online !== false) ? '#4caf50' : '#f44336' }}>
                                        {(botConfig.statusConfig?.online !== false) ? '🟢 Online' : '🔴 Offline'}
                                    </span>
                                    <input type="checkbox" checked={botConfig.statusConfig?.online !== false} onChange={e => setBotConfig({ ...botConfig, statusConfig: { ...(botConfig.statusConfig || {}), online: e.target.checked } })} />
                                </label>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--spacing-sm)' }}>
                                <div>
                                    <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>成功次数</label>
                                    <input className="input" type="number" min={0} value={botConfig.statusConfig?.successCount ?? 0} onChange={e => setBotConfig({ ...botConfig, statusConfig: { ...(botConfig.statusConfig || {}), successCount: Number(e.target.value) } })} style={{ width: '100%' }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>失败次数</label>
                                    <input className="input" type="number" min={0} value={botConfig.statusConfig?.failCount ?? 0} onChange={e => setBotConfig({ ...botConfig, statusConfig: { ...(botConfig.statusConfig || {}), failCount: Number(e.target.value) } })} style={{ width: '100%' }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>成功率 (自动)</label>
                                    <div className="input" style={{ width: '100%', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}>
                                        {(() => { const s = botConfig.statusConfig?.successCount ?? 0; const f = botConfig.statusConfig?.failCount ?? 0; const t = s + f; return t > 0 ? `${(s / t * 100).toFixed(1)}%` : '0%'; })()}
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-sm)', marginTop: 'var(--spacing-sm)' }}>
                                <div>
                                    <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>时间刷新间隔 (分钟)</label>
                                    <input className="input" type="number" min={1} max={60} value={botConfig.statusConfig?.refreshInterval ?? 5} onChange={e => setBotConfig({ ...botConfig, statusConfig: { ...(botConfig.statusConfig || {}), refreshInterval: Number(e.target.value) } })} style={{ width: '100%' }} placeholder="5" />
                                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>每 N 分钟随机刷新 Last Updated 时间</span>
                                </div>
                                <div>
                                    <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>公告信息 (可选)</label>
                                    <input className="input" value={botConfig.statusConfig?.notice || ''} onChange={e => setBotConfig({ ...botConfig, statusConfig: { ...(botConfig.statusConfig || {}), notice: e.target.value } })} style={{ width: '100%' }} placeholder="e.g. Maintenance at 3AM UTC" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <button className="btn btn-primary" style={{ marginTop: 'var(--spacing-lg)' }} onClick={saveBotConfig} disabled={saving}>
                        {saving ? '⏳ 保存中...' : '💾 保存配置'}
                    </button>
                </div>
            )}

            {/* Services Section */}
            {activeSection === 'services' && (
                <div className="card" style={{ padding: 'var(--spacing-lg)' }}>
                    <h3 style={{ marginBottom: 'var(--spacing-lg)' }}>📋 服务管理</h3>
                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                        {(botConfig.services || []).map((s, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                                <span style={{ fontSize: '20px' }}>{s.emoji}</span>
                                <span style={{ flex: 1, fontWeight: 500 }}>{s.name}</span>
                                <span style={{ color: 'var(--text-muted)' }}>{s.credits} credits</span>
                                <button className="btn btn-sm btn-outline" onClick={() => removeService(i)} style={{ color: 'var(--color-danger)' }}>🗑️</button>
                            </div>
                        ))}
                        {(botConfig.services || []).length === 0 && (
                            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--spacing-md)' }}>暂无服务</p>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div>
                            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>表情</label>
                            <input className="input" value={newService.emoji} onChange={e => setNewService({ ...newService, emoji: e.target.value })} style={{ width: '60px' }} />
                        </div>
                        <div style={{ flex: 1, minWidth: '120px' }}>
                            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>名称</label>
                            <input className="input" value={newService.name} onChange={e => setNewService({ ...newService, name: e.target.value })} placeholder="例: Apple Music" style={{ width: '100%' }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>积分</label>
                            <input className="input" type="number" min={1} value={newService.credits} onChange={e => setNewService({ ...newService, credits: Number(e.target.value) })} style={{ width: '80px' }} />
                        </div>
                        <button className="btn btn-primary btn-sm" onClick={addService}>➕ 添加</button>
                    </div>
                    <button className="btn btn-primary" style={{ marginTop: 'var(--spacing-lg)' }} onClick={saveBotConfig} disabled={saving}>
                        {saving ? '⏳ 保存中...' : '💾 保存服务'}
                    </button>
                </div>
            )}

            {/* Users Section */}
            {activeSection === 'users' && (
                <div className="card" style={{ padding: 'var(--spacing-lg)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                        <h3>👥 Bot 用户 ({botUsers.length})</h3>
                        <button className="btn btn-sm btn-secondary" onClick={fetchBotUsers}>🔄</button>
                    </div>
                    <div className="users-table">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>User ID</th>
                                    <th>用户名</th>
                                    <th>积分</th>
                                    <th>验证次数</th>
                                    <th>邀请码</th>
                                    <th>注册时间</th>
                                </tr>
                            </thead>
                            <tbody>
                                {botUsers.map((u, i) => (
                                    <tr key={i}>
                                        <td style={{ fontFamily: "'SF Mono', monospace", fontSize: 'var(--text-sm)' }}>{u.telegram_id}</td>
                                        <td>@{u.username || '-'}</td>
                                        <td><span className="badge badge-info">{u.credits}</span></td>
                                        <td>{u.total_verifications || 0}</td>
                                        <td style={{ fontFamily: "'SF Mono', monospace", fontSize: 'var(--text-sm)' }}>{u.referral_code}</td>
                                        <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{u.created_at ? new Date(u.created_at).toLocaleString() : '-'}</td>
                                    </tr>
                                ))}
                                {botUsers.length === 0 && (
                                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 'var(--spacing-xl)', color: 'var(--text-muted)' }}>暂无用户</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Orders Section */}
            {activeSection === 'orders' && (
                <div className="card" style={{ padding: 'var(--spacing-lg)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                        <h3>💰 充值订单 ({botOrders.length})</h3>
                        <button className="btn btn-sm btn-secondary" onClick={fetchBotOrders}>🔄</button>
                    </div>
                    <div className="users-table">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>订单 ID</th>
                                    <th>用户</th>
                                    <th>网络</th>
                                    <th>金额</th>
                                    <th>积分</th>
                                    <th>状态</th>
                                    <th>备注码</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {botOrders.map((o, i) => (
                                    <tr key={i}>
                                        <td style={{ fontFamily: "'SF Mono', monospace", fontSize: 'var(--text-xs)' }}>{o.id}</td>
                                        <td>{o.telegram_id}</td>
                                        <td>
                                            <span className="badge" style={{ fontSize: 'var(--text-xs)' }}>
                                                {o.network === 'trc20' ? '🔴 TRC20' : o.network === 'bsc' ? '🟡 BSC' : o.network === 'binance_pay' ? '🆔 Binance' : o.network || '-'}
                                            </span>
                                        </td>
                                        <td>${o.usdt_amount}</td>
                                        <td>{o.credits_to_add}</td>
                                        <td>
                                            <span className={`badge badge-${o.status === 'confirmed' ? 'success' : o.status === 'pending' ? 'warning' : 'error'}`}>
                                                {o.status === 'confirmed' ? '✅' : o.status === 'pending' ? '⏳' : '❌'} {o.status}
                                            </span>
                                        </td>
                                        <td style={{ fontFamily: "'SF Mono', monospace", fontSize: 'var(--text-sm)' }}>
                                            {o.note_code || (o.tx_hash ? o.tx_hash.substring(0, 12) + '...' : '-')}
                                        </td>
                                        <td>
                                            {o.status === 'pending' && (
                                                <button className="btn btn-sm btn-primary" onClick={async () => {
                                                    if (!confirm(`确认订单 ${o.id}？将为用户 ${o.telegram_id} 添加 ${o.credits_to_add} 积分。`)) return;
                                                    try {
                                                        const res = await fetch(`${API_BASE}/api/admin/bot-confirm-order`, {
                                                            method: 'POST',
                                                            headers: authHeaders,
                                                            body: JSON.stringify({ order_id: o.id })
                                                        });
                                                        if (res.ok) {
                                                            alert('✅ 订单已确认');
                                                            fetchBotOrders();
                                                        } else {
                                                            const err = await res.json();
                                                            alert('失败: ' + (err.detail || '未知错误'));
                                                        }
                                                    } catch (e) { alert('Error: ' + e.message); }
                                                }}>✅ 确认</button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {botOrders.length === 0 && (
                                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: 'var(--spacing-xl)', color: 'var(--text-muted)' }}>暂无订单</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

// CDK Management Component
function CDKManagement({ token, cdkList, setCdkList, cdkStats, setCdkStats, cdkGenerating, setCdkGenerating, cdkGenQuota, setCdkGenQuota, cdkGenCount, setCdkGenCount, cdkGenNote, setCdkGenNote, cdkFilter, setCdkFilter, cdkNewCodes, setCdkNewCodes }) {
    const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
    const [expandedCdk, setExpandedCdk] = useState(null);
    const [cdkHistory, setCdkHistory] = useState([]);
    const [cdkHistoryLoading, setCdkHistoryLoading] = useState(false);

    const fetchCDKs = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/cdk/list`, { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                setCdkList(data.cdks || []);
                setCdkStats(data.stats || {});
            }
        } catch (e) { console.error('Failed to fetch CDKs:', e); }
    };

    const fetchCdkHistory = async (code) => {
        if (expandedCdk === code) { setExpandedCdk(null); return; }
        setCdkHistoryLoading(true);
        setExpandedCdk(code);
        try {
            const res = await fetch(`${API_BASE}/api/cdk/history/${encodeURIComponent(code)}`, { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                setCdkHistory(data.records || []);
            }
        } catch (e) { console.error('Failed to fetch CDK history:', e); }
        finally { setCdkHistoryLoading(false); }
    };

    useEffect(() => { fetchCDKs(); }, []);

    const handleGenerate = async () => {
        setCdkGenerating(true);
        try {
            const res = await fetch(`${API_BASE}/api/cdk/generate`, {
                method: 'POST', headers: authHeaders,
                body: JSON.stringify({ count: cdkGenCount, quota: cdkGenQuota, note: cdkGenNote })
            });
            if (res.ok) {
                const data = await res.json();
                setCdkNewCodes(data.codes || []);
                setCdkGenNote('');
                await fetchCDKs();
            } else {
                const err = await res.json();
                alert(err.detail || '生成失败');
            }
        } catch (e) { alert('生成失败: ' + e.message); }
        finally { setCdkGenerating(false); }
    };

    const handleDelete = async (code) => {
        if (!confirm(`确定删除 CDK: ${code}？`)) return;
        try {
            const res = await fetch(`${API_BASE}/api/cdk/delete`, {
                method: 'POST', headers: authHeaders,
                body: JSON.stringify({ code })
            });
            if (res.ok) await fetchCDKs();
            else alert('删除失败');
        } catch (e) { alert('删除失败: ' + e.message); }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    const copyAllNewCodes = () => {
        navigator.clipboard.writeText(cdkNewCodes.join('\n'));
    };

    const filteredList = cdkList.filter(c => {
        if (cdkFilter === 'unused') return c.status === 'unused';
        if (cdkFilter === 'active') return c.status === 'active';
        if (cdkFilter === 'used') return c.status === 'used';
        return true;
    });

    const quotaOptions = [1, 5, 20, 50, 100];

    return (
        <div className="tab-content">
            {/* CDK Stats */}
            <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                <div className="stat-card card primary">
                    <div className="stat-icon">🔑</div>
                    <div className="stat-info">
                        <span className="stat-value">{cdkStats.total || 0}</span>
                        <span className="stat-label">总数</span>
                    </div>
                </div>
                <div className="stat-card card success">
                    <div className="stat-icon">✨</div>
                    <div className="stat-info">
                        <span className="stat-value">{cdkStats.unused || 0}</span>
                        <span className="stat-label">未使用</span>
                    </div>
                </div>
                <div className="stat-card card info">
                    <div className="stat-icon">⚡</div>
                    <div className="stat-info">
                        <span className="stat-value">{cdkStats.totalRemaining || 0}</span>
                        <span className="stat-label">剩余总额度</span>
                    </div>
                </div>
                <div className="stat-card card warning">
                    <div className="stat-icon">📊</div>
                    <div className="stat-info">
                        <span className="stat-value">{cdkStats.totalUsed || 0}</span>
                        <span className="stat-label">已消耗</span>
                    </div>
                </div>
            </div>

            {/* Generate CDK */}
            <div className="card" style={{ padding: 'var(--spacing-lg)', marginBottom: 'var(--spacing-lg)' }}>
                <h3 style={{ marginBottom: 'var(--spacing-md)', fontSize: 'var(--text-lg)' }}>🎲 生成 CDK</h3>
                <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>面额</label>
                        <select className="input" value={cdkGenQuota} onChange={e => setCdkGenQuota(Number(e.target.value))} style={{ width: '120px' }}>
                            {quotaOptions.map(q => <option key={q} value={q}>{q} 次</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>数量</label>
                        <input className="input" type="number" min={1} max={100} value={cdkGenCount} onChange={e => setCdkGenCount(Number(e.target.value))} style={{ width: '80px' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: '150px' }}>
                        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>备注（可选）</label>
                        <input className="input" type="text" placeholder="例如：测试用" value={cdkGenNote} onChange={e => setCdkGenNote(e.target.value)} style={{ width: '100%' }} />
                    </div>
                    <button className="btn btn-primary" onClick={handleGenerate} disabled={cdkGenerating}>
                        {cdkGenerating ? '⏳ 生成中...' : `🎲 生成 ${cdkGenCount} 个`}
                    </button>
                </div>
            </div>

            {/* Newly Generated Codes */}
            {cdkNewCodes.length > 0 && (
                <div className="card" style={{ padding: 'var(--spacing-lg)', marginBottom: 'var(--spacing-lg)', border: '2px solid var(--color-success)', background: 'rgba(16, 185, 129, 0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-sm)' }}>
                        <h3 style={{ fontSize: 'var(--text-base)', color: 'var(--color-success)' }}>✅ 新生成的 CDK</h3>
                        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                            <button className="btn btn-sm btn-secondary" onClick={copyAllNewCodes}>📋 复制全部</button>
                            <button className="btn btn-sm btn-ghost" onClick={() => setCdkNewCodes([])}>✕ 关闭</button>
                        </div>
                    </div>
                    <div style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 'var(--text-sm)', lineHeight: '1.8' }}>
                        {cdkNewCodes.map((code, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                <span>{code}</span>
                                <button className="btn btn-sm btn-ghost" onClick={() => copyToClipboard(code)} style={{ padding: '2px 6px', fontSize: 'var(--text-xs)' }}>📋</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Filter + CDK Table */}
            <div className="card" style={{ padding: 'var(--spacing-lg)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                    <h3 style={{ fontSize: 'var(--text-lg)' }}>📋 CDK 列表 ({filteredList.length})</h3>
                    <div style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
                        {['all', 'unused', 'active', 'used'].map(f => (
                            <button key={f} className={`btn btn-sm ${cdkFilter === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCdkFilter(f)}>
                                {f === 'all' ? '全部' : f === 'unused' ? '未使用' : f === 'active' ? '使用中' : '已用完'}
                            </button>
                        ))}
                        <button className="btn btn-sm btn-secondary" onClick={fetchCDKs}>🔄</button>
                    </div>
                </div>
                <div className="users-table">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>CDK 代码</th>
                                <th>面额</th>
                                <th>使用情况</th>
                                <th>状态</th>
                                <th>备注</th>
                                <th>创建时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredList.map(c => (
                                <React.Fragment key={c.code}>
                                    <tr>
                                        <td style={{ fontFamily: "'SF Mono', monospace", fontSize: 'var(--text-sm)' }}>{c.code}</td>
                                        <td>{c.quota} 次</td>
                                        <td>{c.used} / {c.quota}</td>
                                        <td>
                                            <span className={`badge badge-${c.status === 'unused' ? 'info' : c.status === 'active' ? 'success' : 'error'}`}>
                                                {c.status === 'unused' ? '未使用' : c.status === 'active' ? '使用中' : '已用完'}
                                            </span>
                                        </td>
                                        <td style={{ color: 'var(--text-muted)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.note || '-'}</td>
                                        <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{c.createdAt ? new Date(c.createdAt).toLocaleString() : '-'}</td>
                                        <td>
                                            <div className="action-btns">
                                                <button className="btn btn-sm btn-secondary" onClick={() => fetchCdkHistory(c.code)} title="查看验证记录"
                                                    style={{ background: expandedCdk === c.code ? 'var(--color-primary)' : undefined, color: expandedCdk === c.code ? 'white' : undefined }}
                                                >👁️</button>
                                                <button className="btn btn-sm btn-secondary" onClick={() => copyToClipboard(c.code)}>📋</button>
                                                <button className="btn btn-sm btn-outline" onClick={() => handleDelete(c.code)} style={{ color: 'var(--color-danger)' }}>🗑️</button>
                                            </div>
                                        </td>
                                    </tr>
                                    {expandedCdk === c.code && (
                                        <tr>
                                            <td colSpan={7} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                                                <div style={{ padding: '12px 20px' }}>
                                                    <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>
                                                        📜 验证记录 ({cdkHistory.length})
                                                    </div>
                                                    {cdkHistoryLoading ? (
                                                        <div style={{ textAlign: 'center', padding: '12px', color: 'var(--text-muted)' }}>⏳ 加载中...</div>
                                                    ) : cdkHistory.length === 0 ? (
                                                        <div style={{ textAlign: 'center', padding: '12px', color: 'var(--text-muted)', fontSize: '13px' }}>暂无验证记录</div>
                                                    ) : (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '240px', overflowY: 'auto' }}>
                                                            {cdkHistory.map(h => (
                                                                <div key={h.id} style={{
                                                                    display: 'flex', alignItems: 'center', gap: '10px',
                                                                    padding: '6px 10px', borderRadius: '6px',
                                                                    background: 'var(--bg-primary)', fontSize: '12px'
                                                                }}>
                                                                    <span style={{
                                                                        width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                                                                        background: h.status === 'pass' ? '#10b981' : h.status === 'failed' ? '#ef4444' : '#f59e0b'
                                                                    }} />
                                                                    <span style={{ fontFamily: "'SF Mono', monospace", minWidth: '80px', color: h.status === 'pass' ? '#10b981' : h.status === 'failed' ? '#ef4444' : '#f59e0b', fontWeight: 600 }}>
                                                                        {h.status === 'pass' ? '✅ 通过' : h.status === 'failed' ? '❌ 失败' : '⏳ ' + h.status}
                                                                    </span>
                                                                    <span style={{ fontFamily: "'SF Mono', monospace", color: 'var(--text-secondary)', minWidth: '180px' }}>
                                                                        {h.verificationId || '-'}
                                                                    </span>
                                                                    <span style={{ flex: 1, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                        {h.message || '-'}
                                                                    </span>
                                                                    <span style={{ color: 'var(--text-muted)', fontSize: '11px', flexShrink: 0 }}>
                                                                        {h.timestamp ? new Date(h.timestamp).toLocaleString() : '-'}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment >
                            ))}
                            {filteredList.length === 0 && (
                                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 'var(--spacing-xl)', color: 'var(--text-muted)' }}>暂无 CDK 数据</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

export default function Admin() {
    const { user, loading } = useAuth();
    const { t } = useLang();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('overview');
    const [siteStats, setSiteStats] = useState({});
    const [verifyLog, setVerifyLog] = useState([]);
    const [config, setConfig] = useState(null);
    const [showSaveNotice, setShowSaveNotice] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [testing, setTesting] = useState(false);
    const [saving, setSaving] = useState(false);

    // Verification history state
    const [historyData, setHistoryData] = useState([]);
    const [historyStats, setHistoryStats] = useState({ pass: 0, failed: 0, processing: 0, cancel: 0, total: 0 });
    const [hoveredStatusItem, setHoveredStatusItem] = useState(null);
    const [addCount, setAddCount] = useState(1);
    const [addingStatus, setAddingStatus] = useState(null);
    const [autoRules, setAutoRules] = useState([]);
    const [newRule, setNewRule] = useState({ intervalMinutes: 5, status: 'pass', durationHours: 0 });
    const [savingRule, setSavingRule] = useState(false);

    // CDK management state
    const [cdkList, setCdkList] = useState([]);
    const [cdkStats, setCdkStats] = useState({});
    const [cdkGenerating, setCdkGenerating] = useState(false);
    const [cdkGenQuota, setCdkGenQuota] = useState(5);
    const [cdkGenCount, setCdkGenCount] = useState(1);
    const [cdkGenNote, setCdkGenNote] = useState('');
    const [cdkFilter, setCdkFilter] = useState('all');
    const [cdkNewCodes, setCdkNewCodes] = useState([]);

    // Test document generation state
    const [testingDocument, setTestingDocument] = useState(false);
    const [testDocumentResult, setTestDocumentResult] = useState(null);

    // AI Generator form state
    const [aiProvider, setAiProvider] = useState('gemini');
    const [batchApiSettings, setBatchApiSettings] = useState({
        apiUrl: 'https://batch.1key.me/api/batch',
        apiKey: ''
    });
    const [getgemSettings, setGetgemSettings] = useState({
        apiUrl: 'https://getgem.cc',
        cdk: '',
        hasStoredCdk: false
    });
    const [appendGetgemCdk, setAppendGetgemCdk] = useState(true);
    const [getgemStatus, setGetgemStatus] = useState(null);
    const [getgemChecking, setGetgemChecking] = useState(false);
    const [geminiSettings, setGeminiSettings] = useState({
        apiKey: '',
        model: 'gemini-3-pro-image-preview',
        documentTypes: ['id_card', 'transcript', 'schedule']  // Default: generate all
    });
    const [puppeteerSettings, setPuppeteerSettings] = useState({
        template: 'student-id-generator.html',
        useGeminiPhoto: true,
        availableTemplates: []
    });
    const [sheeridSettings, setSheeridSettings] = useState({
        docTypes: ['class_schedule']  // Default: class_schedule, array for multi-select
    });
    const [lionpathSettings, setLionpathSettings] = useState({
        template: 'schedule.html',
        availableTemplates: []
    });
    const [vsidSettings, setVsidSettings] = useState({
        docTypes: ['student_id', 'schedule'],  // Default: student ID and schedule
        availableDocTypes: []
    });
    const [uiucSettings, setUiucSettings] = useState({
        templates: ['uiuc_id_card.html'],
        availableTemplates: []
    });
    const [onepasshtmlSettings, setOnepasshtmlSettings] = useState({
        templates: [],
        availableTemplates: []
    });
    const [proxySettings, setProxySettings] = useState({
        enabled: true,
        host: 'proxy.global.ip2up.com',
        port: '12348',
        user: '',
        password: ''
    });

    // Region mode state: 'global' (default) or 'us_only'
    const [regionMode, setRegionMode] = useState('global');

    // Maintenance mode state
    const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
    const [maintenanceMessage, setMaintenanceMessage] = useState('系统维护中，请稍后再试');
    const [maintenanceEstEnd, setMaintenanceEstEnd] = useState('');
    const [maintenanceSaving, setMaintenanceSaving] = useState(false);
    const [maintenanceSaved, setMaintenanceSaved] = useState(false);

    // Tips inline state
    const [tipsContent, setTipsContent] = useState('在 one.google.com/ai-student 的蓝色按钮上右键复制链接，不要点进去！建议用无痕窗口登录账户获取。\n如果验证链接中 verificationId= 后面是空的，建议直接换号。\n一次消耗一个配额，成功后自动扣除。');
    const [tipsSaving, setTipsSaving] = useState(false);
    const [tipsSaved, setTipsSaved] = useState(false);

    // Database backup state
    const [backupList, setBackupList] = useState([]);
    const [backupCreating, setBackupCreating] = useState(false);
    const [backupDownloading, setBackupDownloading] = useState(false);

    // Verification mode: 'api' (default) or 'browser' (Puppeteer) — only for non-telegram providers
    const [browserMode, setBrowserMode] = useState(false);

    // University source: 'sheerid_api' (dynamic) or 'custom_list' (local list)
    const [universitySource, setUniversitySource] = useState('sheerid_api');

    // Telegram multi-account management
    const [tgAccounts, setTgAccounts] = useState([]);
    const [tgShowAdd, setTgShowAdd] = useState(false);
    const [tgNewApiId, setTgNewApiId] = useState('');
    const [tgNewApiHash, setTgNewApiHash] = useState('');
    const [tgNewLabel, setTgNewLabel] = useState('');
    const [tgLoginAccountId, setTgLoginAccountId] = useState(null);
    const [tgLoginPhone, setTgLoginPhone] = useState('');
    const [tgLoginCode, setTgLoginCode] = useState('');
    const [tgLoginHash, setTgLoginHash] = useState('');
    const [tgLoginPassword, setTgLoginPassword] = useState('');
    const [tgLoginStep, setTgLoginStep] = useState('idle'); // idle | phone | code | password | done
    const [tgLoginMsg, setTgLoginMsg] = useState('');
    const [tgLoading, setTgLoading] = useState(false);
    const [tgCheckResults, setTgCheckResults] = useState(null);
    const [tgChecking, setTgChecking] = useState(false);

    // Bot Stats (waterfall priority)
    const [botStats, setBotStats] = useState({ bots: [], windowMinutes: 60 });

    const fetchBotStats = async () => {
        try {
            const res = await fetch(`${API}/api/bot-stats`);
            if (res.ok) setBotStats(await res.json());
        } catch (e) { /* ignore */ }
    };

    // Auto-refresh bot stats every 15s when in telegram mode
    useEffect(() => {
        if (aiProvider !== 'telegram') return;
        fetchBotStats();
        const interval = setInterval(fetchBotStats, 15000);
        return () => clearInterval(interval);
    }, [aiProvider]);

    useEffect(() => {
        if (!loading && !user) {
            navigate('/');
        }
    }, [user, loading, navigate]);

    // Load configuration on mount
    useEffect(() => {
        fetchConfig();
        fetchTgAccounts();
        // Fetch site-wide stats for Overview tab
        const fetchSiteData = async () => {
            try {
                const token = user?.token || localStorage.getItem('verifykey-token');
                const headers = { 'Authorization': `Bearer ${token}` };
                const [statsRes, logRes] = await Promise.all([
                    fetch(`${API_BASE}/api/admin/bot-stats`, { headers }),
                    fetch(`${API_BASE}/api/verify/history`)
                ]);
                if (statsRes.ok) setSiteStats(await statsRes.json());
                if (logRes.ok) {
                    const logData = await logRes.json();
                    const all = (logData.history || []).filter(r => r.verificationId?.trim() && !r.verificationId.startsWith('auto-'));
                    const apiLog = all.slice(-50).reverse();
                    // Merge: preserve SSE "processing" entries that aren't in API data yet
                    setVerifyLog(prev => {
                        const sseProcessing = prev.filter(e => (e.status === 'processing' || e.status === 'submitted') && !apiLog.some(a => a.verificationId === e.verificationId));
                        return sseProcessing.length > 0 ? [...sseProcessing, ...apiLog].slice(0, 300) : apiLog;
                    });
                }
            } catch (e) { console.error('Failed to fetch site data:', e); }
        };
        fetchSiteData();
        const interval = setInterval(fetchSiteData, 15000);
        return () => clearInterval(interval);
    }, []);

    // SSE Real-time updates for overview verification log
    useEffect(() => {
        const token = user?.token || localStorage.getItem('verifykey-token');
        if (!token) return;

        const sseUrl = `${API_BASE}/api/admin/verify-stream?authorization=Bearer ${token}`;
        const es = new EventSource(sseUrl);

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'progress') {
                    const vid = data.vid || '';
                    if (!vid) return;
                    setVerifyLog(prev => {
                        const existingIdx = prev.findIndex(l => l.verificationId === vid);
                        const newEntry = {
                            id: existingIdx >= 0 ? prev[existingIdx].id : `sse-${Date.now()}-${Math.random()}`,
                            verificationId: vid,
                            status: data.step === 'submitted' ? 'processing' : 'processing',
                            message: data.message || '处理中...',
                            timestamp: new Date().toISOString(),
                            cdk: existingIdx >= 0 ? prev[existingIdx].cdk : '',
                        };
                        if (existingIdx >= 0) {
                            const newLog = [...prev];
                            newLog[existingIdx] = { ...newLog[existingIdx], ...newEntry };
                            return newLog;
                        } else {
                            return [newEntry, ...prev].slice(0, 300);
                        }
                    });
                } else if (data.type === 'done') {
                    setVerifyLog(prev => {
                        let newLog = [...prev];
                        for (const res of data.results || []) {
                            const vid = res.verificationId || res.vid || '';
                            if (!vid) continue;
                            const status = res.success ? 'pass' : 'failed';
                            const msg = res.message || res.reason || '';
                            const existingIdx = newLog.findIndex(l => l.verificationId === vid);
                            if (existingIdx >= 0) {
                                newLog[existingIdx] = {
                                    ...newLog[existingIdx],
                                    status,
                                    message: msg,
                                    timestamp: new Date().toISOString(),
                                };
                            } else {
                                newLog.unshift({
                                    id: `sse-done-${Date.now()}-${Math.random()}`,
                                    verificationId: vid,
                                    status,
                                    message: msg,
                                    timestamp: new Date().toISOString(),
                                    cdk: data.cdkRemaining != null ? '' : '',
                                });
                            }
                        }
                        return newLog.slice(0, 300);
                    });
                }
            } catch (err) {
                console.error('Overview SSE parse error', err);
            }
        };

        es.onerror = () => {
            // Will auto-reconnect
        };

        return () => es.close();
    }, []);

    // Fetch verification history when tab is activated
    useEffect(() => {
        if (activeTab === 'verify-status') {
            (async () => {
                try {
                    const res = await fetch(`${API_BASE}/api/verify/history`);
                    if (res.ok) {
                        const data = await res.json();
                        setHistoryData(data.history || []);
                        setHistoryStats(data.stats || { pass: 0, failed: 0, processing: 0, cancel: 0, total: 0 });
                    }
                    // Load auto-record rules
                    const arRes = await fetch(`${API_BASE}/api/verify/auto-record`);
                    if (arRes.ok) {
                        const arData = await arRes.json();
                        setAutoRules(arData.rules || []);
                    }
                } catch (e) {
                    console.warn('Failed to fetch verification history:', e);
                }
            })();
        }
    }, [activeTab]);

    // Fetch maintenance status and tips when settings tab is activated
    useEffect(() => {
        if (activeTab === 'settings') {
            (async () => {
                try {
                    const res = await fetch(`${API_BASE}/api/maintenance`);
                    if (res.ok) {
                        const data = await res.json();
                        setMaintenanceEnabled(data.enabled);
                        setMaintenanceMessage(data.message || '系统维护中，请稍后再试');
                        setMaintenanceEstEnd(data.estimatedEnd || '');
                    }
                } catch (e) {
                    console.warn('Failed to fetch maintenance status:', e);
                }
                // Fetch tips inline config
                try {
                    const res = await fetch(`${API_BASE}/api/config`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.tipsInline?.content) {
                            setTipsContent(data.tipsInline.content);
                        }
                    }
                } catch (e) {
                    console.warn('Failed to fetch tips config:', e);
                }
                // Fetch backup list
                try {
                    const token = user?.token || localStorage.getItem('verifykey-token');
                    const res = await fetch(`${API_BASE}/api/backup/list`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        setBackupList(data.backups || []);
                    }
                } catch (e) {
                    console.warn('Failed to fetch backup list:', e);
                }
            })();
        }
    }, [activeTab]);

    const handleSaveMaintenance = async () => {
        setMaintenanceSaving(true);
        setMaintenanceSaved(false);
        try {
            const token = user?.token || localStorage.getItem('verifykey-token');
            const res = await fetch(`${API_BASE}/api/maintenance`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    enabled: maintenanceEnabled,
                    message: maintenanceMessage,
                    estimatedEnd: maintenanceEstEnd || null
                })
            });
            if (res.ok) {
                setMaintenanceSaved(true);
                setTimeout(() => setMaintenanceSaved(false), 2000);
            } else {
                const err = await res.json();
                alert(err.error || '保存失败');
            }
        } catch (e) {
            alert('保存失败: ' + e.message);
        } finally {
            setMaintenanceSaving(false);
        }
    };

    const handleSaveTips = async () => {
        setTipsSaving(true);
        setTipsSaved(false);
        try {
            const token = user?.token || localStorage.getItem('verifykey-token');
            const res = await fetch(`${API_BASE}/api/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ tipsInline: { content: tipsContent } })
            });
            if (res.ok) {
                setTipsSaved(true);
                setTimeout(() => setTipsSaved(false), 2000);
            } else {
                const err = await res.json();
                alert(err.error || '保存失败');
            }
        } catch (e) {
            alert('保存失败: ' + e.message);
        } finally {
            setTipsSaving(false);
        }
    };

    const handleCreateBackup = async () => {
        setBackupCreating(true);
        try {
            const token = user?.token || localStorage.getItem('verifykey-token');
            const res = await fetch(`${API_BASE}/api/backup/create`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setBackupList(data.backups || []);
            } else {
                alert('备份创建失败');
            }
        } catch (e) {
            alert('备份创建失败: ' + e.message);
        } finally {
            setBackupCreating(false);
        }
    };

    const handleDownloadBackup = async () => {
        setBackupDownloading(true);
        try {
            const token = user?.token || localStorage.getItem('verifykey-token');
            const res = await fetch(`${API_BASE}/api/backup/download`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `onepass_backup_${new Date().toISOString().slice(0, 10)}.db`;
                a.click();
                URL.revokeObjectURL(url);
                // Refresh backup list
                const listRes = await fetch(`${API_BASE}/api/backup/list`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (listRes.ok) {
                    const data = await listRes.json();
                    setBackupList(data.backups || []);
                }
            } else {
                alert('下载备份失败');
            }
        } catch (e) {
            alert('下载备份失败: ' + e.message);
        } finally {
            setBackupDownloading(false);
        }
    };

    // ========== Telegram Multi-Account Management ==========
    const fetchTgAccounts = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/telegram/accounts`);
            if (res.ok) {
                const data = await res.json();
                setTgAccounts(data.accounts || []);
            }
        } catch (e) { console.error('Failed to fetch TG accounts:', e); }
    };

    const handleTgAdd = async () => {
        if (!tgNewApiId || !tgNewApiHash) return;
        setTgLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/telegram/accounts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiId: tgNewApiId, apiHash: tgNewApiHash, label: tgNewLabel || undefined })
            });
            if (res.ok) {
                setTgShowAdd(false);
                setTgNewApiId(''); setTgNewApiHash(''); setTgNewLabel('');
                fetchTgAccounts();
            }
        } catch (e) { alert('添加失败: ' + e.message); }
        setTgLoading(false);
    };

    const handleTgLoginRequest = async (accountId) => {
        if (!tgLoginPhone) return;
        setTgLoading(true); setTgLoginMsg('');
        try {
            const res = await fetch(`${API_BASE}/api/telegram/accounts/${accountId}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: tgLoginPhone })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setTgLoginHash(data.phone_code_hash);
                setTgLoginStep('code');
                setTgLoginMsg(data.message);
            } else {
                setTgLoginMsg(data.detail || data.error || '发送验证码失败');
            }
        } catch (e) { setTgLoginMsg('网络错误: ' + e.message); }
        setTgLoading(false);
    };

    const handleTgVerifyCode = async (accountId) => {
        if (!tgLoginCode) return;
        setTgLoading(true); setTgLoginMsg('');
        try {
            const res = await fetch(`${API_BASE}/api/telegram/accounts/${accountId}/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone: tgLoginPhone,
                    code: tgLoginCode,
                    phone_code_hash: tgLoginHash,
                    password: tgLoginPassword || undefined
                })
            });
            const data = await res.json();
            if (data.needs_password) {
                setTgLoginStep('password');
                setTgLoginMsg('此账号启用了两步验证，请输入密码');
            } else if (res.ok && data.success) {
                setTgLoginStep('done');
                setTgLoginMsg(`✅ ${data.message}`);
                setTgLoginAccountId(null);
                fetchTgAccounts();
            } else {
                setTgLoginMsg(data.detail || data.error || '验证码错误');
            }
        } catch (e) { setTgLoginMsg('网络错误: ' + e.message); }
        setTgLoading(false);
    };

    const handleTgRemove = async (accountId) => {
        if (!window.confirm('确定要删除这个账号吗？')) return;
        try {
            await fetch(`${API_BASE}/api/telegram/accounts/${accountId}`, { method: 'DELETE' });
            fetchTgAccounts();
        } catch (e) { alert('删除失败'); }
    };

    const handleTgToggle = async (accountId, currentEnabled) => {
        try {
            const res = await fetch(`${API_BASE}/api/telegram/accounts/${accountId}/toggle`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: !currentEnabled })
            });
            if (res.ok) {
                fetchTgAccounts();
            }
        } catch (e) { console.error('Toggle failed:', e); }
    };

    const handleTgBotAssign = async (accountId, botType, currentAssigned) => {
        const newAssigned = currentAssigned.includes(botType)
            ? currentAssigned.filter(b => b !== botType)
            : [...currentAssigned, botType];
        try {
            const res = await fetch(`${API_BASE}/api/telegram/accounts/${accountId}/toggle`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assignedBots: newAssigned })
            });
            if (res.ok) {
                fetchTgAccounts();
            }
        } catch (e) { console.error('Bot assign failed:', e); }
    };

    const handleTgCheckConnections = async () => {
        setTgChecking(true);
        setTgCheckResults(null);
        try {
            const res = await fetch(`${API_BASE}/api/telegram/accounts/check-connections`, { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                const map = {};
                (data.results || []).forEach(r => { map[r.id] = r; });
                setTgCheckResults(map);
                fetchTgAccounts();
            }
        } catch (e) { console.error('Check connections failed:', e); }
        setTgChecking(false);
    };

    const fetchConfig = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/config`);
            if (res.ok) {
                const data = await res.json();
                setConfig(data);
                setAiProvider(data.aiGenerator?.provider || 'gemini');
                if (data.aiGenerator?.batchApi) {
                    setBatchApiSettings(prev => ({
                        ...prev,
                        apiUrl: data.aiGenerator.batchApi.apiUrl || prev.apiUrl,
                        apiKey: data.aiGenerator.batchApi.apiKey?.includes('...')
                            ? ''
                            : (data.aiGenerator.batchApi.apiKey || '')
                    }));
                    if (data.aiGenerator.batchApi.apiKey?.includes('...')) {
                        setBatchApiSettings(prev => ({ ...prev, hasStoredKey: true }));
                    }
                }
                // Load GetGem settings
                if (data.aiGenerator?.getgem) {
                    setGetgemSettings(prev => ({
                        ...prev,
                        apiUrl: data.aiGenerator.getgem.apiUrl || prev.apiUrl,
                        cdk: data.aiGenerator.getgem.cdk?.includes('...')
                            ? ''
                            : (data.aiGenerator.getgem.cdk || '')
                    }));
                    if (data.aiGenerator.getgem.cdk?.includes('...')) {
                        setGetgemSettings(prev => ({ ...prev, hasStoredCdk: true }));
                    }
                }
                if (data.aiGenerator?.gemini) {
                    setGeminiSettings(prev => ({
                        ...prev,
                        apiKey: data.aiGenerator.gemini.apiKey?.includes('...')
                            ? ''
                            : (data.aiGenerator.gemini.apiKey || ''),
                        model: data.aiGenerator.gemini.model || prev.model,
                        documentTypes: data.aiGenerator.gemini.documentTypes || prev.documentTypes
                    }));
                    if (data.aiGenerator.gemini.apiKey?.includes('...')) {
                        setGeminiSettings(prev => ({ ...prev, hasStoredKey: true }));
                    }
                }
                if (data.aiGenerator?.puppeteer) {
                    setPuppeteerSettings(prev => ({
                        ...prev,
                        template: data.aiGenerator.puppeteer.template || prev.template,
                        useGeminiPhoto: data.aiGenerator.puppeteer.useGeminiPhoto !== false
                    }));
                }
                // Load SheerID settings
                if (data.aiGenerator?.sheerid) {
                    setSheeridSettings(prev => ({
                        ...prev,
                        docTypes: data.aiGenerator.sheerid.docTypes || prev.docTypes
                    }));
                }
                // Load proxy settings
                if (data.proxy) {
                    setProxySettings(prev => ({
                        ...prev,
                        enabled: data.proxy.enabled !== false,
                        host: data.proxy.host || prev.host,
                        port: data.proxy.port || prev.port,
                        user: data.proxy.user?.includes('...') ? '' : (data.proxy.user || ''),
                        password: data.proxy.password?.includes('...') ? '' : (data.proxy.password || ''),
                        hasStoredCredentials: data.proxy.user?.includes('...')
                    }));
                }
                // Load region mode setting
                if (data.aiGenerator?.regionMode) {
                    setRegionMode(data.aiGenerator.regionMode);
                }
                // Load university source setting
                if (data.aiGenerator?.universitySource) {
                    setUniversitySource(data.aiGenerator.universitySource);
                }
                // Load browser mode setting
                if (data.verification?.browserMode !== undefined) {
                    setBrowserMode(data.verification.browserMode);
                }
                // Load LionPATH settings
                if (data.aiGenerator?.lionpath) {
                    setLionpathSettings(prev => ({
                        ...prev,
                        template: data.aiGenerator.lionpath.template || prev.template,
                        templates: data.aiGenerator.lionpath.templates || (data.aiGenerator.lionpath.template ? [data.aiGenerator.lionpath.template] : [])
                    }));
                }
                // Load VSID settings
                if (data.aiGenerator?.vsid) {
                    setVsidSettings(prev => ({
                        ...prev,
                        docTypes: data.aiGenerator.vsid.docTypes || prev.docTypes
                    }));
                }
                // Load UIUC settings
                if (data.aiGenerator?.uiuc) {
                    setUiucSettings(prev => ({
                        ...prev,
                        templates: data.aiGenerator.uiuc.templates || prev.templates
                    }));
                }
                // Load OnepassHTML settings
                if (data.aiGenerator?.onepasshtml) {
                    setOnepasshtmlSettings(prev => ({
                        ...prev,
                        templates: data.aiGenerator.onepasshtml.templates || prev.templates
                    }));
                }
            }

            // Fetch available templates
            const templatesRes = await fetch(`${API_BASE}/api/templates`);
            if (templatesRes.ok) {
                const templatesData = await templatesRes.json();
                setPuppeteerSettings(prev => ({
                    ...prev,
                    availableTemplates: templatesData.templates || []
                }));
            }

            // Fetch LionPATH templates
            const lionpathTemplatesRes = await fetch(`${API_BASE}/api/lionpath-templates`);
            if (lionpathTemplatesRes.ok) {
                const lionpathTemplatesData = await lionpathTemplatesRes.json();
                setLionpathSettings(prev => ({
                    ...prev,
                    availableTemplates: lionpathTemplatesData.templates || []
                }));
            }

            // Fetch VSID document types
            const vsidDocTypesRes = await fetch(`${API_BASE}/api/vsid-doctypes`);
            if (vsidDocTypesRes.ok) {
                const vsidDocTypesData = await vsidDocTypesRes.json();
                setVsidSettings(prev => ({
                    ...prev,
                    availableDocTypes: vsidDocTypesData.docTypes || []
                }));
            }

            // Fetch UIUC templates
            const uiucTemplatesRes = await fetch(`${API_BASE}/api/uiuc-templates`);
            if (uiucTemplatesRes.ok) {
                const uiucTemplatesData = await uiucTemplatesRes.json();
                setUiucSettings(prev => ({
                    ...prev,
                    availableTemplates: uiucTemplatesData.templates || []
                }));
            }

            // Fetch OnepassHTML templates
            const onepasshtmlTemplatesRes = await fetch(`${API_BASE}/api/onepasshtml-templates`);
            if (onepasshtmlTemplatesRes.ok) {
                const onepasshtmlTemplatesData = await onepasshtmlTemplatesRes.json();
                setOnepasshtmlSettings(prev => ({
                    ...prev,
                    availableTemplates: onepasshtmlTemplatesData.templates || []
                }));
            }
        } catch (error) {
            console.error('Failed to load config:', error);
        }
    };

    const handleSaveAiConfig = async () => {
        setSaving(true);
        try {
            const updates = {
                aiGenerator: {
                    provider: aiProvider,
                    regionMode: regionMode,
                    universitySource: universitySource,
                    batchApi: {
                        enabled: aiProvider === 'batch_api',
                        apiUrl: batchApiSettings.apiUrl,
                        apiKey: batchApiSettings.apiKey || undefined
                    },
                    getgem: {
                        enabled: aiProvider === 'getgem',
                        apiUrl: getgemSettings.apiUrl,
                        cdk: getgemSettings.cdk || undefined,
                        appendCdk: appendGetgemCdk
                    },
                    gemini: {
                        enabled: aiProvider === 'gemini' || aiProvider === 'puppeteer',
                        apiKey: geminiSettings.apiKey || undefined,
                        model: geminiSettings.model,
                        documentTypes: geminiSettings.documentTypes
                    },
                    puppeteer: {
                        enabled: aiProvider === 'puppeteer',
                        template: puppeteerSettings.template,
                        useGeminiPhoto: puppeteerSettings.useGeminiPhoto
                    },
                    sheerid: {
                        enabled: aiProvider === 'sheerid',
                        docTypes: sheeridSettings.docTypes || ['class_schedule']
                    },
                    lionpath: {
                        enabled: aiProvider === 'lionpath',
                        template: lionpathSettings.template,
                        templates: lionpathSettings.templates || (lionpathSettings.template ? [lionpathSettings.template] : [])
                    },
                    vsid: {
                        enabled: aiProvider === 'vsid',
                        docTypes: vsidSettings.docTypes || ['student_id', 'schedule']
                    },
                    uiuc: {
                        enabled: aiProvider === 'uiuc',
                        templates: uiucSettings.templates || ['uiuc_id_card.html']
                    },
                    onepasshtml: {
                        enabled: aiProvider === 'onepasshtml',
                        templates: onepasshtmlSettings.templates || []
                    },
                    svgFallback: { enabled: true }
                },
                proxy: {
                    enabled: proxySettings.enabled,
                    host: proxySettings.host,
                    port: proxySettings.port,
                    user: proxySettings.user || undefined,
                    password: proxySettings.password || undefined
                },
                verification: {
                    browserMode: browserMode,
                    telegram: {
                        enabled: config?.verification?.telegram?.enabled || false,
                        apiId: config?.verification?.telegram?.apiId,
                        apiHash: config?.verification?.telegram?.apiHash,
                        botUsername: config?.verification?.telegram?.botUsername
                    },
                    dualBot: {
                        ...(config?.verification?.dualBot || {}),
                        enabled: config?.verification?.dualBot?.enabled || false,
                        warmupBot: config?.verification?.dualBot?.warmupBot || '@SatsetHelperbot',
                        verifyBot: config?.verification?.dualBot?.verifyBot || '@AutoGeminiProbot',
                        autoBypass: config?.verification?.dualBot?.autoBypass !== false
                    },
                    singleBots: config?.verification?.singleBots || []
                }
            };

            const res = await fetch(`${API_BASE}/api/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });

            if (res.ok) {
                setShowSaveNotice(true);
                setTimeout(() => setShowSaveNotice(false), 2000);
                fetchConfig();
            }
        } catch (error) {
            console.error('Failed to save config:', error);
        }
        setSaving(false);
    };

    const handleTestConnection = async () => {
        setTesting(true);
        setTestResult(null);

        try {
            const body = {
                provider: aiProvider,
                apiUrl: aiProvider === 'batch_api' ? batchApiSettings.apiUrl : undefined,
                apiKey: aiProvider === 'batch_api' ? batchApiSettings.apiKey : geminiSettings.apiKey,
                model: geminiSettings.model
            };

            const res = await fetch(`${API_BASE}/api/config/test`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await res.json();
            setTestResult(data);
        } catch (error) {
            setTestResult({ success: false, message: error.message });
        }
        setTesting(false);
    };

    const handleTestDocument = async () => {
        setTestingDocument(true);
        setTestDocumentResult(null);

        try {
            // Build config based on selected provider
            const testConfig = {
                provider: aiProvider
            };

            if (aiProvider === 'puppeteer') {
                testConfig.template = puppeteerSettings.template;
                testConfig.useGeminiPhoto = puppeteerSettings.useGeminiPhoto;
                if (puppeteerSettings.useGeminiPhoto && geminiSettings.apiKey) {
                    testConfig.geminiApiKey = geminiSettings.apiKey;
                }
            } else if (aiProvider === 'gemini') {
                testConfig.geminiApiKey = geminiSettings.apiKey;
                testConfig.geminiModel = geminiSettings.model;
            } else if (aiProvider === 'batch_api') {
                testConfig.batchApiUrl = batchApiSettings.apiUrl;
                testConfig.batchApiKey = batchApiSettings.apiKey;
            }

            const res = await fetch(`${API_BASE}/api/config/test-document`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(testConfig)
            });

            const data = await res.json();
            setTestDocumentResult(data);
        } catch (error) {
            setTestDocumentResult({ success: false, message: error.message });
        }
        setTestingDocument(false);
    };

    // 模拟数据
    const stats = {
        totalUsers: 1247,
        activeUsers: 892,
        totalVerifications: 34582,
        successRate: 98.7,
        revenue: 12580,
        pendingWithdrawals: 3
    };

    const users = [
        { id: 1, username: 'user1', email: 'user1@example.com', credits: 150, status: 'active', joined: '2026-01-15' },
        { id: 2, username: 'user2', email: 'user2@example.com', credits: 45, status: 'active', joined: '2026-01-18' },
        { id: 3, username: 'user3', email: 'user3@example.com', credits: 0, status: 'suspended', joined: '2026-01-20' },
        { id: 4, username: 'user4', email: 'user4@example.com', credits: 320, status: 'active', joined: '2026-01-22' },
    ];

    const tabs = [
        { id: 'overview', label: t('tabOverview'), icon: '📊' },
        { id: 'cdk', label: t('tabCdk'), icon: '🔑' },
        { id: 'users', label: t('tabUsers'), icon: '👥' },
        { id: 'ai-generator', label: t('tabAiGen'), icon: '🤖' },
        { id: 'verify-status', label: t('tabVerifyStatus'), icon: '📋' },
        { id: 'telegram-bot', label: t('tabTgBot'), icon: '🤖' },
        { id: 'settings', label: t('tabSettings'), icon: '⚙️' },
    ];

    if (loading || !user) return null;

    return (
        <div className="admin-page">
            <div className="container">
                {/* Header */}
                <div className="admin-header">
                    <h1 className="page-title">{t('adminTitle')}</h1>
                    <p className="page-desc">{t('adminDesc')}</p>
                </div>

                {/* Tabs */}
                <div className="admin-tabs">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            className={`admin-tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            <span className="tab-icon">{tab.icon}</span>
                            <span className="tab-label">{tab.label}</span>
                        </button>
                    ))}
                </div>

                {/* Overview Tab */}
                {activeTab === 'overview' && (
                    <div className="tab-content">
                        <div className="stats-grid">
                            <div className="stat-card card">
                                <div className="stat-icon">🎓</div>
                                <div className="stat-info">
                                    <span className="stat-value">{siteStats?.site_total_success || 0}</span>
                                    <span className="stat-label">{t('statTotalSuccess')}</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">⏱️</div>
                                <div className="stat-info">
                                    <span className="stat-value">{siteStats?.site_1h_success_rate || 0}%</span>
                                    <span className="stat-label">{t('stat1hRate')}</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">📈</div>
                                <div className="stat-info">
                                    <span className="stat-value">{siteStats?.site_5h_success_rate || 0}%</span>
                                    <span className="stat-label">{t('stat5hRate')}</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">🌐</div>
                                <div className="stat-info">
                                    <span className="stat-value">{siteStats?.site_cdk_api || 0}</span>
                                    <span className="stat-label">{t('statApiUsage')}</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">🤖</div>
                                <div className="stat-info">
                                    <span className="stat-value">{siteStats?.site_cdk_local || 0}</span>
                                    <span className="stat-label">{t('statLocalUsage')}</span>
                                </div>
                            </div>
                        </div>

                        {/* Verification Log */}
                        <div className="card" style={{ marginTop: 'var(--spacing-lg)', padding: 'var(--spacing-lg)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px', fontSize: '14px', flexWrap: 'wrap' }}>
                                <span>{t('logTotal')} <strong>{verifyLog.length}</strong> {t('logEntries')}</span>
                                <span>|</span>
                                {verifyLog.filter(r => r.status === 'processing').length > 0 && (
                                    <span style={{ color: '#f59e0b', fontWeight: 600 }}>{verifyLog.filter(r => r.status === 'processing').length} 处理中</span>
                                )}
                                <span style={{ color: '#16a34a', fontWeight: 600 }}>{verifyLog.filter(r => r.status === 'pass').length} {t('logSuccess')}</span>
                                <span style={{ color: '#dc2626', fontWeight: 600 }}>{verifyLog.filter(r => r.status === 'failed').length} {t('logFailed')}</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '600px', overflowY: 'auto' }}>
                                {verifyLog.length === 0 && <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '24px' }}>{t('logNoRecords')}</div>}
                                {verifyLog.map(r => {
                                    const isPass = r.status === 'pass';
                                    const isProcessing = r.status === 'processing';
                                    const vid = r.verificationId || '';
                                    const shortVid = vid.length > 20 ? `${vid.slice(0, 8)}...${vid.slice(-8)}` : vid;
                                    const ts = r.timestamp ? new Date(r.timestamp).toLocaleString('zh-CN', { hour12: false }) : '';
                                    const bgColor = isProcessing ? 'rgba(245, 158, 11, 0.06)' : isPass ? 'rgba(22, 163, 74, 0.06)' : 'rgba(220, 38, 38, 0.06)';
                                    const borderColor = isProcessing ? 'rgba(245, 158, 11, 0.15)' : isPass ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.15)';
                                    const iconBg = isProcessing ? '#f59e0b' : isPass ? '#16a34a' : '#dc2626';
                                    const icon = isProcessing ? '◎' : isPass ? '✓' : '✕';
                                    const msgColor = isProcessing ? '#f59e0b' : isPass ? '#16a34a' : '#dc2626';
                                    return (
                                        <div key={r.id} style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: '14px',
                                            padding: '14px 18px',
                                            borderRadius: '10px',
                                            background: bgColor,
                                            border: `1px solid ${borderColor}`,
                                        }}>
                                            <div style={{
                                                width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                                                background: iconBg,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                color: '#fff', fontSize: '14px', fontWeight: 700, marginTop: '2px',
                                                ...(isProcessing ? { animation: 'pulse 1.5s ease-in-out infinite' } : {}),
                                            }}>{icon}</div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>VID: {shortVid}</span>
                                                    {isProcessing && (
                                                        <span style={{
                                                            fontSize: '11px', padding: '1px 8px', borderRadius: '10px',
                                                            background: '#f59e0b', color: '#fff', fontWeight: 600,
                                                        }}>处理中</span>
                                                    )}
                                                </div>
                                                {r.message && <div style={{ fontSize: '13px', fontWeight: 600, color: msgColor, marginTop: '3px', wordBreak: 'break-all' }}>{r.message}</div>}
                                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span>{ts}</span>
                                                    {r.cdk && <span style={{ background: 'var(--bg-tertiary)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' }}>🔑 {r.cdk}</span>}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* CDK Management Tab */}
                {activeTab === 'cdk' && (
                    <CDKManagement
                        token={user?.token || localStorage.getItem('verifykey-token')}
                        cdkList={cdkList}
                        setCdkList={setCdkList}
                        cdkStats={cdkStats}
                        setCdkStats={setCdkStats}
                        cdkGenerating={cdkGenerating}
                        setCdkGenerating={setCdkGenerating}
                        cdkGenQuota={cdkGenQuota}
                        setCdkGenQuota={setCdkGenQuota}
                        cdkGenCount={cdkGenCount}
                        setCdkGenCount={setCdkGenCount}
                        cdkGenNote={cdkGenNote}
                        setCdkGenNote={setCdkGenNote}
                        cdkFilter={cdkFilter}
                        setCdkFilter={setCdkFilter}
                        cdkNewCodes={cdkNewCodes}
                        setCdkNewCodes={setCdkNewCodes}
                    />
                )}

                {/* Users Tab */}
                {activeTab === 'users' && (
                    <div className="tab-content">
                        <div className="users-table card">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>用户名</th>
                                        <th>邮箱</th>
                                        <th>积分</th>
                                        <th>状态</th>
                                        <th>注册时间</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map(u => (
                                        <tr key={u.id}>
                                            <td>{u.id}</td>
                                            <td>{u.username}</td>
                                            <td>{u.email}</td>
                                            <td>{u.credits}</td>
                                            <td>
                                                <span className={`badge badge-${u.status === 'active' ? 'success' : 'error'}`}>
                                                    {u.status === 'active' ? '正常' : '禁用'}
                                                </span>
                                            </td>
                                            <td>{u.joined}</td>
                                            <td>
                                                <div className="action-btns">
                                                    <button className="btn btn-sm btn-secondary">编辑</button>
                                                    <button className="btn btn-sm btn-outline">禁用</button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* AI Generator Tab */}
                {activeTab === 'ai-generator' && (
                    <div className="tab-content">
                        <div className="settings-section card">
                            <h3>🤖 AI 文档生成器配置</h3>
                            <p className="settings-desc">
                                选择用于生成验证文档（学生证、成绩单）的 AI 提供商。
                            </p>

                            {/* Provider Selection — Categorized */}

                            {/* ── API 类 ── */}
                            <div style={{ marginBottom: '20px' }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    marginBottom: '10px', paddingBottom: '8px',
                                    borderBottom: '2px solid rgba(0,136,204,0.15)'
                                }}>
                                    <span style={{
                                        fontSize: '11px', fontWeight: 700,
                                        background: 'linear-gradient(135deg, #0088cc, #005fa3)',
                                        color: 'white', padding: '3px 10px', borderRadius: '10px',
                                        letterSpacing: '0.5px'
                                    }}>🔌 API 类</span>
                                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>调用外部服务</span>
                                </div>
                                <div className="provider-cards">
                                    <div
                                        className={`provider-card ${aiProvider === 'getgem' ? 'active' : ''}`}
                                        onClick={() => setAiProvider('getgem')}
                                    >
                                        <div className="provider-icon">💎</div>
                                        <div className="provider-info">
                                            <h4>GetGem API</h4>
                                            <p>使用 GetGem.cc 第三方验证 API</p>
                                        </div>
                                        <div className="provider-status">
                                            <span className="badge badge-success">推荐</span>
                                        </div>
                                    </div>

                                    <div
                                        className={`provider-card ${aiProvider === 'batch_api' ? 'active' : ''}`}
                                        onClick={() => setAiProvider('batch_api')}
                                    >
                                        <div className="provider-icon">🔗</div>
                                        <div className="provider-info">
                                            <h4>batch.1key.me API</h4>
                                            <p>使用第三方批量验证 API</p>
                                        </div>
                                        <div className="provider-status">
                                            <span className="badge badge-warning">需配置</span>
                                        </div>
                                    </div>

                                    <div
                                        className={`provider-card ${aiProvider === 'telegram' ? 'active' : ''}`}
                                        onClick={() => setAiProvider('telegram')}
                                    >
                                        <div className="provider-icon">📨</div>
                                        <div className="provider-info">
                                            <h4>Userbot</h4>
                                            <p>调用外部 SheerID Bot 自动验证</p>
                                        </div>
                                        <div className="provider-status">
                                            <span className="badge badge-warning">需配置</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* ── 模板类 ── */}
                            <div style={{ marginBottom: '12px' }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    marginBottom: '10px', paddingBottom: '8px',
                                    borderBottom: '2px solid rgba(76,175,80,0.15)'
                                }}>
                                    <span style={{
                                        fontSize: '11px', fontWeight: 700,
                                        background: 'linear-gradient(135deg, #4caf50, #388e3c)',
                                        color: 'white', padding: '3px 10px', borderRadius: '10px',
                                        letterSpacing: '0.5px'
                                    }}>📄 模板类</span>
                                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>本地生成</span>
                                </div>
                                <div className="provider-cards">

                                    <div
                                        className={`provider-card ${aiProvider === 'gemini' ? 'active' : ''}`}
                                        onClick={() => setAiProvider('gemini')}
                                    >
                                        <div className="provider-icon">✨</div>
                                        <div className="provider-info">
                                            <h4>Gemini API</h4>
                                            <p>直接调用 Google Gemini API</p>
                                        </div>
                                        <div className="provider-status">
                                            <span className="badge badge-warning">需配置</span>
                                        </div>
                                    </div>

                                    <div
                                        className={`provider-card ${aiProvider === 'puppeteer' ? 'active' : ''}`}
                                        onClick={() => setAiProvider('puppeteer')}
                                    >
                                        <div className="provider-icon">🎨</div>
                                        <div className="provider-info">
                                            <h4>Puppeteer HTML 模板</h4>
                                            <p>使用 Puppeteer 渲染 HTML 模板生成高质量证件</p>
                                        </div>
                                        <div className="provider-status">
                                            <span className="badge badge-success">推荐</span>
                                        </div>
                                    </div>

                                    <div
                                        className={`provider-card ${aiProvider === 'lionpath' ? 'active' : ''}`}
                                        onClick={() => setAiProvider('lionpath')}
                                    >
                                        <div className="provider-icon">🦁</div>
                                        <div className="provider-info">
                                            <h4>LionPATH 课程表</h4>
                                            <p>Penn State 学生门户截图，备选验证方式</p>
                                        </div>
                                        <div className="provider-status">
                                            <span className="badge badge-info">备选</span>
                                        </div>
                                    </div>

                                    <div
                                        className={`provider-card ${aiProvider === 'sheerid' ? 'active' : ''}`}
                                        onClick={() => setAiProvider('sheerid')}
                                    >
                                        <div className="provider-icon">📚</div>
                                        <div className="provider-info">
                                            <h4>SheerID Generator</h4>
                                            <p>通用文档生成：课程表/成绩单/学生证</p>
                                        </div>
                                        <div className="provider-status">
                                            <span className="badge badge-warning">通用</span>
                                        </div>
                                    </div>

                                    <div
                                        className={`provider-card ${aiProvider === 'vsid' ? 'active' : ''}`}
                                        onClick={() => setAiProvider('vsid')}
                                    >
                                        <div className="provider-icon">🎓</div>
                                        <div className="provider-info">
                                            <h4>VSID Generator</h4>
                                            <p>国际学生证生成：支持5种文档类型</p>
                                        </div>
                                        <div className="provider-status">
                                            <span className="badge badge-success">新</span>
                                        </div>
                                    </div>

                                    <div
                                        className={`provider-card ${aiProvider === 'uiuc' ? 'active' : ''}`}
                                        onClick={() => setAiProvider('uiuc')}
                                    >
                                        <div className="provider-icon">🏛️</div>
                                        <div className="provider-info">
                                            <h4>UIUC i-card</h4>
                                            <p>伊利诺伊大学厄巴纳-香槟分校学生证</p>
                                        </div>
                                        <div className="provider-status">
                                            <span className="badge badge-info">专属</span>
                                        </div>
                                    </div>

                                    <div
                                        className={`provider-card ${aiProvider === 'onepasshtml' ? 'active' : ''}`}
                                        onClick={() => setAiProvider('onepasshtml')}
                                    >
                                        <div className="provider-icon">📝</div>
                                        <div className="provider-info">
                                            <h4>OnepassHTML 固定模板</h4>
                                            <p>固定学校 HTML 模板，仅修改学生信息</p>
                                        </div>
                                        <div className="provider-status">
                                            <span className="badge badge-success">新</span>
                                        </div>
                                    </div>

                                </div>
                            </div>

                            {/* GetGem.cc API Settings */}
                            {aiProvider === 'getgem' && (
                                <div className="provider-settings">
                                    <h4>💎 GetGem API 配置</h4>
                                    <div className="settings-form">
                                        <div className="getgem-info" style={{
                                            background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
                                            color: 'white',
                                            padding: '16px 20px',
                                            borderRadius: '8px',
                                            marginBottom: '16px'
                                        }}>
                                            <p style={{ margin: 0, fontSize: '14px' }}>
                                                <strong>GetGem.cc</strong> 是第三方学生身份验证 API 服务。
                                                提交 verificationId 后自动完成验证流程，支持批量处理和状态轮询。
                                            </p>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">API URL</label>
                                            <input
                                                type="text"
                                                className="input"
                                                value={getgemSettings.apiUrl}
                                                onChange={(e) => setGetgemSettings(s => ({ ...s, apiUrl: e.target.value }))}
                                                placeholder="https://getgem.cc"
                                            />
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">GetGem CDK</label>
                                            <textarea
                                                className="input textarea"
                                                value={getgemSettings.cdk}
                                                onChange={(e) => setGetgemSettings(s => ({ ...s, cdk: e.target.value, hasStoredCdk: false }))}
                                                placeholder={getgemSettings.hasStoredCdk ? "••••••••••\n••••••••••\n（已保存，留空保持不变）" : "请输入一个或多个 API CDK（每行一个，系统将自动轮询并处理额度耗尽的情况）"}
                                                rows={4}
                                                style={{ fontFamily: 'monospace' }}
                                            />
                                            {getgemSettings.hasStoredCdk && (
                                                <div style={{ marginTop: '8px', marginBottom: '8px' }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '8px', fontSize: '13px' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={appendGetgemCdk}
                                                            onChange={(e) => setAppendGetgemCdk(e.target.checked)}
                                                            style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: '#3b82f6' }}
                                                        />
                                                        <span>
                                                            ➕ <strong>追加到现有 CDK 之后</strong> <span style={{ color: '#888', fontSize: '12px' }}>(不勾选将完全覆盖旧 CDK)</span>
                                                        </span>
                                                    </label>
                                                </div>
                                            )}
                                            {getgemSettings.hasStoredCdk && (
                                                <p className="input-hint"><span className="key-stored">✓ CDK 已保存</span></p>
                                            )}
                                            <p className="input-hint">
                                                从 <a href="https://getgem.cc" target="_blank" rel="noreferrer">getgem.cc</a> 获取 CDK 激活码
                                            </p>
                                        </div>
                                        <div style={{ marginTop: '12px' }}>
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                disabled={getgemChecking}
                                                onClick={async () => {
                                                    setGetgemChecking(true);
                                                    setGetgemStatus(null);
                                                    try {
                                                        const res = await fetch(`${API_BASE}/api/getgem/status`);
                                                        const data = await res.json();
                                                        setGetgemStatus(data);
                                                    } catch (e) {
                                                        setGetgemStatus({ error: e.message });
                                                    }
                                                    setGetgemChecking(false);
                                                }}
                                            >
                                                {getgemChecking ? '⏳ 检查中...' : '🔍 检查 GetGem 状态'}
                                            </button>
                                            {getgemStatus && (
                                                <div style={{
                                                    marginTop: '12px',
                                                    padding: '12px 16px',
                                                    borderRadius: '8px',
                                                    background: getgemStatus.connected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                                    border: `1px solid ${getgemStatus.connected ? '#10B981' : '#EF4444'}`,
                                                    fontSize: '13px'
                                                }}>
                                                    <div>{getgemStatus.connected ? '✅ API 连接正常' : '❌ API 连接失败'}</div>
                                                    {getgemStatus.cdkBalance && (
                                                        <div style={{ marginTop: '6px' }}>
                                                            💎 CDK 余额: <strong>{getgemStatus.cdkBalance.remaining_uses}</strong> / {getgemStatus.cdkBalance.total_uses}
                                                        </div>
                                                    )}
                                                    {getgemStatus.health && (
                                                        <div style={{ marginTop: '6px' }}>
                                                            🏭 活跃任务: {getgemStatus.health.activeJobs || 0} · 可用槽位: {getgemStatus.health.availableSlots || 'N/A'}
                                                        </div>
                                                    )}
                                                    {getgemStatus.error && (
                                                        <div style={{ marginTop: '6px', color: '#EF4444' }}>错误: {getgemStatus.error}</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* batch.1key.me API Settings */}
                            {aiProvider === 'batch_api' && (
                                <div className="provider-settings">
                                    <h4>batch.1key.me API 配置</h4>
                                    <div className="settings-form">
                                        <div className="input-group">
                                            <label className="input-label">API URL</label>
                                            <input
                                                type="text"
                                                className="input"
                                                value={batchApiSettings.apiUrl}
                                                onChange={(e) => setBatchApiSettings(s => ({ ...s, apiUrl: e.target.value }))}
                                                placeholder="https://batch.1key.me/api/batch"
                                            />
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">API Key</label>
                                            <input
                                                type="password"
                                                className="input"
                                                value={batchApiSettings.apiKey}
                                                onChange={(e) => setBatchApiSettings(s => ({ ...s, apiKey: e.target.value, hasStoredKey: false }))}
                                                placeholder={batchApiSettings.hasStoredKey ? "••••••••••（已保存，留空保持不变）" : "输入 batch.1key.me API Key"}
                                            />
                                            {batchApiSettings.hasStoredKey && (
                                                <p className="input-hint"><span className="key-stored">✓ API Key 已保存</span></p>
                                            )}
                                            <p className="input-hint">
                                                从 <a href="https://batch.1key.me" target="_blank" rel="noreferrer">batch.1key.me</a> 获取 API Key
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Gemini API Settings */}
                            {aiProvider === 'gemini' && (
                                <div className="provider-settings">
                                    <h4>Gemini API 配置</h4>
                                    <div className="settings-form">
                                        <div className="input-group">
                                            <label className="input-label">API Key</label>
                                            <input
                                                type="password"
                                                className="input"
                                                value={geminiSettings.apiKey}
                                                onChange={(e) => setGeminiSettings(s => ({ ...s, apiKey: e.target.value, hasStoredKey: false }))}
                                                placeholder={geminiSettings.hasStoredKey ? "••••••••••（已保存，留空保持不变）" : "AIzaSy..."}
                                            />
                                            <p className="input-hint">
                                                {geminiSettings.hasStoredKey && <span className="key-stored">✓ API Key 已保存 · </span>}
                                                从 <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio</a> 获取
                                            </p>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">模型</label>
                                            <select
                                                className="input"
                                                value={geminiSettings.model}
                                                onChange={(e) => setGeminiSettings(s => ({ ...s, model: e.target.value }))}
                                            >
                                                <optgroup label="🖼️ 图像生成模型">
                                                    <option value="gemini-3-pro-image-preview">gemini-3-pro-image-preview (推荐)</option>
                                                    <option value="gemini-2.0-flash-exp-image-generation">gemini-2.0-flash-exp-image-generation</option>
                                                    <option value="imagen-4.0-generate-001">imagen-4.0-generate-001</option>
                                                </optgroup>
                                            </select>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">生成文档类型</label>
                                            <div className="checkbox-group">
                                                <label className="checkbox-label">
                                                    <input
                                                        type="checkbox"
                                                        checked={geminiSettings.documentTypes?.includes('id_card')}
                                                        onChange={(e) => {
                                                            const types = geminiSettings.documentTypes || [];
                                                            if (e.target.checked) {
                                                                setGeminiSettings(s => ({ ...s, documentTypes: [...types, 'id_card'] }));
                                                            } else {
                                                                setGeminiSettings(s => ({ ...s, documentTypes: types.filter(t => t !== 'id_card') }));
                                                            }
                                                        }}
                                                    />
                                                    <span>🪪 学生证</span>
                                                </label>
                                                <label className="checkbox-label">
                                                    <input
                                                        type="checkbox"
                                                        checked={geminiSettings.documentTypes?.includes('transcript')}
                                                        onChange={(e) => {
                                                            const types = geminiSettings.documentTypes || [];
                                                            if (e.target.checked) {
                                                                setGeminiSettings(s => ({ ...s, documentTypes: [...types, 'transcript'] }));
                                                            } else {
                                                                setGeminiSettings(s => ({ ...s, documentTypes: types.filter(t => t !== 'transcript') }));
                                                            }
                                                        }}
                                                    />
                                                    <span>📜 成绩单</span>
                                                </label>
                                                <label className="checkbox-label">
                                                    <input
                                                        type="checkbox"
                                                        checked={geminiSettings.documentTypes?.includes('schedule')}
                                                        onChange={(e) => {
                                                            const types = geminiSettings.documentTypes || [];
                                                            if (e.target.checked) {
                                                                setGeminiSettings(s => ({ ...s, documentTypes: [...types, 'schedule'] }));
                                                            } else {
                                                                setGeminiSettings(s => ({ ...s, documentTypes: types.filter(t => t !== 'schedule') }));
                                                            }
                                                        }}
                                                    />
                                                    <span>📅 课程表</span>
                                                </label>
                                            </div>
                                            <p className="input-hint">选择要自动生成的证明文件类型，至少选择一项</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Puppeteer HTML Template Settings */}
                            {aiProvider === 'puppeteer' && (
                                <div className="provider-settings">
                                    <h4>🎨 Puppeteer HTML 模板配置</h4>
                                    <div className="settings-form">
                                        <div className="input-group">
                                            <label className="input-label">选择 HTML 模板</label>
                                            <select
                                                className="input"
                                                value={puppeteerSettings.template}
                                                onChange={(e) => setPuppeteerSettings(s => ({ ...s, template: e.target.value }))}
                                            >
                                                {puppeteerSettings.availableTemplates.length > 0 ? (
                                                    puppeteerSettings.availableTemplates.map(tpl => (
                                                        <option key={tpl.filename} value={tpl.filename}>
                                                            {tpl.name} ({tpl.filename})
                                                        </option>
                                                    ))
                                                ) : (
                                                    <option value="student-id-generator.html">student-id-generator.html (默认)</option>
                                                )}
                                            </select>
                                            <p className="input-hint">
                                                模板文件位于 <code>VerifyKey/templates/</code> 目录
                                            </p>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">
                                                <input
                                                    type="checkbox"
                                                    checked={puppeteerSettings.useGeminiPhoto}
                                                    onChange={(e) => setPuppeteerSettings(s => ({ ...s, useGeminiPhoto: e.target.checked }))}
                                                    style={{ marginRight: '8px' }}
                                                />
                                                使用 Gemini AI 生成学生证件照
                                            </label>
                                            <p className="input-hint">
                                                启用后将使用 Gemini AI 自动生成逼真的学生头像（使用上方 Gemini 配置中的 API Key）
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* LionPATH Settings */}
                            {aiProvider === 'lionpath' && (
                                <div className="provider-settings">
                                    <h4>🦁 LionPATH 配置</h4>
                                    <div className="settings-form">
                                        <div className="lionpath-info" style={{
                                            background: 'linear-gradient(135deg, #1E407C 0%, #96BEE6 100%)',
                                            color: 'white',
                                            padding: '16px 20px',
                                            borderRadius: '8px',
                                            marginBottom: '16px'
                                        }}>
                                            <p style={{ margin: 0, fontSize: '14px' }}>
                                                <strong>Penn State LionPATH</strong> 是宾州州立大学的学生门户系统。
                                                此模式生成模拟的课程表截图，作为验证的备选文档类型。
                                            </p>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">选择 HTML 模板 (支持多选)</label>
                                            <div className="template-cards" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {(lionpathSettings.availableTemplates.length > 0 ? lionpathSettings.availableTemplates : [
                                                    { filename: "schedule.html", label: "经典风格 (Student Center)" },
                                                    { filename: "schedule_modern.html", label: "现代风格 (卡片式)" },
                                                    { filename: "schedule_calendar.html", label: "日历视图 (周课表)" },
                                                    { filename: "enrollment_verification.html", label: "注册验证" },
                                                    { filename: "schedule_browser.html", label: "浏览器截图 (SheerID推荐)" },
                                                    { filename: "psu_id_card.html", label: "PSU学生证 (ID Card)" }
                                                ]).map(tpl => {
                                                    const currentTemplates = lionpathSettings.templates || (lionpathSettings.template ? [lionpathSettings.template] : []);
                                                    const isSelected = currentTemplates.includes(tpl.filename);

                                                    return (
                                                        <label key={tpl.filename} className={`template-card ${isSelected ? 'selected' : ''}`} style={{
                                                            display: 'flex', alignItems: 'center', padding: '10px 14px',
                                                            borderRadius: '6px', cursor: 'pointer',
                                                            background: isSelected ? 'rgba(30, 64, 124, 0.1)' : '#f8f9fa',
                                                            border: isSelected ? '1px solid #1E407C' : '1px solid #eee',
                                                            transition: 'all 0.2s'
                                                        }}>
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={(e) => {
                                                                    const checked = e.target.checked;
                                                                    const current = lionpathSettings.templates || (lionpathSettings.template ? [lionpathSettings.template] : []);
                                                                    let next;
                                                                    if (checked) {
                                                                        next = [...current, tpl.filename];
                                                                    } else {
                                                                        next = current.filter(t => t !== tpl.filename);
                                                                    }
                                                                    setLionpathSettings(s => ({
                                                                        ...s,
                                                                        templates: next,
                                                                        template: next[0] || '' // Fallback for legacy
                                                                    }));
                                                                }}
                                                                style={{ marginRight: '10px' }}
                                                            />
                                                            <div>
                                                                <div style={{ fontWeight: 500, fontSize: '14px', color: '#333' }}>{tpl.label || tpl.filename}</div>
                                                                <div style={{ fontSize: '12px', color: '#666' }}>{tpl.filename}</div>
                                                            </div>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                            <p className="input-hint" style={{ marginTop: '5px' }}>
                                                💡 推荐同时选择 "Browser Screenshot" (课程表) 和 "PSU ID Card" (学生证) 以提高通过率。
                                            </p>
                                        </div>
                                        <p className="input-hint" style={{ marginTop: '12px' }}>
                                            此模式将自动生成：
                                            <br />• 🎓 随机 PSU 学号 (9位)
                                            <br />• 📧 PSU 格式邮箱
                                            <br />• 📚 随机课程表 (4-5门课程)
                                            <br />• 📅 当前学期信息
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* SheerID Generator Settings */}
                            {aiProvider === 'sheerid' && (
                                <div className="provider-settings">
                                    <h4>📚 SheerID Generator 配置</h4>
                                    <div className="settings-form">
                                        <div className="sheerid-info" style={{
                                            background: 'linear-gradient(135deg, #4299E1 0%, #805AD5 100%)',
                                            color: 'white',
                                            padding: '16px 20px',
                                            borderRadius: '8px',
                                            marginBottom: '16px'
                                        }}>
                                            <p style={{ margin: 0, fontSize: '14px' }}>
                                                <strong>SheerID Generator</strong> 使用 Pillow 生成通用学术文档，
                                                支持任意大学，适用于不需要特定大学样式的验证场景。
                                            </p>
                                        </div>

                                        <div className="input-group">
                                            <label className="input-label">文档类型（可多选）</label>
                                            <div className="document-type-checkboxes" style={{
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '10px',
                                                marginTop: '8px'
                                            }}>
                                                {[
                                                    { value: 'class_schedule', label: '📅 课程表 (Class Schedule)' },
                                                    { value: 'transcript', label: '📝 成绩单 (Transcript)' },
                                                    { value: 'id_card', label: '🪪 学生证 (ID Card)' }
                                                ].map(docType => (
                                                    <label key={docType.value} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        cursor: 'pointer',
                                                        padding: '8px 12px',
                                                        background: (sheeridSettings?.docTypes || ['class_schedule']).includes(docType.value)
                                                            ? 'linear-gradient(135deg, rgba(102, 126, 234, 0.15) 0%, rgba(118, 75, 162, 0.15) 100%)'
                                                            : 'rgba(0,0,0,0.03)',
                                                        borderRadius: '8px',
                                                        border: (sheeridSettings?.docTypes || ['class_schedule']).includes(docType.value)
                                                            ? '1px solid #667eea'
                                                            : '1px solid transparent',
                                                        transition: 'all 0.2s ease'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={(sheeridSettings?.docTypes || ['class_schedule']).includes(docType.value)}
                                                            onChange={(e) => {
                                                                const currentTypes = sheeridSettings?.docTypes || ['class_schedule'];
                                                                let newTypes;
                                                                if (e.target.checked) {
                                                                    newTypes = [...currentTypes, docType.value];
                                                                } else {
                                                                    newTypes = currentTypes.filter(t => t !== docType.value);
                                                                    if (newTypes.length === 0) newTypes = ['class_schedule']; // At least one
                                                                }
                                                                setSheeridSettings(s => ({ ...s, docTypes: newTypes }));
                                                            }}
                                                            style={{ width: '16px', height: '16px' }}
                                                        />
                                                        <span style={{ fontSize: '14px' }}>{docType.label}</span>
                                                    </label>
                                                ))}
                                            </div>
                                            <p className="input-hint">
                                                选择一个或多个文档类型，系统将随机选择其中一种生成
                                            </p>
                                        </div>

                                        <p className="input-hint" style={{ marginTop: '16px' }}>
                                            ✨ 此模式将自动生成：
                                            <br />• 📛 随机学生姓名 (Faker 美国)
                                            <br />• 🆔 8位随机学号
                                            <br />• 🎂 大学生年龄的随机生日 (2000-2006)
                                            <br />• 📚 随机课程/成绩数据
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* VSID Generator Settings */}
                            {aiProvider === 'vsid' && (
                                <div className="provider-settings">
                                    <h4>🎓 VSID Generator 配置</h4>
                                    <div className="settings-form">
                                        <div className="vsid-info" style={{
                                            background: 'linear-gradient(135deg, #10B981 0%, #3B82F6 100%)',
                                            color: 'white',
                                            padding: '16px 20px',
                                            borderRadius: '8px',
                                            marginBottom: '16px'
                                        }}>
                                            <p style={{ margin: 0, fontSize: '14px' }}>
                                                <strong>VSID Generator</strong> 使用 Headless Browser 自动化生成多种学术文档，
                                                支持学生证、在读证明、课程表、录取通知书和成绩单。
                                            </p>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">选择文档类型 (可多选)</label>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                                                {(vsidSettings.availableDocTypes.length > 0 ? vsidSettings.availableDocTypes : [
                                                    { value: 'student_id', label: '🪪 学生证 (Student ID)' },
                                                    { value: 'enrollment', label: '📜 在读证明 (Enrollment Certificate)' },
                                                    { value: 'schedule', label: '📅 课程表 (Course Schedule)' },
                                                    { value: 'admission', label: '📬 录取通知书 (Admission Letter)' },
                                                    { value: 'transcript', label: '📊 成绩单 (Transcript)' }
                                                ]).map(docType => (
                                                    <label key={docType.value} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '10px 14px',
                                                        borderRadius: '6px',
                                                        cursor: 'pointer',
                                                        background: (vsidSettings?.docTypes || ['student_id', 'schedule']).includes(docType.value)
                                                            ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-secondary)',
                                                        border: (vsidSettings?.docTypes || ['student_id', 'schedule']).includes(docType.value)
                                                            ? '1px solid #10B981'
                                                            : '1px solid transparent',
                                                        transition: 'all 0.2s ease'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={(vsidSettings?.docTypes || ['student_id', 'schedule']).includes(docType.value)}
                                                            onChange={(e) => {
                                                                const currentTypes = vsidSettings?.docTypes || ['student_id', 'schedule'];
                                                                let newTypes;
                                                                if (e.target.checked) {
                                                                    newTypes = [...currentTypes, docType.value];
                                                                } else {
                                                                    newTypes = currentTypes.filter(t => t !== docType.value);
                                                                    if (newTypes.length === 0) newTypes = ['student_id']; // At least one
                                                                }
                                                                setVsidSettings(s => ({ ...s, docTypes: newTypes }));
                                                            }}
                                                            style={{ width: '16px', height: '16px' }}
                                                        />
                                                        <span style={{ fontSize: '14px' }}>{docType.label}</span>
                                                    </label>
                                                ))}
                                            </div>
                                            <p className="input-hint">
                                                💡 推荐同时选择 "学生证" 和 "课程表" 以提高验证通过率
                                            </p>
                                        </div>

                                        <p className="input-hint" style={{ marginTop: '16px' }}>
                                            ✨ 此模式将自动生成：
                                            <br />• 📛 基于姓名的学生信息
                                            <br />• 🆔 随机学号
                                            <br />• 🎓 随机专业和学位
                                            <br />• 📅 合理的入学和毕业日期
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* UIUC i-card Settings */}
                            {aiProvider === 'uiuc' && (
                                <div className="provider-settings">
                                    <h4>🏛️ UIUC i-card 配置</h4>
                                    <div className="settings-form">
                                        <div className="uiuc-info" style={{
                                            background: 'linear-gradient(135deg, #E84A27 0%, #13294B 100%)',
                                            color: 'white',
                                            padding: '16px 20px',
                                            borderRadius: '8px',
                                            marginBottom: '16px'
                                        }}>
                                            <p style={{ margin: 0, fontSize: '14px' }}>
                                                <strong>UIUC i-card Generator</strong> 专门用于生成伊利诺伊大学厄巴纳-香槟分校 (UIUC) 学生证。
                                                自动生成照片、姓名、UIU号、Library号、Card号及过期日期。
                                            </p>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">选择模板 (可多选)</label>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                                                {(uiucSettings.availableTemplates.length > 0 ? uiucSettings.availableTemplates : [
                                                    { filename: 'uiuc_id_card.html', label: 'UIUC i-card 学生证' }
                                                ]).map(template => (
                                                    <label key={template.filename} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '10px 14px',
                                                        borderRadius: '6px',
                                                        cursor: 'pointer',
                                                        background: (uiucSettings?.templates || ['uiuc_id_card.html']).includes(template.filename)
                                                            ? 'rgba(232, 74, 39, 0.1)' : 'var(--bg-secondary)',
                                                        border: (uiucSettings?.templates || ['uiuc_id_card.html']).includes(template.filename)
                                                            ? '1px solid #E84A27'
                                                            : '1px solid transparent',
                                                        transition: 'all 0.2s ease'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={(uiucSettings?.templates || ['uiuc_id_card.html']).includes(template.filename)}
                                                            onChange={(e) => {
                                                                const currentTemplates = uiucSettings?.templates || ['uiuc_id_card.html'];
                                                                let newTemplates;
                                                                if (e.target.checked) {
                                                                    newTemplates = [...currentTemplates, template.filename];
                                                                } else {
                                                                    newTemplates = currentTemplates.filter(t => t !== template.filename);
                                                                    if (newTemplates.length === 0) newTemplates = ['uiuc_id_card.html'];
                                                                }
                                                                setUiucSettings(s => ({ ...s, templates: newTemplates }));
                                                            }}
                                                            style={{ width: '16px', height: '16px' }}
                                                        />
                                                        <span style={{ fontSize: '14px' }}>🪪 {template.label}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>

                                        <div style={{
                                            marginTop: '16px',
                                            padding: '12px 16px',
                                            background: 'var(--bg-secondary)',
                                            borderRadius: '8px',
                                            fontSize: '13px'
                                        }}>
                                            <strong>📋 生成的字段:</strong>
                                            <ul style={{ margin: '8px 0 0', paddingLeft: '20px', lineHeight: '1.8' }}>
                                                <li><strong>UIU:</strong> 76 + 5位随机数字</li>
                                                <li><strong>Library:</strong> 2 + 13位随机数字</li>
                                                <li><strong>Card:</strong> 563665 + 10位随机数字</li>
                                                <li><strong>Card Expires:</strong> 2027年随机日期</li>
                                                <li><strong>Photo:</strong> Gemini AI 生成</li>
                                            </ul>
                                        </div>

                                        <p className="input-hint" style={{ marginTop: '16px' }}>
                                            ⚠️ 此模式自动使用 University of Illinois Urbana-Champaign 作为学校
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* OnepassHTML Fixed Template Settings */}
                            {aiProvider === 'onepasshtml' && (
                                <div className="provider-settings">
                                    <h4>📝 OnepassHTML 固定模板配置</h4>
                                    <div className="settings-form">
                                        <div className="onepasshtml-info" style={{
                                            background: 'linear-gradient(135deg, #F59E0B 0%, #EF4444 100%)',
                                            color: 'white',
                                            padding: '16px 20px',
                                            borderRadius: '8px',
                                            marginBottom: '16px'
                                        }}>
                                            <p style={{ margin: 0, fontSize: '14px' }}>
                                                <strong>OnepassHTML 固定模板</strong> 使用预设的 HTML 模板为特定学校生成文档，
                                                每个模板对应一所固定学校，仅动态填充学生个人信息。
                                            </p>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">选择模板 (可多选)</label>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                                                {(onepasshtmlSettings.availableTemplates.length > 0 ? onepasshtmlSettings.availableTemplates : [
                                                    { filename: 'rit-demand-letter.html', label: 'RIT Demand Letter (催缴通知)' }
                                                ]).map(template => (
                                                    <label key={template.filename} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '10px 14px',
                                                        borderRadius: '6px',
                                                        cursor: 'pointer',
                                                        background: (onepasshtmlSettings?.templates || []).includes(template.filename)
                                                            ? 'rgba(245, 158, 11, 0.1)' : 'var(--bg-secondary)',
                                                        border: (onepasshtmlSettings?.templates || []).includes(template.filename)
                                                            ? '1px solid #F59E0B'
                                                            : '1px solid transparent',
                                                        transition: 'all 0.2s ease'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={(onepasshtmlSettings?.templates || []).includes(template.filename)}
                                                            onChange={(e) => {
                                                                const currentTemplates = onepasshtmlSettings?.templates || [];
                                                                let newTemplates;
                                                                if (e.target.checked) {
                                                                    newTemplates = [...currentTemplates, template.filename];
                                                                } else {
                                                                    newTemplates = currentTemplates.filter(t => t !== template.filename);
                                                                }
                                                                setOnepasshtmlSettings(s => ({ ...s, templates: newTemplates }));
                                                            }}
                                                            style={{ width: '16px', height: '16px' }}
                                                        />
                                                        <span style={{ fontSize: '14px' }}>📄 {template.label}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>

                                        <div style={{
                                            marginTop: '16px',
                                            padding: '12px 16px',
                                            background: 'var(--bg-secondary)',
                                            borderRadius: '8px',
                                            fontSize: '13px'
                                        }}>
                                            <strong>📋 特点说明:</strong>
                                            <ul style={{ margin: '8px 0 0', paddingLeft: '20px', lineHeight: '1.8' }}>
                                                <li><strong>固定学校:</strong> 每个模板对应特定学校，无需选择大学</li>
                                                <li><strong>动态信息:</strong> 学生姓名、学号、费用等自动随机生成</li>
                                                <li><strong>高质量:</strong> Puppeteer 渲染 + 截图，还原真实文档效果</li>
                                            </ul>
                                        </div>

                                        <p className="input-hint" style={{ marginTop: '16px' }}>
                                            ⚠️ 此模式使用模板中预设的学校信息，不会随机选择大学
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Telegram Account Management — Premium Redesign */}
                            {aiProvider === 'telegram' && (
                                <div className="provider-settings" style={{ padding: 0, overflow: 'hidden', borderRadius: '14px', border: '1px solid var(--border)' }}>
                                    {/* Header */}
                                    <div style={{
                                        background: 'linear-gradient(135deg, #0088cc 0%, #004d73 100%)',
                                        padding: '20px 24px', color: 'white',
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                    }}>
                                        <div>
                                            <h4 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700, color: 'white' }}>
                                                📱 账号管理
                                            </h4>
                                            <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.85)' }}>
                                                多账号管理 · 所有 Bot 验证共用激活账号
                                            </p>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {!tgAccounts.some(a => a.active) && (
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            const res = await fetch(`${API_BASE}/api/telegram/reconnect`, { method: 'POST' });
                                                            const data = await res.json();
                                                            if (data.success) {
                                                                alert('✅ 重连成功');
                                                                fetchTgAccounts();
                                                            } else {
                                                                alert('❌ ' + (data.message || '重连失败'));
                                                            }
                                                        } catch (e) {
                                                            alert('❌ 重连请求失败');
                                                        }
                                                    }}
                                                    style={{
                                                        background: 'rgba(255,255,255,0.2)',
                                                        border: '1px solid rgba(255,255,255,0.3)',
                                                        color: 'white', fontSize: '11px', fontWeight: 600,
                                                        padding: '4px 12px', borderRadius: '14px',
                                                        cursor: 'pointer', transition: 'all 0.2s',
                                                        backdropFilter: 'blur(8px)'
                                                    }}
                                                >🔄 重连</button>
                                            )}
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: '6px',
                                                background: 'rgba(255,255,255,0.15)',
                                                padding: '6px 14px', borderRadius: '20px',
                                                fontSize: '12px', fontWeight: 600, backdropFilter: 'blur(8px)', color: 'white'
                                            }}>
                                                <div style={{
                                                    width: '8px', height: '8px', borderRadius: '50%',
                                                    background: tgAccounts.some(a => a.active) ? '#69f0ae' : '#ff5252',
                                                    boxShadow: tgAccounts.some(a => a.active) ? '0 0 8px #69f0ae' : 'none'
                                                }} />
                                                {tgAccounts.some(a => a.active) ? '已连接' : '未激活'}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ padding: '20px 24px' }}>


                                        {/* Account List */}
                                        {tgAccounts.length === 0 ? (
                                            <div style={{
                                                padding: '40px 24px', textAlign: 'center',
                                                background: 'var(--bg-secondary)', borderRadius: '12px',
                                                marginBottom: '16px'
                                            }}>
                                                <div style={{ fontSize: '40px', marginBottom: '12px', filter: 'grayscale(0.3)' }}>📱</div>
                                                <p style={{ fontWeight: 600, marginBottom: '4px' }}>暂无账号</p>
                                                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>点击下方「添加账号」开始配置</p>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                                                {tgAccounts.map(acc => (
                                                    <div key={acc.id} style={{
                                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                        padding: '12px 16px',
                                                        background: 'var(--bg-secondary)',
                                                        borderRadius: '10px',
                                                        border: '1.5px solid transparent',
                                                        transition: 'all 0.25s ease'
                                                    }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                                                            <div style={{
                                                                width: '36px', height: '36px', borderRadius: '10px',
                                                                background: acc.hasSession ? 'linear-gradient(135deg, #0088cc, #00bcd4)' : 'linear-gradient(135deg, #9e9e9e, #757575)',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                fontSize: '16px', color: 'white', fontWeight: 700, flexShrink: 0
                                                            }}>
                                                                {(acc.label || '?')[0].toUpperCase()}
                                                            </div>
                                                            <div style={{ minWidth: 0 }}>
                                                                <div style={{ fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                        {acc.label || '未命名'}
                                                                    </span>
                                                                </div>
                                                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                    <span>{acc.phone || (acc.hasSession ? '已登录' : '未登录')}</span>
                                                                    {acc.hasSession && (
                                                                        <span style={{
                                                                            fontSize: '10px',
                                                                            padding: '1px 6px',
                                                                            borderRadius: '4px',
                                                                            background: acc.enabled ? 'rgba(76, 175, 80, 0.1)' : 'rgba(158, 158, 158, 0.1)',
                                                                            color: acc.enabled ? '#4caf50' : '#9e9e9e',
                                                                            border: acc.enabled ? '1px solid rgba(76, 175, 80, 0.2)' : '1px solid rgba(158, 158, 158, 0.2)'
                                                                        }}>
                                                                            {acc.enabled ? '已启用并行' : '已下架'}
                                                                        </span>
                                                                    )}
                                                                    {/* Connection check result badge */}
                                                                    {tgCheckResults && tgCheckResults[acc.id] && (
                                                                        <span style={{
                                                                            fontSize: '10px',
                                                                            padding: '1px 6px',
                                                                            borderRadius: '4px',
                                                                            background: tgCheckResults[acc.id].online ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)',
                                                                            color: tgCheckResults[acc.id].online ? '#4caf50' : '#f44336',
                                                                            border: tgCheckResults[acc.id].online ? '1px solid rgba(76, 175, 80, 0.2)' : '1px solid rgba(244, 67, 54, 0.2)',
                                                                            fontWeight: 600
                                                                        }}>
                                                                            {tgCheckResults[acc.id].online
                                                                                ? (tgCheckResults[acc.id].reconnected ? '🔄 已重连' : '✓ 在线')
                                                                                : `✕ 掉线${tgCheckResults[acc.id].error ? ': ' + tgCheckResults[acc.id].error : ''}`
                                                                            }
                                                                        </span>
                                                                    )}
                                                                    {acc.quota !== undefined && acc.quota !== null && (
                                                                        <span style={{
                                                                            fontSize: '10px',
                                                                            padding: '1px 6px',
                                                                            borderRadius: '4px',
                                                                            background: acc.quota > 5 ? 'rgba(33, 150, 243, 0.1)' : 'rgba(255, 152, 0, 0.1)',
                                                                            color: acc.quota > 5 ? '#2196f3' : '#ff9800',
                                                                            border: acc.quota > 5 ? '1px solid rgba(33, 150, 243, 0.2)' : '1px solid rgba(255, 152, 0, 0.2)'
                                                                        }}>
                                                                            额度: {acc.quota}
                                                                        </span>
                                                                    )}
                                                                    {acc.cooldownUntil && (
                                                                        <span style={{
                                                                            fontSize: '10px',
                                                                            padding: '1px 6px',
                                                                            borderRadius: '4px',
                                                                            background: 'rgba(244, 67, 54, 0.1)',
                                                                            color: '#f44336',
                                                                            border: '1px solid rgba(244, 67, 54, 0.2)',
                                                                            animation: 'pulse 2s infinite'
                                                                        }}>
                                                                            ⏳ 冷却中
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                                                            {/* Pool Toggle Switch */}
                                                            {acc.hasSession && (
                                                                <div
                                                                    onClick={() => handleTgToggle(acc.id, acc.enabled)}
                                                                    title={acc.enabled ? "点击下架此账号" : "点击加入并发池"}
                                                                    style={{
                                                                        width: '40px',
                                                                        height: '20px',
                                                                        borderRadius: '20px',
                                                                        background: acc.enabled ? 'var(--color-success)' : 'var(--bg-card)',
                                                                        border: acc.enabled ? 'none' : '1px solid var(--border-color)',
                                                                        position: 'relative',
                                                                        cursor: 'pointer',
                                                                        transition: 'all 0.3s ease',
                                                                        padding: '2px'
                                                                    }}
                                                                >
                                                                    <div style={{
                                                                        width: '16px',
                                                                        height: '16px',
                                                                        borderRadius: '50%',
                                                                        background: 'white',
                                                                        position: 'absolute',
                                                                        left: acc.enabled ? '22px' : '2px',
                                                                        transition: 'all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
                                                                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                                                    }} />
                                                                </div>
                                                            )}

                                                            {/* Bot Assignment Badges */}
                                                            {acc.hasSession && (
                                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                                    {[
                                                                        { key: 'dualbot', label: '新Bot' },
                                                                        ...(config?.verification?.singleBots || []).map(b => ({ key: b.id, label: b.id === 'blackbot' ? 'BlackBot' : b.id === 'oldbot' ? '老Bot' : b.username }))
                                                                    ].map(bot => {
                                                                        const assigned = (acc.assignedBots || ['dualbot']);
                                                                        const isOn = assigned.includes(bot.key);
                                                                        return (
                                                                            <span
                                                                                key={bot.key}
                                                                                onClick={() => handleTgBotAssign(acc.id, bot.key, assigned)}
                                                                                style={{
                                                                                    padding: '2px 8px',
                                                                                    fontSize: '11px',
                                                                                    fontWeight: 600,
                                                                                    borderRadius: '10px',
                                                                                    cursor: 'pointer',
                                                                                    transition: 'all 0.2s',
                                                                                    background: isOn ? 'rgba(76, 175, 80, 0.15)' : 'rgba(150, 150, 150, 0.1)',
                                                                                    color: isOn ? '#4caf50' : '#999',
                                                                                    border: `1px solid ${isOn ? 'rgba(76, 175, 80, 0.3)' : 'rgba(150, 150, 150, 0.2)'}`,
                                                                                    userSelect: 'none'
                                                                                }}
                                                                                title={isOn ? `点击取消 ${bot.label} 使用此账号` : `点击允许 ${bot.label} 使用此账号`}
                                                                            >
                                                                                {isOn ? '✓ ' : ''}{bot.label}
                                                                            </span>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}

                                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                                {!acc.hasSession && (
                                                                    <button onClick={() => {
                                                                        setTgLoginAccountId(acc.id);
                                                                        setTgLoginStep('phone');
                                                                        setTgLoginPhone(''); setTgLoginCode(''); setTgLoginMsg(''); setTgLoginPassword('');
                                                                    }}
                                                                        disabled={tgLoading}
                                                                        style={{
                                                                            padding: '6px 16px', fontSize: '12px', fontWeight: 600,
                                                                            background: 'linear-gradient(135deg, #0088cc, #005fa3)',
                                                                            color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer',
                                                                            transition: 'all 0.2s'
                                                                        }}
                                                                    >登录</button>
                                                                )}
                                                                <button onClick={() => handleTgRemove(acc.id)}
                                                                    style={{
                                                                        padding: '6px 8px', fontSize: '12px',
                                                                        background: 'transparent', color: 'var(--text-secondary)',
                                                                        border: '1px solid var(--border)', borderRadius: '8px',
                                                                        cursor: 'pointer', transition: 'all 0.2s'
                                                                    }}
                                                                >✕</button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Login Flow */}
                                        {tgLoginAccountId && (
                                            <div style={{
                                                padding: '20px', borderRadius: '12px', marginBottom: '16px',
                                                background: 'linear-gradient(135deg, rgba(0,136,204,0.06), rgba(0,136,204,0.02))',
                                                border: '1.5px solid rgba(0,136,204,0.2)'
                                            }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <span style={{ fontSize: '20px' }}>🔐</span>
                                                        <div>
                                                            <div style={{ fontWeight: 700, fontSize: '14px' }}>登录账号</div>
                                                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                                {tgLoginStep === 'phone' ? '步骤 1/2 · 输入手机号' :
                                                                    tgLoginStep === 'code' ? '步骤 2/2 · 输入验证码' :
                                                                        tgLoginStep === 'password' ? '额外步骤 · 两步验证' : '完成'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <button onClick={() => { setTgLoginAccountId(null); setTgLoginStep('idle'); }}
                                                        style={{ background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px 8px' }}>✕</button>
                                                </div>

                                                {/* Step progress bar */}
                                                <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
                                                    {['phone', 'code'].map((s, i) => (
                                                        <div key={s} style={{
                                                            flex: 1, height: '3px', borderRadius: '2px',
                                                            background: ['phone', 'code', 'password', 'done'].indexOf(tgLoginStep) >= i
                                                                ? '#0088cc' : 'var(--border)',
                                                            transition: 'background 0.3s'
                                                        }} />
                                                    ))}
                                                </div>

                                                {tgLoginStep === 'phone' && (
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <input type="text" className="input" value={tgLoginPhone}
                                                            onChange={e => setTgLoginPhone(e.target.value)}
                                                            placeholder="+86 138xxxx5678"
                                                            style={{ flex: 1 }}
                                                        />
                                                        <button onClick={() => handleTgLoginRequest(tgLoginAccountId)}
                                                            disabled={tgLoading || !tgLoginPhone}
                                                            style={{
                                                                padding: '8px 20px', background: '#0088cc', color: 'white',
                                                                border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px',
                                                                opacity: (tgLoading || !tgLoginPhone) ? 0.5 : 1, whiteSpace: 'nowrap'
                                                            }}>{tgLoading ? '⏳' : '发送验证码'}</button>
                                                    </div>
                                                )}

                                                {tgLoginStep === 'code' && (
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <input type="text" className="input" value={tgLoginCode}
                                                            onChange={e => setTgLoginCode(e.target.value)}
                                                            placeholder="12345"
                                                            style={{ flex: 1, letterSpacing: '6px', textAlign: 'center', fontSize: '20px', fontWeight: 700 }}
                                                            autoFocus maxLength={6}
                                                        />
                                                        <button onClick={() => handleTgVerifyCode(tgLoginAccountId)}
                                                            disabled={tgLoading || !tgLoginCode}
                                                            style={{
                                                                padding: '8px 20px', background: '#00c853', color: 'white',
                                                                border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px',
                                                                opacity: (tgLoading || !tgLoginCode) ? 0.5 : 1, whiteSpace: 'nowrap'
                                                            }}>{tgLoading ? '⏳' : '确认'}</button>
                                                    </div>
                                                )}

                                                {tgLoginStep === 'password' && (
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <input type="password" className="input" value={tgLoginPassword}
                                                            onChange={e => setTgLoginPassword(e.target.value)}
                                                            placeholder="两步验证密码"
                                                            style={{ flex: 1 }} autoFocus
                                                        />
                                                        <button onClick={() => handleTgVerifyCode(tgLoginAccountId)}
                                                            disabled={tgLoading || !tgLoginPassword}
                                                            style={{
                                                                padding: '8px 20px', background: '#00c853', color: 'white',
                                                                border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px',
                                                                opacity: (tgLoading || !tgLoginPassword) ? 0.5 : 1, whiteSpace: 'nowrap'
                                                            }}>{tgLoading ? '⏳' : '确认'}</button>
                                                    </div>
                                                )}

                                                {tgLoginMsg && (
                                                    <div style={{
                                                        marginTop: '10px', padding: '8px 12px', borderRadius: '8px',
                                                        background: tgLoginMsg.includes('✅') ? 'rgba(0,200,83,0.1)' : 'rgba(0,136,204,0.08)',
                                                        fontSize: '13px',
                                                        color: tgLoginMsg.includes('✅') ? '#00c853' : 'var(--text-primary)'
                                                    }}>{tgLoginMsg}</div>
                                                )}
                                            </div>
                                        )}

                                        {/* Add Account Button / Form */}
                                        {tgShowAdd ? (
                                            <div style={{
                                                padding: '20px', borderRadius: '12px', marginBottom: '20px',
                                                background: 'var(--bg-secondary)', border: '1.5px dashed var(--border)'
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                                                    <span style={{ fontSize: '16px' }}>➕</span>
                                                    <span style={{ fontWeight: 700, fontSize: '14px' }}>添加账号</span>
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                                    <div style={{ gridColumn: '1 / -1' }}>
                                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>标签名称</label>
                                                        <input type="text" className="input" value={tgNewLabel}
                                                            onChange={e => setTgNewLabel(e.target.value)}
                                                            placeholder="例: 主号 / 备用号"
                                                            style={{ width: '100%', boxSizing: 'border-box' }} />
                                                    </div>
                                                    <div>
                                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>API ID</label>
                                                        <input type="text" className="input" value={tgNewApiId}
                                                            onChange={e => setTgNewApiId(e.target.value)}
                                                            placeholder="12345678"
                                                            style={{ width: '100%', boxSizing: 'border-box' }} />
                                                    </div>
                                                    <div>
                                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>API Hash</label>
                                                        <input type="password" className="input" value={tgNewApiHash}
                                                            onChange={e => setTgNewApiHash(e.target.value)}
                                                            placeholder="abcdef123456..."
                                                            style={{ width: '100%', boxSizing: 'border-box' }} />
                                                    </div>
                                                </div>
                                                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '10px 0 14px' }}>
                                                    从 <a href="https://my.telegram.org" target="_blank" rel="noreferrer" style={{ color: '#0088cc' }}>my.telegram.org</a> 获取 API ID 和 API Hash
                                                </p>
                                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                    <button onClick={() => setTgShowAdd(false)}
                                                        style={{
                                                            padding: '8px 18px', fontSize: '13px',
                                                            background: 'transparent', border: '1px solid var(--border)',
                                                            borderRadius: '8px', cursor: 'pointer'
                                                        }}>取消</button>
                                                    <button onClick={handleTgAdd}
                                                        disabled={tgLoading || !tgNewApiId || !tgNewApiHash}
                                                        style={{
                                                            padding: '8px 20px', fontSize: '13px', fontWeight: 600,
                                                            background: '#0088cc', color: 'white',
                                                            border: 'none', borderRadius: '8px', cursor: 'pointer',
                                                            opacity: (tgLoading || !tgNewApiId || !tgNewApiHash) ? 0.5 : 1
                                                        }}>{tgLoading ? '添加中...' : '添加'}</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                                                <button onClick={() => setTgShowAdd(true)}
                                                    style={{
                                                        flex: 1, padding: '12px',
                                                        background: 'transparent', border: '2px dashed var(--border)',
                                                        borderRadius: '10px', cursor: 'pointer',
                                                        fontSize: '13px', fontWeight: 600,
                                                        color: 'var(--text-secondary)', transition: 'all 0.2s'
                                                    }}>
                                                    + 添加账号
                                                </button>
                                                <button onClick={handleTgCheckConnections}
                                                    disabled={tgChecking}
                                                    style={{
                                                        padding: '12px 20px',
                                                        background: tgChecking ? 'var(--bg-secondary)' : 'linear-gradient(135deg, #0088cc, #00bcd4)',
                                                        color: tgChecking ? 'var(--text-secondary)' : 'white',
                                                        border: 'none', borderRadius: '10px', cursor: tgChecking ? 'default' : 'pointer',
                                                        fontSize: '13px', fontWeight: 600,
                                                        transition: 'all 0.2s', whiteSpace: 'nowrap',
                                                        boxShadow: tgChecking ? 'none' : '0 2px 8px rgba(0,136,204,0.3)'
                                                    }}>
                                                    {tgChecking ? '🔄 检测中...' : '📡 检测连接'}
                                                </button>
                                            </div>
                                        )}

                                        {/* ── Bot Priority Dashboard ── */}
                                        {(() => {
                                            const bots = botStats.bots || [];
                                            return (
                                                <div style={{
                                                    borderRadius: '12px', overflow: 'hidden',
                                                    border: '1px solid var(--border)', marginBottom: '12px'
                                                }}>
                                                    <div style={{
                                                        padding: '14px 18px',
                                                        background: 'linear-gradient(135deg, rgba(255,152,0,0.08), rgba(255,152,0,0.02))',
                                                        borderBottom: '1px solid var(--border)',
                                                        display: 'flex', alignItems: 'center', gap: '8px'
                                                    }}>
                                                        <span style={{ fontSize: '16px' }}>📊</span>
                                                        <span style={{ fontWeight: 700, fontSize: '14px' }}>Bot 优先级 & 实时统计</span>
                                                        <span style={{
                                                            fontSize: '10px', padding: '2px 8px',
                                                            background: 'rgba(255,152,0,0.15)', color: '#ff9800',
                                                            borderRadius: '10px', fontWeight: 700, marginLeft: 'auto'
                                                        }}>瀑布模式</span>
                                                    </div>
                                                    <div style={{ padding: '16px 18px' }}>
                                                        {/* Time window slider */}
                                                        <div style={{ marginBottom: '16px' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                                                <label style={{ fontSize: '13px', fontWeight: 600 }}>统计时间窗口</label>
                                                                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--primary)' }}>
                                                                    {botStats.windowMinutes} 分钟
                                                                </span>
                                                            </div>
                                                            <input
                                                                type="range" min="5" max="120" step="5"
                                                                value={botStats.windowMinutes}
                                                                onChange={async (e) => {
                                                                    const val = parseInt(e.target.value);
                                                                    setBotStats(prev => ({ ...prev, windowMinutes: val }));
                                                                    try {
                                                                        await fetch(`${API}/api/bot-stats/window`, {
                                                                            method: 'POST',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({ windowMinutes: val })
                                                                        });
                                                                        fetchBotStats();
                                                                    } catch (e) { /* ignore */ }
                                                                }}
                                                                style={{ width: '100%', cursor: 'pointer' }}
                                                            />
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                                <span>5分钟</span>
                                                                <span>30分钟</span>
                                                                <span>60分钟</span>
                                                                <span>120分钟</span>
                                                            </div>
                                                        </div>

                                                        {/* Bot priority table */}
                                                        {bots.length === 0 ? (
                                                            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                                                                暂无数据。请确保后端已重启并启用了至少一个 Bot，验证后将自动显示统计。
                                                            </div>
                                                        ) : (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                                {bots.map((bot, i) => {
                                                                    const ratePercent = Math.round(bot.rate * 100);
                                                                    const barColor = ratePercent >= 70 ? '#4caf50' : ratePercent >= 40 ? '#ff9800' : '#f44336';
                                                                    return (
                                                                        <div key={bot.id} style={{
                                                                            padding: '12px 14px', borderRadius: '10px',
                                                                            border: '1px solid var(--border)',
                                                                            background: i === 0 ? 'rgba(76,175,80,0.04)' : 'var(--bg-secondary)',
                                                                            display: 'flex', alignItems: 'center', gap: '12px'
                                                                        }}>
                                                                            {/* Rank badge */}
                                                                            <div style={{
                                                                                width: '28px', height: '28px', borderRadius: '50%',
                                                                                background: i === 0 ? '#4caf50' : i === 1 ? '#ff9800' : '#9e9e9e',
                                                                                color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                                fontWeight: 800, fontSize: '13px', flexShrink: 0
                                                                            }}>
                                                                                {i + 1}
                                                                            </div>

                                                                            {/* Bot info */}
                                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                                                                    <span style={{ fontWeight: 700, fontSize: '13px' }}>{bot.name}</span>
                                                                                    {i === 0 && (
                                                                                        <span style={{ fontSize: '10px', padding: '1px 6px', background: 'rgba(76,175,80,0.15)', color: '#4caf50', borderRadius: '8px', fontWeight: 700 }}>
                                                                                            优先
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                                {/* Success rate bar */}
                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                    <div style={{ flex: 1, height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                                                                                        <div style={{ width: `${ratePercent}%`, height: '100%', background: barColor, borderRadius: '3px', transition: 'width 0.3s' }} />
                                                                                    </div>
                                                                                    <span style={{ fontSize: '12px', fontWeight: 700, color: barColor, minWidth: '36px', textAlign: 'right' }}>
                                                                                        {ratePercent}%
                                                                                    </span>
                                                                                </div>
                                                                            </div>

                                                                            {/* Stats */}
                                                                            <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-secondary)', flexShrink: 0 }}>
                                                                                <div style={{ textAlign: 'center' }}>
                                                                                    <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>{bot.total}</div>
                                                                                    <div>总数</div>
                                                                                </div>
                                                                                <div style={{ textAlign: 'center' }}>
                                                                                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#4caf50' }}>{bot.success}</div>
                                                                                    <div>成功</div>
                                                                                </div>
                                                                                <div style={{ textAlign: 'center' }}>
                                                                                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#f44336' }}>{bot.failed}</div>
                                                                                    <div>失败</div>
                                                                                </div>
                                                                                <div style={{ textAlign: 'center' }}>
                                                                                    <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>¥{bot.costPerVerify}</div>
                                                                                    <div>单价</div>
                                                                                </div>
                                                                                <div style={{ textAlign: 'center' }}>
                                                                                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#ff9800' }}>¥{bot.expectedCost}</div>
                                                                                    <div>期望</div>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}

                                                        <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '10px 0 0', lineHeight: 1.4 }}>
                                                            💡 系统按「期望成本 = 单价 ÷ 成功率」升序排列，优先使用排名第一的 Bot。失败后自动尝试下一个。
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {/* ── Dual Bot Config ── */}
                                        <div style={{
                                            borderRadius: '12px', overflow: 'hidden',
                                            border: '1px solid var(--border)', marginBottom: '12px'
                                        }}>
                                            <div style={{
                                                padding: '14px 18px',
                                                background: 'linear-gradient(135deg, rgba(76,175,80,0.08), rgba(76,175,80,0.02))',
                                                borderBottom: '1px solid var(--border)',
                                                display: 'flex', alignItems: 'center', gap: '8px'
                                            }}>
                                                <span style={{ fontSize: '16px' }}>🤖</span>
                                                <span style={{ fontWeight: 700, fontSize: '14px' }}>Dual Bot 验证</span>
                                                <span style={{
                                                    fontSize: '10px', padding: '2px 8px',
                                                    background: 'rgba(76,175,80,0.15)', color: '#4caf50',
                                                    borderRadius: '10px', fontWeight: 700, marginLeft: 'auto'
                                                }}>新方法</span>
                                            </div>
                                            <div style={{ padding: '16px 18px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                                                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                                                        新方法：预热 Bot → 验证 Bot → 失败自动刷新链接
                                                    </p>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer', fontWeight: 600, color: '#4caf50' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={config?.verification?.dualBot?.enabled || false}
                                                            onChange={e => {
                                                                const val = e.target.checked;
                                                                setConfig(prev => ({
                                                                    ...prev,
                                                                    verification: {
                                                                        ...prev.verification || {},
                                                                        dualBot: { ...prev.verification?.dualBot || {}, enabled: val },
                                                                        telegram: { ...prev.verification?.telegram || {}, enabled: val ? false : prev.verification?.telegram?.enabled },
                                                                        blackBot: { ...prev.verification?.blackBot || {}, enabled: val ? false : prev.verification?.blackBot?.enabled }
                                                                    }
                                                                }));
                                                            }}
                                                            style={{ width: '18px', height: '18px' }}
                                                        />
                                                        启用
                                                    </label>
                                                </div>
                                                <div style={{
                                                    display: 'flex', flexDirection: 'column', gap: '12px',
                                                    opacity: config?.verification?.dualBot?.enabled ? 1 : 0.6,
                                                    pointerEvents: config?.verification?.dualBot?.enabled ? 'auto' : 'none',
                                                    transition: 'all 0.3s'
                                                }}>
                                                    <div>
                                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>预热 Bot</label>
                                                        <input type="text" className="input"
                                                            value={config?.verification?.dualBot?.warmupBot || '@SatsetHelperbot'}
                                                            onChange={e => setConfig(prev => ({
                                                                ...prev,
                                                                verification: {
                                                                    ...prev.verification || {},
                                                                    dualBot: { ...prev.verification?.dualBot || {}, warmupBot: e.target.value }
                                                                }
                                                            }))}
                                                            placeholder="@SatsetHelperbot"
                                                            style={{ width: '100%', boxSizing: 'border-box' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>验证 Bot</label>
                                                        <input type="text" className="input"
                                                            value={config?.verification?.dualBot?.verifyBot || '@AutoGeminiProbot'}
                                                            onChange={e => setConfig(prev => ({
                                                                ...prev,
                                                                verification: {
                                                                    ...prev.verification || {},
                                                                    dualBot: { ...prev.verification?.dualBot || {}, verifyBot: e.target.value }
                                                                }
                                                            }))}
                                                            placeholder="@AutoGeminiProbot"
                                                            style={{ width: '100%', boxSizing: 'border-box' }}
                                                        />
                                                    </div>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={config?.verification?.dualBot?.autoBypass !== false}
                                                            onChange={e => setConfig(prev => ({
                                                                ...prev,
                                                                verification: {
                                                                    ...prev.verification || {},
                                                                    dualBot: { ...prev.verification?.dualBot || {}, autoBypass: e.target.checked }
                                                                }
                                                            }))}
                                                            style={{ width: '16px', height: '16px' }}
                                                        />
                                                        验证失败时自动 Bypass（刷新链接）
                                                    </label>

                                                    {/* ── Cost Per Verify ── */}
                                                    <div style={{ marginTop: '8px' }}>
                                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>单次验证成本 (costPerVerify)</label>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <input type="number" className="input"
                                                                value={config?.verification?.dualBot?.costPerVerify ?? 1}
                                                                onChange={e => setConfig(prev => ({
                                                                    ...prev,
                                                                    verification: {
                                                                        ...prev.verification || {},
                                                                        dualBot: { ...prev.verification?.dualBot || {}, costPerVerify: parseFloat(e.target.value) || 1 }
                                                                    }
                                                                }))}
                                                                min="0.01" step="0.1"
                                                                style={{ width: '80px', boxSizing: 'border-box', fontSize: '12px' }}
                                                            />
                                                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>用于瀑布优先级排序（期望成本 = 价格 / 成功率）</span>
                                                        </div>
                                                    </div>

                                                    {/* ── Bot Rules (Collapsible) ── */}
                                                    <details style={{ marginTop: '12px' }}>
                                                        <summary style={{
                                                            cursor: 'pointer', padding: '10px 14px',
                                                            borderRadius: '10px', border: '1px solid var(--border)',
                                                            background: 'var(--bg-secondary)',
                                                            fontSize: '13px', fontWeight: 700,
                                                            display: 'flex', alignItems: 'center', gap: '8px',
                                                            listStyle: 'none', userSelect: 'none'
                                                        }}>
                                                            <span style={{ transition: 'transform 0.2s' }}>▶</span>
                                                            📋 响应规则 & 冷却配置
                                                            <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                                                                点击展开/收起
                                                            </span>
                                                        </summary>
                                                        <div style={{ paddingTop: '8px' }}>
                                                            {/* ── DualBot: Processing Keywords ── */}
                                                            <div style={{ marginTop: '12px' }}>
                                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px' }}>处理中关键词 (processingKeywords)</label>
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                                                    {(config?.verification?.dualBot?.processingKeywords || []).map((pk, pi) => (
                                                                        <span key={pi} style={{
                                                                            display: 'inline-flex', alignItems: 'center', gap: '3px',
                                                                            padding: '2px 8px', fontSize: '11px', fontWeight: 600, fontFamily: 'monospace',
                                                                            background: 'rgba(255,152,0,0.1)', color: '#ff9800',
                                                                            borderRadius: '10px', border: '1px solid rgba(255,152,0,0.2)'
                                                                        }}>
                                                                            {pk}
                                                                            <span style={{ cursor: 'pointer', fontSize: '12px', lineHeight: 1 }}
                                                                                onClick={() => setConfig(prev => {
                                                                                    const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                    const newPks = [...(dualBot.processingKeywords || [])];
                                                                                    newPks.splice(pi, 1);
                                                                                    dualBot.processingKeywords = newPks;
                                                                                    return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                })}>×</span>
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                                <input type="text" className="input"
                                                                    placeholder="输入关键词后按 Enter"
                                                                    style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px', fontFamily: 'monospace' }}
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter' && e.target.value.trim()) {
                                                                            const val = e.target.value.trim();
                                                                            setConfig(prev => {
                                                                                const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                dualBot.processingKeywords = [...(dualBot.processingKeywords || []), val];
                                                                                return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                            });
                                                                            e.target.value = '';
                                                                        }
                                                                    }}
                                                                />
                                                            </div>

                                                            {/* ── DualBot: Warmup Success Keywords ── */}
                                                            <div style={{ marginTop: '12px' }}>
                                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px' }}>预热成功关键词 (warmupSuccessKeywords)</label>
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                                                    {(config?.verification?.dualBot?.warmupSuccessKeywords || []).map((wk, wi) => (
                                                                        <span key={wi} style={{
                                                                            display: 'inline-flex', alignItems: 'center', gap: '3px',
                                                                            padding: '2px 8px', fontSize: '11px', fontWeight: 600, fontFamily: 'monospace',
                                                                            background: 'rgba(76,175,80,0.1)', color: '#4caf50',
                                                                            borderRadius: '10px', border: '1px solid rgba(76,175,80,0.2)'
                                                                        }}>
                                                                            {wk}
                                                                            <span style={{ cursor: 'pointer', fontSize: '12px', lineHeight: 1 }}
                                                                                onClick={() => setConfig(prev => {
                                                                                    const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                    const newWks = [...(dualBot.warmupSuccessKeywords || [])];
                                                                                    newWks.splice(wi, 1);
                                                                                    dualBot.warmupSuccessKeywords = newWks;
                                                                                    return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                })}>×</span>
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                                <input type="text" className="input"
                                                                    placeholder="输入关键词后按 Enter"
                                                                    style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px', fontFamily: 'monospace' }}
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter' && e.target.value.trim()) {
                                                                            const val = e.target.value.trim();
                                                                            setConfig(prev => {
                                                                                const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                dualBot.warmupSuccessKeywords = [...(dualBot.warmupSuccessKeywords || []), val];
                                                                                return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                            });
                                                                            e.target.value = '';
                                                                        }
                                                                    }}
                                                                />
                                                                <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                                    预热Bot返回这些关键词时视为文档生成成功
                                                                </p>
                                                            </div>

                                                            {/* ── DualBot: Response Rules ── */}
                                                            <div style={{
                                                                marginTop: '16px', padding: '14px',
                                                                borderRadius: '10px', border: '1px solid var(--border)',
                                                                background: 'var(--bg-secondary)'
                                                            }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                        <span style={{ fontSize: '14px' }}>📋</span>
                                                                        <span style={{ fontWeight: 700, fontSize: '13px' }}>验证Bot 响应规则</span>
                                                                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 400 }}>
                                                                            按顺序匹配，优先级从上到下
                                                                        </span>
                                                                    </div>
                                                                    <button
                                                                        onClick={() => setConfig(prev => {
                                                                            const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                            dualBot.responseRules = [...(dualBot.responseRules || []), {
                                                                                keywords: ['NEW_KEYWORD'],
                                                                                status: 'failed',
                                                                                success: false,
                                                                                message: '新规则',
                                                                                messageKey: 'msgNewRule'
                                                                            }];
                                                                            return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                        })}
                                                                        style={{
                                                                            padding: '4px 12px', fontSize: '12px', fontWeight: 600,
                                                                            background: 'rgba(76,175,80,0.1)', color: '#4caf50',
                                                                            border: '1px solid rgba(76,175,80,0.3)', borderRadius: '8px',
                                                                            cursor: 'pointer'
                                                                        }}
                                                                    >+ 添加规则</button>
                                                                </div>

                                                                {(config?.verification?.dualBot?.responseRules || []).map((rule, ri) => (
                                                                    <div key={ri} style={{
                                                                        padding: '12px', marginBottom: '8px',
                                                                        borderRadius: '8px', border: '1px solid var(--border)',
                                                                        background: rule.success ? 'rgba(76,175,80,0.04)' : 'rgba(239,68,68,0.04)'
                                                                    }}>
                                                                        {/* Rule header */}
                                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                <span style={{
                                                                                    width: '8px', height: '8px', borderRadius: '50%',
                                                                                    background: rule.status === 'approved' ? '#4caf50' : rule.status === 'cooldown' ? '#ff9800' : '#ef4444',
                                                                                    display: 'inline-block'
                                                                                }} />
                                                                                <span style={{ fontSize: '12px', fontWeight: 700 }}>规则 #{ri + 1}</span>
                                                                                <span style={{
                                                                                    fontSize: '10px', padding: '1px 8px', borderRadius: '10px', fontWeight: 700,
                                                                                    background: rule.status === 'approved' ? 'rgba(76,175,80,0.15)' : rule.status === 'cooldown' ? 'rgba(255,152,0,0.15)' : 'rgba(239,68,68,0.15)',
                                                                                    color: rule.status === 'approved' ? '#4caf50' : rule.status === 'cooldown' ? '#ff9800' : '#ef4444'
                                                                                }}>
                                                                                    {rule.status === 'approved' ? '✓ 成功' : rule.status === 'cooldown' ? '⏳ 冷却' : '✕ 失败'}
                                                                                </span>
                                                                            </div>
                                                                            <button
                                                                                onClick={() => setConfig(prev => {
                                                                                    const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                    const newRules = [...(dualBot.responseRules || [])];
                                                                                    newRules.splice(ri, 1);
                                                                                    dualBot.responseRules = newRules;
                                                                                    return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                })}
                                                                                style={{
                                                                                    padding: '2px 8px', fontSize: '14px',
                                                                                    background: 'transparent', color: '#ef4444',
                                                                                    border: 'none', cursor: 'pointer', borderRadius: '4px'
                                                                                }}
                                                                                title="删除此规则"
                                                                            >🗑️</button>
                                                                        </div>

                                                                        {/* Keywords */}
                                                                        <div style={{ marginBottom: '8px' }}>
                                                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>关键词 (Keywords)</label>
                                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                                                                {(rule.keywords || []).map((kw, ki) => (
                                                                                    <span key={ki} style={{
                                                                                        display: 'inline-flex', alignItems: 'center', gap: '3px',
                                                                                        padding: '2px 8px', fontSize: '11px', fontWeight: 600, fontFamily: 'monospace',
                                                                                        background: 'rgba(102,126,234,0.1)', color: '#667eea',
                                                                                        borderRadius: '10px', border: '1px solid rgba(102,126,234,0.2)'
                                                                                    }}>
                                                                                        {kw}
                                                                                        <span style={{ cursor: 'pointer', fontSize: '12px', lineHeight: 1 }}
                                                                                            onClick={() => setConfig(prev => {
                                                                                                const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                                const newRules = [...(dualBot.responseRules || [])];
                                                                                                const newKws = [...(newRules[ri].keywords || [])];
                                                                                                newKws.splice(ki, 1);
                                                                                                newRules[ri] = { ...newRules[ri], keywords: newKws };
                                                                                                dualBot.responseRules = newRules;
                                                                                                return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                            })}>×</span>
                                                                                    </span>
                                                                                ))}
                                                                            </div>
                                                                            <input type="text" className="input"
                                                                                placeholder="输入关键词后按 Enter"
                                                                                style={{ width: '100%', boxSizing: 'border-box', fontSize: '11px', fontFamily: 'monospace' }}
                                                                                onKeyDown={e => {
                                                                                    if (e.key === 'Enter' && e.target.value.trim()) {
                                                                                        const val = e.target.value.trim();
                                                                                        setConfig(prev => {
                                                                                            const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                            const newRules = [...(dualBot.responseRules || [])];
                                                                                            const newKws = [...(newRules[ri].keywords || []), val];
                                                                                            newRules[ri] = { ...newRules[ri], keywords: newKws };
                                                                                            dualBot.responseRules = newRules;
                                                                                            return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                        });
                                                                                        e.target.value = '';
                                                                                    }
                                                                                }}
                                                                            />
                                                                        </div>

                                                                        {/* Status + Success row */}
                                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                                                                            <div>
                                                                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>状态 (status)</label>
                                                                                <select className="input"
                                                                                    value={rule.status || 'failed'}
                                                                                    onChange={e => setConfig(prev => {
                                                                                        const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                        const newRules = [...(dualBot.responseRules || [])];
                                                                                        const newStatus = e.target.value;
                                                                                        newRules[ri] = { ...newRules[ri], status: newStatus, success: newStatus === 'approved' };
                                                                                        dualBot.responseRules = newRules;
                                                                                        return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                    })}
                                                                                    style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                                                                >
                                                                                    <option value="approved">✅ approved (成功)</option>
                                                                                    <option value="failed">❌ failed (失败)</option>
                                                                                    <option value="cooldown">⏳ cooldown (冷却)</option>
                                                                                </select>
                                                                            </div>
                                                                            <div>
                                                                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>成功 (success)</label>
                                                                                <label style={{
                                                                                    display: 'flex', alignItems: 'center', gap: '6px',
                                                                                    padding: '6px 10px', borderRadius: '6px',
                                                                                    border: '1px solid var(--border)', fontSize: '12px', cursor: 'pointer'
                                                                                }}>
                                                                                    <input type="checkbox"
                                                                                        checked={rule.success === true}
                                                                                        onChange={e => setConfig(prev => {
                                                                                            const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                            const newRules = [...(dualBot.responseRules || [])];
                                                                                            newRules[ri] = { ...newRules[ri], success: e.target.checked };
                                                                                            dualBot.responseRules = newRules;
                                                                                            return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                        })}
                                                                                        style={{ width: '14px', height: '14px' }}
                                                                                    />
                                                                                    {rule.success ? '✅ 是' : '❌ 否'}
                                                                                </label>
                                                                            </div>
                                                                        </div>

                                                                        {/* Message + Keys */}
                                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '6px' }}>
                                                                            <div>
                                                                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>消息 (message)</label>
                                                                                <input type="text" className="input"
                                                                                    value={rule.message || ''}
                                                                                    onChange={e => setConfig(prev => {
                                                                                        const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                        const newRules = [...(dualBot.responseRules || [])];
                                                                                        newRules[ri] = { ...newRules[ri], message: e.target.value };
                                                                                        dualBot.responseRules = newRules;
                                                                                        return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                    })}
                                                                                    style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                                                                />
                                                                            </div>
                                                                            <div>
                                                                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>消息Key (messageKey)</label>
                                                                                <input type="text" className="input"
                                                                                    value={rule.messageKey || ''}
                                                                                    onChange={e => setConfig(prev => {
                                                                                        const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                        const newRules = [...(dualBot.responseRules || [])];
                                                                                        newRules[ri] = { ...newRules[ri], messageKey: e.target.value };
                                                                                        dualBot.responseRules = newRules;
                                                                                        return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                    })}
                                                                                    placeholder="msgApproved"
                                                                                    style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px', fontFamily: 'monospace' }}
                                                                                />
                                                                            </div>
                                                                        </div>

                                                                        {/* Failure Reason Key */}
                                                                        {!rule.success && (
                                                                            <div>
                                                                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>失败原因Key (failureReasonKey)</label>
                                                                                <input type="text" className="input"
                                                                                    value={rule.failureReasonKey || ''}
                                                                                    onChange={e => setConfig(prev => {
                                                                                        const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                        const newRules = [...(dualBot.responseRules || [])];
                                                                                        newRules[ri] = { ...newRules[ri], failureReasonKey: e.target.value };
                                                                                        dualBot.responseRules = newRules;
                                                                                        return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                    })}
                                                                                    placeholder="reasonFraud / reasonFailed / reasonDocRejected"
                                                                                    style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px', fontFamily: 'monospace' }}
                                                                                />
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ))}

                                                                {(config?.verification?.dualBot?.responseRules || []).length === 0 && (
                                                                    <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12px', padding: '12px 0', margin: 0 }}>
                                                                        暂无规则，点击「+ 添加规则」开始配置
                                                                    </p>
                                                                )}
                                                            </div>

                                                            {/* ── DualBot: Cooldown & Quota ── */}
                                                            <div style={{
                                                                marginTop: '12px', padding: '12px',
                                                                borderRadius: '8px', border: '1px solid var(--border)',
                                                                background: 'var(--bg-secondary)'
                                                            }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                                                                    <span style={{ fontSize: '13px' }}>⚙️</span>
                                                                    <span style={{ fontWeight: 700, fontSize: '12px' }}>冷却 & 配额配置</span>
                                                                </div>
                                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                                                                    <div>
                                                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>冷却关键词 (cooldown.keywords)</label>
                                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                                                            {(config?.verification?.dualBot?.cooldown?.keywords || []).map((ck, ci) => (
                                                                                <span key={ci} style={{
                                                                                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                                                                                    padding: '2px 8px', fontSize: '11px', fontWeight: 600, fontFamily: 'monospace',
                                                                                    background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                                                                                    borderRadius: '10px', border: '1px solid rgba(239,68,68,0.2)'
                                                                                }}>
                                                                                    {ck}
                                                                                    <span style={{ cursor: 'pointer', fontSize: '12px', lineHeight: 1 }}
                                                                                        onClick={() => setConfig(prev => {
                                                                                            const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                            const cd = { ...(dualBot.cooldown || {}) };
                                                                                            const newCks = [...(cd.keywords || [])];
                                                                                            newCks.splice(ci, 1);
                                                                                            cd.keywords = newCks;
                                                                                            dualBot.cooldown = cd;
                                                                                            return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                        })}>×</span>
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                        <input type="text" className="input"
                                                                            placeholder="输入关键词后按 Enter"
                                                                            style={{ width: '100%', boxSizing: 'border-box', fontSize: '11px', fontFamily: 'monospace' }}
                                                                            onKeyDown={e => {
                                                                                if (e.key === 'Enter' && e.target.value.trim()) {
                                                                                    const val = e.target.value.trim();
                                                                                    setConfig(prev => {
                                                                                        const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                        const cd = { ...(dualBot.cooldown || {}) };
                                                                                        cd.keywords = [...(cd.keywords || []), val];
                                                                                        dualBot.cooldown = cd;
                                                                                        return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                    });
                                                                                    e.target.value = '';
                                                                                }
                                                                            }}
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>冷却时间正则 (cooldown.timePattern)</label>
                                                                        <input type="text" className="input"
                                                                            value={config?.verification?.dualBot?.cooldown?.timePattern || ''}
                                                                            onChange={e => setConfig(prev => {
                                                                                const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                const cd = { ...(dualBot.cooldown || {}) };
                                                                                cd.timePattern = e.target.value;
                                                                                dualBot.cooldown = cd;
                                                                                return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                            })}
                                                                            placeholder="(\d+)\s*M"
                                                                            style={{ width: '100%', boxSizing: 'border-box', fontSize: '11px', fontFamily: 'monospace' }}
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>配额正则 (quota.remainingPattern)</label>
                                                                        <input type="text" className="input"
                                                                            value={config?.verification?.dualBot?.quota?.remainingPattern || ''}
                                                                            onChange={e => setConfig(prev => {
                                                                                const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                dualBot.quota = { ...(dualBot.quota || {}), remainingPattern: e.target.value };
                                                                                return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                            })}
                                                                            placeholder="TOTAL\s+TERSEDIA[:\s]*\*{0,2}(\d+)\*{0,2}"
                                                                            style={{ width: '100%', boxSizing: 'border-box', fontSize: '11px', fontFamily: 'monospace' }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* ── DualBot: Retries & Timeout ── */}
                                                            <div style={{
                                                                marginTop: '12px', padding: '12px',
                                                                borderRadius: '8px', border: '1px solid var(--border)',
                                                                background: 'var(--bg-secondary)'
                                                            }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                                                                    <span style={{ fontSize: '13px' }}>🔄</span>
                                                                    <span style={{ fontWeight: 700, fontSize: '12px' }}>重试 & 超时配置</span>
                                                                </div>
                                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                                                                    <div>
                                                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>最大重试 (maxRetries)</label>
                                                                        <input type="number" className="input"
                                                                            value={config?.verification?.dualBot?.maxRetries ?? 5}
                                                                            onChange={e => setConfig(prev => {
                                                                                const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                dualBot.maxRetries = parseInt(e.target.value) || 5;
                                                                                return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                            })}
                                                                            min="1" max="20"
                                                                            style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>预热超时 (warmupTimeout)</label>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                            <input type="number" className="input"
                                                                                value={config?.verification?.dualBot?.warmupTimeout ?? 90}
                                                                                onChange={e => setConfig(prev => {
                                                                                    const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                    dualBot.warmupTimeout = parseInt(e.target.value) || 90;
                                                                                    return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                })}
                                                                                min="30" max="600"
                                                                                style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                                                            />
                                                                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>秒</span>
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>验证超时 (verifyTimeout)</label>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                            <input type="number" className="input"
                                                                                value={config?.verification?.dualBot?.verifyTimeout ?? 120}
                                                                                onChange={e => setConfig(prev => {
                                                                                    const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                    dualBot.verifyTimeout = parseInt(e.target.value) || 120;
                                                                                    return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                })}
                                                                                min="30" max="600"
                                                                                style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                                                            />
                                                                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>秒</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </details>
                                                </div>
                                            </div>

                                            {/* ── Dynamic Single Bot Configs ── */}
                                            {(config?.verification?.singleBots || []).map((bot, idx) => {
                                                const isBlack = bot.id === 'blackbot';
                                                const isLegacy = bot.id === 'oldbot';
                                                const icon = isBlack ? '🖤' : isLegacy ? '📨' : '🤖';

                                                return (
                                                    <div key={bot.id} style={{
                                                        borderRadius: '12px', overflow: 'hidden',
                                                        border: '1px solid var(--border)', marginTop: '12px'
                                                    }}>
                                                        <div style={{
                                                            padding: '14px 18px',
                                                            background: isBlack ? 'linear-gradient(135deg, rgba(33,33,33,0.08), rgba(33,33,33,0.02))'
                                                                : isLegacy ? 'linear-gradient(135deg, rgba(255,152,0,0.08), rgba(255,152,0,0.02))'
                                                                    : 'linear-gradient(135deg, rgba(76,175,80,0.08), rgba(76,175,80,0.02))',
                                                            borderBottom: '1px solid var(--border)',
                                                            display: 'flex', alignItems: 'center', gap: '8px'
                                                        }}>
                                                            <span style={{ fontSize: '16px' }}>{icon}</span>
                                                            <span style={{ fontWeight: 700, fontSize: '14px' }}>{bot.username || bot.id} 验证</span>
                                                            <span style={{
                                                                fontSize: '10px', padding: '2px 8px',
                                                                background: 'rgba(33,33,33,0.15)', color: '#555',
                                                                borderRadius: '10px', fontWeight: 700, marginLeft: 'auto'
                                                            }}>单Bot ({bot.id})</span>
                                                        </div>
                                                        <div style={{ padding: '16px 18px' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                                                                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                                                                    使用分配给该Bot的账号发送验证请求
                                                                </p>
                                                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer', fontWeight: 600, color: '#333' }}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={bot.enabled === true}
                                                                        onChange={e => {
                                                                            const val = e.target.checked;
                                                                            setConfig(prev => {
                                                                                const newBots = [...(prev.verification?.singleBots || [])];
                                                                                newBots[idx] = { ...newBots[idx], enabled: val };
                                                                                return {
                                                                                    ...prev,
                                                                                    verification: {
                                                                                        ...prev.verification,
                                                                                        singleBots: newBots,
                                                                                        dualBot: { ...prev.verification?.dualBot, enabled: val ? false : prev.verification?.dualBot?.enabled }
                                                                                    }
                                                                                };
                                                                            });
                                                                        }}
                                                                        style={{ width: '18px', height: '18px' }}
                                                                    />
                                                                    启用
                                                                </label>
                                                            </div>
                                                            <div style={{
                                                                display: 'flex', flexDirection: 'column', gap: '12px',
                                                                opacity: bot.enabled ? 1 : 0.6,
                                                                pointerEvents: bot.enabled ? 'auto' : 'none',
                                                                transition: 'all 0.3s'
                                                            }}>
                                                                <div>
                                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>目标 Bot</label>
                                                                    <input type="text" className="input"
                                                                        value={bot.username || ''}
                                                                        onChange={e => setConfig(prev => {
                                                                            const newBots = [...(prev.verification?.singleBots || [])];
                                                                            newBots[idx] = { ...newBots[idx], username: e.target.value };
                                                                            return {
                                                                                ...prev,
                                                                                verification: {
                                                                                    ...prev.verification,
                                                                                    singleBots: newBots
                                                                                }
                                                                            };
                                                                        })}
                                                                        placeholder="@Bot_Username"
                                                                        style={{ width: '100%', boxSizing: 'border-box' }}
                                                                    />
                                                                </div>
                                                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={bot.autoBypass !== false}
                                                                        onChange={e => setConfig(prev => {
                                                                            const newBots = [...(prev.verification?.singleBots || [])];
                                                                            newBots[idx] = { ...newBots[idx], autoBypass: e.target.checked };
                                                                            return {
                                                                                ...prev,
                                                                                verification: {
                                                                                    ...prev.verification,
                                                                                    singleBots: newBots
                                                                                }
                                                                            };
                                                                        })}
                                                                        style={{ width: '16px', height: '16px' }}
                                                                    />
                                                                    验证失败时自动 Bypass（刷新链接）
                                                                </label>

                                                                {/* ── Cost Per Verify ── */}
                                                                <div style={{ marginTop: '8px' }}>
                                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>单次验证成本 (costPerVerify)</label>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                        <input type="number" className="input"
                                                                            value={bot.costPerVerify ?? 1}
                                                                            onChange={e => setConfig(prev => {
                                                                                const newBots = [...(prev.verification?.singleBots || [])];
                                                                                newBots[idx] = { ...newBots[idx], costPerVerify: parseFloat(e.target.value) || 1 };
                                                                                return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                            })}
                                                                            min="0.01" step="0.1"
                                                                            style={{ width: '80px', boxSizing: 'border-box', fontSize: '12px' }}
                                                                        />
                                                                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>用于瀑布优先级排序</span>
                                                                    </div>
                                                                </div>

                                                                {/* ── Concurrent Per Account ── */}
                                                                <div style={{ marginTop: '8px' }}>
                                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>每账号并发数 (concurrentPerAccount)</label>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                        <input type="number" className="input"
                                                                            value={bot.concurrentPerAccount ?? 1}
                                                                            onChange={e => setConfig(prev => {
                                                                                const newBots = [...(prev.verification?.singleBots || [])];
                                                                                newBots[idx] = { ...newBots[idx], concurrentPerAccount: parseInt(e.target.value) || 1 };
                                                                                return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                            })}
                                                                            min="1" max="10"
                                                                            style={{ width: '80px', boxSizing: 'border-box', fontSize: '12px' }}
                                                                        />
                                                                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                                            {(bot.concurrentPerAccount ?? 1) > 1
                                                                                ? '⚡ 同一账号可同时发送多条链接（需Bot回复带VID）'
                                                                                : '🔒 同一账号同时只处理一条链接'}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                {/* ── Send Format ── */}
                                                                <div style={{ marginTop: '8px' }}>
                                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>发送格式 (sendFormat)</label>
                                                                    <input type="text" className="input"
                                                                        value={bot.sendFormat || '{link}'}
                                                                        onChange={e => setConfig(prev => {
                                                                            const newBots = [...(prev.verification?.singleBots || [])];
                                                                            newBots[idx] = { ...newBots[idx], sendFormat: e.target.value };
                                                                            return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                        })}
                                                                        placeholder="{link}"
                                                                        style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '12px' }}
                                                                    />
                                                                    <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                                        使用 <code>{'{link}'}</code> 作为验证链接占位符
                                                                    </p>
                                                                </div>

                                                                {/* ── Auto Click Buttons ── */}
                                                                <div style={{ marginTop: '12px' }}>
                                                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px' }}>自动点击按钮 (autoClickButtons)</label>
                                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
                                                                        {(bot.autoClickButtons || []).map((btn, bi) => (
                                                                            <span key={bi} style={{
                                                                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                                                                padding: '3px 10px', fontSize: '12px', fontWeight: 600,
                                                                                background: 'rgba(0,136,204,0.1)', color: '#0088cc',
                                                                                borderRadius: '14px', border: '1px solid rgba(0,136,204,0.2)'
                                                                            }}>
                                                                                {btn}
                                                                                <span style={{ cursor: 'pointer', marginLeft: '2px', fontSize: '14px', lineHeight: 1 }}
                                                                                    onClick={() => setConfig(prev => {
                                                                                        const newBots = [...(prev.verification?.singleBots || [])];
                                                                                        const newBtns = [...(newBots[idx].autoClickButtons || [])];
                                                                                        newBtns.splice(bi, 1);
                                                                                        newBots[idx] = { ...newBots[idx], autoClickButtons: newBtns };
                                                                                        return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                    })}>×</span>
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                    <input type="text" className="input"
                                                                        placeholder="输入按钮文本后按 Enter 添加"
                                                                        style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                                                        onKeyDown={e => {
                                                                            if (e.key === 'Enter' && e.target.value.trim()) {
                                                                                const val = e.target.value.trim();
                                                                                setConfig(prev => {
                                                                                    const newBots = [...(prev.verification?.singleBots || [])];
                                                                                    const newBtns = [...(newBots[idx].autoClickButtons || []), val];
                                                                                    newBots[idx] = { ...newBots[idx], autoClickButtons: newBtns };
                                                                                    return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                });
                                                                                e.target.value = '';
                                                                            }
                                                                        }}
                                                                    />
                                                                </div>

                                                                {/* ── Bot Rules (Collapsible) ── */}
                                                                <details style={{ marginTop: '12px' }}>
                                                                    <summary style={{
                                                                        cursor: 'pointer', padding: '10px 14px',
                                                                        borderRadius: '10px', border: '1px solid var(--border)',
                                                                        background: 'var(--bg-secondary)',
                                                                        fontSize: '13px', fontWeight: 700,
                                                                        display: 'flex', alignItems: 'center', gap: '8px',
                                                                        listStyle: 'none', userSelect: 'none'
                                                                    }}>
                                                                        <span style={{ transition: 'transform 0.2s' }}>▶</span>
                                                                        📋 响应规则 & 冷却配置
                                                                        <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                                                                            点击展开/收起
                                                                        </span>
                                                                    </summary>
                                                                    <div style={{ paddingTop: '8px' }}>
                                                                        {/* ── Response Rules ── */}
                                                                        <div style={{
                                                                            marginTop: '16px', padding: '14px',
                                                                            borderRadius: '10px', border: '1px solid var(--border)',
                                                                            background: 'var(--bg-secondary)'
                                                                        }}>
                                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                                    <span style={{ fontSize: '14px' }}>📋</span>
                                                                                    <span style={{ fontWeight: 700, fontSize: '13px' }}>响应规则 (Response Rules)</span>
                                                                                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 400 }}>
                                                                                        按顺序匹配，优先级从上到下
                                                                                    </span>
                                                                                </div>
                                                                                <button
                                                                                    onClick={() => setConfig(prev => {
                                                                                        const newBots = [...(prev.verification?.singleBots || [])];
                                                                                        const newRules = [...(newBots[idx].responseRules || []), {
                                                                                            keywords: ['NEW_KEYWORD'],
                                                                                            status: 'failed',
                                                                                            success: false,
                                                                                            message: '新规则',
                                                                                            messageKey: 'msgNewRule'
                                                                                        }];
                                                                                        newBots[idx] = { ...newBots[idx], responseRules: newRules };
                                                                                        return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                    })}
                                                                                    style={{
                                                                                        padding: '4px 12px', fontSize: '12px', fontWeight: 600,
                                                                                        background: 'rgba(76,175,80,0.1)', color: '#4caf50',
                                                                                        border: '1px solid rgba(76,175,80,0.3)', borderRadius: '8px',
                                                                                        cursor: 'pointer'
                                                                                    }}
                                                                                >+ 添加规则</button>
                                                                            </div>

                                                                            {(bot.responseRules || []).map((rule, ri) => (
                                                                                <div key={ri} style={{
                                                                                    padding: '12px', marginBottom: '8px',
                                                                                    borderRadius: '8px', border: '1px solid var(--border)',
                                                                                    background: rule.success ? 'rgba(76,175,80,0.04)' : 'rgba(239,68,68,0.04)'
                                                                                }}>
                                                                                    {/* Rule header */}
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                            <span style={{
                                                                                                width: '8px', height: '8px', borderRadius: '50%',
                                                                                                background: rule.status === 'approved' ? '#4caf50' : rule.status === 'cooldown' ? '#ff9800' : '#ef4444',
                                                                                                display: 'inline-block'
                                                                                            }} />
                                                                                            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                                                                                规则 #{ri + 1}
                                                                                            </span>
                                                                                            <span style={{
                                                                                                fontSize: '10px', padding: '1px 8px', borderRadius: '10px', fontWeight: 700,
                                                                                                background: rule.status === 'approved' ? 'rgba(76,175,80,0.15)' : rule.status === 'cooldown' ? 'rgba(255,152,0,0.15)' : 'rgba(239,68,68,0.15)',
                                                                                                color: rule.status === 'approved' ? '#4caf50' : rule.status === 'cooldown' ? '#ff9800' : '#ef4444'
                                                                                            }}>
                                                                                                {rule.status === 'approved' ? '✓ 成功' : rule.status === 'cooldown' ? '⏳ 冷却' : '✕ 失败'}
                                                                                            </span>
                                                                                        </div>
                                                                                        <button
                                                                                            onClick={() => setConfig(prev => {
                                                                                                const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                const newRules = [...(newBots[idx].responseRules || [])];
                                                                                                newRules.splice(ri, 1);
                                                                                                newBots[idx] = { ...newBots[idx], responseRules: newRules };
                                                                                                return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                            })}
                                                                                            style={{
                                                                                                padding: '2px 8px', fontSize: '14px',
                                                                                                background: 'transparent', color: '#ef4444',
                                                                                                border: 'none', cursor: 'pointer', borderRadius: '4px'
                                                                                            }}
                                                                                            title="删除此规则"
                                                                                        >🗑️</button>
                                                                                    </div>

                                                                                    {/* Keywords */}
                                                                                    <div style={{ marginBottom: '8px' }}>
                                                                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>关键词 (Keywords)</label>
                                                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                                                                            {(rule.keywords || []).map((kw, ki) => (
                                                                                                <span key={ki} style={{
                                                                                                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                                                                                                    padding: '2px 8px', fontSize: '11px', fontWeight: 600, fontFamily: 'monospace',
                                                                                                    background: 'rgba(102,126,234,0.1)', color: '#667eea',
                                                                                                    borderRadius: '10px', border: '1px solid rgba(102,126,234,0.2)'
                                                                                                }}>
                                                                                                    {kw}
                                                                                                    <span style={{ cursor: 'pointer', fontSize: '12px', lineHeight: 1 }}
                                                                                                        onClick={() => setConfig(prev => {
                                                                                                            const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                            const newRules = [...(newBots[idx].responseRules || [])];
                                                                                                            const newKws = [...(newRules[ri].keywords || [])];
                                                                                                            newKws.splice(ki, 1);
                                                                                                            newRules[ri] = { ...newRules[ri], keywords: newKws };
                                                                                                            newBots[idx] = { ...newBots[idx], responseRules: newRules };
                                                                                                            return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                                        })}>×</span>
                                                                                                </span>
                                                                                            ))}
                                                                                        </div>
                                                                                        <input type="text" className="input"
                                                                                            placeholder="输入关键词后按 Enter"
                                                                                            style={{ width: '100%', boxSizing: 'border-box', fontSize: '11px', fontFamily: 'monospace' }}
                                                                                            onKeyDown={e => {
                                                                                                if (e.key === 'Enter' && e.target.value.trim()) {
                                                                                                    const val = e.target.value.trim();
                                                                                                    setConfig(prev => {
                                                                                                        const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                        const newRules = [...(newBots[idx].responseRules || [])];
                                                                                                        const newKws = [...(newRules[ri].keywords || []), val];
                                                                                                        newRules[ri] = { ...newRules[ri], keywords: newKws };
                                                                                                        newBots[idx] = { ...newBots[idx], responseRules: newRules };
                                                                                                        return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                                    });
                                                                                                    e.target.value = '';
                                                                                                }
                                                                                            }}
                                                                                        />
                                                                                    </div>

                                                                                    {/* Status + Success row */}
                                                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                                                                                        <div>
                                                                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>状态 (status)</label>
                                                                                            <select className="input"
                                                                                                value={rule.status || 'failed'}
                                                                                                onChange={e => setConfig(prev => {
                                                                                                    const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                    const newRules = [...(newBots[idx].responseRules || [])];
                                                                                                    const newStatus = e.target.value;
                                                                                                    newRules[ri] = { ...newRules[ri], status: newStatus, success: newStatus === 'approved' };
                                                                                                    newBots[idx] = { ...newBots[idx], responseRules: newRules };
                                                                                                    return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                                })}
                                                                                                style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                                                                            >
                                                                                                <option value="approved">✅ approved (成功)</option>
                                                                                                <option value="failed">❌ failed (失败)</option>
                                                                                                <option value="cooldown">⏳ cooldown (冷却)</option>
                                                                                            </select>
                                                                                        </div>
                                                                                        <div>
                                                                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>成功 (success)</label>
                                                                                            <label style={{
                                                                                                display: 'flex', alignItems: 'center', gap: '6px',
                                                                                                padding: '6px 10px', borderRadius: '6px',
                                                                                                border: '1px solid var(--border)', fontSize: '12px', cursor: 'pointer'
                                                                                            }}>
                                                                                                <input type="checkbox"
                                                                                                    checked={rule.success === true}
                                                                                                    onChange={e => setConfig(prev => {
                                                                                                        const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                        const newRules = [...(newBots[idx].responseRules || [])];
                                                                                                        newRules[ri] = { ...newRules[ri], success: e.target.checked };
                                                                                                        newBots[idx] = { ...newBots[idx], responseRules: newRules };
                                                                                                        return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                                    })}
                                                                                                    style={{ width: '14px', height: '14px' }}
                                                                                                />
                                                                                                {rule.success ? '✅ 是' : '❌ 否'}
                                                                                            </label>
                                                                                        </div>
                                                                                    </div>

                                                                                    {/* Message + Keys */}
                                                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '6px' }}>
                                                                                        <div>
                                                                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>消息 (message)</label>
                                                                                            <input type="text" className="input"
                                                                                                value={rule.message || ''}
                                                                                                onChange={e => setConfig(prev => {
                                                                                                    const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                    const newRules = [...(newBots[idx].responseRules || [])];
                                                                                                    newRules[ri] = { ...newRules[ri], message: e.target.value };
                                                                                                    newBots[idx] = { ...newBots[idx], responseRules: newRules };
                                                                                                    return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                                })}
                                                                                                style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                                                                            />
                                                                                        </div>
                                                                                        <div>
                                                                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>消息Key (messageKey)</label>
                                                                                            <input type="text" className="input"
                                                                                                value={rule.messageKey || ''}
                                                                                                onChange={e => setConfig(prev => {
                                                                                                    const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                    const newRules = [...(newBots[idx].responseRules || [])];
                                                                                                    newRules[ri] = { ...newRules[ri], messageKey: e.target.value };
                                                                                                    newBots[idx] = { ...newBots[idx], responseRules: newRules };
                                                                                                    return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                                })}
                                                                                                placeholder="msgApproved"
                                                                                                style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px', fontFamily: 'monospace' }}
                                                                                            />
                                                                                        </div>
                                                                                    </div>

                                                                                    {/* Failure Reason Key (only for non-success) */}
                                                                                    {!rule.success && (
                                                                                        <div>
                                                                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>失败原因Key (failureReasonKey)</label>
                                                                                            <input type="text" className="input"
                                                                                                value={rule.failureReasonKey || ''}
                                                                                                onChange={e => setConfig(prev => {
                                                                                                    const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                    const newRules = [...(newBots[idx].responseRules || [])];
                                                                                                    newRules[ri] = { ...newRules[ri], failureReasonKey: e.target.value };
                                                                                                    newBots[idx] = { ...newBots[idx], responseRules: newRules };
                                                                                                    return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                                })}
                                                                                                placeholder="reasonFraud / reasonFailed / reasonDocRejected"
                                                                                                style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px', fontFamily: 'monospace' }}
                                                                                            />
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            ))}

                                                                            {(bot.responseRules || []).length === 0 && (
                                                                                <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12px', padding: '12px 0', margin: 0 }}>
                                                                                    暂无规则，点击「+ 添加规则」开始配置
                                                                                </p>
                                                                            )}
                                                                        </div>

                                                                        {/* ── Processing Keywords ── */}
                                                                        <div style={{ marginTop: '12px' }}>
                                                                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px' }}>处理中关键词 (processingKeywords)</label>
                                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                                                                {(bot.processingKeywords || []).map((pk, pi) => (
                                                                                    <span key={pi} style={{
                                                                                        display: 'inline-flex', alignItems: 'center', gap: '3px',
                                                                                        padding: '2px 8px', fontSize: '11px', fontWeight: 600, fontFamily: 'monospace',
                                                                                        background: 'rgba(255,152,0,0.1)', color: '#ff9800',
                                                                                        borderRadius: '10px', border: '1px solid rgba(255,152,0,0.2)'
                                                                                    }}>
                                                                                        {pk}
                                                                                        <span style={{ cursor: 'pointer', fontSize: '12px', lineHeight: 1 }}
                                                                                            onClick={() => setConfig(prev => {
                                                                                                const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                const newPks = [...(newBots[idx].processingKeywords || [])];
                                                                                                newPks.splice(pi, 1);
                                                                                                newBots[idx] = { ...newBots[idx], processingKeywords: newPks };
                                                                                                return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                            })}>×</span>
                                                                                    </span>
                                                                                ))}
                                                                            </div>
                                                                            <input type="text" className="input"
                                                                                placeholder="输入关键词后按 Enter"
                                                                                style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px', fontFamily: 'monospace' }}
                                                                                onKeyDown={e => {
                                                                                    if (e.key === 'Enter' && e.target.value.trim()) {
                                                                                        const val = e.target.value.trim();
                                                                                        setConfig(prev => {
                                                                                            const newBots = [...(prev.verification?.singleBots || [])];
                                                                                            const newPks = [...(newBots[idx].processingKeywords || []), val];
                                                                                            newBots[idx] = { ...newBots[idx], processingKeywords: newPks };
                                                                                            return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                        });
                                                                                        e.target.value = '';
                                                                                    }
                                                                                }}
                                                                            />
                                                                            <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                                                匹配到这些关键词时视为「处理中」，会继续等待最终结果
                                                                            </p>
                                                                        </div>

                                                                        {/* ── Quota & Cooldown ── */}
                                                                        <div style={{
                                                                            marginTop: '12px', padding: '12px',
                                                                            borderRadius: '8px', border: '1px solid var(--border)',
                                                                            background: 'var(--bg-secondary)'
                                                                        }}>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                                                                                <span style={{ fontSize: '13px' }}>⚙️</span>
                                                                                <span style={{ fontWeight: 700, fontSize: '12px' }}>配额 & 冷却配置</span>
                                                                            </div>
                                                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                                                                                <div>
                                                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>配额正则 (quota.remainingPattern)</label>
                                                                                    <input type="text" className="input"
                                                                                        value={bot.quota?.remainingPattern || ''}
                                                                                        onChange={e => setConfig(prev => {
                                                                                            const newBots = [...(prev.verification?.singleBots || [])];
                                                                                            newBots[idx] = { ...newBots[idx], quota: { ...newBots[idx].quota, remainingPattern: e.target.value } };
                                                                                            return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                        })}
                                                                                        placeholder="(\\d+)\\s+VERIFICATIONS?\\s+REMAINING"
                                                                                        style={{ width: '100%', boxSizing: 'border-box', fontSize: '11px', fontFamily: 'monospace' }}
                                                                                    />
                                                                                </div>
                                                                                <div>
                                                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>冷却关键词 (cooldown.keywords)</label>
                                                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                                                                        {(bot.cooldown?.keywords || []).map((ck, ci) => (
                                                                                            <span key={ci} style={{
                                                                                                display: 'inline-flex', alignItems: 'center', gap: '3px',
                                                                                                padding: '2px 8px', fontSize: '11px', fontWeight: 600, fontFamily: 'monospace',
                                                                                                background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                                                                                                borderRadius: '10px', border: '1px solid rgba(239,68,68,0.2)'
                                                                                            }}>
                                                                                                {ck}
                                                                                                <span style={{ cursor: 'pointer', fontSize: '12px', lineHeight: 1 }}
                                                                                                    onClick={() => setConfig(prev => {
                                                                                                        const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                        const cd = { ...(newBots[idx].cooldown || {}) };
                                                                                                        const newCks = [...(cd.keywords || [])];
                                                                                                        newCks.splice(ci, 1);
                                                                                                        cd.keywords = newCks;
                                                                                                        newBots[idx] = { ...newBots[idx], cooldown: cd };
                                                                                                        return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                                    })}>×</span>
                                                                                            </span>
                                                                                        ))}
                                                                                    </div>
                                                                                    <input type="text" className="input"
                                                                                        placeholder="输入关键词后按 Enter"
                                                                                        style={{ width: '100%', boxSizing: 'border-box', fontSize: '11px', fontFamily: 'monospace' }}
                                                                                        onKeyDown={e => {
                                                                                            if (e.key === 'Enter' && e.target.value.trim()) {
                                                                                                const val = e.target.value.trim();
                                                                                                setConfig(prev => {
                                                                                                    const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                    const cd = { ...(newBots[idx].cooldown || {}) };
                                                                                                    cd.keywords = [...(cd.keywords || []), val];
                                                                                                    newBots[idx] = { ...newBots[idx], cooldown: cd };
                                                                                                    return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                                });
                                                                                                e.target.value = '';
                                                                                            }
                                                                                        }}
                                                                                    />
                                                                                </div>
                                                                                <div>
                                                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>冷却时间正则 (cooldown.timePattern)</label>
                                                                                    <input type="text" className="input"
                                                                                        value={bot.cooldown?.timePattern || ''}
                                                                                        onChange={e => setConfig(prev => {
                                                                                            const newBots = [...(prev.verification?.singleBots || [])];
                                                                                            const cd = { ...(newBots[idx].cooldown || {}) };
                                                                                            cd.timePattern = e.target.value;
                                                                                            newBots[idx] = { ...newBots[idx], cooldown: cd };
                                                                                            return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                        })}
                                                                                        placeholder="(\\d+)\\s*M"
                                                                                        style={{ width: '100%', boxSizing: 'border-box', fontSize: '11px', fontFamily: 'monospace' }}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        </div>

                                                                        {/* ── SingleBot: Retries & Timeout ── */}
                                                                        <div style={{
                                                                            marginTop: '12px', padding: '12px',
                                                                            borderRadius: '8px', border: '1px solid var(--border)',
                                                                            background: 'var(--bg-secondary)'
                                                                        }}>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                                                                                <span style={{ fontSize: '13px' }}>🔄</span>
                                                                                <span style={{ fontWeight: 700, fontSize: '12px' }}>重试 & 超时配置</span>
                                                                            </div>
                                                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                                                                <div>
                                                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>最大重试 (maxRetries)</label>
                                                                                    <input type="number" className="input"
                                                                                        value={bot.maxRetries ?? 5}
                                                                                        onChange={e => setConfig(prev => {
                                                                                            const newBots = [...(prev.verification?.singleBots || [])];
                                                                                            newBots[idx] = { ...newBots[idx], maxRetries: parseInt(e.target.value) || 5 };
                                                                                            return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                        })}
                                                                                        min="1" max="20"
                                                                                        style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                                                                    />
                                                                                </div>
                                                                                <div>
                                                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>超时时间 (timeout)</label>
                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                                        <input type="number" className="input"
                                                                                            value={bot.timeout ?? 180}
                                                                                            onChange={e => setConfig(prev => {
                                                                                                const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                newBots[idx] = { ...newBots[idx], timeout: parseInt(e.target.value) || 180 };
                                                                                                return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                            })}
                                                                                            min="30" max="600"
                                                                                            style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                                                                        />
                                                                                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>秒</span>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </details>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Region Mode Settings - Template providers only */}
                            {!['getgem', 'batch_api', 'telegram'].includes(aiProvider) && (
                                <div className="provider-settings region-settings" style={{ marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '24px' }}>
                                    <h4>🌍 验证地区配置</h4>
                                    <p className="settings-desc" style={{ marginBottom: '16px' }}>
                                        选择生成验证文档时使用的学校地区范围
                                    </p>
                                    <div className="settings-form">
                                        <div className="input-group">
                                            <label className="input-label">地区模式</label>
                                            <select
                                                className="input"
                                                value={regionMode}
                                                onChange={(e) => setRegionMode(e.target.value)}
                                            >
                                                <option value="us_only">🇺🇸 仅美国学校 (US Only)</option>
                                                <option value="global">🌏 全球学校 (Global)</option>
                                            </select>
                                            <p className="input-hint">
                                                {regionMode === 'us_only'
                                                    ? '仅使用美国学校生成验证文档，更稳定的验证通过率'
                                                    : '随机选择全球学校生成验证文档，包括美国、欧洲、亚洲等地区'}
                                            </p>
                                        </div>
                                        <div className="input-group" style={{ marginTop: '16px' }}>
                                            <label className="input-label">学校来源</label>
                                            <select
                                                className="input"
                                                value={universitySource}
                                                onChange={(e) => setUniversitySource(e.target.value)}
                                            >
                                                <option value="sheerid_api">🔗 SheerID API 动态获取</option>
                                                <option value="custom_list">📋 自定义名单 (本地列表)</option>
                                            </select>
                                            <p className="input-hint">
                                                {universitySource === 'sheerid_api'
                                                    ? '从 SheerID API 实时获取学校列表，确保 ID 准确匹配'
                                                    : '使用预设的高成功率学校名单 (来自 ThanhNguyxn)，不依赖 API'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Proxy Settings - Template providers only */}
                            {!['getgem', 'batch_api', 'telegram'].includes(aiProvider) && (
                                <div className="provider-settings proxy-settings" style={{ marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '24px' }}>
                                    <h4>🌐 住宅代理配置 (Residential Proxy)</h4>
                                    <p className="settings-desc" style={{ marginBottom: '16px' }}>
                                        配置住宅代理可有效防止 SheerID 的 IP 风控检测 (fraudRulesReject)
                                    </p>
                                    <div className="settings-form">
                                        <div className="input-group">
                                            <label className="input-label">
                                                <input
                                                    type="checkbox"
                                                    checked={proxySettings.enabled}
                                                    onChange={(e) => setProxySettings(s => ({ ...s, enabled: e.target.checked }))}
                                                    style={{ marginRight: '8px' }}
                                                />
                                                启用代理
                                            </label>
                                        </div>
                                        {proxySettings.enabled && (
                                            <>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '12px' }}>
                                                    <div className="input-group">
                                                        <label className="input-label">代理主机 (Host)</label>
                                                        <input
                                                            type="text"
                                                            className="input"
                                                            value={proxySettings.host}
                                                            onChange={(e) => setProxySettings(s => ({ ...s, host: e.target.value }))}
                                                            placeholder="proxy.global.ip2up.com"
                                                        />
                                                    </div>
                                                    <div className="input-group">
                                                        <label className="input-label">端口 (Port)</label>
                                                        <input
                                                            type="text"
                                                            className="input"
                                                            value={proxySettings.port}
                                                            onChange={(e) => setProxySettings(s => ({ ...s, port: e.target.value }))}
                                                            placeholder="12348"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="input-group">
                                                    <label className="input-label">用户名 (Username)</label>
                                                    <input
                                                        type="text"
                                                        className="input"
                                                        value={proxySettings.user}
                                                        onChange={(e) => setProxySettings(s => ({ ...s, user: e.target.value, hasStoredCredentials: false }))}
                                                        placeholder={proxySettings.hasStoredCredentials ? "••••••••••（已保存，留空保持不变）" : "hW32EF_200_0_0_..."}
                                                    />
                                                    <p className="input-hint">
                                                        ip2up 格式: <code>[account]_[country]_[province]_[city]_[session]_[sessionTime]_[flag]</code>
                                                    </p>
                                                </div>
                                                <div className="input-group">
                                                    <label className="input-label">密码 (Password)</label>
                                                    <input
                                                        type="password"
                                                        className="input"
                                                        value={proxySettings.password}
                                                        onChange={(e) => setProxySettings(s => ({ ...s, password: e.target.value, hasStoredCredentials: false }))}
                                                        placeholder={proxySettings.hasStoredCredentials ? "••••••••••（已保存，留空保持不变）" : ""}
                                                    />
                                                    {proxySettings.hasStoredCredentials && (
                                                        <p className="input-hint">
                                                            <span className="key-stored">✓ 代理凭据已保存</span>
                                                        </p>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Test & Save Buttons */}
                            <div className="settings-actions">
                                <button
                                    className="btn btn-secondary"
                                    onClick={handleTestConnection}
                                    disabled={testing}
                                >
                                    {testing ? '测试中...' : '🔌 测试连接'}
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    onClick={handleTestDocument}
                                    disabled={testingDocument}
                                >
                                    {testingDocument ? '生成中...' : '🖼️ 测试文档生成'}
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleSaveAiConfig}
                                    disabled={saving}
                                >
                                    {saving ? '保存中...' : '💾 保存配置'}
                                </button>
                                {showSaveNotice && (
                                    <span className="save-notice">✓ 已保存</span>
                                )}
                            </div>

                            {/* Test Result */}
                            {testResult && (
                                <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                                    <span className="test-icon">{testResult.success ? '✅' : '❌'}</span>
                                    <span className="test-message">{testResult.message}</span>
                                </div>
                            )}

                            {/* Test Document Result */}
                            {testDocumentResult && (
                                <div className="test-document-result">
                                    <h4>📄 文档生成测试结果</h4>
                                    {testDocumentResult.success ? (
                                        <div className="test-document-content">
                                            {/* Display all generated documents */}
                                            <div className="test-document-images" style={{
                                                display: 'grid',
                                                gridTemplateColumns: testDocumentResult.images?.length > 1 ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr',
                                                gap: '16px',
                                                marginBottom: '20px'
                                            }}>
                                                {(testDocumentResult.images || [{ image: testDocumentResult.image, filename: testDocumentResult.filename, type: 'document' }]).map((doc, idx) => (
                                                    <div key={idx} className="test-document-image" style={{
                                                        background: '#f8f9fa',
                                                        borderRadius: '12px',
                                                        padding: '12px',
                                                        textAlign: 'center'
                                                    }}>
                                                        <div style={{
                                                            fontSize: '12px',
                                                            color: '#667eea',
                                                            fontWeight: 600,
                                                            marginBottom: '8px',
                                                            textTransform: 'uppercase'
                                                        }}>
                                                            {doc.type === 'id_card' ? '🪪 学生卡' :
                                                                doc.type === 'transcript' ? '📜 成绩单' :
                                                                    doc.type === 'class_schedule' ? '📅 课程表' :
                                                                        doc.type === 'schedule' ? '📅 课程表' : '📄 文档'}
                                                        </div>
                                                        {(doc.filename?.endsWith('.pdf') || doc.image?.startsWith('data:application/pdf')) ? (
                                                            <div>
                                                                <embed
                                                                    src={doc.image}
                                                                    type="application/pdf"
                                                                    style={{
                                                                        width: '100%',
                                                                        height: '400px',
                                                                        borderRadius: '8px',
                                                                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                                                                    }}
                                                                />
                                                                <a
                                                                    href={doc.image}
                                                                    download={doc.filename || 'document.pdf'}
                                                                    style={{
                                                                        display: 'inline-block',
                                                                        marginTop: '8px',
                                                                        padding: '6px 16px',
                                                                        background: '#667eea',
                                                                        color: '#fff',
                                                                        borderRadius: '6px',
                                                                        fontSize: '12px',
                                                                        textDecoration: 'none',
                                                                        fontWeight: 600
                                                                    }}
                                                                >📥 下载 PDF</a>
                                                            </div>
                                                        ) : (
                                                            <img
                                                                src={doc.image}
                                                                alt={doc.type || 'Generated Document'}
                                                                style={{
                                                                    maxWidth: '100%',
                                                                    maxHeight: '300px',
                                                                    borderRadius: '8px',
                                                                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                                                                }}
                                                            />
                                                        )}
                                                        <p className="filename" style={{
                                                            marginTop: '8px',
                                                            fontSize: '12px',
                                                            color: '#666'
                                                        }}>{doc.filename}</p>
                                                    </div>
                                                ))}
                                            </div>
                                            {/* Form data */}
                                            <div className="test-document-form-data" style={{
                                                background: 'linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%)',
                                                borderRadius: '8px',
                                                padding: '12px 16px'
                                            }}>
                                                <h5 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#667eea' }}>
                                                    📝 表单数据 (将提交到 SheerID)
                                                </h5>
                                                <table className="form-data-table" style={{ width: '100%', fontSize: '13px' }}>
                                                    <tbody>
                                                        {Object.entries(testDocumentResult.formData || {})
                                                            .filter(([key]) => ['firstName', 'lastName', 'university', 'birthDate', 'dob', 'email', 'studentId'].includes(key))
                                                            .map(([key, value]) => (
                                                                <tr key={key}>
                                                                    <td style={{ padding: '4px 8px', color: '#666', fontWeight: 500, width: '120px' }}>{key}</td>
                                                                    <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{value}</td>
                                                                </tr>
                                                            ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="test-result error">
                                            <span className="test-icon">❌</span>
                                            <span className="test-message">{testDocumentResult.message}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Info Card */}
                        <div className="settings-section card">
                            <h3>💡 说明</h3>
                            <div className="info-content">
                                <p><strong>🎨 Puppeteer HTML 模板（推荐）：</strong>使用 Puppeteer 渲染自定义 HTML 模板生成高质量学生证图片，支持 Gemini AI 生成逼真的学生证件照，效果最佳。</p>
                                <p><strong>Gemini 官方 API：</strong>直接调用 Google Gemini API 生成学生证图像，需要有效的 API Key。</p>
                                <p><strong>batch.1key.me API：</strong>使用第三方批量验证 API，需要配置 API Key。</p>
                                <p className="info-warning">⚠️ 如果 AI 生成失败，系统会自动回退到备用生成方式。</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Verify Status Tab */}
                {activeTab === 'verify-status' && (
                    <div className="tab-content">
                        {/* Live Grid Preview */}
                        <div className="settings-section card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <h3 style={{ margin: 0 }}>📋 实时验证状态</h3>
                                <div style={{ display: 'flex', gap: '14px', fontSize: '13px' }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
                                        {historyStats.pass} Pass
                                    </span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }}></span>
                                        {historyStats.failed} Failed
                                    </span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#94a3b8', display: 'inline-block' }}></span>
                                        {historyStats.cancel} Cancel
                                    </span>
                                </div>
                            </div>
                            <div className="status-grid-container">
                                <div className="status-grid three-rows">
                                    {historyData.slice(-60).map((item) => (
                                        <div
                                            key={item.id}
                                            className={`status-block ${item.status}`}
                                            onMouseEnter={() => setHoveredStatusItem(item)}
                                            onMouseLeave={() => setHoveredStatusItem(null)}
                                        >
                                            {hoveredStatusItem?.id === item.id && (
                                                <div className="status-tooltip">
                                                    <span className="tooltip-status">
                                                        {item.status === 'pass' ? '✓ Pass' :
                                                            item.status === 'failed' ? '✕ Failed' :
                                                                item.status === 'processing' ? '⏳ Processing' : '◷ Cancel'}
                                                    </span>
                                                    <span className="tooltip-time">{item.timestamp?.split('T')[1]?.slice(0, 8) || ''}</span>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {historyData.length === 0 && (
                                <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px', padding: '20px 0' }}>暂无验证记录</p>
                            )}
                        </div>

                        {/* Controls */}
                        <div className="settings-section card">
                            <h3>➕ 添加记录</h3>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '12px' }}>
                                <input
                                    type="number"
                                    min="1"
                                    max="50"
                                    value={addCount}
                                    onChange={(e) => setAddCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                                    className="input"
                                    style={{ width: '70px', textAlign: 'center' }}
                                />
                                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>条</span>
                                {[
                                    { status: 'pass', label: '✅ Pass', color: '#10b981' },
                                    { status: 'failed', label: '❌ Failed', color: '#ef4444' },
                                    { status: 'cancel', label: '◷ Cancel', color: '#94a3b8' },
                                ].map(item => (
                                    <button
                                        key={item.status}
                                        disabled={addingStatus !== null}
                                        className="btn btn-sm"
                                        style={{
                                            background: addingStatus === item.status ? '#999' : item.color,
                                            color: '#fff',
                                            border: 'none',
                                            padding: '6px 14px',
                                            borderRadius: '6px',
                                            fontSize: '12px',
                                            fontWeight: 600,
                                            cursor: addingStatus !== null ? 'not-allowed' : 'pointer',
                                            opacity: addingStatus !== null && addingStatus !== item.status ? 0.5 : 1
                                        }}
                                        onClick={async () => {
                                            if (addingStatus !== null) return;
                                            setAddingStatus(item.status);
                                            try {
                                                const res = await fetch(`${API_BASE}/api/verify/history`, {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ status: item.status, count: addCount })
                                                });
                                                if (res.ok) {
                                                    const data = await res.json();
                                                    // Re-fetch to get accurate grid
                                                    const hRes = await fetch(`${API_BASE}/api/verify/history`);
                                                    if (hRes.ok) {
                                                        const hData = await hRes.json();
                                                        setHistoryData(hData.history || []);
                                                        setHistoryStats(hData.stats || { pass: 0, failed: 0, processing: 0, cancel: 0, total: 0 });
                                                    }
                                                }
                                            } catch (e) {
                                                alert('添加失败: ' + e.message);
                                            } finally {
                                                setAddingStatus(null);
                                            }
                                        }}
                                    >
                                        {addingStatus === item.status ? '...' : item.label}
                                    </button>
                                ))}
                            </div>

                            {/* Clear All */}
                            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border, #e2ddd8)' }}>
                                <button
                                    className="btn btn-sm"
                                    disabled={addingStatus !== null}
                                    style={{
                                        background: 'transparent',
                                        color: '#ef4444',
                                        border: '1px solid #ef4444',
                                        padding: '6px 16px',
                                        borderRadius: '6px',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        cursor: 'pointer'
                                    }}
                                    onClick={async () => {
                                        if (!confirm('确定要清空所有验证状态记录吗？此操作不可撤销。')) return;
                                        try {
                                            const res = await fetch(`${API_BASE}/api/verify/history`, { method: 'DELETE' });
                                            if (res.ok) {
                                                const data = await res.json();
                                                setHistoryData([]);
                                                setHistoryStats({ pass: 0, failed: 0, processing: 0, cancel: 0, total: 0 });
                                            }
                                        } catch (e) {
                                            alert('清空失败: ' + e.message);
                                        }
                                    }}
                                >
                                    🗑️ 清空所有记录
                                </button>
                                <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    共 {historyStats.total || 0} 条记录
                                </span>
                            </div>
                        </div>

                        {/* Auto Record Rules */}
                        <div className="settings-section card">
                            <h3>⏱️ 自动添加记录</h3>
                            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 16px' }}>
                                配置自动添加规则，规则持久化保存，重启后自动恢复
                            </p>

                            {/* Existing rules list */}
                            {autoRules.length > 0 && (
                                <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {autoRules.map(rule => (
                                        <div key={rule.id} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '10px 14px',
                                            background: rule.enabled ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-secondary)',
                                            border: `1px solid ${rule.enabled ? 'rgba(16, 185, 129, 0.25)' : 'var(--border-primary)'}`,
                                            borderRadius: '8px'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <span style={{
                                                    width: 8, height: 8, borderRadius: '50%',
                                                    background: rule.running ? '#10b981' : '#94a3b8',
                                                    display: 'inline-block'
                                                }}></span>
                                                <span style={{ fontSize: '13px', fontWeight: 500 }}>
                                                    每 {rule.intervalMinutes || Math.round((rule.intervalSeconds || 60) / 60)} 分钟 → {rule.status === 'pass' ? '✅ Pass' : rule.status === 'failed' ? '❌ Failed' : '◷ Cancel'}
                                                </span>
                                                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                                    {rule.running ? '运行中' : '已停止'}
                                                    {rule.durationHours > 0 && (
                                                        rule.running && rule.remainingHours != null
                                                            ? ` · 剩余 ${rule.remainingHours}h`
                                                            : ` · 时效 ${rule.durationHours}h`
                                                    )}
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button
                                                    className="btn btn-sm"
                                                    style={{
                                                        background: rule.enabled ? '#f59e0b' : '#10b981',
                                                        color: '#fff',
                                                        border: 'none',
                                                        padding: '4px 12px',
                                                        borderRadius: '5px',
                                                        fontSize: '11px',
                                                        fontWeight: 600,
                                                        cursor: 'pointer'
                                                    }}
                                                    onClick={async () => {
                                                        try {
                                                            const res = await fetch(`${API_BASE}/api/verify/auto-record/${rule.id}`, {
                                                                method: 'PUT',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({ enabled: !rule.enabled })
                                                            });
                                                            if (res.ok) {
                                                                const listRes = await fetch(`${API_BASE}/api/verify/auto-record`);
                                                                if (listRes.ok) setAutoRules((await listRes.json()).rules || []);
                                                            }
                                                        } catch (e) { alert(e.message); }
                                                    }}
                                                >
                                                    {rule.enabled ? '⏸ 停止' : '▶ 启动'}
                                                </button>
                                                <button
                                                    className="btn btn-sm"
                                                    style={{
                                                        background: 'transparent',
                                                        color: '#ef4444',
                                                        border: '1px solid #ef4444',
                                                        padding: '4px 10px',
                                                        borderRadius: '5px',
                                                        fontSize: '11px',
                                                        fontWeight: 600,
                                                        cursor: 'pointer'
                                                    }}
                                                    onClick={async () => {
                                                        if (!confirm('删除此规则？')) return;
                                                        try {
                                                            await fetch(`${API_BASE}/api/verify/auto-record/${rule.id}`, { method: 'DELETE' });
                                                            const listRes = await fetch(`${API_BASE}/api/verify/auto-record`);
                                                            if (listRes.ok) setAutoRules((await listRes.json()).rules || []);
                                                        } catch (e) { alert(e.message); }
                                                    }}
                                                >
                                                    🗑
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Add new rule */}
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', paddingTop: autoRules.length > 0 ? '12px' : 0, borderTop: autoRules.length > 0 ? '1px solid var(--border-primary)' : 'none' }}>
                                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>新规则：每</span>
                                <input
                                    type="number"
                                    min="1"
                                    max="60"
                                    value={newRule.intervalMinutes}
                                    onChange={(e) => setNewRule(prev => ({ ...prev, intervalMinutes: Math.max(1, parseInt(e.target.value) || 5) }))}
                                    className="input"
                                    style={{ width: '65px', textAlign: 'center' }}
                                />
                                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>分钟 添加</span>
                                <select
                                    className="input"
                                    value={newRule.status}
                                    onChange={(e) => setNewRule(prev => ({ ...prev, status: e.target.value }))}
                                    style={{ width: '110px', cursor: 'pointer' }}
                                >
                                    <option value="pass">✅ Pass</option>
                                    <option value="failed">❌ Failed</option>
                                    <option value="cancel">◷ Cancel</option>
                                </select>
                                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>时效</span>
                                <input
                                    type="number"
                                    min="0"
                                    max="72"
                                    step="1"
                                    value={newRule.durationHours}
                                    onChange={(e) => setNewRule(prev => ({ ...prev, durationHours: Math.max(0, parseFloat(e.target.value) || 0) }))}
                                    className="input"
                                    style={{ width: '65px', textAlign: 'center' }}
                                />
                                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>小时</span>
                                <button
                                    className="btn btn-sm"
                                    disabled={savingRule}
                                    style={{
                                        background: '#10b981',
                                        color: '#fff',
                                        border: 'none',
                                        padding: '6px 16px',
                                        borderRadius: '6px',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        cursor: 'pointer'
                                    }}
                                    onClick={async () => {
                                        setSavingRule(true);
                                        try {
                                            const res = await fetch(`${API_BASE}/api/verify/auto-record`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify(newRule)
                                            });
                                            if (res.ok) {
                                                const listRes = await fetch(`${API_BASE}/api/verify/auto-record`);
                                                if (listRes.ok) setAutoRules((await listRes.json()).rules || []);
                                            }
                                        } catch (e) {
                                            alert('添加失败: ' + e.message);
                                        } finally {
                                            setSavingRule(false);
                                        }
                                    }}
                                >
                                    {savingRule ? '...' : '➕ 添加规则'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Telegram Bot Tab */}
                {activeTab === 'telegram-bot' && (
                    <TelegramBotTab />
                )}

                {/* Settings Tab */}
                {activeTab === 'settings' && (
                    <div className="tab-content">

                        {/* Browser Mode - only shown when provider is not telegram */}
                        {aiProvider !== 'telegram' && (
                            <div className="settings-section card">
                                <h3>⚡ 验证模式</h3>
                                <p className="settings-desc">
                                    选择验证请求的发送方式。API 模式速度快，浏览器模式使用 Chromium 模拟真实浏览器，更不容易被检测。
                                </p>
                                <div className="settings-form">
                                    <div className="mode-selector" style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                                        <div
                                            onClick={() => setBrowserMode(false)}
                                            style={{
                                                flex: 1, padding: '16px', borderRadius: '12px', cursor: 'pointer',
                                                border: !browserMode ? '2px solid #7c5cfc' : '2px solid #e2e8f0',
                                                background: !browserMode ? 'linear-gradient(135deg, #f0ecff 0%, #e8e0ff 100%)' : '#f8fafc',
                                                transition: 'all 0.2s ease'
                                            }}
                                        >
                                            <div style={{ fontSize: '24px', marginBottom: '8px' }}>⚡</div>
                                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>API 模式</div>
                                            <div style={{ fontSize: '12px', color: '#64748b' }}>标准 HTTP 请求，速度快</div>
                                        </div>
                                        <div
                                            onClick={() => setBrowserMode(true)}
                                            style={{
                                                flex: 1, padding: '16px', borderRadius: '12px', cursor: 'pointer',
                                                border: browserMode ? '2px solid #7c5cfc' : '2px solid #e2e8f0',
                                                background: browserMode ? 'linear-gradient(135deg, #f0ecff 0%, #e8e0ff 100%)' : '#f8fafc',
                                                transition: 'all 0.2s ease'
                                            }}
                                        >
                                            <div style={{ fontSize: '24px', marginBottom: '8px' }}>🌐</div>
                                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>浏览器模式</div>
                                            <div style={{ fontSize: '12px', color: '#64748b' }}>Chromium 模拟真实浏览器</div>
                                        </div>
                                    </div>
                                    <button className="btn btn-primary" onClick={handleSaveAiConfig} disabled={saving}>
                                        {saving ? '保存中...' : '保存'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {aiProvider === 'telegram' && (
                            <div className="settings-section card">
                                <h3>🤖 Bot 验证</h3>
                                <p className="settings-desc">
                                    当前使用 Bot 进行验证，无需选择验证模式。链接将直接发送给 Bot 处理。
                                </p>
                            </div>
                        )}

                        {/* Maintenance Mode Card */}
                        <div className="settings-section card" style={{
                            border: maintenanceEnabled ? '2px solid #ef4444' : '2px solid transparent',
                            transition: 'all 0.3s ease',
                            overflow: 'hidden',
                            padding: 0
                        }}>
                            {/* Status Banner */}
                            <div style={{
                                padding: '14px 20px',
                                background: maintenanceEnabled
                                    ? 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)'
                                    : 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                                borderBottom: '1px solid',
                                borderColor: maintenanceEnabled ? '#fecaca' : '#bbf7d0',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                transition: 'all 0.3s ease'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span style={{
                                        width: '10px', height: '10px', borderRadius: '50%',
                                        background: maintenanceEnabled ? '#ef4444' : '#22c55e',
                                        boxShadow: maintenanceEnabled ? '0 0 8px rgba(239,68,68,0.5)' : '0 0 8px rgba(34,197,94,0.5)',
                                        animation: maintenanceEnabled ? 'pulse 2s infinite' : 'none'
                                    }} />
                                    <span style={{
                                        fontSize: '14px', fontWeight: 600,
                                        color: maintenanceEnabled ? '#dc2626' : '#16a34a'
                                    }}>
                                        {maintenanceEnabled ? '维护模式已开启' : '网站运行正常'}
                                    </span>
                                </div>
                                {/* Toggle Switch */}
                                <div
                                    onClick={() => setMaintenanceEnabled(!maintenanceEnabled)}
                                    style={{
                                        width: '52px', height: '28px', borderRadius: '14px', cursor: 'pointer',
                                        background: maintenanceEnabled ? 'linear-gradient(135deg, #ef4444, #dc2626)' : '#d1d5db',
                                        position: 'relative', transition: 'all 0.3s ease',
                                        boxShadow: maintenanceEnabled ? '0 0 12px rgba(239,68,68,0.3)' : 'inset 0 1px 3px rgba(0,0,0,0.1)',
                                        flexShrink: 0
                                    }}
                                >
                                    <div style={{
                                        width: '22px', height: '22px', borderRadius: '50%',
                                        background: '#fff', position: 'absolute', top: '3px',
                                        left: maintenanceEnabled ? '27px' : '3px',
                                        transition: 'left 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.15)'
                                    }} />
                                </div>
                            </div>

                            {/* Card Body */}
                            <div style={{ padding: '20px 20px 0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                                    <span style={{ fontSize: '20px' }}>🚧</span>
                                    <h3 style={{ margin: 0, fontSize: '16px' }}>维护模式设置</h3>
                                </div>

                                {/* Form Fields */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    {/* Message Field */}
                                    <div>
                                        <label style={{
                                            display: 'block', fontSize: '13px', fontWeight: 500,
                                            color: 'var(--text-secondary, #64748b)', marginBottom: '6px'
                                        }}>
                                            📝 维护公告内容
                                        </label>
                                        <textarea
                                            className="input textarea"
                                            placeholder="输入将向用户显示的维护公告..."
                                            rows={3}
                                            value={maintenanceMessage}
                                            onChange={(e) => setMaintenanceMessage(e.target.value)}
                                            style={{
                                                resize: 'vertical', minHeight: '72px',
                                                fontSize: '14px', lineHeight: '1.5',
                                                width: '100%', boxSizing: 'border-box'
                                            }}
                                        />
                                    </div>

                                    {/* Estimated End Time */}
                                    <div>
                                        <label style={{
                                            display: 'block', fontSize: '13px', fontWeight: 500,
                                            color: 'var(--text-secondary, #64748b)', marginBottom: '6px'
                                        }}>
                                            🕐 预计恢复时间 <span style={{ fontWeight: 400, color: '#94a3b8' }}>（可选）</span>
                                        </label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <input
                                                type="datetime-local"
                                                className="input"
                                                value={maintenanceEstEnd ? maintenanceEstEnd.slice(0, 16) : ''}
                                                onChange={(e) => setMaintenanceEstEnd(e.target.value ? new Date(e.target.value).toISOString() : '')}
                                                style={{ flex: 1, fontSize: '14px' }}
                                            />
                                            {maintenanceEstEnd && (
                                                <button
                                                    onClick={() => setMaintenanceEstEnd('')}
                                                    style={{
                                                        background: 'none', border: 'none', cursor: 'pointer',
                                                        color: '#94a3b8', fontSize: '18px', padding: '4px',
                                                        lineHeight: 1
                                                    }}
                                                    title="清除时间"
                                                >✕</button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Action Bar */}
                            <div style={{
                                display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px',
                                padding: '16px 20px',
                                marginTop: '20px',
                                borderTop: '1px solid var(--border-color, #e2e8f0)',
                                background: 'var(--bg-secondary, #f8fafc)'
                            }}>
                                {maintenanceSaved && (
                                    <span style={{
                                        color: '#10b981', fontSize: '13px', fontWeight: 500,
                                        display: 'flex', alignItems: 'center', gap: '4px',
                                        animation: 'fadeIn 0.3s ease'
                                    }}>
                                        <span>✓</span> 已保存
                                    </span>
                                )}
                                <button
                                    onClick={handleSaveMaintenance}
                                    disabled={maintenanceSaving}
                                    style={{
                                        padding: '8px 24px',
                                        borderRadius: '8px',
                                        border: 'none',
                                        cursor: maintenanceSaving ? 'not-allowed' : 'pointer',
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        color: '#fff',
                                        background: maintenanceEnabled
                                            ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                                            : 'linear-gradient(135deg, #7c5cfc, #6d4fe8)',
                                        boxShadow: maintenanceEnabled
                                            ? '0 2px 8px rgba(239,68,68,0.3)'
                                            : '0 2px 8px rgba(124,92,252,0.3)',
                                        transition: 'all 0.2s ease',
                                        opacity: maintenanceSaving ? 0.7 : 1,
                                        display: 'flex', alignItems: 'center', gap: '6px'
                                    }}
                                >
                                    {maintenanceSaving ? (
                                        <><span className="loading-spinner small" /> 保存中...</>
                                    ) : maintenanceEnabled ? (
                                        '保存并启用维护'
                                    ) : (
                                        '保存设置'
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Tips Inline Config Card */}
                        <div className="settings-section card" style={{ overflow: 'hidden', padding: 0 }}>
                            <div style={{
                                padding: '14px 20px',
                                background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                                borderBottom: '1px solid #bfdbfe',
                                display: 'flex', alignItems: 'center', gap: '10px'
                            }}>
                                <span style={{ fontSize: '20px' }}>💡</span>
                                <h3 style={{ margin: 0, fontSize: '16px', color: '#1e40af' }}>页面提示文案配置</h3>
                                <span style={{ fontSize: '12px', color: '#60a5fa', marginLeft: 'auto' }}>显示在验证页面底部</span>
                            </div>

                            <div style={{ padding: '20px' }}>
                                <textarea
                                    className="input textarea"
                                    value={tipsContent}
                                    onChange={(e) => setTipsContent(e.target.value)}
                                    rows={4}
                                    style={{
                                        width: '100%', fontSize: '14px', boxSizing: 'border-box',
                                        resize: 'vertical', minHeight: '80px', lineHeight: '1.6'
                                    }}
                                    placeholder="输入提示内容，每行一条..."
                                />
                            </div>

                            <div style={{
                                display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px',
                                padding: '16px 20px',
                                borderTop: '1px solid var(--border-color, #e2e8f0)',
                                background: 'var(--bg-secondary, #f8fafc)'
                            }}>
                                {tipsSaved && (
                                    <span style={{
                                        color: '#10b981', fontSize: '13px', fontWeight: 500,
                                        display: 'flex', alignItems: 'center', gap: '4px',
                                        animation: 'fadeIn 0.3s ease'
                                    }}>
                                        <span>✓</span> 已保存
                                    </span>
                                )}
                                <button
                                    onClick={handleSaveTips}
                                    disabled={tipsSaving}
                                    style={{
                                        padding: '8px 24px', borderRadius: '8px', border: 'none',
                                        cursor: tipsSaving ? 'not-allowed' : 'pointer',
                                        fontSize: '14px', fontWeight: 600, color: '#fff',
                                        background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                                        boxShadow: '0 2px 8px rgba(59,130,246,0.3)',
                                        transition: 'all 0.2s ease',
                                        opacity: tipsSaving ? 0.7 : 1,
                                        display: 'flex', alignItems: 'center', gap: '6px'
                                    }}
                                >
                                    {tipsSaving ? (
                                        <><span className="loading-spinner small" /> 保存中...</>
                                    ) : '保存提示文案'}
                                </button>
                            </div>
                        </div>

                        {/* Database Backup Card */}
                        <div className="settings-section card" style={{ overflow: 'hidden', padding: 0 }}>
                            <div style={{
                                padding: '14px 20px',
                                background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                                borderBottom: '1px solid #bbf7d0',
                                display: 'flex', alignItems: 'center', gap: '10px'
                            }}>
                                <span style={{ fontSize: '20px' }}>🗄️</span>
                                <h3 style={{ margin: 0, fontSize: '16px', color: '#166534' }}>数据库备份</h3>
                                <span style={{ fontSize: '12px', color: '#4ade80', marginLeft: 'auto' }}>自动每日备份 · 保留最近 7 份</span>
                            </div>

                            <div style={{ padding: '20px' }}>
                                {backupList.length > 0 ? (
                                    <div style={{ marginBottom: '16px' }}>
                                        <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
                                                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-secondary, #64748b)' }}>文件名</th>
                                                    <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-secondary, #64748b)' }}>大小</th>
                                                    <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-secondary, #64748b)' }}>创建时间</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {backupList.map((b, i) => (
                                                    <tr key={i} style={{ borderBottom: '1px solid var(--border-color, #f1f5f9)' }}>
                                                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '12px' }}>{b.filename}</td>
                                                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>{b.sizeMB} MB</td>
                                                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>{new Date(b.createdAt).toLocaleString('zh-CN')}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <p style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: '14px', margin: '0 0 16px' }}>暂无备份记录，首次自动备份将在启动后 1 分钟内创建。</p>
                                )}
                            </div>

                            <div style={{
                                display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px',
                                padding: '16px 20px',
                                borderTop: '1px solid var(--border-color, #e2e8f0)',
                                background: 'var(--bg-secondary, #f8fafc)'
                            }}>
                                <button
                                    onClick={handleCreateBackup}
                                    disabled={backupCreating}
                                    style={{
                                        padding: '8px 20px', borderRadius: '8px', border: '1px solid var(--border-color, #d1d5db)',
                                        cursor: backupCreating ? 'not-allowed' : 'pointer',
                                        fontSize: '13px', fontWeight: 500, color: 'var(--text-primary, #334155)',
                                        background: 'var(--bg-primary, #fff)',
                                        opacity: backupCreating ? 0.7 : 1,
                                        display: 'flex', alignItems: 'center', gap: '6px'
                                    }}
                                >
                                    {backupCreating ? (
                                        <><span className="loading-spinner small" /> 备份中...</>
                                    ) : '📋 手动备份'}
                                </button>
                                <button
                                    onClick={handleDownloadBackup}
                                    disabled={backupDownloading}
                                    style={{
                                        padding: '8px 20px', borderRadius: '8px', border: 'none',
                                        cursor: backupDownloading ? 'not-allowed' : 'pointer',
                                        fontSize: '13px', fontWeight: 600, color: '#fff',
                                        background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                                        boxShadow: '0 2px 8px rgba(34,197,94,0.3)',
                                        opacity: backupDownloading ? 0.7 : 1,
                                        display: 'flex', alignItems: 'center', gap: '6px'
                                    }}
                                >
                                    {backupDownloading ? (
                                        <><span className="loading-spinner small" /> 下载中...</>
                                    ) : '⬇️ 下载备份'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div >
    );
}

