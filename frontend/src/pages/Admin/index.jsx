import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/AuthContext';
import { useLang } from '../../stores/LanguageContext';
import './Admin.css';
import '../Verify/Verify.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

const ROLE_LABELS = {
    user: '用户',
    admin: '管理员',
    support_admin: '客服/售后子管理员',
    ops_admin: '运营/代理子管理员',
    tech_admin: '技术运维子管理员',
};

const ADMIN_PERMISSION_LABELS = {
    view_users: '查看用户',
    manage_credits: '调整积分',
    view_orders: '查看订单',
    manage_cdk: '管理 CDK',
    view_logs: '查看验证记录',
    manual_override: '手动处理结果',
    manage_config: '系统配置',
    manage_nodes: '节点/通道管理',
    manage_maintenance: '维护和公告',
    super_admin: '管理员管理',
};

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
    const [logPage, setLogPage] = useState(1);
    const [logTotalPages, setLogTotalPages] = useState(1);
    const [logTotal, setLogTotal] = useState(0);
    const logPageRef = useRef(1);

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

    const fetchLog = useCallback(async (page) => {
        const p = page ?? logPageRef.current;
        try {
            const res = await fetch(`${API_BASE}/api/admin/bot-verify-log?page=${p}&pageSize=100`, { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                const apiLog = data.log || [];
                setLogTotal(data.total || 0);
                setLogTotalPages(data.totalPages || 1);
                // On page 1, merge SSE live entries; on other pages, just show API data
                if (p === 1) {
                    setBotVerifyLog(prev => {
                        const sseProcessing = prev.filter(e => (e.status === 'processing' || e.status === 'submitted') && !apiLog.some(a => a.vid === e.vid || a.link === e.link));
                        return sseProcessing.length > 0 ? [...sseProcessing, ...apiLog] : apiLog;
                    });
                } else {
                    setBotVerifyLog(apiLog);
                }
            }
        } catch (e) { console.error('Failed to fetch bot verify log:', e); }
    }, []);

    const handleLogPageChange = useCallback((newPage) => {
        const p = Math.max(1, Math.min(newPage, logTotalPages));
        setLogPage(p);
        logPageRef.current = p;
        fetchLog(p);
    }, [logTotalPages, fetchLog]);

    useEffect(() => {
        fetchBotConfig();
        fetchBotStats();
        fetchBotUsers();
        fetchBotOrders();
        fetchLog(1);
        const interval = setInterval(() => fetchLog(), 8000);
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
                // Only apply SSE live updates when viewing page 1
                if (logPageRef.current !== 1) return;

                if (data.type === 'progress') {
                    setBotVerifyLog(prev => {
                        const existingIdx = prev.findIndex(l => l.vid === data.vid || l.link === data.link);

                        // Determine status from the event
                        let entryStatus = 'processing';
                        if (data.step === 'result') {
                            entryStatus = data.success ? 'success' : (data.status === 'error' ? 'error' : 'failed');
                        } else if (data.step === 'failed') {
                            entryStatus = 'failed';
                        } else if (data.step === 'submitted') {
                            entryStatus = 'submitted';
                        }

                        const newEntry = {
                            id: existingIdx >= 0 ? prev[existingIdx].id : Date.now() + Math.random(),
                            link: data.link || '',
                            username: existingIdx >= 0 ? prev[existingIdx].username : 'SSE Update',
                            user_id: existingIdx >= 0 ? prev[existingIdx].user_id : '---',
                            status: entryStatus,
                            message: data.message || '',
                            vid: data.vid || '',
                            via: data.via || data.botType || data.source || '',
                            creditCost: data.creditCost || (existingIdx >= 0 ? prev[existingIdx].creditCost : null),
                            timestamp: new Date().toISOString()
                        };

                        if (existingIdx >= 0) {
                            const newLog = [...prev];
                            newLog[existingIdx] = { ...newLog[existingIdx], ...newEntry };
                            return newLog;
                        } else {
                            return [newEntry, ...prev];
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
                        return newLog;
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
                        <span>{t('logTotal')} <strong>{logTotal}</strong> {t('logEntries')}</span>
                        <span>|</span>
                        <span style={{ color: '#3b82f6', fontWeight: 600 }}>
                            {botVerifyLog.filter(r => r.status === 'submitted').length} 已提交
                        </span>
                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>
                            {botVerifyLog.filter(r => r.status === 'processing').length} 处理中
                        </span>
                        <span style={{ color: '#16a34a', fontWeight: 600 }}>{botVerifyLog.filter(r => r.status === 'success').length} {t('logSuccess')}</span>
                        <span style={{ color: '#dc2626', fontWeight: 600 }}>{botVerifyLog.filter(r => !['success', 'submitted', 'processing'].includes(r.status)).length} {t('logFailed')}</span>
                        <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: '13px' }}>
                            第 {logPage}/{logTotalPages} 页
                        </span>
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
                                        {isPass && r.creditCost > 0 && (
                                            <span style={{
                                                display: 'inline-block', marginTop: '4px',
                                                fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px',
                                                background: 'rgba(220, 38, 38, 0.08)', color: '#dc2626',
                                            }}>💰 扣除 {r.creditCost} 积分</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {/* Pagination Controls */}
                    {logTotalPages > 1 && (
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: '8px', marginTop: '20px', padding: '12px 0',
                            borderTop: '1px solid var(--border-color, rgba(128,128,128,0.15))',
                        }}>
                            <button
                                className="btn btn-sm btn-secondary"
                                disabled={logPage <= 1}
                                onClick={() => handleLogPageChange(1)}
                                style={{ minWidth: '36px' }}
                            >«</button>
                            <button
                                className="btn btn-sm btn-secondary"
                                disabled={logPage <= 1}
                                onClick={() => handleLogPageChange(logPage - 1)}
                                style={{ minWidth: '36px' }}
                            >‹</button>
                            {(() => {
                                const pages = [];
                                let start = Math.max(1, logPage - 2);
                                let end = Math.min(logTotalPages, logPage + 2);
                                if (end - start < 4) {
                                    if (start === 1) end = Math.min(logTotalPages, start + 4);
                                    else start = Math.max(1, end - 4);
                                }
                                for (let p = start; p <= end; p++) {
                                    pages.push(
                                        <button
                                            key={p}
                                            className={`btn btn-sm ${p === logPage ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => handleLogPageChange(p)}
                                            style={{ minWidth: '36px' }}
                                        >{p}</button>
                                    );
                                }
                                return pages;
                            })()}
                            <button
                                className="btn btn-sm btn-secondary"
                                disabled={logPage >= logTotalPages}
                                onClick={() => handleLogPageChange(logPage + 1)}
                                style={{ minWidth: '36px' }}
                            >›</button>
                            <button
                                className="btn btn-sm btn-secondary"
                                disabled={logPage >= logTotalPages}
                                onClick={() => handleLogPageChange(logTotalPages)}
                                style={{ minWidth: '36px' }}
                            >»</button>
                            <span style={{ fontSize: '13px', color: 'var(--text-secondary)', marginLeft: '12px' }}>
                                共 {logTotal} 条
                            </span>
                        </div>
                    )}
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

// ============================================================
// Live Task Monitor Component (SSE Real-time)
// ============================================================
function LiveTaskMonitor() {
    const { user } = useAuth();
    const token = user?.token || localStorage.getItem('verifykey-token');
    const [tasks, setTasks] = useState([]);
    const [filter, setFilter] = useState('all'); // 'all' | 'gemini' | 'gpt'
    const esRef = useRef(null);

    // Error code descriptions (same as user-facing)
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
        MANUAL_CANCEL: '手动取消（操作员取消）',
        INVALID_ACCOUNT: '账号信息有误（手动标记）',
        UNKNOWN_ERROR: '未知错误',
    };

    // Source label mapping
    const sourceLabels = {
        pixel: 'UPixel', pixel_auto: 'UPixel Auto', kpixel: 'KPixel', ypixel: 'YPixel',
        vpixel: 'VPixel', gpt: 'GPT充值',
    };

    const isGeminiSource = (src) => ['pixel', 'pixel_auto', 'kpixel', 'ypixel', 'vpixel'].includes(src);

    useEffect(() => {
        if (!token) return;

        // Load today's historical tasks on mount
        const loadHistory = async () => {
            try {
                const res = await fetch(`${API_BASE}/api/admin/today-tasks`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setTasks(data.tasks || []);
                }
            } catch (e) {
                console.warn('Failed to load today tasks:', e);
            }
        };
        loadHistory();

        // SSE real-time updates
        const sseUrl = `${API_BASE}/api/admin/verify-stream?authorization=Bearer ${token}`;
        const es = new EventSource(sseUrl);
        esRef.current = es;

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // Only process progress events from pixel/kpixel/ypixel/vpixel/gpt sources
                if (data.type === 'progress' && data.source) {
                    const vid = data.vid || '';
                    const source = data.source || '';
                    if (!['pixel', 'pixel_auto', 'kpixel', 'ypixel', 'vpixel', 'gpt'].includes(source)) return;

                    setTasks(prev => {
                        const key = vid || `${source}_${data.link}_${Date.now()}`;
                        const existingIdx = prev.findIndex(t => t.vid === key);

                        // Determine status
                        let status = 'processing';
                        if (data.step === 'result') {
                            status = data.success ? 'success' : 'failed';
                        } else if (data.step === 'submitted') {
                            status = 'submitted';
                        }

                        const entry = {
                            vid: key,
                            source,
                            email: data.link || '',
                            status,
                            message: data.message || '',
                            step: data.step || '',
                            stage: data.stage || 0,
                            totalStages: data.totalStages || 0,
                            stageLabel: data.stageLabel || '',
                            queuePosition: data.queuePosition ?? -1,
                            elapsed: data.elapsed || 0,
                            url: data.url || '',
                            error: data.error || '',
                            resultMsg: data.result_msg || '',
                            channel: data.channel || '',
                            userId: data.userId || '',
                            timestamp: existingIdx >= 0 ? prev[existingIdx].timestamp : new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                        };

                        if (existingIdx >= 0) {
                            const updated = [...prev];
                            updated[existingIdx] = { ...updated[existingIdx], ...entry };
                            return updated;
                        } else {
                            return [entry, ...prev].slice(0, 500);
                        }
                    });
                }
            } catch (err) {
                console.error('LiveMonitor SSE parse error:', err);
            }
        };

        es.onerror = () => { /* auto-reconnect */ };

        return () => { es.close(); };
    }, [token]);

    // Filter tasks
    const filteredTasks = tasks.filter(t => {
        if (filter === 'gemini') return isGeminiSource(t.source);
        if (filter === 'gpt') return t.source === 'gpt';
        return true;
    });

    // Stats
    const stats = {
        total: filteredTasks.length,
        processing: filteredTasks.filter(t => t.status === 'processing' || t.status === 'submitted').length,
        success: filteredTasks.filter(t => t.status === 'success').length,
        failed: filteredTasks.filter(t => t.status === 'failed').length,
    };

    const formatElapsed = (s) => s > 0 ? `${Math.round(s)}s` : '';
    const formatTs = (ts) => ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

    // Build display message — same as user-facing, stripped of leading emojis
    const getDisplayMessage = (t) => {
        let msg = (t.message || '').replace(/^[❌✅✓✕❗⚠️🔴🟢☑️☒🔄⏳◈💎⚡✨🔗\u200d\ufe0f\s]+/, '');
        if (!msg) {
            if (t.status === 'success') msg = '验证成功';
            else if (t.status === 'failed') {
                if (t.source === 'pixel' || t.source === 'pixel_auto') {
                    msg = t.resultMsg || t.error || '验证失败';
                } else {
                    msg = ERROR_DESCRIPTIONS[t.error] || t.error || '验证失败';
                }
            }
            else if (t.status === 'submitted') msg = '已提交，排队中...';
            else msg = '处理中...';
        }
        return msg;
    };

    // Build private info line
    const getPrivateInfo = (t) => {
        const parts = [];
        parts.push(`source: ${sourceLabels[t.source] || t.source}`);
        if (t.userId) parts.push(`user: ${t.userId}`);
        if (t.channel) parts.push(`channel: ${t.channel.toUpperCase()}`);
        if (t.error && t.error !== t.message) parts.push(`error_code: ${t.error}`);
        return `(${parts.join(' · ')})`;
    };

    // Source badge color
    const sourceBadge = (src) => {
        const colors = {
            pixel: { bg: 'rgba(59,130,246,0.1)', color: '#3b82f6' },
            pixel_auto: { bg: 'rgba(234,88,12,0.1)', color: '#ea580c' },
            kpixel: { bg: 'rgba(139,92,246,0.1)', color: '#7c3aed' },
            ypixel: { bg: 'rgba(245,158,11,0.1)', color: '#d97706' },
            vpixel: { bg: 'rgba(236,72,153,0.1)', color: '#db2777' },
            gpt: { bg: 'rgba(16,185,129,0.1)', color: '#059669' },
        };
        const c = colors[src] || colors.pixel;
        return (
            <span style={{
                padding: '2px 8px', borderRadius: '8px', fontWeight: 600, fontSize: '11px',
                background: c.bg, color: c.color, marginLeft: '8px',
            }}>{sourceLabels[src] || src}</span>
        );
    };

    return (
        <div className="tab-content">
            {/* Filter Buttons */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                {[{ id: 'all', label: '全部', icon: '📋' }, { id: 'gemini', label: 'Gemini 验证', icon: '📡' }, { id: 'gpt', label: 'GPT 充值', icon: '🤖' }].map(f => (
                    <button key={f.id}
                        className={`btn btn-sm ${filter === f.id ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setFilter(f.id)}
                    >{f.icon} {f.label}</button>
                ))}
                <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }}
                    onClick={() => setTasks([])}
                >🗑️ 清空</button>
            </div>

            {/* Stats Header */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px',
                fontSize: '14px', flexWrap: 'wrap', padding: '12px 16px',
                background: 'var(--bg-secondary)', borderRadius: '10px',
                border: '1px solid var(--border-primary)',
            }}>
                <span>共 <strong>{stats.total}</strong> 条</span>
                <span>|</span>
                <span style={{ color: '#f59e0b', fontWeight: 600 }}>
                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', marginRight: '4px', animation: stats.processing > 0 ? 'pulse 1.5s ease-in-out infinite' : 'none' }} />
                    {stats.processing} 处理中
                </span>
                <span style={{ color: '#16a34a', fontWeight: 600 }}>{stats.success} 成功</span>
                <span style={{ color: '#dc2626', fontWeight: 600 }}>{stats.failed} 失败</span>
            </div>

            {/* Task List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '75vh', overflowY: 'auto' }}>
                {filteredTasks.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                        <div style={{ fontSize: '48px', marginBottom: '12px' }}>📺</div>
                        <p style={{ fontSize: '15px' }}>等待用户提交任务...</p>
                        <p style={{ fontSize: '13px', marginTop: '6px', color: 'var(--text-tertiary)' }}>用户在前端提交 Gemini 验证或 GPT 充值后，任务将实时出现在这里</p>
                    </div>
                )}
                {filteredTasks.map(t => {
                    const isActive = t.status === 'processing' || t.status === 'submitted';
                    const isSuccess = t.status === 'success';
                    const isFailed = t.status === 'failed';

                    const statusColors = {
                        submitted: { bg: 'rgba(59,130,246,0.06)', border: 'rgba(59,130,246,0.15)', accent: '#3b82f6' },
                        processing: { bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.15)', accent: '#f59e0b' },
                        success: { bg: 'rgba(22,163,74,0.06)', border: 'rgba(22,163,74,0.15)', accent: '#16a34a' },
                        failed: { bg: 'rgba(220,38,38,0.06)', border: 'rgba(220,38,38,0.15)', accent: '#dc2626' },
                    };
                    const sc = statusColors[t.status] || statusColors.processing;

                    // Progress bar for UPixel (has stage/totalStages)
                    const showProgress = t.source === 'pixel' && t.totalStages > 0 && isActive;
                    const progressPct = showProgress ? Math.min(Math.round((t.stage / t.totalStages) * 100), 100) : 0;

                    return (
                        <div key={t.vid} style={{
                            display: 'flex', alignItems: 'flex-start', gap: '14px',
                            padding: '14px 18px', borderRadius: '12px',
                            background: sc.bg, border: `1px solid ${sc.border}`,
                            transition: 'all 0.2s ease',
                        }}>
                            {/* Status Icon */}
                            <div style={{
                                width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                                background: sc.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: '#fff', fontSize: '14px', fontWeight: 700, marginTop: '2px',
                                ...(isActive ? { animation: 'pulse 1.5s ease-in-out infinite' } : {}),
                            }}>
                                {isSuccess ? '✓' : isFailed ? '✕' : t.status === 'submitted' ? '◌' : '◎'}
                            </div>

                            {/* Content */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                {/* Top Row: Email + Source Badge */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                                            {t.email}
                                        </span>
                                        {sourceBadge(t.source)}
                                        {t.cost > 0 && (() => {
                                            let cBg, cColor, cBorder, cText;
                                            const isProc = t.status === 'processing' || t.status === 'submitted';
                                            if (isProc) {
                                                cBg = 'rgba(245, 158, 11, 0.1)'; cColor = '#d97706'; cBorder = '1px solid rgba(245, 158, 11, 0.2)';
                                                cText = `预扣 ${t.cost} 积分`;
                                            } else if (t.status === 'success') {
                                                cBg = 'rgba(22, 163, 74, 0.1)'; cColor = '#16a34a'; cBorder = '1px solid rgba(22, 163, 74, 0.2)';
                                                cText = `实扣 ${t.cost} 积分`;
                                            } else {
                                                // For live stream, if it failed it's virtually guaranteed refunded by the state machine
                                                const definitelyRefunded = t.isRefunded === 1 || t.status === 'failed';
                                                if (definitelyRefunded) {
                                                    cBg = 'rgba(16, 185, 129, 0.1)'; cColor = '#059669'; cBorder = '1px solid rgba(16, 185, 129, 0.2)';
                                                    cText = `已退 ${t.cost} 积分`;
                                                } else {
                                                    cBg = 'rgba(244, 63, 94, 0.1)'; cColor = '#e11d48'; cBorder = '1px solid rgba(244, 63, 94, 0.2)';
                                                    cText = `未退 ${t.cost} 积分`;
                                                }
                                            }
                                            return (
                                                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: cBg, color: cColor, border: cBorder, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '2px', marginLeft: '6px' }}>
                                                    💰 {cText}
                                                </span>
                                            );
                                        })()}
                                        {isActive && (
                                            <span style={{
                                                fontSize: '11px', padding: '1px 8px', borderRadius: '10px',
                                                background: sc.accent, color: '#fff', fontWeight: 600,
                                            }}>
                                                {t.status === 'submitted' ? '已提交' : '处理中'}
                                            </span>
                                        )}
                                    </div>
                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                        {formatTs(t.updatedAt || t.timestamp)}
                                    </span>
                                </div>

                                {/* Progress Message — same as user-facing */}
                                <div style={{ fontSize: '13px', fontWeight: 600, color: sc.accent, marginTop: '4px', wordBreak: 'break-all' }}>
                                    {getDisplayMessage(t)}
                                </div>

                                {/* UPixel Progress Bar */}
                                {showProgress && (
                                    <div style={{ marginTop: '6px' }}>
                                        <div style={{
                                            height: '4px', borderRadius: '2px', background: 'rgba(0,0,0,0.08)',
                                            overflow: 'hidden',
                                        }}>
                                            <div style={{
                                                width: `${progressPct}%`, height: '100%',
                                                background: sc.accent, borderRadius: '2px',
                                                transition: 'width 0.5s ease',
                                            }} />
                                        </div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                            [{t.stage}/{t.totalStages}] {t.stageLabel}
                                        </div>
                                    </div>
                                )}

                                {/* Success URL */}
                                {isSuccess && t.url && (
                                    <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <a href={t.url} target="_blank" rel="noopener noreferrer"
                                            style={{ fontSize: '13px', color: '#6366f1', wordBreak: 'break-all', textDecoration: 'none' }}
                                        >🔗 {t.url}</a>
                                        <button
                                            style={{
                                                background: 'rgba(99,102,241,0.1)', border: 'none', borderRadius: '6px',
                                                padding: '2px 8px', cursor: 'pointer', fontSize: '12px', color: '#6366f1',
                                            }}
                                            onClick={() => navigator.clipboard.writeText(t.url)}
                                        >📋</button>
                                    </div>
                                )}

                                {/* Credit Cost */}
                                {isSuccess && t.creditCost > 0 && (
                                    <span style={{
                                        display: 'inline-block', marginTop: '4px',
                                        fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px',
                                        background: 'rgba(220, 38, 38, 0.08)', color: '#dc2626',
                                    }}>💰 扣除 {t.creditCost} 积分</span>
                                )}

                                {/* Private Info (parenthesized) */}
                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px', fontFamily: "'SF Mono', 'Menlo', monospace" }}>
                                    {getPrivateInfo(t)}
                                </div>

                                {/* Elapsed Time */}
                                {t.elapsed > 0 && (
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', display: 'inline-block' }}>⏱️ {formatElapsed(t.elapsed)}</span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ============================================================
// Pixel API Tab Component
// ============================================================
// ==========================================
// GPT Keys Management Tab
// ==========================================
function GptKeysTab({ config, setConfig }) {
    const { user } = useAuth();
    const token = user?.token || localStorage.getItem('verifykey-token');
    const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

    const [stats, setStats] = useState({ total: 0, available: 0, used: 0, channels: {} });
    const [keys, setKeys] = useState([]);
    const [keySearch, setKeySearch] = useState('');
    const [keyPage, setKeyPage] = useState(1);
    const [newKeys, setNewKeys] = useState('');
    const [adding, setAdding] = useState(false);
    const [addResult, setAddResult] = useState(null);
    const [addChannel, setAddChannel] = useState('sbs');
    const [gptMaint, setGptMaint] = useState({ gpt_sbs: false, gpt_red: false, gpt_vip: false, gpt_tg: false, gpt_api: false });
    const [plusApiCfg, setPlusApiCfg] = useState({ enabled: false, baseUrl: '', apiKey: '' });
    const [plusApiSaving, setPlusApiSaving] = useState(false);
    const [plusApiSaved, setPlusApiSaved] = useState(false);
    const [plusApiBalance, setPlusApiBalance] = useState(null);
    const [plusApiBalanceLoading, setPlusApiBalanceLoading] = useState(false);
    const [tgAccounts, setTgAccounts] = useState([]);
    const [tgPoolSavingId, setTgPoolSavingId] = useState(null);
    const [newProcessingKw, setNewProcessingKw] = useState('');
    const [tgLoading, setTgLoading] = useState(false);
    const [tgChecking, setTgChecking] = useState(false);
    const [tgCheckResults, setTgCheckResults] = useState(null);
    const [tgShowAdd, setTgShowAdd] = useState(false);
    const [tgNewApiId, setTgNewApiId] = useState('');
    const [tgNewApiHash, setTgNewApiHash] = useState('');
    const [tgNewLabel, setTgNewLabel] = useState('');
    const [tgLoginAccountId, setTgLoginAccountId] = useState(null);
    const [tgLoginStep, setTgLoginStep] = useState('phone');
    const [tgLoginPhone, setTgLoginPhone] = useState('');
    const [tgLoginCode, setTgLoginCode] = useState('');
    const [tgLoginHash, setTgLoginHash] = useState('');
    const [tgLoginPassword, setTgLoginPassword] = useState('');
    const [tgLoginMsg, setTgLoginMsg] = useState('');
    const [gptCfgSaving, setGptCfgSaving] = useState(false);
    const [gptCfgSaved, setGptCfgSaved] = useState(false);

    useEffect(() => {
        setKeyPage(1);
    }, [keySearch]);

    const filteredKeys = keys.filter(k => 
        k.card_key.toLowerCase().includes(keySearch.toLowerCase()) || 
        (k.used_email && k.used_email.toLowerCase().includes(keySearch.toLowerCase())) ||
        (k.status && k.status.toLowerCase().includes(keySearch.toLowerCase()))
    );
    const keyTotalPages = Math.max(1, Math.ceil(filteredKeys.length / 100));
    const displayKeys = filteredKeys.slice((keyPage - 1) * 100, keyPage * 100);

    const fetchStats = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/gpt-keys/stats`, { headers: authHeaders });
            if (res.ok) setStats(await res.json());
        } catch (e) { console.error(e); }
    };

    const fetchKeys = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/gpt-keys/list`, { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                setKeys(data.keys || []);
            }
        } catch (e) { console.error(e); }
    };

    const fetchGptMaint = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/service-status`);
            if (res.ok) {
                const data = await res.json();
                if (data.manual) setGptMaint({
                    gpt_sbs: data.manual.gpt_sbs || false,
                    gpt_red: data.manual.gpt_red || false,
                    gpt_vip: data.manual.gpt_vip || false,
                    gpt_aic: data.manual.gpt_aic || false,
                    gpt_nitro: data.manual.gpt_nitro || false,
                    gpt_tg: data.manual.gpt_tg || false,
                    gpt_api: data.manual.gpt_api || false,
                });
            }
        } catch {}
    };

    const fetchTgAccounts = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/telegram/accounts`, { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                setTgAccounts(data.accounts || []);
            } else {
                console.error('Failed to fetch TG accounts:', res.status);
            }
        } catch (e) {
            console.error('Failed to fetch TG accounts:', e);
        }
    };

    const updateGptCfg = (patchOrBuilder) => {
        setConfig(prev => {
            const verification = { ...(prev?.verification || {}) };
            const current = { ...(verification.gptRechargeBot || {}) };
            const next = typeof patchOrBuilder === 'function'
                ? patchOrBuilder(current)
                : { ...current, ...patchOrBuilder };
            return { ...prev, verification: { ...verification, gptRechargeBot: next } };
        });
    };

    const handleToggleTgPool = async (acc) => {
        setTgPoolSavingId(acc.id);
        try {
            await fetch(`${API_BASE}/api/telegram/accounts/${acc.id}/toggle`, {
                method: 'PUT',
                headers: authHeaders,
                body: JSON.stringify({ enabled: !acc.enabled }),
            });
            await fetchTgAccounts();
        } catch (e) {
            console.error('TG pool toggle failed:', e);
        } finally {
            setTgPoolSavingId(null);
        }
    };

    const handleToggleGptAssign = async (acc) => {
        const assigned = acc.assignedBots || ['dualbot'];
        const newAssigned = assigned.includes('gptbot')
            ? assigned.filter(b => b !== 'gptbot')
            : [...assigned, 'gptbot'];
        setTgPoolSavingId(acc.id);
        try {
            await fetch(`${API_BASE}/api/telegram/accounts/${acc.id}/toggle`, {
                method: 'PUT',
                headers: authHeaders,
                body: JSON.stringify({ assignedBots: newAssigned }),
            });
            await fetchTgAccounts();
        } catch (e) {
            console.error('GPTBot assign toggle failed:', e);
        } finally {
            setTgPoolSavingId(null);
        }
    };

    const handleTgAdd = async () => {
        if (!tgNewApiId || !tgNewApiHash) return;
        setTgLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/telegram/accounts`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ apiId: tgNewApiId.trim(), apiHash: tgNewApiHash.trim(), label: tgNewLabel.trim() || undefined })
            });
            const text = await res.text();
            let data = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (res.ok) {
                setTgShowAdd(false);
                setTgNewApiId('');
                setTgNewApiHash('');
                setTgNewLabel('');
                fetchTgAccounts();
            } else {
                const serverMsg = data.detail || data.error || data.message || text || `HTTP ${res.status}`;
                alert(`添加失败: ${serverMsg}`);
            }
        } catch (e) {
            alert('添加失败: ' + e.message);
        } finally {
            setTgLoading(false);
        }
    };

    const handleTgLoginRequest = async (accountId) => {
        if (!tgLoginPhone) return;
        setTgLoading(true);
        setTgLoginMsg('');
        try {
            const res = await fetch(`${API_BASE}/api/telegram/accounts/${accountId}/login`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ phone: tgLoginPhone })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setTgLoginHash(data.phone_code_hash);
                setTgLoginStep('code');
                setTgLoginMsg(data.message || '验证码已发送');
            } else {
                setTgLoginMsg(data.detail || data.error || '发送验证码失败');
            }
        } catch (e) {
            setTgLoginMsg('网络错误: ' + e.message);
        } finally {
            setTgLoading(false);
        }
    };

    const handleTgVerifyCode = async (accountId) => {
        if (!tgLoginCode) return;
        setTgLoading(true);
        setTgLoginMsg('');
        try {
            const res = await fetch(`${API_BASE}/api/telegram/accounts/${accountId}/verify`, {
                method: 'POST',
                headers: authHeaders,
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
                setTgLoginMsg(`✅ ${data.message || '登录成功'}`);
                setTgLoginAccountId(null);
                fetchTgAccounts();
            } else {
                setTgLoginMsg(data.detail || data.error || '验证码错误');
            }
        } catch (e) {
            setTgLoginMsg('网络错误: ' + e.message);
        } finally {
            setTgLoading(false);
        }
    };

    const handleTgRemove = async (accountId) => {
        if (!window.confirm('确定要删除这个账号吗？')) return;
        try {
            const res = await fetch(`${API_BASE}/api/telegram/accounts/${accountId}`, { method: 'DELETE', headers: authHeaders });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                alert(`删除失败: ${data.detail || data.error || `HTTP ${res.status}`}`);
                return;
            }
            fetchTgAccounts();
        } catch (e) {
            alert('删除失败');
        }
    };

    const handleTgCheckConnections = async () => {
        setTgChecking(true);
        setTgCheckResults(null);
        try {
            const res = await fetch(`${API_BASE}/api/telegram/accounts/check-connections`, { method: 'POST', headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                const map = {};
                (data.results || []).forEach(r => { map[r.id] = r; });
                setTgCheckResults(map);
                fetchTgAccounts();
            } else {
                const data = await res.json().catch(() => ({}));
                alert(`检测连接失败: ${data.detail || data.error || `HTTP ${res.status}`}`);
            }
        } catch (e) {
            console.error('Check connections failed:', e);
        } finally {
            setTgChecking(false);
        }
    };

    const handleSaveGptTgConfig = async () => {
        if (!token) {
            alert('保存失败: 未登录');
            return;
        }
        setGptCfgSaving(true);
        try {
            const payload = {
                verification: {
                    gptRechargeBot: {
                        ...(config?.verification?.gptRechargeBot || {}),
                        enabled: config?.verification?.gptRechargeBot?.enabled || false,
                        targetBot: config?.verification?.gptRechargeBot?.targetBot || '@AutoRechargeProbot',
                        sendFormat: config?.verification?.gptRechargeBot?.sendFormat || '{accessToken}',
                        botFirstFallbackToKey: config?.verification?.gptRechargeBot?.botFirstFallbackToKey === true,
                        preCommandEnabled: config?.verification?.gptRechargeBot?.preCommandEnabled !== false,
                        preCommand: config?.verification?.gptRechargeBot?.preCommand || '⚡ 激活plus母号',
                        preCommandTimeout: Number(config?.verification?.gptRechargeBot?.preCommandTimeout || 45),
                        timeout: Number(config?.verification?.gptRechargeBot?.timeout || 120),
                        maxRetries: Number(config?.verification?.gptRechargeBot?.maxRetries || 5),
                        processingKeywords: config?.verification?.gptRechargeBot?.processingKeywords || [],
                        responseRules: config?.verification?.gptRechargeBot?.responseRules || [],
                        cooldown: config?.verification?.gptRechargeBot?.cooldown || { keywords: ['COOLDOWN', 'RATE LIMIT', 'TOO MANY'], timePattern: '(\\d+)\\s*[MS]' },
                    }
                }
            };
            const res = await fetch(`${API_BASE}/api/config`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(payload),
            });
            const text = await res.text();
            let data = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (!res.ok) {
                alert(`保存失败: ${data.detail || data.error || text || `HTTP ${res.status}`}`);
                return;
            }
            setGptCfgSaved(true);
            setTimeout(() => setGptCfgSaved(false), 1800);
        } catch (e) {
            alert('保存失败: ' + e.message);
        } finally {
            setGptCfgSaving(false);
        }
    };

    const fetchPlusApiCfg = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/admin/gpt-plus-api/config`, { headers: authHeaders });
            if (res.ok) setPlusApiCfg(await res.json());
        } catch {}
    };

    const handleSavePlusApiCfg = async () => {
        setPlusApiSaving(true);
        setPlusApiSaved(false);
        try {
            await fetch(`${API_BASE}/api/admin/gpt-plus-api/config`, {
                method: 'POST', headers: authHeaders,
                body: JSON.stringify(plusApiCfg),
            });
            setPlusApiSaved(true);
            setTimeout(() => setPlusApiSaved(false), 3000);
        } catch {} finally { setPlusApiSaving(false); }
    };

    const handleCheckPlusApiBalance = async () => {
        setPlusApiBalanceLoading(true);
        setPlusApiBalance(null);
        try {
            const res = await fetch(`${API_BASE}/api/admin/gpt-plus-api/balance`, { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                setPlusApiBalance(data.balances || {});
            } else {
                const err = await res.json().catch(() => ({}));
                setPlusApiBalance({ error: err.detail || `HTTP ${res.status}` });
            }
        } catch (e) { setPlusApiBalance({ error: e.message }); }
        finally { setPlusApiBalanceLoading(false); }
    };

    useEffect(() => { fetchStats(); fetchKeys(); fetchGptMaint(); fetchTgAccounts(); fetchPlusApiCfg(); }, []);

    const handleAdd = async () => {
        if (!newKeys.trim()) return;
        setAdding(true);
        setAddResult(null);
        try {
            const res = await fetch(`${API_BASE}/api/gpt-keys/add`, {
                method: 'POST', headers: authHeaders,
                body: JSON.stringify({ keys: newKeys, channel: addChannel }),
            });
            const data = await res.json();
            if (res.ok) {
                setAddResult(data);
                setNewKeys('');
                fetchStats();
                fetchKeys();
            } else {
                setAddResult({ error: data.detail || '添加失败' });
            }
        } catch (e) {
            setAddResult({ error: e.message });
        } finally {
            setAdding(false);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('确定删除此卡密？')) return;
        try {
            await fetch(`${API_BASE}/api/gpt-keys/${id}`, { method: 'DELETE', headers: authHeaders });
            fetchStats();
            fetchKeys();
        } catch (e) { console.error(e); }
    };

    const statusBadge = (status) => {
        const map = {
            available: { bg: 'rgba(16,185,129,0.1)', color: '#059669', text: '可用' },
            reserved: { bg: 'rgba(245,158,11,0.1)', color: '#d97706', text: '已预留' },
            used: { bg: 'rgba(107,114,128,0.1)', color: '#6b7280', text: '已使用' },
            invalid: { bg: 'rgba(239,68,68,0.1)', color: '#dc2626', text: '无效' },
        };
        const s = map[status] || map.available;
        return <span style={{ padding: '2px 10px', borderRadius: '8px', background: s.bg, color: s.color, fontWeight: 600, fontSize: '12px' }}>{s.text}</span>;
    };

    const channelColors = { red: { bg: 'rgba(239,68,68,0.1)', color: '#dc2626' }, sbs: { bg: 'rgba(59,130,246,0.1)', color: '#3b82f6' }, vip: { bg: 'rgba(139,92,246,0.1)', color: '#7c3aed' }, aic: { bg: 'rgba(245,158,11,0.1)', color: '#d97706' }, nitro: { bg: 'rgba(16,185,129,0.1)', color: '#059669' }, tg: { bg: 'rgba(20,184,166,0.1)', color: '#0f766e' } };
    const channelBadge = (ch) => {
        const c = channelColors[ch] || channelColors.sbs;
        return <span style={{
            padding: '2px 8px', borderRadius: '8px', fontWeight: 600, fontSize: '11px',
            background: c.bg, color: c.color,
        }}>{(ch || 'sbs').toUpperCase()}</span>;
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                {[
                    { label: '总卡密', value: stats.total, icon: '🎫️', color: '#7c5cfc' },
                    { label: '可用', value: stats.available, icon: '✅', color: '#10b981' },
                    { label: '已使用', value: stats.used, icon: '📋', color: '#6b7280' },
                ].map(({ label, value, icon, color }) => (
                    <div key={label} style={{
                        background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                        borderRadius: '12px', padding: '20px', textAlign: 'center'
                    }}>
                        <div style={{ fontSize: '24px', marginBottom: '4px' }}>{icon}</div>
                        <div style={{ fontSize: '28px', fontWeight: 700, color }}>{value}</div>
                        <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>{label}</div>
                    </div>
                ))}
            </div>

            {/* Per-channel stats */}
            {stats.channels && Object.keys(stats.channels).length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                    {Object.entries(stats.channels).map(([ch, s]) => (
                        <div key={ch} style={{
                            background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                            borderRadius: '10px', padding: '14px 18px',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{
                                    padding: '3px 10px', borderRadius: '8px', fontWeight: 700, fontSize: '12px',
                                    background: (channelColors[ch] || channelColors.sbs).bg,
                                    color: (channelColors[ch] || channelColors.sbs).color,
                                }}>{ch.toUpperCase()}</span>
                                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>通道</span>
                            </div>
                            <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
                                <span>可用 <strong style={{ color: '#10b981' }}>{s.available}</strong></span>
                                <span>已用 <strong>{s.used}</strong></span>
                                <span>总计 <strong>{s.total}</strong></span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Add Keys */}
            <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>➕ 批量添加卡密</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                        {['sbs', 'red', 'vip', 'aic', 'nitro'].map(ch => (
                            <button key={ch} onClick={() => setAddChannel(ch)} style={{
                                padding: '4px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                                fontWeight: 600, fontSize: '12px',
                                background: addChannel === ch
                                    ? (channelColors[ch] || channelColors.sbs).bg
                                    : 'var(--bg-secondary)',
                                color: addChannel === ch
                                    ? (channelColors[ch] || channelColors.sbs).color
                                    : 'var(--text-tertiary)',
                            }}>{ch.toUpperCase()}</button>
                        ))}
                    </div>
                </div>
                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <textarea
                        className="input textarea"
                        style={{ minHeight: '100px', fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: '13px' }}
                        placeholder={`每行一个 ${addChannel.toUpperCase()} 通道卡密...`}
                        value={newKeys}
                        onChange={e => setNewKeys(e.target.value)}
                    />
                    {addResult && (
                        <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border-primary)' }}>
                            {addResult.error ? (
                                <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', color: '#dc2626', fontSize: '13px', fontWeight: 500 }}>
                                    ❌ {addResult.error}
                                </div>
                            ) : (
                                <>
                                    <div style={{ padding: '10px 14px', background: 'var(--bg-secondary)', fontSize: '13px', fontWeight: 600, display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                        <span>输入 {addResult.total_input} 个</span>
                                        {addResult.valid > 0 && <span style={{ color: '#059669' }}>✅ 有效 {addResult.valid}</span>}
                                        {addResult.invalid > 0 && <span style={{ color: '#dc2626' }}>❌ 无效 {addResult.invalid}</span>}
                                        {addResult.duplicate > 0 && <span style={{ color: '#d97706' }}>⚠️ 重复 {addResult.duplicate}</span>}
                                    </div>
                                    {addResult.results && addResult.results.length > 0 && (
                                        <div style={{ maxHeight: '150px', overflow: 'auto', fontSize: '12px' }}>
                                            {addResult.results.map((r, i) => (
                                                <div key={i} style={{
                                                    padding: '6px 14px', borderTop: '1px solid var(--border-primary)',
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                    background: r.status === 'valid' ? 'rgba(16,185,129,0.04)' : r.status === 'invalid' ? 'rgba(239,68,68,0.04)' : 'rgba(245,158,11,0.04)',
                                                }}>
                                                    <span style={{ fontFamily: "'SF Mono', monospace", maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.key}</span>
                                                    <span style={{
                                                        color: r.status === 'valid' ? '#059669' : r.status === 'invalid' ? '#dc2626' : '#d97706',
                                                        fontWeight: 500,
                                                    }}>{r.status === 'valid' ? '✅' : r.status === 'invalid' ? '❌' : '⚠️'} {r.msg}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                    <button
                        className="btn btn-primary"
                        disabled={adding || !newKeys.trim()}
                        onClick={handleAdd}
                    >
                        {adding ? '🔄 验证并添加中...' : `添加到 ${addChannel.toUpperCase()} (${newKeys.split('\n').filter(l => l.trim()).length} 个)`}
                    </button>
                </div>
            </div>

            {/* Key List */}
            <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontWeight: 600 }}>📋 卡密列表</span>
                        <input
                            type="text"
                            placeholder="搜索卡密或邮箱..."
                            className="input"
                            style={{ padding: '4px 8px', fontSize: '13px', width: '200px' }}
                            value={keySearch}
                            onChange={(e) => setKeySearch(e.target.value)}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>{filteredKeys.length} 条记录</span>
                        {keyTotalPages > 1 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <button
                                    onClick={() => setKeyPage(p => Math.max(1, p - 1))}
                                    disabled={keyPage === 1}
                                    style={{ padding: '2px 8px', fontSize: '12px', border: '1px solid var(--border-primary)', borderRadius: '4px', background: 'var(--bg-secondary)', cursor: keyPage === 1 ? 'not-allowed' : 'pointer', opacity: keyPage === 1 ? 0.5 : 1 }}
                                >
                                    上一页
                                </button>
                                <span style={{ fontSize: '12px', padding: '0 4px' }}>{keyPage} / {keyTotalPages}</span>
                                <button
                                    onClick={() => setKeyPage(p => Math.min(keyTotalPages, p + 1))}
                                    disabled={keyPage === keyTotalPages}
                                    style={{ padding: '2px 8px', fontSize: '12px', border: '1px solid var(--border-primary)', borderRadius: '4px', background: 'var(--bg-secondary)', cursor: keyPage === keyTotalPages ? 'not-allowed' : 'pointer', opacity: keyPage === keyTotalPages ? 0.5 : 1 }}
                                >
                                    下一页
                                </button>
                            </div>
                        )}
                    </div>
                </div>
                <div style={{ overflow: 'auto', maxHeight: '400px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                            <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0 }}>
                                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600 }}>卡密</th>
                                <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600 }}>通道</th>
                                <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600 }}>状态</th>
                                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600 }}>使用邮箱</th>
                                <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600 }}>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {displayKeys.map(k => (
                                <tr key={k.id} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                                    <td style={{ padding: '10px 16px', fontFamily: "'SF Mono', monospace", maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {k.card_key}
                                    </td>
                                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>{channelBadge(k.channel)}</td>
                                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>{statusBadge(k.status)}</td>
                                    <td style={{ padding: '10px 16px', color: k.used_email ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                                        {k.used_email || '-'}
                                    </td>
                                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                                        <button
                                            onClick={() => handleDelete(k.id)}
                                            style={{
                                                background: 'rgba(239,68,68,0.08)', color: '#dc2626',
                                                border: 'none', borderRadius: '6px', padding: '4px 12px',
                                                cursor: 'pointer', fontSize: '12px', fontWeight: 500
                                            }}
                                        >🗑️</button>
                                    </td>
                                </tr>
                            ))}
                            {keys.length === 0 && (
                                <tr>
                                    <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                                        暂无卡密，请先添加
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* GPT TG Account Pool */}
            <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid var(--border-primary)',
                    fontWeight: 700,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <span>📱 GPTBot 账号池</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn" style={{ fontSize: '12px', padding: '5px 10px' }} onClick={() => setTgShowAdd(v => !v)}>
                            + 添加账号
                        </button>
                        <button className="btn" style={{ fontSize: '12px', padding: '5px 10px' }} onClick={handleTgCheckConnections} disabled={tgChecking}>
                            {tgChecking ? '检测中...' : '📡 检测连接'}
                        </button>
                        <button className="btn" style={{ fontSize: '12px', padding: '5px 10px' }} onClick={fetchTgAccounts}>刷新</button>
                    </div>
                </div>
                <div style={{ padding: '12px 20px', fontSize: '12px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)' }}>
                    这里可直接管理 GPT 充值账号池（添加、登录、检测连接、启用并发、GPTBot 分配）。
                </div>
                {tgShowAdd && (
                    <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-primary)', background: 'var(--bg-secondary)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '8px' }}>
                            <input className="input" placeholder="API ID" value={tgNewApiId} onChange={e => setTgNewApiId(e.target.value)} />
                            <input className="input" placeholder="API Hash" value={tgNewApiHash} onChange={e => setTgNewApiHash(e.target.value)} />
                            <input className="input" placeholder="账号备注(可选)" value={tgNewLabel} onChange={e => setTgNewLabel(e.target.value)} />
                            <button className="btn btn-primary" onClick={handleTgAdd} disabled={tgLoading || !tgNewApiId || !tgNewApiHash}>
                                {tgLoading ? '添加中...' : '添加'}
                            </button>
                        </div>
                    </div>
                )}
                <div style={{ padding: '10px 20px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {tgAccounts.length === 0 ? (
                        <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                            暂无 TG 账号
                        </div>
                    ) : (
                        tgAccounts.map(acc => {
                            const assigned = acc.assignedBots || ['dualbot'];
                            const gptAssigned = assigned.includes('gptbot');
                            return (
                                <div key={acc.id} style={{
                                    border: '1px solid var(--border-primary)',
                                    borderRadius: '10px',
                                    padding: '10px 12px',
                                    display: 'grid',
                                    gridTemplateColumns: '1fr auto',
                                    alignItems: 'center',
                                    gap: '10px'
                                }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: '14px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {acc.label || acc.phone || acc.id}
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span>{acc.phone || (acc.hasSession ? '已登录' : '未登录')}</span>
                                            <span style={{
                                                padding: '1px 6px',
                                                borderRadius: '6px',
                                                fontSize: '10px',
                                                background: acc.hasSession ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.12)',
                                                color: acc.hasSession ? '#059669' : '#dc2626'
                                            }}>
                                                {acc.hasSession ? '会话正常' : '未登录'}
                                            </span>
                                            {tgCheckResults && tgCheckResults[acc.id] && (
                                                <span style={{
                                                    padding: '1px 6px',
                                                    borderRadius: '6px',
                                                    fontSize: '10px',
                                                    background: tgCheckResults[acc.id].online ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.12)',
                                                    color: tgCheckResults[acc.id].online ? '#059669' : '#dc2626'
                                                }}>
                                                    {tgCheckResults[acc.id].online ? '在线' : '掉线'}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                        {!acc.hasSession ? (
                                            <button
                                                className="btn btn-primary"
                                                disabled={tgLoading}
                                                onClick={() => {
                                                    setTgLoginAccountId(acc.id);
                                                    setTgLoginStep('phone');
                                                    setTgLoginPhone('');
                                                    setTgLoginCode('');
                                                    setTgLoginHash('');
                                                    setTgLoginPassword('');
                                                    setTgLoginMsg('');
                                                }}
                                                style={{ fontSize: '12px', padding: '5px 10px' }}
                                            >
                                                登录账号
                                            </button>
                                        ) : (
                                            <>
                                                <button
                                                    className="btn"
                                                    disabled={tgPoolSavingId === acc.id}
                                                    onClick={() => handleToggleTgPool(acc)}
                                                    style={{
                                                        fontSize: '12px', padding: '5px 10px',
                                                        border: 'none', borderRadius: '7px',
                                                        background: acc.enabled ? 'rgba(16,185,129,0.14)' : 'rgba(107,114,128,0.12)',
                                                        color: acc.enabled ? '#059669' : '#6b7280'
                                                    }}
                                                >
                                                    {acc.enabled ? '已启用' : '已下架'}
                                                </button>
                                                <button
                                                    className="btn"
                                                    disabled={tgPoolSavingId === acc.id}
                                                    onClick={() => handleToggleGptAssign(acc)}
                                                    style={{
                                                        fontSize: '12px', padding: '5px 10px',
                                                        border: 'none', borderRadius: '7px',
                                                        background: gptAssigned ? 'rgba(34,197,94,0.15)' : 'rgba(156,163,175,0.15)',
                                                        color: gptAssigned ? '#16a34a' : '#6b7280'
                                                    }}
                                                >
                                                    {gptAssigned ? '✓ GPTBot' : 'GPTBot'}
                                                </button>
                                            </>
                                        )}
                                        <button
                                            className="btn"
                                            onClick={() => handleTgRemove(acc.id)}
                                            style={{
                                                fontSize: '12px', padding: '5px 10px',
                                                border: 'none', borderRadius: '7px',
                                                background: 'rgba(239,68,68,0.12)', color: '#dc2626'
                                            }}
                                        >
                                            删除
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
                {tgLoginAccountId && (
                    <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-primary)', background: 'var(--bg-secondary)' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                            <strong style={{ fontSize: '13px' }}>登录账号</strong>
                            <button className="btn" style={{ fontSize: '11px', padding: '3px 8px' }} onClick={() => setTgLoginAccountId(null)}>关闭</button>
                        </div>
                        {tgLoginStep === 'phone' && (
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input className="input" placeholder="+8613800138000" value={tgLoginPhone} onChange={e => setTgLoginPhone(e.target.value)} />
                                <button className="btn btn-primary" onClick={() => handleTgLoginRequest(tgLoginAccountId)} disabled={tgLoading || !tgLoginPhone}>
                                    {tgLoading ? '发送中...' : '发送验证码'}
                                </button>
                            </div>
                        )}
                        {(tgLoginStep === 'code' || tgLoginStep === 'password') && (
                            <div style={{ display: 'grid', gridTemplateColumns: tgLoginStep === 'password' ? '1fr 1fr auto' : '1fr auto', gap: '8px' }}>
                                <input className="input" placeholder="验证码" value={tgLoginCode} onChange={e => setTgLoginCode(e.target.value)} />
                                {tgLoginStep === 'password' && (
                                    <input className="input" type="password" placeholder="2FA 密码" value={tgLoginPassword} onChange={e => setTgLoginPassword(e.target.value)} />
                                )}
                                <button className="btn btn-primary" onClick={() => handleTgVerifyCode(tgLoginAccountId)} disabled={tgLoading || !tgLoginCode}>
                                    {tgLoading ? '验证中...' : '验证登录'}
                                </button>
                            </div>
                        )}
                        {tgLoginMsg && <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>{tgLoginMsg}</div>}
                    </div>
                )}
            </div>

            {/* GPT TG Bot + Rules */}
            <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid var(--border-primary)',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px'
                }}>
                    <span>🤖 GPT 充值 TG Bot · 响应规则</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {gptCfgSaved && <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: 600 }}>✓ 已保存</span>}
                        <button
                            className="btn btn-primary"
                            onClick={handleSaveGptTgConfig}
                            disabled={gptCfgSaving}
                            style={{ fontSize: '12px', padding: '5px 12px' }}
                        >
                            {gptCfgSaving ? '保存中...' : '保存配置'}
                        </button>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: '#0f766e', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={config?.verification?.gptRechargeBot?.enabled || false}
                                onChange={e => updateGptCfg({ enabled: e.target.checked })}
                                style={{ width: '16px', height: '16px' }}
                            />
                            启用
                        </label>
                    </div>
                </div>
                <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px 120px', gap: '8px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>目标 Bot</label>
                            <input
                                type="text"
                                className="input"
                                value={config?.verification?.gptRechargeBot?.targetBot || '@AutoRechargeProbot'}
                                onChange={e => updateGptCfg({ targetBot: e.target.value })}
                                placeholder="@AutoRechargeProbot"
                                style={{ width: '100%', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>发送格式</label>
                            <input
                                type="text"
                                className="input"
                                value={config?.verification?.gptRechargeBot?.sendFormat || '{accessToken}'}
                                onChange={e => updateGptCfg({ sendFormat: e.target.value })}
                                placeholder="{accessToken}"
                                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '12px' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>超时(秒)</label>
                            <input
                                type="number"
                                className="input"
                                value={config?.verification?.gptRechargeBot?.timeout ?? 120}
                                onChange={e => updateGptCfg({ timeout: parseInt(e.target.value, 10) || 120 })}
                                min="30"
                                max="600"
                                style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>最大重试</label>
                            <input
                                type="number"
                                className="input"
                                value={config?.verification?.gptRechargeBot?.maxRetries ?? 5}
                                onChange={e => updateGptCfg({ maxRetries: parseInt(e.target.value, 10) || 5 })}
                                min="1"
                                max="20"
                                style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 120px', gap: '8px', alignItems: 'end' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={config?.verification?.gptRechargeBot?.preCommandEnabled !== false}
                                onChange={e => updateGptCfg({ preCommandEnabled: e.target.checked })}
                                style={{ width: '16px', height: '16px' }}
                            />
                            预指令流程
                        </label>
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>预发送指令</label>
                            <input
                                type="text"
                                className="input"
                                value={config?.verification?.gptRechargeBot?.preCommand || '⚡ 激活plus母号'}
                                onChange={e => updateGptCfg({ preCommand: e.target.value })}
                                placeholder="⚡ 激活plus母号"
                                style={{ width: '100%', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>预指令超时</label>
                            <input
                                type="number"
                                className="input"
                                value={config?.verification?.gptRechargeBot?.preCommandTimeout ?? 45}
                                onChange={e => updateGptCfg({ preCommandTimeout: parseInt(e.target.value, 10) || 45 })}
                                min="10"
                                max="300"
                                style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                            />
                        </div>
                    </div>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={config?.verification?.gptRechargeBot?.botFirstFallbackToKey === true}
                            onChange={e => updateGptCfg({ botFirstFallbackToKey: e.target.checked })}
                            style={{ width: '16px', height: '16px' }}
                        />
                        GPT BOT 作为第一通道，失败后自动切换卡密通道（不立即返回失败）
                    </label>

                    <div style={{ marginTop: '-4px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                        这是无卡密 TG 通道。占位符支持: <code>{'{accessToken}'}</code> <code>{'{account}'}</code> <code>{'{email}'}</code>（兼容保留 <code>{'{card_key}'}</code>）。
                        启用“预指令流程”后，将先发送预指令（例如“⚡ 激活plus母号”），收到回复后再发送发送格式内容。
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                            处理中关键词 (processingKeywords)
                        </label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                            {(config?.verification?.gptRechargeBot?.processingKeywords || []).map((kw, idx) => (
                                <span key={idx} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                                    padding: '2px 8px', fontSize: '11px', fontWeight: 600,
                                    background: 'rgba(245,158,11,0.1)', color: '#d97706',
                                    borderRadius: '10px', border: '1px solid rgba(245,158,11,0.2)'
                                }}>
                                    {kw}
                                    <span
                                        style={{ cursor: 'pointer', lineHeight: 1 }}
                                        onClick={() => updateGptCfg(cur => ({
                                            ...cur,
                                            processingKeywords: (cur.processingKeywords || []).filter((_, i) => i !== idx),
                                        }))}
                                    >×</span>
                                </span>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <input
                                type="text"
                                className="input"
                                value={newProcessingKw}
                                onChange={e => setNewProcessingKw(e.target.value)}
                                placeholder="新增关键词，按 Enter 或点击添加"
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && newProcessingKw.trim()) {
                                        const v = newProcessingKw.trim();
                                        updateGptCfg(cur => ({ ...cur, processingKeywords: [...(cur.processingKeywords || []), v] }));
                                        setNewProcessingKw('');
                                    }
                                }}
                                style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px', fontFamily: 'monospace' }}
                            />
                            <button
                                className="btn"
                                onClick={() => {
                                    if (!newProcessingKw.trim()) return;
                                    const v = newProcessingKw.trim();
                                    updateGptCfg(cur => ({ ...cur, processingKeywords: [...(cur.processingKeywords || []), v] }));
                                    setNewProcessingKw('');
                                }}
                            >添加</button>
                        </div>
                    </div>

                    <div style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>响应规则 (responseRules)</label>
                            <button
                                className="btn"
                                style={{ fontSize: '12px', padding: '4px 10px' }}
                                onClick={() => updateGptCfg(cur => ({
                                    ...cur,
                                    responseRules: [...(cur.responseRules || []), { keywords: ['SUCCESS'], status: 'approved', success: true, message: '充值成功' }],
                                }))}
                            >+ 添加规则</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {(config?.verification?.gptRechargeBot?.responseRules || []).map((rule, ri) => (
                                <div key={ri} style={{ border: '1px solid var(--border-primary)', borderRadius: '8px', padding: '10px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1fr 36px', gap: '8px', alignItems: 'center' }}>
                                        <input
                                            type="text"
                                            className="input"
                                            value={(rule.keywords || []).join(' | ')}
                                            onChange={e => {
                                                const keywords = e.target.value.split('|').map(s => s.trim()).filter(Boolean);
                                                updateGptCfg(cur => {
                                                    const list = [...(cur.responseRules || [])];
                                                    list[ri] = { ...list[ri], keywords };
                                                    return { ...cur, responseRules: list };
                                                });
                                            }}
                                            placeholder="关键词1 | 关键词2"
                                            style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px', fontFamily: 'monospace' }}
                                        />
                                        <select
                                            className="input"
                                            value={rule.status || 'failed'}
                                            onChange={e => {
                                                const status = e.target.value;
                                                updateGptCfg(cur => {
                                                    const list = [...(cur.responseRules || [])];
                                                    list[ri] = { ...list[ri], status, success: status === 'approved' };
                                                    return { ...cur, responseRules: list };
                                                });
                                            }}
                                            style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                        >
                                            <option value="approved">approved</option>
                                            <option value="cooldown">cooldown</option>
                                            <option value="failed">failed</option>
                                        </select>
                                        <input
                                            type="text"
                                            className="input"
                                            value={rule.message || ''}
                                            onChange={e => {
                                                updateGptCfg(cur => {
                                                    const list = [...(cur.responseRules || [])];
                                                    list[ri] = { ...list[ri], message: e.target.value };
                                                    return { ...cur, responseRules: list };
                                                });
                                            }}
                                            placeholder="结果消息"
                                            style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                        />
                                        <button
                                            className="btn"
                                            onClick={() => updateGptCfg(cur => ({
                                                ...cur,
                                                responseRules: (cur.responseRules || []).filter((_, i) => i !== ri),
                                            }))}
                                            style={{ color: '#dc2626', border: 'none', background: 'rgba(239,68,68,0.1)', borderRadius: '6px', padding: '4px 0' }}
                                        >×</button>
                                    </div>
                                </div>
                            ))}
                            {(config?.verification?.gptRechargeBot?.responseRules || []).length === 0 && (
                                <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '12px', padding: '8px 0' }}>
                                    暂无规则
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* GPT Plus API config */}
            <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{
                    padding: '16px 20px', borderBottom: '1px solid var(--border-primary)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px'
                }}>
                    <div>
                        <span style={{ fontWeight: 700 }}>🔷 GPT Plus API 通道</span>
                        <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginLeft: '8px' }}>外部充值服务（1个月 Plus）</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {plusApiSaved && <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: 600 }}>✓ 已保存</span>}
                        <button
                            className="btn btn-primary"
                            onClick={handleSavePlusApiCfg}
                            disabled={plusApiSaving}
                            style={{ fontSize: '12px', padding: '5px 12px' }}
                        >
                            {plusApiSaving ? '保存中...' : '保存配置'}
                        </button>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: '#0f766e', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={plusApiCfg.enabled || false}
                                onChange={e => setPlusApiCfg(p => ({ ...p, enabled: e.target.checked }))}
                                style={{ width: '16px', height: '16px' }}
                            />
                            启用
                        </label>
                    </div>
                </div>
                <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>API Base URL</label>
                            <input
                                type="text"
                                className="input"
                                value={plusApiCfg.baseUrl || ''}
                                onChange={e => setPlusApiCfg(p => ({ ...p, baseUrl: e.target.value }))}
                                placeholder="https://your-api-domain.com"
                                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '13px' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>API Key</label>
                            <input
                                type="password"
                                className="input"
                                value={plusApiCfg.apiKey || ''}
                                onChange={e => setPlusApiCfg(p => ({ ...p, apiKey: e.target.value }))}
                                placeholder="X-API-Key..."
                                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '13px' }}
                            />
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <button
                            className="btn btn-secondary"
                            onClick={handleCheckPlusApiBalance}
                            disabled={plusApiBalanceLoading}
                            style={{ fontSize: '12px', padding: '5px 14px' }}
                        >
                            {plusApiBalanceLoading ? '查询中...' : '查询余额'}
                        </button>
                        {plusApiBalance && !plusApiBalance.error && (
                            <span style={{ fontSize: '13px', fontWeight: 600 }}>
                                Plus 余额：<span style={{ color: '#6366f1' }}>{plusApiBalance.plus ?? '-'}</span>
                            </span>
                        )}
                        {plusApiBalance?.error && (
                            <span style={{ fontSize: '12px', color: '#dc2626' }}>❌ {plusApiBalance.error}</span>
                        )}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        启用后，用户充值时可选择 API 通道，使用 workflow=plus（1个月）。失败时费用由外部 API 自动退回。
                    </div>
                </div>
            </div>

            {/* Per-channel maintenance toggles */}
            <div className="card" style={{ padding: 'var(--spacing-md)' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>🔧 GPT 通道维护开关</div>
                {[
                    { key: 'gpt_sbs', label: '🔵 SBS 通道', desc: 'chong.databrain.sbs' },
                    { key: 'gpt_red', label: '🔴 RED 通道', desc: 'redeemgpt.com' },
                    { key: 'gpt_vip', label: '🟣 VIP 通道', desc: 'shop.gptai.vip' },
                    { key: 'gpt_aic', label: '🟠 AIC 通道', desc: 'aichong.plus' },
                    { key: 'gpt_nitro', label: '🟢 Nitro 通道', desc: 'receipt.nitro.xin' },
                    { key: 'gpt_tg', label: '🟢 TG 通道', desc: 'Telegram Userbot 目标 Bot' },
                    { key: 'gpt_api', label: '🔷 API 通道', desc: 'GPT Plus 1个月外部充值 API' },
                ].map(s => (
                    <div key={s.key} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '10px 0', borderBottom: '1px solid var(--border-primary)',
                    }}>
                        <div>
                            <div style={{ fontSize: '13px', fontWeight: 600 }}>{s.label}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{s.desc}</div>
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                            <span style={{
                                fontSize: '11px', fontWeight: 600,
                                color: gptMaint[s.key] ? '#dc2626' : '#16a34a',
                            }}>
                                {gptMaint[s.key] ? '维护中' : '正常'}
                            </span>
                            <input
                                type="checkbox"
                                checked={!!gptMaint[s.key]}
                                onChange={async (e) => {
                                    const val = e.target.checked;
                                    setGptMaint(prev => ({ ...prev, [s.key]: val }));
                                    try {
                                        await fetch(`${API_BASE}/api/service-status`, {
                                            method: 'POST',
                                            headers: { ...authHeaders, 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ [s.key]: val }),
                                        });
                                    } catch (err) {
                                        console.warn('GPT maint toggle failed:', err);
                                        setGptMaint(prev => ({ ...prev, [s.key]: !val }));
                                    }
                                }}
                            />
                        </label>
                    </div>
                ))}
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '8px' }}>
                    💡 开启的通道会轮询使用，维护中的通道在充值时会跳过
                </div>
            </div>
        </div>
    );
}


function GptTeamTab() {
    const { user } = useAuth();
    const token = user?.token || localStorage.getItem('verifykey-token');
    const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

    const [section, setSection] = useState('dashboard');
    const [loading, setLoading] = useState(false);
    const [recordsLoading, setRecordsLoading] = useState(false);
    const [teams, setTeams] = useState([]);
    const [teamStats, setTeamStats] = useState({ totalTeams: 0, availableTeams: 0, totalRecords: 0 });
    const [teamFilters, setTeamFilters] = useState({ search: '', status: '', page: 1, perPage: 20 });
    const [teamPagination, setTeamPagination] = useState({ currentPage: 1, totalPages: 1, total: 0, perPage: 20 });

    const [records, setRecords] = useState([]);
    const [recordStats, setRecordStats] = useState({ total: 0, today: 0, thisWeek: 0, thisMonth: 0 });
    const [recordFilters, setRecordFilters] = useState({ email: '', code: '', teamId: '', startDate: '', endDate: '', page: 1, perPage: 20 });
    const [recordPagination, setRecordPagination] = useState({ currentPage: 1, totalPages: 1, total: 0, perPage: 20 });
    const [showImportModal, setShowImportModal] = useState(false);
    const [importMode, setImportMode] = useState('single');
    const [importing, setImporting] = useState(false);
    const [membersModalOpen, setMembersModalOpen] = useState(false);
    const [membersLoading, setMembersLoading] = useState(false);
    const [membersActionLoading, setMembersActionLoading] = useState('');
    const [memberModalTeam, setMemberModalTeam] = useState(null);
    const [memberEmailInput, setMemberEmailInput] = useState('');
    const [teamMembersData, setTeamMembersData] = useState({ members: [], total: 0, error: '' });
    const [batchProgress, setBatchProgress] = useState({ visible: false, stage: '正在准备...', percent: 0, success: 0, failed: 0 });
    const [batchResults, setBatchResults] = useState([]);
    const [batchSummary, setBatchSummary] = useState('');
    const [singleImport, setSingleImport] = useState({
        access_token: '',
        session_token: '',
        account_id: '',
    });
    const [batchContent, setBatchContent] = useState('');

    const formatShortAccountId = (value) => {
        const text = (value || '').trim();
        if (!text) return '-';
        if (text.length <= 18) return text;
        return `${text.slice(0, 8)}...${text.slice(-6)}`;
    };

    const formatStatusLabel = (value) => {
        const map = {
            active: '可用',
            full: '已满',
            expired: '过期',
            error: '异常',
            banned: '封禁',
        };
        return map[(value || '').toLowerCase()] || (value || '-');
    };

    const formatDateTimeCell = (value) => {
        const text = (value || '').trim();
        if (!text) return { date: '-', time: '' };
        try {
            const date = new Date(text);
            if (Number.isNaN(date.getTime())) return { date: text, time: '' };
            const formatted = date.toLocaleString('zh-CN', { hour12: false });
            const [day = formatted, time = ''] = formatted.split(' ');
            return { date: day, time };
        } catch {
            return { date: text, time: '' };
        }
    };

    const fetchDashboard = async () => {
        setLoading(true);
        try {
            const qp = new URLSearchParams({
                page: String(teamFilters.page || 1),
                per_page: String(teamFilters.perPage || 20),
                search: teamFilters.search || '',
                status: teamFilters.status || '',
            });
            const res = await fetch(`${API_BASE}/api/admin/gpt-team/dashboard?${qp.toString()}`, { headers: authHeaders });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setTeams(data.teams || []);
            setTeamStats(data.stats || { totalTeams: 0, availableTeams: 0, totalRecords: 0 });
            setTeamPagination(data.pagination || { currentPage: 1, totalPages: 1, total: 0, perPage: 20 });
        } catch (e) {
            console.error('Failed to fetch GPT team dashboard:', e);
        } finally {
            setLoading(false);
        }
    };

    const fetchRecords = async () => {
        setRecordsLoading(true);
        try {
            const qp = new URLSearchParams({
                page: String(recordFilters.page || 1),
                per_page: String(recordFilters.perPage || 20),
                email: recordFilters.email || '',
                code: recordFilters.code || '',
                team_id: String(recordFilters.teamId || 0),
                start_date: recordFilters.startDate || '',
                end_date: recordFilters.endDate || '',
            });
            const res = await fetch(`${API_BASE}/api/admin/gpt-team/records?${qp.toString()}`, { headers: authHeaders });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setRecords(data.records || []);
            setRecordStats(data.stats || { total: 0, today: 0, thisWeek: 0, thisMonth: 0 });
            setRecordPagination(data.pagination || { currentPage: 1, totalPages: 1, total: 0, perPage: 20 });
        } catch (e) {
            console.error('Failed to fetch GPT team records:', e);
        } finally {
            setRecordsLoading(false);
        }
    };

    useEffect(() => {
        fetchDashboard();
    }, [teamFilters.page, teamFilters.perPage]);

    useEffect(() => {
        fetchRecords();
    }, [recordFilters.page, recordFilters.perPage]);

    const handleSubmitSingleImport = async () => {
        try {
            setImporting(true);
            const res = await fetch(`${API_BASE}/api/admin/gpt-team/import`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    import_type: 'single',
                    access_token: singleImport.access_token || '',
                    session_token: singleImport.session_token || '',
                    account_id: singleImport.account_id || '',
                })
            });
            const raw = await res.text();
            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch {
                throw new Error(raw || `HTTP ${res.status}`);
            }
            if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
            if (!data.success) throw new Error(data.error || '导入失败');
            setShowImportModal(false);
            setSingleImport({
                access_token: '',
                session_token: '',
                account_id: '',
            });
            await fetchDashboard();
        } catch (e) {
            alert(`导入失败: ${e.message}`);
        } finally {
            setImporting(false);
        }
    };

    const handleSubmitBatchImport = async () => {
        if (!batchContent.trim()) return;
        try {
            setImporting(true);
            setBatchProgress({ visible: true, stage: '准备导入...', percent: 0, success: 0, failed: 0 });
            setBatchResults([]);
            setBatchSummary('');
            const res = await fetch(`${API_BASE}/api/admin/gpt-team/import`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ import_type: 'batch', content: batchContent })
            });
            if (!res.ok) {
                let errMsg = `HTTP ${res.status}`;
                try {
                    const errJson = await res.json();
                    errMsg = errJson.error || errJson.detail || errMsg;
                } catch {}
                throw new Error(errMsg);
            }

            const reader = res.body?.getReader();
            if (!reader) throw new Error('批量导入流不可用');
            const decoder = new TextDecoder();
            let buffer = '';
            let successCount = 0;
            let failedCount = 0;

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.trim()) continue;
                    let data = null;
                    try { data = JSON.parse(line); } catch { continue; }
                    if (data.type === 'start') {
                        setBatchProgress(prev => ({ ...prev, stage: `开始导入 (共 ${data.total} 条)...`, percent: 0 }));
                    } else if (data.type === 'progress') {
                        successCount = Number(data.success_count || 0);
                        failedCount = Number(data.failed_count || 0);
                        const percent = Math.round(((data.current || 0) / (data.total || 1)) * 100);
                        setBatchProgress({
                            visible: true,
                            stage: `正在导入 ${data.current}/${data.total}...`,
                            percent,
                            success: successCount,
                            failed: failedCount,
                        });
                        if (data.last_result) {
                            setBatchResults(prev => [data.last_result, ...prev]);
                        }
                    } else if (data.type === 'finish') {
                        const sum = `总数: ${data.total} | 成功: ${data.success_count} | 失败: ${data.failed_count}`;
                        setBatchSummary(sum);
                        setBatchProgress({
                            visible: true,
                            stage: '导入完成',
                            percent: 100,
                            success: Number(data.success_count || 0),
                            failed: Number(data.failed_count || 0),
                        });
                        await fetchDashboard();
                    } else if (data.type === 'error') {
                        throw new Error(data.error || '批量导入失败');
                    }
                }
            }
        } catch (e) {
            alert(`导入失败: ${e.message}`);
        } finally {
            setImporting(false);
        }
    };

    const handleEditTeam = async (team) => {
        const teamName = window.prompt('Team 名称', team.teamName || '');
        if (teamName === null) return;
        const status = (window.prompt('状态(active/full/expired/error/banned)', team.status || 'active') || '').trim().toLowerCase();
        if (!status) return;
        const maxMembersRaw = window.prompt('最大成员数', String(team.maxMembers || 6));
        if (maxMembersRaw === null) return;
        const maxMembers = Number(maxMembersRaw);
        if (!Number.isFinite(maxMembers) || maxMembers < 0) {
            alert('最大成员数格式不正确');
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/api/admin/gpt-team/teams/${team.id}`, {
                method: 'PUT',
                headers: authHeaders,
                body: JSON.stringify({ teamName, status, maxMembers })
            });
            if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
            await fetchDashboard();
        } catch (e) {
            alert(`更新失败: ${e.message}`);
        }
    };

    const handleDeleteTeam = async (team) => {
        if (!window.confirm(`确认删除 Team: ${team.email} ?`)) return;
        try {
            const res = await fetch(`${API_BASE}/api/admin/gpt-team/teams/${team.id}`, { method: 'DELETE', headers: authHeaders });
            if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
            await fetchDashboard();
        } catch (e) {
            alert(`删除失败: ${e.message}`);
        }
    };

    const loadTeamMembers = async (teamId) => {
        setMembersLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/gpt-team/teams/${teamId}/members/list`, { headers: authHeaders });
            const raw = await res.text();
            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch {
                throw new Error(raw || `HTTP ${res.status}`);
            }
            if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
            setTeamMembersData({ members: data.members || [], total: Number(data.total || 0), error: '' });
            if (data.team) setMemberModalTeam(data.team);
            await fetchDashboard();
        } catch (e) {
            setTeamMembersData({ members: [], total: 0, error: e.message || '加载失败' });
        } finally {
            setMembersLoading(false);
        }
    };

    const handleOpenMembers = async (team) => {
        setMemberModalTeam(team);
        setMemberEmailInput('');
        setTeamMembersData({ members: [], total: 0, error: '' });
        setMembersModalOpen(true);
        await loadTeamMembers(team.id);
    };

    const handleRefreshTeam = async (team) => {
        try {
            setMembersActionLoading(`refresh-${team.id}`);
            const res = await fetch(`${API_BASE}/api/admin/gpt-team/teams/${team.id}/refresh`, {
                method: 'POST',
                headers: authHeaders,
            });
            const raw = await res.text();
            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch {
                throw new Error(raw || `HTTP ${res.status}`);
            }
            if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
            await fetchDashboard();
            if (membersModalOpen && memberModalTeam?.id === team.id) {
                await loadTeamMembers(team.id);
            }
        } catch (e) {
            alert(`刷新失败: ${e.message}`);
        } finally {
            setMembersActionLoading('');
        }
    };

    const handleAddMember = async () => {
        if (!memberModalTeam?.id) return;
        const email = memberEmailInput.trim();
        if (!email) {
            alert('请输入成员邮箱');
            return;
        }
        try {
            setMembersActionLoading('add-member');
            const res = await fetch(`${API_BASE}/api/admin/gpt-team/teams/${memberModalTeam.id}/members/add`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ email }),
            });
            const raw = await res.text();
            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch {
                throw new Error(raw || `HTTP ${res.status}`);
            }
            if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
            setMemberEmailInput('');
            await loadTeamMembers(memberModalTeam.id);
        } catch (e) {
            alert(`邀请失败: ${e.message}`);
        } finally {
            setMembersActionLoading('');
        }
    };

    const handleDeleteMember = async (member) => {
        if (!memberModalTeam?.id) return;
        if (!window.confirm(`确认删除成员 ${member.email || member.user_id} ?`)) return;
        try {
            setMembersActionLoading(`delete-${member.user_id}`);
            const res = await fetch(`${API_BASE}/api/admin/gpt-team/teams/${memberModalTeam.id}/members/${member.user_id}/delete`, {
                method: 'POST',
                headers: authHeaders,
            });
            const raw = await res.text();
            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch {
                throw new Error(raw || `HTTP ${res.status}`);
            }
            if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
            await loadTeamMembers(memberModalTeam.id);
        } catch (e) {
            alert(`删除失败: ${e.message}`);
        } finally {
            setMembersActionLoading('');
        }
    };

    const handleRevokeInvite = async (member) => {
        if (!memberModalTeam?.id) return;
        if (!window.confirm(`确认撤回对 ${member.email} 的邀请 ?`)) return;
        try {
            setMembersActionLoading(`revoke-${member.email}`);
            const res = await fetch(`${API_BASE}/api/admin/gpt-team/teams/${memberModalTeam.id}/invites/revoke`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ email: member.email }),
            });
            const raw = await res.text();
            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch {
                throw new Error(raw || `HTTP ${res.status}`);
            }
            if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
            await loadTeamMembers(memberModalTeam.id);
        } catch (e) {
            alert(`撤回失败: ${e.message}`);
        } finally {
            setMembersActionLoading('');
        }
    };

    const handleAddRecord = async () => {
        const email = (window.prompt('使用邮箱') || '').trim();
        if (!email) return;
        const code = (window.prompt('兑换码（可选）') || '').trim();
        const teamIdRaw = (window.prompt('Team ID（可选）', '0') || '0').trim();
        const accountId = (window.prompt('Account ID（可选）') || '').trim();
        const teamId = Number(teamIdRaw || '0');
        try {
            const res = await fetch(`${API_BASE}/api/admin/gpt-team/records`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ email, code, teamId: Number.isFinite(teamId) ? teamId : 0, accountId })
            });
            if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
            await fetchRecords();
            await fetchDashboard();
        } catch (e) {
            alert(`新增记录失败: ${e.message}`);
        }
    };

    const handleDeleteRecord = async (id) => {
        if (!window.confirm(`确认删除记录 #${id} ?`)) return;
        try {
            const res = await fetch(`${API_BASE}/api/admin/gpt-team/records/${id}`, { method: 'DELETE', headers: authHeaders });
            if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
            await fetchRecords();
            await fetchDashboard();
        } catch (e) {
            alert(`删除记录失败: ${e.message}`);
        }
    };

    return (
        <div className="tab-content">
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <button className={`admin-tab ${section === 'dashboard' ? 'active' : ''}`} onClick={() => setSection('dashboard')}>📊 控制台</button>
                <button className={`admin-tab ${section === 'records' ? 'active' : ''}`} onClick={() => setSection('records')}>📜 使用记录</button>
            </div>

            {section === 'dashboard' && (
                <div>
                    <div className="stats-grid" style={{ marginBottom: '12px' }}>
                        <div className="stat-card card"><div className="stat-info"><span className="stat-value">{teamStats.totalTeams || 0}</span><span className="stat-label">Team 总数</span></div></div>
                        <div className="stat-card card"><div className="stat-info"><span className="stat-value">{teamStats.availableTeams || 0}</span><span className="stat-label">可用 Team</span></div></div>
                        <div className="stat-card card"><div className="stat-info"><span className="stat-value">{teamStats.totalRecords || 0}</span><span className="stat-label">使用记录</span></div></div>
                    </div>
                    <div className="card" style={{ padding: '12px', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <input className="input" style={{ maxWidth: 260 }} placeholder="搜索邮箱/Account/Team" value={teamFilters.search} onChange={e => setTeamFilters(prev => ({ ...prev, search: e.target.value }))} />
                            <select className="input" style={{ maxWidth: 160 }} value={teamFilters.status} onChange={e => setTeamFilters(prev => ({ ...prev, status: e.target.value }))}>
                                <option value="">全部状态</option>
                                <option value="active">active</option>
                                <option value="full">full</option>
                                <option value="expired">expired</option>
                                <option value="error">error</option>
                                <option value="banned">banned</option>
                            </select>
                            <button className="btn" onClick={() => { setTeamFilters(prev => ({ ...prev, page: 1 })); fetchDashboard(); }}>查询</button>
                            <button className="btn btn-secondary" onClick={() => { setTeamFilters({ search: '', status: '', page: 1, perPage: 20 }); setTimeout(fetchDashboard, 0); }}>重置</button>
                            <button className="btn btn-primary" onClick={() => setShowImportModal(true)}>+ 导入 Team</button>
                        </div>
                    </div>
                    <div className="card gpt-team-dashboard-table-card">
                        {loading ? <div style={{ padding: 16 }}>加载中...</div> : (
                            <div className="gpt-team-dashboard-table-wrap">
                            <table className="admin-table gpt-team-dashboard-table" style={{ width: '100%', minWidth: 1180 }}>
                                <thead>
                                    <tr>
                                        <th>ID</th><th>账号</th><th>成员</th><th>状态</th><th>到期</th><th>更新时间</th><th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {teams.map(team => {
                                        const updatedAt = formatDateTimeCell(team.updatedAt);
                                        const expiresAt = formatDateTimeCell(team.expiresAt);
                                        const currentMembers = Number(team.currentMembers || 0);
                                        const maxMembers = Number(team.maxMembers || 0);
                                        return (
                                            <tr key={team.id}>
                                                <td>
                                                    <div className="gpt-team-id-cell">#{team.id}</div>
                                                </td>
                                                <td>
                                                    <div className="gpt-team-account-cell">
                                                        <div className="gpt-team-account-email">{team.email || '-'}</div>
                                                        <div className="gpt-team-account-sub">Account ID: {formatShortAccountId(team.accountId)}</div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="gpt-team-members-cell">
                                                        <strong>{currentMembers}/{maxMembers || '-'}</strong>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className={`gpt-team-status-badge ${(team.status || '').toLowerCase()}`}>
                                                        {formatStatusLabel(team.status)}
                                                    </span>
                                                </td>
                                                <td>
                                                    <div className="gpt-team-time-cell">
                                                        <div>{expiresAt.date}</div>
                                                        {expiresAt.time && <small>{expiresAt.time}</small>}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="gpt-team-time-cell">
                                                        <div>{updatedAt.date}</div>
                                                        {updatedAt.time && <small>{updatedAt.time}</small>}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="gpt-team-actions">
                                                        <button className="btn btn-sm btn-secondary" onClick={() => handleRefreshTeam(team)} disabled={membersActionLoading === `refresh-${team.id}`}>刷新</button>
                                                        <button className="btn btn-sm btn-secondary" onClick={() => handleOpenMembers(team)}>成员</button>
                                                        <button className="btn btn-sm" onClick={() => handleEditTeam(team)}>编辑</button>
                                                        <button className="btn btn-sm btn-danger" onClick={() => handleDeleteTeam(team)}>删除</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {teams.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>暂无 Team 数据</td></tr>}
                                </tbody>
                            </table>
                            </div>
                        )}
                    </div>
                    <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>共 {teamPagination.total || 0} 条</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="btn btn-sm" disabled={(teamPagination.currentPage || 1) <= 1} onClick={() => setTeamFilters(prev => ({ ...prev, page: Math.max(1, (prev.page || 1) - 1) }))}>上一页</button>
                            <span style={{ alignSelf: 'center' }}>{teamPagination.currentPage || 1} / {teamPagination.totalPages || 1}</span>
                            <button className="btn btn-sm" disabled={(teamPagination.currentPage || 1) >= (teamPagination.totalPages || 1)} onClick={() => setTeamFilters(prev => ({ ...prev, page: (prev.page || 1) + 1 }))}>下一页</button>
                        </div>
                    </div>
                </div>
            )}

            {membersModalOpen && (
                <div className="gpt-team-modal-backdrop" onClick={() => membersActionLoading ? null : setMembersModalOpen(false)}>
                    <div className="gpt-team-modal gpt-team-members-modal" onClick={e => e.stopPropagation()}>
                        <div className="gpt-team-modal-header">
                            <div>
                                <h3 className="gpt-team-modal-title">Team 成员管理</h3>
                                <p className="gpt-team-modal-subtitle">
                                    {memberModalTeam?.email || '-'} · {memberModalTeam?.teamName || '未命名 Team'} · {memberModalTeam?.currentMembers || 0}/{memberModalTeam?.maxMembers || 0}
                                </p>
                            </div>
                            <button className="gpt-team-modal-close" onClick={() => setMembersModalOpen(false)} aria-label="关闭">×</button>
                        </div>
                        <div className="gpt-team-modal-body">
                            <div className="gpt-team-members-toolbar">
                                <div className="gpt-team-members-add">
                                    <input
                                        className="input"
                                        placeholder="输入成员邮箱后发送邀请"
                                        value={memberEmailInput}
                                        onChange={e => setMemberEmailInput(e.target.value)}
                                    />
                                    <button className="btn btn-primary" onClick={handleAddMember} disabled={membersActionLoading === 'add-member' || membersLoading}>
                                        {membersActionLoading === 'add-member' ? '邀请中...' : '邀请成员'}
                                    </button>
                                </div>
                                <button className="btn" onClick={() => loadTeamMembers(memberModalTeam.id)} disabled={membersLoading}>重新加载</button>
                            </div>

                            {teamMembersData.error && (
                                <div className="gpt-team-members-error">{teamMembersData.error}</div>
                            )}

                            <div className="gpt-team-members-panels">
                                <div className="card gpt-team-members-panel">
                                    <div className="gpt-team-members-panel-head">
                                        <strong>已加入成员</strong>
                                        <span>{teamMembersData.members.filter(m => m.status === 'joined').length} 人</span>
                                    </div>
                                    <div className="gpt-team-members-table-wrap">
                                        <table className="admin-table gpt-team-members-table">
                                            <thead>
                                                <tr><th>邮箱</th><th>角色</th><th>加入时间</th><th>操作</th></tr>
                                            </thead>
                                            <tbody>
                                                {membersLoading ? (
                                                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '24px' }}>加载中...</td></tr>
                                                ) : teamMembersData.members.filter(m => m.status === 'joined').length === 0 ? (
                                                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>暂无已加入成员</td></tr>
                                                ) : (
                                                    teamMembersData.members.filter(m => m.status === 'joined').map(member => (
                                                        <tr key={`joined-${member.user_id || member.email}`}>
                                                            <td>{member.email || '-'}</td>
                                                            <td>{member.role === 'account-owner' ? '所有者' : (member.role || '成员')}</td>
                                                            <td>{member.added_at ? new Date(member.added_at).toLocaleString('zh-CN', { hour12: false }) : '-'}</td>
                                                            <td>
                                                                {member.role === 'account-owner' ? (
                                                                    <span style={{ color: 'var(--text-secondary)' }}>不可删除</span>
                                                                ) : (
                                                                    <button className="btn btn-sm btn-danger" onClick={() => handleDeleteMember(member)} disabled={membersActionLoading === `delete-${member.user_id}`}>
                                                                        {membersActionLoading === `delete-${member.user_id}` ? '删除中...' : '删除'}
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <div className="card gpt-team-members-panel">
                                    <div className="gpt-team-members-panel-head">
                                        <strong>待加入邀请</strong>
                                        <span>{teamMembersData.members.filter(m => m.status === 'invited').length} 人</span>
                                    </div>
                                    <div className="gpt-team-members-table-wrap">
                                        <table className="admin-table gpt-team-members-table">
                                            <thead>
                                                <tr><th>邮箱</th><th>状态</th><th>邀请时间</th><th>操作</th></tr>
                                            </thead>
                                            <tbody>
                                                {membersLoading ? (
                                                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '24px' }}>加载中...</td></tr>
                                                ) : teamMembersData.members.filter(m => m.status === 'invited').length === 0 ? (
                                                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>暂无待加入邀请</td></tr>
                                                ) : (
                                                    teamMembersData.members.filter(m => m.status === 'invited').map(member => (
                                                        <tr key={`invite-${member.email}`}>
                                                            <td>{member.email || '-'}</td>
                                                            <td>待加入</td>
                                                            <td>{member.added_at ? new Date(member.added_at).toLocaleString('zh-CN', { hour12: false }) : '-'}</td>
                                                            <td>
                                                                <button className="btn btn-sm" onClick={() => handleRevokeInvite(member)} disabled={membersActionLoading === `revoke-${member.email}`}>
                                                                    {membersActionLoading === `revoke-${member.email}` ? '撤回中...' : '撤回'}
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>

                            <div className="gpt-team-modal-actions">
                                <button className="btn" onClick={() => setMembersModalOpen(false)} disabled={!!membersActionLoading}>关闭</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showImportModal && (
                <div className="gpt-team-modal-backdrop" onClick={() => !importing && setShowImportModal(false)}>
                    <div className="gpt-team-modal" onClick={e => e.stopPropagation()}>
                        <div className="gpt-team-modal-header">
                            <div>
                                <h3 className="gpt-team-modal-title">导入 Team</h3>
                                <p className="gpt-team-modal-subtitle">沿用 team-manage 的导入结构，支持单个导入和批量流式导入。</p>
                            </div>
                            <button className="gpt-team-modal-close" onClick={() => setShowImportModal(false)} aria-label="关闭">×</button>
                        </div>
                        <div className="gpt-team-modal-body">
                            <div className="gpt-team-modal-tabs">
                                <button className={`gpt-team-modal-tab ${importMode === 'single' ? 'active' : ''}`} onClick={() => setImportMode('single')}>单个导入</button>
                                <button className={`gpt-team-modal-tab ${importMode === 'batch' ? 'active' : ''}`} onClick={() => setImportMode('batch')}>批量导入</button>
                            </div>

                            {importMode === 'single' ? (
                                <div className="gpt-team-import-form">
                                    <div className="gpt-team-form-field gpt-team-form-field-full">
                                        <label className="gpt-team-field-label">Access Token (AT) *</label>
                                        <input className="input" value={singleImport.access_token} onChange={e => setSingleImport(prev => ({ ...prev, access_token: e.target.value }))} placeholder="eyJ..." />
                                        <div className="gpt-team-field-hint">必填项，以 `eyJ` 开头的 JWT Token</div>
                                    </div>
                                    <div className="gpt-team-form-field">
                                        <label className="gpt-team-field-label">Session Token</label>
                                        <input className="input" value={singleImport.session_token} onChange={e => setSingleImport(prev => ({ ...prev, session_token: e.target.value }))} placeholder="eyJ..." />
                                        <div className="gpt-team-field-hint">可选，作为备选刷新方式</div>
                                    </div>
                                    <div className="gpt-team-form-field">
                                        <label className="gpt-team-field-label">Account ID</label>
                                        <input className="input" value={singleImport.account_id} onChange={e => setSingleImport(prev => ({ ...prev, account_id: e.target.value }))} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                                        <div className="gpt-team-field-hint">可选，如果不填写将从 API 自动获取</div>
                                    </div>
                                </div>
                            ) : (
                                <div className="gpt-team-batch-panel">
                                    <div className="gpt-team-form-field gpt-team-form-field-full">
                                    <label className="gpt-team-field-label">批量导入内容 <span className="required">*</span></label>
                                    <textarea
                                        className="input"
                                        style={{ minHeight: '240px', resize: 'vertical' }}
                                        value={batchContent}
                                        onChange={e => setBatchContent(e.target.value)}
                                        placeholder={'一行一个 AT Token...'}
                                    />
                                    <div className="gpt-team-field-hint">和 `team-manage` 一样，逐行解析 token，实时返回导入进度。</div>
                                    </div>
                                    {batchProgress.visible && (
                                        <div className="gpt-team-batch-progress">
                                            <div className="gpt-team-batch-progress-meta">
                                                <span>{batchProgress.stage}</span>
                                                <span>{batchProgress.percent}%</span>
                                            </div>
                                            <div className="gpt-team-batch-progress-bar">
                                                <div className="gpt-team-batch-progress-bar-fill" style={{ width: `${batchProgress.percent}%` }} />
                                            </div>
                                            <div className="gpt-team-batch-progress-stats">
                                                <span>成功: <span className="gpt-team-count-success">{batchProgress.success}</span></span>
                                                <span>失败: <span className="gpt-team-count-failed">{batchProgress.failed}</span></span>
                                            </div>
                                            {batchResults.length > 0 && (
                                                <div className="gpt-team-batch-results-wrap">
                                                    <div className="gpt-team-batch-results-head">
                                                        <strong>导入详情</strong>
                                                        <small>{batchSummary}</small>
                                                    </div>
                                                    <div className="gpt-team-batch-results-table-wrap">
                                                        <table className="admin-table" style={{ width: '100%', minWidth: 420 }}>
                                                            <thead><tr><th>邮箱</th><th>状态</th><th>消息</th></tr></thead>
                                                            <tbody>
                                                                {batchResults.map((res, idx) => (
                                                                    <tr key={`${res.email || 'unknown'}-${idx}`}>
                                                                        <td>{res.email || '未知'}</td>
                                                                        <td className={res.success ? 'gpt-team-status-success' : 'gpt-team-status-failed'}>{res.success ? '成功' : '失败'}</td>
                                                                        <td>{res.success ? (res.message || '导入成功') : (res.error || '导入失败')}</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="gpt-team-modal-actions">
                                <button className="btn" onClick={() => setShowImportModal(false)} disabled={importing}>取消</button>
                                <button
                                    className="btn btn-primary"
                                    disabled={importing || (importMode === 'single' ? !singleImport.access_token.trim() : !batchContent.trim())}
                                    onClick={() => importMode === 'single' ? handleSubmitSingleImport() : handleSubmitBatchImport()}
                                >
                                    {importing ? '导入中...' : '确定导入'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {section === 'records' && (
                <div>
                    <div className="stats-grid" style={{ marginBottom: '12px' }}>
                        <div className="stat-card card"><div className="stat-info"><span className="stat-value">{recordStats.total || 0}</span><span className="stat-label">总记录</span></div></div>
                        <div className="stat-card card"><div className="stat-info"><span className="stat-value">{recordStats.today || 0}</span><span className="stat-label">今日</span></div></div>
                        <div className="stat-card card"><div className="stat-info"><span className="stat-value">{recordStats.thisWeek || 0}</span><span className="stat-label">本周</span></div></div>
                        <div className="stat-card card"><div className="stat-info"><span className="stat-value">{recordStats.thisMonth || 0}</span><span className="stat-label">本月</span></div></div>
                    </div>
                    <div className="card" style={{ padding: '12px', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <input className="input" style={{ maxWidth: 200 }} placeholder="邮箱" value={recordFilters.email} onChange={e => setRecordFilters(prev => ({ ...prev, email: e.target.value }))} />
                            <input className="input" style={{ maxWidth: 160 }} placeholder="兑换码" value={recordFilters.code} onChange={e => setRecordFilters(prev => ({ ...prev, code: e.target.value }))} />
                            <input className="input" style={{ maxWidth: 120 }} placeholder="Team ID" value={recordFilters.teamId} onChange={e => setRecordFilters(prev => ({ ...prev, teamId: e.target.value }))} />
                            <input className="input" type="date" value={recordFilters.startDate} onChange={e => setRecordFilters(prev => ({ ...prev, startDate: e.target.value }))} />
                            <input className="input" type="date" value={recordFilters.endDate} onChange={e => setRecordFilters(prev => ({ ...prev, endDate: e.target.value }))} />
                            <button className="btn" onClick={() => { setRecordFilters(prev => ({ ...prev, page: 1 })); fetchRecords(); }}>查询</button>
                            <button className="btn btn-secondary" onClick={() => { setRecordFilters({ email: '', code: '', teamId: '', startDate: '', endDate: '', page: 1, perPage: 20 }); setTimeout(fetchRecords, 0); }}>重置</button>
                            <button className="btn btn-primary" onClick={handleAddRecord}>+ 新增记录</button>
                        </div>
                    </div>
                    <div className="card" style={{ overflowX: 'auto' }}>
                        {recordsLoading ? <div style={{ padding: 16 }}>加载中...</div> : (
                            <table className="admin-table" style={{ width: '100%', minWidth: 920 }}>
                                <thead>
                                    <tr>
                                        <th>ID</th><th>邮箱</th><th>兑换码</th><th>Team ID</th><th>Team 名称</th><th>Account ID</th><th>时间</th><th>质保</th><th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {records.map(r => (
                                        <tr key={r.id}>
                                            <td>{r.id}</td>
                                            <td>{r.email}</td>
                                            <td>{r.code || '-'}</td>
                                            <td>{r.teamId || '-'}</td>
                                            <td>{r.teamName || '-'}</td>
                                            <td>{r.accountId || '-'}</td>
                                            <td>{r.redeemedAt ? new Date(r.redeemedAt).toLocaleString('zh-CN', { hour12: false }) : '-'}</td>
                                            <td>{r.isWarrantyRedemption ? '是' : '否'}</td>
                                            <td><button className="btn btn-sm btn-danger" onClick={() => handleDeleteRecord(r.id)}>删除</button></td>
                                        </tr>
                                    ))}
                                    {records.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>暂无使用记录</td></tr>}
                                </tbody>
                            </table>
                        )}
                    </div>
                    <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>共 {recordPagination.total || 0} 条</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="btn btn-sm" disabled={(recordPagination.currentPage || 1) <= 1} onClick={() => setRecordFilters(prev => ({ ...prev, page: Math.max(1, (prev.page || 1) - 1) }))}>上一页</button>
                            <span style={{ alignSelf: 'center' }}>{recordPagination.currentPage || 1} / {recordPagination.totalPages || 1}</span>
                            <button className="btn btn-sm" disabled={(recordPagination.currentPage || 1) >= (recordPagination.totalPages || 1)} onClick={() => setRecordFilters(prev => ({ ...prev, page: (prev.page || 1) + 1 }))}>下一页</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}


function PixelApiTab() {
    const { user } = useAuth();
    const token = user?.token || localStorage.getItem('verifykey-token');
    const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

    const [activeSection, setActiveSection] = useState('status');
    const [health, setHealth] = useState(null);
    const [balance, setBalance] = useState(null);
    const [queue, setQueue] = useState(null);
    const [pixelConfig, setPixelConfig] = useState({ enabled: false, apiKey: '', baseUrl: 'https://iqless.icu', hasKey: false });
    const [configSaving, setConfigSaving] = useState(false);
    const [newApiKey, setNewApiKey] = useState('');
    const [newBaseUrl, setNewBaseUrl] = useState('');

    // KPixel (Pro) config state
    const [kpixelConfig, setKpixelConfig] = useState({ enabled: false, cdkey: '', hasKey: false, baseUrl: '', creditCost: 1.5 });
    const [newKPixelCdkey, setNewKPixelCdkey] = useState('');
    const [kpixelSaving, setKpixelSaving] = useState(false);
    const [kpixelBalance, setKpixelBalance] = useState(null);

    // VPixel config state
    const [vpixelConfig, setVpixelConfig] = useState({ enabled: false, card: '', hasCard: false, baseUrl: 'http://1688ai.vip', creditCost: 1.5 });
    const [newVPixelCard, setNewVPixelCard] = useState('');
    const [vpixelSaving, setVpixelSaving] = useState(false);
    const [vpixelQueue, setVpixelQueue] = useState(null);
    // VPixel card pool
    const [vpixelCards, setVpixelCards] = useState([]);
    const [vpixelCardStats, setVpixelCardStats] = useState({ total: 0, available: 0, used: 0 });
    const [vpixelNewCards, setVpixelNewCards] = useState('');
    const [vpixelAddingCards, setVpixelAddingCards] = useState(false);
    const [vpixelAddResult, setVpixelAddResult] = useState(null);

    // YPixel config state
    const [ypixelConfig, setYpixelConfig] = useState({ enabled: false, baseUrl: 'https://pixel.yh-mo.xyz', creditCost: 1.0 });
    const [ypixelCards, setYpixelCards] = useState([]);
    const [ypixelCardStats, setYpixelCardStats] = useState({ total: 0, available: 0, used: 0 });
    const [ypixelNewCards, setYpixelNewCards] = useState('');
    const [ypixelAddingCards, setYpixelAddingCards] = useState(false);
    const [ypixelAddResult, setYpixelAddResult] = useState(null);

    const [serviceMaint, setServiceMaint] = useState({ gemini_normal: false, gemini_advanced: false, gpt_plus: false, gpt_team: false });
    const [pixelJobs, setPixelJobs] = useState([]);
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyOffset, setHistoryOffset] = useState(0);
    const [historyTotal, setHistoryTotal] = useState(0);
    const HISTORY_LIMIT = 20;

    // Fetch status data
    const fetchStatus = async () => {
        try {
            const [hRes, bRes, qRes, kbRes, vqRes] = await Promise.all([
                fetch(`${API_BASE}/api/pixel/health`),
                fetch(`${API_BASE}/api/pixel/balance`, { headers: authHeaders }).catch(() => null),
                fetch(`${API_BASE}/api/pixel/queue`, { headers: authHeaders }).catch(() => null),
                fetch(`${API_BASE}/api/kpixel/balance`, { method: 'POST', headers: authHeaders }).catch(() => null),
                fetch(`${API_BASE}/api/vpixel/queue`).catch(() => null),
            ]);
            if (hRes.ok) setHealth(await hRes.json());
            if (bRes && bRes.ok) setBalance(await bRes.json());
            if (qRes && qRes.ok) setQueue(await qRes.json());
            if (kbRes && kbRes.ok) setKpixelBalance(await kbRes.json());
            if (vqRes && vqRes.ok) setVpixelQueue(await vqRes.json());
            // Fetch manual service maintenance state
            try {
                const smRes = await fetch(`${API_BASE}/api/service-status`);
                if (smRes.ok) {
                    const smData = await smRes.json();
                    if (smData.manual) setServiceMaint(smData.manual);
                }
            } catch {}
        } catch (e) {
            console.warn('Pixel status fetch error:', e);
        }
    };

    // Fetch config
    const fetchConfig = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/pixel/config`, { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                setPixelConfig(data);
                setNewBaseUrl(data.baseUrl || 'https://iqless.icu');
            }
        } catch (e) {
            console.warn('Pixel config fetch error:', e);
        }
        // Fetch KPixel config
        try {
            const res2 = await fetch(`${API_BASE}/api/kpixel/config`, { headers: authHeaders });
            if (res2.ok) {
                const data2 = await res2.json();
                setKpixelConfig(data2);
            }
        } catch (e) {
            console.warn('KPixel config fetch error:', e);
        }
        // Fetch VPixel config
        try {
            const res3 = await fetch(`${API_BASE}/api/vpixel/config`, { headers: authHeaders });
            if (res3.ok) {
                const data3 = await res3.json();
                setVpixelConfig(data3);
            }
        } catch (e) {
            console.warn('VPixel config fetch error:', e);
        }
        // Fetch VPixel card pool
        try {
            const [cRes, sRes] = await Promise.all([
                fetch(`${API_BASE}/api/vpixel/cards`, { headers: authHeaders }),
                fetch(`${API_BASE}/api/vpixel/cards/stats`, { headers: authHeaders }),
            ]);
            if (cRes.ok) { const d = await cRes.json(); setVpixelCards(d.keys || []); }
            if (sRes.ok) { const d = await sRes.json(); setVpixelCardStats(d); }
        } catch (e) {
            console.warn('VPixel cards fetch error:', e);
        }
        // Fetch YPixel config + cards
        try {
            const ycfg = await fetch(`${API_BASE}/api/ypixel/config`, { headers: authHeaders });
            if (ycfg.ok) setYpixelConfig(await ycfg.json());
            const [ycRes, ysRes] = await Promise.all([
                fetch(`${API_BASE}/api/ypixel/cards`, { headers: authHeaders }),
                fetch(`${API_BASE}/api/ypixel/cards/stats`, { headers: authHeaders }),
            ]);
            if (ycRes.ok) { const d = await ycRes.json(); setYpixelCards(d.keys || []); }
            if (ysRes.ok) { const d = await ysRes.json(); setYpixelCardStats(d); }
        } catch (e) {
            console.warn('YPixel config fetch error:', e);
        }
    };

    // Fetch history
    const fetchHistory = async (offset = 0) => {
        setHistoryLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/pixel/history?limit=${HISTORY_LIMIT}&offset=${offset}`, { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                setHistory(data.records || data.jobs || data.history || data.data || []);
                setHistoryTotal(data.total || 0);
                setHistoryOffset(offset);
            }
        } catch (e) {
            console.warn('Pixel history fetch error:', e);
        } finally {
            setHistoryLoading(false);
        }
    };

    // Initial fetch
    useEffect(() => {
        fetchStatus();
        fetchConfig();
        const interval = setInterval(fetchStatus, 10000);
        return () => clearInterval(interval);
    }, []);

    // SSE: listen to the existing admin verify-stream for Pixel events
    useEffect(() => {
        const sseToken = user?.token || localStorage.getItem('verifykey-token');
        if (!sseToken) return;

        const sseUrl = `${API_BASE}/api/admin/verify-stream?authorization=Bearer ${sseToken}`;
        const es = new EventSource(sseUrl);

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.source !== 'pixel' && data.source !== 'kpixel' && data.source !== 'vpixel' && data.source !== 'gpt') return;

                setPixelJobs(prev => {
                    const jobId = data.vid || '';
                    const existingIdx = prev.findIndex(j => j.jobId === jobId);

                    let status = 'processing';
                    if (data.step === 'result') {
                        status = data.success ? 'success' : 'failed';
                    } else if (data.step === 'submitted') {
                        status = 'submitted';
                    }

                    const isKPixel = data.source === 'kpixel' || data.source === 'vpixel' || data.source === 'gpt' || data.source === 'pixel_auto';

                    const entry = {
                        id: existingIdx >= 0 ? prev[existingIdx].id : Date.now() + Math.random(),
                        jobId,
                        email: data.link || '',
                        status,
                        stage: data.stage || 0,
                        totalStages: isKPixel ? 0 : (data.totalStages || 8),
                        stageLabel: data.stageLabel || '',
                        message: data.message || '',
                        url: data.url || (existingIdx >= 0 ? prev[existingIdx].url : ''),
                        error: data.error || '',
                        elapsed: data.elapsed || 0,
                        timestamp: new Date().toISOString(),
                        source: data.source || 'pixel',
                        channel: data.channel || (existingIdx >= 0 ? prev[existingIdx].channel : ''),
                        creditCost: data.creditCost || (existingIdx >= 0 ? prev[existingIdx].creditCost : null),
                    };

                    if (existingIdx >= 0) {
                        const newJobs = [...prev];
                        newJobs[existingIdx] = { ...newJobs[existingIdx], ...entry };
                        return newJobs;
                    } else {
                        return [entry, ...prev].slice(0, 200);
                    }
                });
            } catch (err) {
                // ignore parse errors
            }
        };

        es.onerror = () => { /* auto-reconnect */ };

        return () => es.close();
    }, []);

    // Save config
    const saveConfig = async () => {
        if (!token) {
            alert('保存失败: 未登录，请刷新页面重新登录');
            return;
        }
        setConfigSaving(true);
        try {
            const body = { enabled: pixelConfig.enabled };
            if (newApiKey.trim()) body.apiKey = newApiKey.trim();
            if (newBaseUrl.trim()) body.baseUrl = newBaseUrl.trim();

            const res = await fetch(`${API_BASE}/api/pixel/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                alert('✅ Pixel API 配置已保存');
                setNewApiKey('');
                await fetchConfig();
            } else {
                let errMsg = `HTTP ${res.status}`;
                try { const err = await res.json(); errMsg = err.detail || errMsg; } catch { try { errMsg = await res.text(); } catch {} }
                alert('保存失败: ' + errMsg);
            }
        } catch (e) {
            console.error('Save config error:', e);
            alert('保存失败: 网络错误 - ' + e.message);
        } finally {
            setConfigSaving(false);
        }
    };

    const maskEmail = (email) => {
        if (!email) return '';
        const [u, d] = email.split('@');
        if (!u || !d) return email;
        return (u.length > 3 ? u.slice(0, 2) + '***' + u.slice(-1) : u[0] + '***') + '@' + d;
    };

    const sections = [
        { id: 'status', label: '📊 状态' },
        { id: 'jobs', label: '🔄 实时任务' },
        { id: 'history', label: '📜 历史' },
        { id: 'config', label: '⚙️ 配置' },
    ];

    const activeJobs = pixelJobs.filter(j => j.status === 'processing' || j.status === 'submitted');
    const completedJobs = pixelJobs.filter(j => j.status === 'success' || j.status === 'failed');

    const statusColors = {
        submitted: { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.2)', color: '#3b82f6', icon: '◌' },
        processing: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)', color: '#f59e0b', icon: '◎' },
        success: { bg: 'rgba(22,163,74,0.08)', border: 'rgba(22,163,74,0.2)', color: '#16a34a', icon: '✓' },
        failed: { bg: 'rgba(220,38,38,0.08)', border: 'rgba(220,38,38,0.2)', color: '#dc2626', icon: '✕' },
    };

    return (
        <div className="tab-content">
            {/* Sub-tabs */}
            <div style={{ display: 'flex', gap: 'var(--spacing-xs)', marginBottom: 'var(--spacing-lg)', flexWrap: 'wrap' }}>
                {sections.map(s => (
                    <button key={s.id}
                        className={`btn btn-sm ${activeSection === s.id ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => {
                            setActiveSection(s.id);
                            if (s.id === 'history' && history.length === 0) fetchHistory(0);
                        }}
                    >{s.label}</button>
                ))}
            </div>

            {/* ===== Status Section ===== */}
            {activeSection === 'status' && (
                <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>📡 Pixel API 状态</span>
                        <button className="btn btn-sm btn-secondary" onClick={fetchStatus} style={{ padding: '2px 10px', fontSize: '12px' }}>🔄 刷新</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                        {/* UPixel Card */}
                        {(() => {
                            const isOnline = health?.status === 'ok' || health?.status === 'healthy';
                            const accent = isOnline ? '#16a34a' : '#dc2626';
                            return (
                                <div style={{
                                    borderRadius: '10px', padding: '12px 14px',
                                    background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
                                    borderLeft: `3px solid ${accent}`,
                                    display: 'flex', flexDirection: 'column', gap: '6px',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{
                                            width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                                            background: accent,
                                            boxShadow: `0 0 6px ${accent}66`,
                                        }} />
                                        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>📦 UPixel</span>
                                        <span style={{
                                            fontSize: '10px', fontWeight: 600, padding: '1px 7px', borderRadius: '8px', marginLeft: 'auto',
                                            background: isOnline ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
                                            color: accent,
                                        }}>{isOnline ? 'Online' : (health?.status || '—')}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                                        <span>📱 设备 {health?.devices?.connected ?? '-'}/{health?.devices?.total ?? '-'}</span>
                                        <span style={{ color: '#d97706', fontWeight: 600 }}>💰 余额 {balance?.balance ?? balance?.credits ?? '-'}</span>
                                        <span>📋 队列 {queue?.queued ?? queue?.queue_length ?? '-'}</span>
                                        {health?.devices?.ready !== undefined && <span>✅ 就绪 {health.devices.ready}</span>}
                                    </div>
                                </div>
                            );
                        })()}
                        {/* KPixel Card */}
                        {(() => {
                            const isOnline = kpixelBalance && !kpixelBalance.error;
                            const accent = isOnline ? '#7c3aed' : '#dc2626';
                            return (
                                <div style={{
                                    borderRadius: '10px', padding: '12px 14px',
                                    background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
                                    borderLeft: `3px solid ${accent}`,
                                    display: 'flex', flexDirection: 'column', gap: '6px',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{
                                            width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                                            background: accent,
                                            boxShadow: `0 0 6px ${accent}66`,
                                        }} />
                                        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>⚡ KPixel Pro</span>
                                        <span style={{
                                            fontSize: '10px', fontWeight: 600, padding: '1px 7px', borderRadius: '8px', marginLeft: 'auto',
                                            background: isOnline ? 'rgba(124,58,237,0.1)' : 'rgba(220,38,38,0.1)',
                                            color: accent,
                                        }}>{isOnline ? 'Online' : (kpixelConfig.enabled ? 'Error' : 'Disabled')}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                                        <span style={{ color: '#7c3aed', fontWeight: 600 }}>💎 余额 {kpixelBalance?.remaining_uses ?? kpixelBalance?.balance ?? '-'}</span>
                                    </div>
                                </div>
                            );
                        })()}
                        {/* VPixel Card */}
                        {(() => {
                            const isOnline = vpixelConfig.enabled && vpixelConfig.hasCard;
                            const accent = isOnline ? '#10b981' : '#dc2626';
                            return (
                                <div style={{
                                    borderRadius: '10px', padding: '12px 14px',
                                    background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
                                    borderLeft: `3px solid ${accent}`,
                                    display: 'flex', flexDirection: 'column', gap: '6px',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{
                                            width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                                            background: accent,
                                            boxShadow: `0 0 6px ${accent}66`,
                                        }} />
                                        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>🔮 VPixel</span>
                                        <span style={{
                                            fontSize: '10px', fontWeight: 600, padding: '1px 7px', borderRadius: '8px', marginLeft: 'auto',
                                            background: isOnline ? 'rgba(16,185,129,0.1)' : 'rgba(220,38,38,0.1)',
                                            color: accent,
                                        }}>{isOnline ? 'Online' : (vpixelConfig.enabled ? '未配置' : 'Disabled')}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                                        <span>📋 队列 {vpixelQueue?.data?.total ?? vpixelQueue?.queue ?? '-'}</span>
                                    </div>
                                </div>
                            );
                        })()}
                        {/* YPixel Card */}
                        {(() => {
                            const isOnline = ypixelConfig.enabled && ypixelCardStats.available > 0;
                            const accent = isOnline ? '#0ea5e9' : '#dc2626';
                            return (
                                <div style={{
                                    borderRadius: '10px', padding: '12px 14px',
                                    background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
                                    borderLeft: `3px solid ${accent}`,
                                    display: 'flex', flexDirection: 'column', gap: '6px',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{
                                            width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                                            background: accent,
                                            boxShadow: `0 0 6px ${accent}66`,
                                        }} />
                                        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>🌐 YPixel</span>
                                        <span style={{
                                            fontSize: '10px', fontWeight: 600, padding: '1px 7px', borderRadius: '8px', marginLeft: 'auto',
                                            background: isOnline ? 'rgba(14,165,233,0.1)' : 'rgba(220,38,38,0.1)',
                                            color: accent,
                                        }}>{ypixelConfig.enabled ? (isOnline ? 'Online' : '无卡密') : 'Disabled'}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                                        <span style={{ color: '#0ea5e9', fontWeight: 600 }}>🎫 卡密 {ypixelCardStats.available}/{ypixelCardStats.total}</span>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                    {/* Config status */}
                    <div className="card" style={{ padding: 'var(--spacing-md)', marginTop: 'var(--spacing-lg)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Pixel API:</span>
                            <span style={{
                                padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
                                background: pixelConfig.enabled ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
                                color: pixelConfig.enabled ? '#16a34a' : '#dc2626',
                            }}>
                                {pixelConfig.enabled ? '已启用' : '未启用'}
                            </span>
                            <span style={{
                                padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
                                background: pixelConfig.hasKey ? 'rgba(59,130,246,0.1)' : 'rgba(107,114,128,0.1)',
                                color: pixelConfig.hasKey ? '#3b82f6' : '#6b7280',
                            }}>
                                {pixelConfig.hasKey ? `Key: ${pixelConfig.apiKey || '***'}` : '未配置 Key'}
                            </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>KPixel API:</span>
                            <span style={{
                                padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
                                background: kpixelConfig.enabled ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
                                color: kpixelConfig.enabled ? '#16a34a' : '#dc2626',
                            }}>
                                {kpixelConfig.enabled ? '已启用' : '未启用'}
                            </span>
                            {kpixelConfig.hasKey && (
                                <span style={{
                                    padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
                                    background: 'rgba(59,130,246,0.1)', color: '#3b82f6',
                                }}>
                                    CDKey: {kpixelConfig.cdkey || '***'}
                                </span>
                            )}
                            {kpixelBalance && (
                                <span style={{
                                    padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
                                    background: 'rgba(139,92,246,0.1)', color: '#7c3aed',
                                }}>
                                    余额: {kpixelBalance.remaining_uses ?? kpixelBalance.balance ?? '-'}
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>VPixel API:</span>
                            <span style={{
                                padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
                                background: vpixelConfig.enabled ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
                                color: vpixelConfig.enabled ? '#16a34a' : '#dc2626',
                            }}>
                                {vpixelConfig.enabled ? '已启用' : '未启用'}
                            </span>
                            {vpixelConfig.hasCard && (
                                <span style={{
                                    padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
                                    background: 'rgba(16,185,129,0.1)', color: '#10b981',
                                }}>
                                    卡密: {vpixelConfig.card || '***'}
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>YPixel API:</span>
                            <span style={{
                                padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
                                background: ypixelConfig.enabled ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
                                color: ypixelConfig.enabled ? '#16a34a' : '#dc2626',
                            }}>
                                {ypixelConfig.enabled ? '已启用' : '未启用'}
                            </span>
                            <span style={{
                                padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
                                background: 'rgba(14,165,233,0.1)', color: '#0ea5e9',
                            }}>
                                卡密: {ypixelCardStats.available}/{ypixelCardStats.total}
                            </span>
                        </div>
                    </div>

                </>
            )}

            {/* ===== Real-time Job Monitor ===== */}
            {activeSection === 'jobs' && (
                <div className="card" style={{ padding: 'var(--spacing-lg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px', fontSize: '14px', flexWrap: 'wrap' }}>
                        <span>总计 <strong>{pixelJobs.length}</strong> 任务</span>
                        <span>|</span>
                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>
                            {activeJobs.length} 进行中
                        </span>
                        <span style={{ color: '#16a34a', fontWeight: 600 }}>
                            {completedJobs.filter(j => j.status === 'success').length} 成功
                        </span>
                        <span style={{ color: '#dc2626', fontWeight: 600 }}>
                            {completedJobs.filter(j => j.status === 'failed').length} 失败
                        </span>
                        <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }}
                            onClick={() => setPixelJobs([])}>清除</button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '700px', overflowY: 'auto' }}>
                        {pixelJobs.length === 0 && (
                            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '60px 20px' }}>
                                <div style={{ fontSize: '36px', marginBottom: '12px' }}>📡</div>
                                <p>暂无 Pixel API 任务</p>
                                <p style={{ fontSize: '13px', marginTop: '4px' }}>从验证页面提交账号后，实时进度将显示在这里</p>
                            </div>
                        )}
                        {pixelJobs.map((job) => {
                            const sc = statusColors[job.status] || statusColors.failed;
                            const progressPercent = job.totalStages > 0 ? (job.stage / job.totalStages) * 100 : 0;
                            const isActive = job.status === 'processing' || job.status === 'submitted';

                            return (
                                <div key={job.id} style={{
                                    display: 'flex', alignItems: 'flex-start', gap: '14px',
                                    padding: '14px 18px', borderRadius: '10px',
                                    background: sc.bg, border: `1px solid ${sc.border}`,
                                }}>
                                    <div style={{
                                        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                                        background: sc.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: '#fff', fontSize: '14px', fontWeight: 700, marginTop: '2px',
                                        ...(isActive ? { animation: 'pulse 1.5s ease-in-out infinite' } : {}),
                                    }}>{sc.icon}</div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                {/* Source badge */}
                                                {(() => {
                                                    const srcMap = {
                                                        pixel: { label: 'UPixel', bg: 'rgba(16,185,129,0.12)', color: '#059669' },
                                                        pixel_auto: { label: 'UPixel Auto', bg: 'rgba(234,88,12,0.12)', color: '#ea580c' },
                                                        kpixel: { label: 'KPixel', bg: 'rgba(124,92,252,0.12)', color: '#7c5cfc' },
                                                        vpixel: { label: 'VPixel', bg: 'rgba(6,182,212,0.12)', color: '#0891b2' },
                                                        gpt: { label: `GPT${job.channel ? '-' + job.channel.toUpperCase() : ''}`, bg: 'rgba(245,158,11,0.12)', color: '#d97706' },
                                                    };
                                                    const s = srcMap[job.source] || srcMap.pixel;
                                                    return (
                                                        <span style={{
                                                            fontSize: '10px', fontWeight: 700, padding: '1px 6px',
                                                            borderRadius: '4px', background: s.bg, color: s.color,
                                                            letterSpacing: '0.3px', lineHeight: '18px', whiteSpace: 'nowrap',
                                                        }}>{s.label}</span>
                                                    );
                                                })()}
                                                <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                                                    {maskEmail(job.email)}
                                                </span>
                                                {isActive && (
                                                    <span style={{
                                                        fontSize: '11px', padding: '1px 8px', borderRadius: '10px',
                                                        background: sc.color, color: '#fff', fontWeight: 600,
                                                    }}>
                                                        {job.status === 'submitted' ? '已提交'
                                                            : job.totalStages > 0 ? `${job.stage}/${job.totalStages}`
                                                            : (job.stageLabel || '运行中')}
                                                    </span>
                                                )}
                                                {job.status === 'success' && (
                                                    <span style={{
                                                        fontSize: '11px', padding: '1px 8px', borderRadius: '10px',
                                                        background: '#16a34a', color: '#fff', fontWeight: 600,
                                                    }}>成功</span>
                                                )}
                                                {job.status === 'failed' && (
                                                    <span style={{
                                                        fontSize: '11px', padding: '1px 8px', borderRadius: '10px',
                                                        background: '#dc2626', color: '#fff', fontWeight: 600,
                                                    }}>失败</span>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                {job.elapsed > 0 && (
                                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{job.elapsed}s</span>
                                                )}
                                                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                    {new Date(job.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                                                </span>
                                            </div>
                                        </div>
                                        {/* Stage progress bar for active jobs */}
                                        {isActive && job.totalStages > 0 && (
                                            <div style={{
                                                height: '4px', borderRadius: '2px', marginTop: '8px',
                                                background: 'rgba(255,255,255,0.1)', overflow: 'hidden',
                                            }}>
                                                <div style={{
                                                    height: '100%', borderRadius: '2px',
                                                    width: `${progressPercent}%`,
                                                    background: sc.color,
                                                    transition: 'width 0.5s ease',
                                                }} />
                                            </div>
                                        )}
                                        {/* Message */}
                                        {job.message && (
                                            <div style={{
                                                fontSize: '13px', fontWeight: 600, color: sc.color,
                                                marginTop: '4px', wordBreak: 'break-all',
                                            }}>
                                                {job.message.replace(/^[❌✅✓✕⏳🔄\s]+/, '')}
                                            </div>
                                        )}
                                        {/* URL for success */}
                                        {job.status === 'success' && job.url && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                                                <a href={job.url} target="_blank" rel="noopener noreferrer"
                                                    style={{
                                                        fontSize: '12px', color: '#3b82f6', textDecoration: 'underline',
                                                        wordBreak: 'break-all', maxWidth: '90%',
                                                    }}>
                                                    🔗 {job.url.length > 60 ? job.url.slice(0, 57) + '...' : job.url}
                                                </a>
                                                <button
                                                    onClick={() => navigator.clipboard.writeText(job.url)}
                                                    style={{
                                                        background: 'none', border: 'none', cursor: 'pointer',
                                                        fontSize: '14px', padding: '2px',
                                                    }}
                                                    title="复制链接"
                                                >📋</button>
                                            </div>
                                        )}
                                        {/* Credit Cost */}
                                        {job.status === 'success' && job.creditCost > 0 && (
                                            <span style={{
                                                display: 'inline-block', marginTop: '4px',
                                                fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px',
                                                background: 'rgba(220, 38, 38, 0.08)', color: '#dc2626',
                                            }}>💰 扣除 {job.creditCost} 积分</span>
                                        )}
                                        {/* Job ID */}
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                            ID: {job.jobId?.slice(0, 12) || '-'}...
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ===== History Section ===== */}
            {activeSection === 'history' && (
                <div className="card" style={{ padding: 'var(--spacing-lg)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                        <h3>📜 Pixel API 历史 ({historyTotal})</h3>
                        <button className="btn btn-sm btn-secondary" onClick={() => fetchHistory(0)} disabled={historyLoading}>
                            {historyLoading ? '⏳' : '🔄'} 刷新
                        </button>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>邮箱</th>
                                    <th>状态</th>
                                    <th>URL</th>
                                    <th>时间</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.length === 0 && (
                                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: 'var(--spacing-xl)', color: 'var(--text-muted)' }}>暂无历史记录</td></tr>
                                )}
                                {history.map((item, i) => (
                                    <tr key={item.job_id || item.email + i}>
                                        <td>{maskEmail(item.email || '')}</td>
                                        <td>
                                            <span className={`badge badge-${(item.status === 'failed') ? 'error' : 'success'}`}>
                                                {(item.status === 'failed') ? '❌ 失败' : '✅ 成功'}
                                            </span>
                                        </td>
                                        <td>
                                            {item.url ? (
                                                <a href={item.url} target="_blank" rel="noopener noreferrer"
                                                    style={{ fontSize: '12px', color: '#3b82f6' }}>
                                                    {item.url.length > 40 ? item.url.slice(0, 37) + '...' : item.url}
                                                </a>
                                            ) : '-'}
                                        </td>
                                        <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                                            {item.completed_at || item.created_at ? new Date(item.completed_at || item.created_at).toLocaleString('zh-CN', { hour12: false }) : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {/* Pagination */}
                    {historyTotal > HISTORY_LIMIT && (
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: 'var(--spacing-md)' }}>
                            <button className="btn btn-sm btn-secondary"
                                disabled={historyOffset === 0 || historyLoading}
                                onClick={() => fetchHistory(Math.max(0, historyOffset - HISTORY_LIMIT))}
                            >◀ 上一页</button>
                            <span style={{ fontSize: '13px', color: 'var(--text-secondary)', alignSelf: 'center' }}>
                                {historyOffset + 1}-{Math.min(historyOffset + HISTORY_LIMIT, historyTotal)} / {historyTotal}
                            </span>
                            <button className="btn btn-sm btn-secondary"
                                disabled={historyOffset + HISTORY_LIMIT >= historyTotal || historyLoading}
                                onClick={() => fetchHistory(historyOffset + HISTORY_LIMIT)}
                            >下一页 ▶</button>
                        </div>
                    )}
                </div>
            )}

            {/* ===== Config Section ===== */}
            {activeSection === 'config' && (
                <div className="card" style={{ padding: 'var(--spacing-lg)' }}>
                    <h3 style={{ marginBottom: 'var(--spacing-lg)' }}>⚙️ Pixel API 配置</h3>
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        {/* Enable toggle */}
                        <div className="card" style={{ padding: 'var(--spacing-md)', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                <span>📦</span>
                                <strong>启用 UPixel 普通验证</strong>
                                <label style={{ marginLeft: 'auto', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: pixelConfig.enabled ? '#16a34a' : '#dc2626' }}>
                                        {pixelConfig.enabled ? '🟢 已启用' : '🔴 未启用'}
                                    </span>
                                    <input type="checkbox" checked={pixelConfig.enabled}
                                        onChange={e => setPixelConfig({ ...pixelConfig, enabled: e.target.checked })} />
                                </label>
                            </div>
                        </div>
                        {/* API Key */}
                        <div>
                            <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                                API Key {pixelConfig.hasKey && <span style={{ color: '#16a34a', fontWeight: 600 }}>（已配置: {pixelConfig.apiKey}）</span>}
                            </label>
                            <input className="input" type="password"
                                value={newApiKey}
                                onChange={e => setNewApiKey(e.target.value)}
                                placeholder={pixelConfig.hasKey ? '留空保持不变，输入新 Key 更新' : 'ak_XXXX-XXXX-XXXX-XXXX'}
                                style={{ width: '100%' }}
                            />
                        </div>
                        {/* Base URL */}
                        <div>
                            <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                                API Base URL
                            </label>
                            <input className="input"
                                value={newBaseUrl}
                                onChange={e => setNewBaseUrl(e.target.value)}
                                placeholder="https://iqless.icu"
                                style={{ width: '100%' }}
                            />
                        </div>
                    </div>
                    <button className="btn btn-primary" style={{ marginTop: 'var(--spacing-lg)' }}
                        onClick={saveConfig} disabled={configSaving}>
                        {configSaving ? '⏳ 保存中...' : '💾 保存 UPixel 配置'}
                    </button>

                    {/* KPixel Pro Config */}
                    <h4 style={{ marginTop: 'var(--spacing-xl)', marginBottom: 'var(--spacing-md)', borderTop: '1px solid var(--border-primary)', paddingTop: 'var(--spacing-lg)' }}>⚡ KPixel Pro 配置</h4>
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        <div className="card" style={{ padding: 'var(--spacing-md)', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                <span>⚡</span>
                                <strong>启用 KPixel Pro</strong>
                                <label style={{ marginLeft: 'auto', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: kpixelConfig.enabled ? '#16a34a' : '#dc2626' }}>
                                        {kpixelConfig.enabled ? '🟢 已启用' : '🔴 未启用'}
                                    </span>
                                    <input type="checkbox" checked={kpixelConfig.enabled}
                                        onChange={e => setKpixelConfig({ ...kpixelConfig, enabled: e.target.checked })} />
                                </label>
                            </div>
                        </div>
                        <div>
                            <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                                CDKey {kpixelConfig.hasKey && <span style={{ color: '#16a34a', fontWeight: 600 }}>（已配置: {kpixelConfig.cdkey}）</span>}
                            </label>
                            <input className="input" type="password"
                                value={newKPixelCdkey}
                                onChange={e => setNewKPixelCdkey(e.target.value)}
                                placeholder={kpixelConfig.hasKey ? '留空保持不变' : 'K-XXXXX...'}
                                style={{ width: '100%' }}
                            />
                        </div>
                    </div>
                    <button className="btn btn-primary" style={{ marginTop: 'var(--spacing-md)' }}
                        onClick={async () => {
                            if (!token) { alert('未登录'); return; }
                            setKpixelSaving(true);
                            try {
                                const body = { enabled: kpixelConfig.enabled };
                                if (newKPixelCdkey.trim()) body.cdkey = newKPixelCdkey.trim();
                                const res = await fetch(`${API_BASE}/api/kpixel/config`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                    body: JSON.stringify(body),
                                });
                                if (res.ok) {
                                    alert('✅ KPixel 配置已保存');
                                    setNewKPixelCdkey('');
                                    await fetchConfig();
                                } else {
                                    let errMsg = `HTTP ${res.status}`;
                                    try { const err = await res.json(); errMsg = err.detail || errMsg; } catch {}
                                    alert('保存失败: ' + errMsg);
                                }
                            } catch (e) {
                                alert('保存失败: ' + e.message);
                            } finally {
                                setKpixelSaving(false);
                            }
                        }} disabled={kpixelSaving}>
                        {kpixelSaving ? '⏳ 保存中...' : '💾 保存 KPixel 配置'}
                    </button>

                    {/* VPixel Config */}
                    <h4 style={{ marginTop: 'var(--spacing-xl)', marginBottom: 'var(--spacing-md)', borderTop: '1px solid var(--border-primary)', paddingTop: 'var(--spacing-lg)' }}>🔮 VPixel 配置（与 KPixel 共享高级验证通道）</h4>
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        <div className="card" style={{ padding: 'var(--spacing-md)', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                <span>🔮</span>
                                <strong>启用 VPixel</strong>
                                <label style={{ marginLeft: 'auto', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: vpixelConfig.enabled ? '#16a34a' : '#dc2626' }}>
                                        {vpixelConfig.enabled ? '🟢 已启用' : '🔴 未启用'}
                                    </span>
                                    <input type="checkbox" checked={vpixelConfig.enabled}
                                        onChange={async e => {
                                            const val = e.target.checked;
                                            setVpixelConfig({ ...vpixelConfig, enabled: val });
                                            try {
                                                await fetch(`${API_BASE}/api/vpixel/config`, {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                                    body: JSON.stringify({ enabled: val }),
                                                });
                                            } catch {}
                                        }} />
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* VPixel Card Pool Stats */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginTop: '16px' }}>
                        {[
                            { emoji: '🎫', value: vpixelCardStats.total, label: '总卡密', color: '#6366f1' },
                            { emoji: '✅', value: vpixelCardStats.available, label: '可用', color: '#16a34a' },
                            { emoji: '📦', value: vpixelCardStats.used, label: '已使用', color: '#9ca3af' },
                        ].map((s, i) => (
                            <div key={i} className="card" style={{ padding: '16px', textAlign: 'center' }}>
                                <div style={{ fontSize: '20px' }}>{s.emoji}</div>
                                <div style={{ fontSize: '24px', fontWeight: 700, color: s.color }}>{s.value}</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{s.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* VPixel Batch Add Cards */}
                    <div className="card" style={{ padding: 'var(--spacing-md)', marginTop: '16px' }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>📝 批量添加 VPixel 卡密</div>
                        <textarea
                            className="input"
                            value={vpixelNewCards}
                            onChange={e => setVpixelNewCards(e.target.value)}
                            placeholder="每行一个卡密，例如：\nABTHQDTMXKLA2F3L\nXYZ123ABC456DEF7"
                            rows={4}
                            style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px' }}
                        />
                        {vpixelAddResult && (
                            <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border-primary)', marginTop: '10px' }}>
                                {vpixelAddResult.error ? (
                                    <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', color: '#dc2626', fontSize: '13px', fontWeight: 500 }}>
                                        ❌ {vpixelAddResult.error}
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ padding: '10px 14px', background: 'var(--bg-secondary)', fontSize: '13px', fontWeight: 600, display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                            <span>输入 {vpixelAddResult.total_input} 个</span>
                                            {vpixelAddResult.valid > 0 && <span style={{ color: '#059669' }}>✅ 有效 {vpixelAddResult.valid}</span>}
                                            {vpixelAddResult.invalid > 0 && <span style={{ color: '#dc2626' }}>❌ 无效 {vpixelAddResult.invalid}</span>}
                                            {vpixelAddResult.duplicate > 0 && <span style={{ color: '#d97706' }}>⚠️ 重复 {vpixelAddResult.duplicate}</span>}
                                        </div>
                                        {vpixelAddResult.results && vpixelAddResult.results.length > 0 && (
                                            <div style={{ maxHeight: '200px', overflow: 'auto', fontSize: '12px' }}>
                                                {vpixelAddResult.results.map((r, i) => (
                                                    <div key={i} style={{
                                                        padding: '6px 14px', borderTop: '1px solid var(--border-primary)',
                                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                        background: r.status === 'valid' ? 'rgba(16,185,129,0.04)' : r.status === 'invalid' ? 'rgba(239,68,68,0.04)' : 'rgba(245,158,11,0.04)',
                                                    }}>
                                                        <span style={{ fontFamily: "'SF Mono', monospace", maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.key}</span>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                            {r.status === 'valid' && r.remaining !== undefined && (
                                                                <span style={{
                                                                    padding: '1px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 600,
                                                                    background: 'rgba(14,165,233,0.1)', color: '#0ea5e9',
                                                                }}>
                                                                    额度 {r.remaining}/{r.total_count}
                                                                </span>
                                                            )}
                                                            <span style={{
                                                                color: r.status === 'valid' ? '#059669' : r.status === 'invalid' ? '#dc2626' : '#d97706',
                                                                fontWeight: 500,
                                                            }}>{r.status === 'valid' ? '✅' : r.status === 'invalid' ? '❌' : '⚠️'} {r.msg}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                        <button
                            className="btn btn-primary"
                            style={{ marginTop: '8px' }}
                            disabled={vpixelAddingCards || !vpixelNewCards.trim()}
                            onClick={async () => {
                                setVpixelAddingCards(true);
                                setVpixelAddResult(null);
                                try {
                                    const res = await fetch(`${API_BASE}/api/vpixel/cards`, {
                                        method: 'POST',
                                        headers: authHeaders,
                                        body: JSON.stringify({ keys: vpixelNewCards }),
                                    });
                                    const data = await res.json();
                                    if (data.success) {
                                        setVpixelAddResult(data);
                                        setVpixelNewCards('');
                                        // Refresh cards
                                        const [cRes, sRes] = await Promise.all([
                                            fetch(`${API_BASE}/api/vpixel/cards`, { headers: authHeaders }),
                                            fetch(`${API_BASE}/api/vpixel/cards/stats`, { headers: authHeaders }),
                                        ]);
                                        if (cRes.ok) { const d = await cRes.json(); setVpixelCards(d.keys || []); }
                                        if (sRes.ok) { const d = await sRes.json(); setVpixelCardStats(d); }
                                    } else {
                                        setVpixelAddResult({ error: data.detail || '添加失败' });
                                    }
                                } catch (e) { setVpixelAddResult({ error: e.message }); }
                                finally { setVpixelAddingCards(false); }
                            }}
                        >
                            {vpixelAddingCards ? '🔄 验证并添加中...' : `添加卡密 (${vpixelNewCards.split('\n').filter(l => l.trim()).length} 个)`}
                        </button>
                    </div>

                    {/* VPixel Card List */}
                    <div className="card" style={{ overflow: 'hidden', marginTop: '16px' }}>
                        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>📋 VPixel 卡密列表</span>
                            <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>{vpixelCards.length} 条记录</span>
                        </div>
                        <div style={{ overflow: 'auto', maxHeight: '300px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                <thead>
                                    <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0 }}>
                                        <th style={{ padding: '8px 12px', textAlign: 'left' }}>卡密</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'center' }}>状态</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'center' }}>额度</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'left' }}>使用邮箱</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'center' }}>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {vpixelCards.map(k => (
                                        <tr key={k.id} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                                            <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{k.card_key}</td>
                                            <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                                <span style={{
                                                    fontSize: '11px', padding: '2px 8px', borderRadius: '10px', fontWeight: 600,
                                                    background: k.status === 'available' ? '#dcfce7' : k.status === 'used' ? '#f3f4f6' : '#fef2f2',
                                                    color: k.status === 'available' ? '#16a34a' : k.status === 'used' ? '#6b7280' : '#dc2626',
                                                }}>{k.status === 'available' ? '可用' : k.status === 'used' ? '已使用' : k.status === 'reserved' ? '使用中' : '无效'}</span>
                                            </td>
                                            <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                                {(k.remaining != null && k.total_count != null) ? (
                                                    <span style={{
                                                        fontSize: '11px', padding: '2px 8px', borderRadius: '10px', fontWeight: 600,
                                                        background: k.remaining > 0 ? 'rgba(14,165,233,0.1)' : 'rgba(107,114,128,0.1)',
                                                        color: k.remaining > 0 ? '#0ea5e9' : '#9ca3af',
                                                    }}>{k.remaining}/{k.total_count}</span>
                                                ) : '-'}
                                            </td>
                                            <td style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-secondary)' }}>{k.used_by_email || '-'}</td>
                                            <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                                <button
                                                    onClick={async () => {
                                                        await fetch(`${API_BASE}/api/vpixel/cards/${k.id}`, { method: 'DELETE', headers: authHeaders });
                                                        setVpixelCards(prev => prev.filter(c => c.id !== k.id));
                                                        setVpixelCardStats(prev => ({
                                                            ...prev,
                                                            total: prev.total - 1,
                                                            available: k.status === 'available' ? prev.available - 1 : prev.available,
                                                            used: k.status === 'used' ? prev.used - 1 : prev.used,
                                                        }));
                                                    }}
                                                    style={{
                                                        background: 'none', border: 'none', color: '#dc2626',
                                                        cursor: 'pointer', fontSize: '12px', fontWeight: 500
                                                    }}
                                                >🗑️</button>
                                            </td>
                                        </tr>
                                    ))}
                                    {vpixelCards.length === 0 && (
                                        <tr>
                                            <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                                                暂无卡密，请先添加
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* YPixel Config */}
                    <h4 style={{ marginTop: 'var(--spacing-xl)', marginBottom: 'var(--spacing-md)', borderTop: '1px solid var(--border-primary)', paddingTop: 'var(--spacing-lg)' }}>🌐 YPixel 配置（普通验证通道）</h4>
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        <div className="card" style={{ padding: 'var(--spacing-md)', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                <span>🌐</span>
                                <strong>启用 YPixel</strong>
                                <label style={{ marginLeft: 'auto', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: ypixelConfig.enabled ? '#16a34a' : '#dc2626' }}>
                                        {ypixelConfig.enabled ? '🟢 已启用' : '🔴 未启用'}
                                    </span>
                                    <input type="checkbox" checked={ypixelConfig.enabled}
                                        onChange={async e => {
                                            const val = e.target.checked;
                                            setYpixelConfig({ ...ypixelConfig, enabled: val });
                                            try {
                                                await fetch(`${API_BASE}/api/ypixel/config`, {
                                                    method: 'POST', headers: authHeaders,
                                                    body: JSON.stringify({ enabled: val }),
                                                });
                                            } catch {}
                                        }} />
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* YPixel Card Pool Stats */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginTop: '16px' }}>
                        {[
                            { emoji: '🎫', value: ypixelCardStats.total, label: '总卡密', color: '#6366f1' },
                            { emoji: '✅', value: ypixelCardStats.available, label: '可用', color: '#16a34a' },
                            { emoji: '📦', value: ypixelCardStats.used, label: '已使用', color: '#9ca3af' },
                        ].map((s, i) => (
                            <div key={i} className="card" style={{ padding: '16px', textAlign: 'center' }}>
                                <div style={{ fontSize: '20px' }}>{s.emoji}</div>
                                <div style={{ fontSize: '24px', fontWeight: 700, color: s.color }}>{s.value}</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{s.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* YPixel Batch Add Cards */}
                    <div className="card" style={{ padding: 'var(--spacing-md)', marginTop: '16px' }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>📝 批量添加 YPixel 卡密</div>
                        <textarea
                            className="input"
                            value={ypixelNewCards}
                            onChange={e => setYpixelNewCards(e.target.value)}
                            placeholder={"每行一个卡密，例如：\n2028-8139-5D2A-5095-3D51"}
                            rows={4}
                            style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px' }}
                        />
                        {ypixelAddResult && (
                            <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border-primary)', marginTop: '10px' }}>
                                {ypixelAddResult.error ? (
                                    <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', color: '#dc2626', fontSize: '13px', fontWeight: 500 }}>
                                        ❌ {ypixelAddResult.error}
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ padding: '10px 14px', background: 'var(--bg-secondary)', fontSize: '13px', fontWeight: 600, display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                            <span>输入 {ypixelAddResult.total_input} 个</span>
                                            {ypixelAddResult.valid > 0 && <span style={{ color: '#059669' }}>✅ 有效 {ypixelAddResult.valid}</span>}
                                            {ypixelAddResult.invalid > 0 && <span style={{ color: '#dc2626' }}>❌ 无效 {ypixelAddResult.invalid}</span>}
                                            {ypixelAddResult.duplicate > 0 && <span style={{ color: '#d97706' }}>⚠️ 重复 {ypixelAddResult.duplicate}</span>}
                                        </div>
                                        {ypixelAddResult.results && ypixelAddResult.results.length > 0 && (
                                            <div style={{ maxHeight: '200px', overflow: 'auto', fontSize: '12px' }}>
                                                {ypixelAddResult.results.map((r, i) => (
                                                    <div key={i} style={{
                                                        padding: '6px 14px', borderTop: '1px solid var(--border-primary)',
                                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                        background: r.status === 'valid' ? 'rgba(16,185,129,0.04)' : r.status === 'invalid' ? 'rgba(239,68,68,0.04)' : 'rgba(245,158,11,0.04)',
                                                    }}>
                                                        <span style={{ fontFamily: "'SF Mono', monospace", maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.key}</span>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                            {r.status === 'valid' && r.remaining !== undefined && (
                                                                <span style={{
                                                                    padding: '1px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 600,
                                                                    background: 'rgba(14,165,233,0.1)', color: '#0ea5e9',
                                                                }}>
                                                                    额度 {r.remaining}/{r.total_count}
                                                                </span>
                                                            )}
                                                            <span style={{
                                                                color: r.status === 'valid' ? '#059669' : r.status === 'invalid' ? '#dc2626' : '#d97706',
                                                                fontWeight: 500,
                                                            }}>{r.status === 'valid' ? '✅' : r.status === 'invalid' ? '❌' : '⚠️'} {r.msg}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                        <button
                            className="btn btn-primary"
                            style={{ marginTop: '8px' }}
                            disabled={ypixelAddingCards || !ypixelNewCards.trim()}
                            onClick={async () => {
                                setYpixelAddingCards(true);
                                setYpixelAddResult(null);
                                try {
                                    const res = await fetch(`${API_BASE}/api/ypixel/cards`, {
                                        method: 'POST', headers: authHeaders,
                                        body: JSON.stringify({ keys: ypixelNewCards }),
                                    });
                                    const data = await res.json();
                                    if (data.success) {
                                        setYpixelAddResult(data);
                                        setYpixelNewCards('');
                                        const [cRes, sRes] = await Promise.all([
                                            fetch(`${API_BASE}/api/ypixel/cards`, { headers: authHeaders }),
                                            fetch(`${API_BASE}/api/ypixel/cards/stats`, { headers: authHeaders }),
                                        ]);
                                        if (cRes.ok) { const d = await cRes.json(); setYpixelCards(d.keys || []); }
                                        if (sRes.ok) { const d = await sRes.json(); setYpixelCardStats(d); }
                                    } else {
                                        setYpixelAddResult({ error: data.detail || '添加失败' });
                                    }
                                } catch (e) { setYpixelAddResult({ error: e.message }); }
                                finally { setYpixelAddingCards(false); }
                            }}
                        >
                            {ypixelAddingCards ? '🔄 验证并添加中...' : `添加卡密 (${ypixelNewCards.split('\n').filter(l => l.trim()).length} 个)`}
                        </button>
                    </div>

                    {/* YPixel Card List */}
                    <div className="card" style={{ overflow: 'hidden', marginTop: '16px' }}>
                        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>📋 YPixel 卡密列表</span>
                            <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>{ypixelCards.length} 条记录</span>
                        </div>
                        <div style={{ overflow: 'auto', maxHeight: '300px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                <thead>
                                    <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0 }}>
                                        <th style={{ padding: '8px 12px', textAlign: 'left' }}>卡密</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'center' }}>状态</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'center' }}>额度</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'left' }}>使用邮箱</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'center' }}>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ypixelCards.map(k => (
                                        <tr key={k.id} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                                            <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{k.card_key}</td>
                                            <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                                <span style={{
                                                    fontSize: '11px', padding: '2px 8px', borderRadius: '10px', fontWeight: 600,
                                                    background: k.status === 'available' ? '#dcfce7' : k.status === 'used' ? '#f3f4f6' : '#fef2f2',
                                                    color: k.status === 'available' ? '#16a34a' : k.status === 'used' ? '#6b7280' : '#dc2626',
                                                }}>{k.status === 'available' ? '可用' : k.status === 'used' ? '已使用' : k.status === 'reserved' ? '使用中' : '无效'}</span>
                                            </td>
                                            <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                                {(k.remaining != null && k.total_count != null) ? (
                                                    <span style={{
                                                        fontSize: '11px', padding: '2px 8px', borderRadius: '10px', fontWeight: 600,
                                                        background: k.remaining > 0 ? 'rgba(14,165,233,0.1)' : 'rgba(107,114,128,0.1)',
                                                        color: k.remaining > 0 ? '#0ea5e9' : '#9ca3af',
                                                    }}>{k.remaining}/{k.total_count}</span>
                                                ) : '-'}
                                            </td>
                                            <td style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-secondary)' }}>{k.used_by_email || '-'}</td>
                                            <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                                <button
                                                    onClick={async () => {
                                                        await fetch(`${API_BASE}/api/ypixel/cards/${k.id}`, { method: 'DELETE', headers: authHeaders });
                                                        setYpixelCards(prev => prev.filter(c => c.id !== k.id));
                                                        setYpixelCardStats(prev => ({
                                                            ...prev,
                                                            total: prev.total - 1,
                                                            available: k.status === 'available' ? prev.available - 1 : prev.available,
                                                            used: k.status === 'used' ? prev.used - 1 : prev.used,
                                                        }));
                                                    }}
                                                    style={{
                                                        background: 'none', border: 'none', color: '#dc2626',
                                                        cursor: 'pointer', fontSize: '12px', fontWeight: 500
                                                    }}
                                                >🗑️</button>
                                            </td>
                                        </tr>
                                    ))}
                                    {ypixelCards.length === 0 && (
                                        <tr>
                                            <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                                                暂无卡密，请先添加
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
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
    const [selectedCdks, setSelectedCdks] = useState(new Set());
    const [batchDeleting, setBatchDeleting] = useState(false);

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
            if (res.ok) { setSelectedCdks(prev => { const next = new Set(prev); next.delete(code); return next; }); await fetchCDKs(); }
            else alert('删除失败');
        } catch (e) { alert('删除失败: ' + e.message); }
    };

    const handleBatchDelete = async () => {
        if (selectedCdks.size === 0) return;
        if (!confirm(`确定删除选中的 ${selectedCdks.size} 个 CDK？此操作不可恢复！`)) return;
        setBatchDeleting(true);
        try {
            const res = await fetch(`${API_BASE}/api/cdk/batch-delete`, {
                method: 'POST', headers: authHeaders,
                body: JSON.stringify({ codes: Array.from(selectedCdks) })
            });
            if (res.ok) {
                const data = await res.json();
                setSelectedCdks(new Set());
                await fetchCDKs();
                alert(`✅ ${data.message}`);
            } else {
                const err = await res.json();
                alert('批量删除失败: ' + (err.detail || '未知错误'));
            }
        } catch (e) { alert('批量删除失败: ' + e.message); }
        finally { setBatchDeleting(false); }
    };

    const toggleSelectCdk = (code) => {
        setSelectedCdks(prev => {
            const next = new Set(prev);
            if (next.has(code)) next.delete(code);
            else next.add(code);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedCdks.size === filteredList.length) {
            setSelectedCdks(new Set());
        } else {
            setSelectedCdks(new Set(filteredList.map(c => c.code)));
        }
    };

    const handleConsume = async (code) => {
        if (!confirm(`确定手动消耗 CDK: ${code} 的 1 个额度？`)) return;
        try {
            const res = await fetch(`${API_BASE}/api/cdk/consume`, {
                method: 'POST', headers: authHeaders,
                body: JSON.stringify({ code })
            });
            if (res.ok) {
                const data = await res.json();
                alert(`✅ ${data.message}`);
                await fetchCDKs();
            } else {
                const err = await res.json();
                alert('消耗失败: ' + (err.detail || '未知错误'));
            }
        } catch (e) { alert('消耗失败: ' + e.message); }
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

    const quotaOptions = [1, 1.5, 3, 5, 10, 20, 50, 100];

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
                        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>积分</label>
                        <select className="input" value={cdkGenQuota} onChange={e => setCdkGenQuota(Number(e.target.value))} style={{ width: '120px' }}>
                            {quotaOptions.map(q => <option key={q} value={q}>{q} 积分</option>)}
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
                    <div style={{ display: 'flex', gap: 'var(--spacing-xs)', alignItems: 'center', flexWrap: 'wrap' }}>
                        {['all', 'unused', 'active', 'used'].map(f => (
                            <button key={f} className={`btn btn-sm ${cdkFilter === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setCdkFilter(f); setSelectedCdks(new Set()); }}>
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
                                <th style={{ width: '36px', textAlign: 'center' }}>
                                    <input type="checkbox" checked={filteredList.length > 0 && selectedCdks.size === filteredList.length} onChange={toggleSelectAll} style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--color-primary)' }} />
                                </th>
                                <th>CDK 代码</th>
                                <th>积分</th>
                                <th>使用情况</th>
                                <th>绑定用户ID</th>
                                <th>状态</th>
                                <th>备注</th>
                                <th>创建时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredList.map(c => (
                                <React.Fragment key={c.code}>
                                    <tr style={{ background: selectedCdks.has(c.code) ? 'rgba(99, 102, 241, 0.06)' : undefined }}>
                                        <td style={{ textAlign: 'center' }}>
                                            <input type="checkbox" checked={selectedCdks.has(c.code)} onChange={() => toggleSelectCdk(c.code)} style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--color-primary)' }} />
                                        </td>
                                        <td style={{ fontFamily: "'SF Mono', monospace", fontSize: 'var(--text-sm)' }}>{c.code}</td>
                                        <td>{c.quota} 积分</td>
                                        <td>{c.used} / {c.quota}</td>
                                        <td style={{ fontFamily: "'SF Mono', monospace", fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                                            {c.redeemedBy ? `user:${c.redeemedBy}` : '-'}
                                        </td>
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
                                                <button className="btn btn-sm btn-warning" onClick={() => handleConsume(c.code)} title="手动消耗 1 个额度" disabled={c.remaining <= 0}
                                                    style={{ opacity: c.remaining <= 0 ? 0.4 : 1 }}
                                                >🔥</button>
                                                <button className="btn btn-sm btn-outline" onClick={() => handleDelete(c.code)} style={{ color: 'var(--color-danger)' }}>🗑️</button>
                                            </div>
                                        </td>
                                    </tr>
                                    {expandedCdk === c.code && (
                                        <tr>
                                            <td colSpan={9} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
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
                                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 'var(--spacing-xl)', color: 'var(--text-muted)' }}>暂无 CDK 数据</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {/* Batch delete bar */}
                {selectedCdks.size > 0 && (
                    <div style={{
                        marginTop: 'var(--spacing-md)',
                        padding: '12px 16px',
                        background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 'var(--spacing-md)',
                    }}>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                            已选中 <strong style={{ color: 'var(--color-danger)' }}>{selectedCdks.size}</strong> 个 CDK
                        </span>
                        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                            <button className="btn btn-sm btn-secondary" onClick={() => setSelectedCdks(new Set())}>
                                取消选择
                            </button>
                            <button className="btn btn-sm" onClick={handleBatchDelete} disabled={batchDeleting}
                                style={{ background: 'var(--color-danger)', color: '#fff', border: 'none' }}>
                                {batchDeleting ? '⏳ 删除中...' : `🗑️ 批量删除 (${selectedCdks.size})`}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function Admin() {
    const { user, loading } = useAuth();
    const { t } = useLang();
    const navigate = useNavigate();
    const userPermissions = user?.admin_permissions || [];
    const isFullAdmin = user?.role === 'admin';
    const can = useCallback((permission) => isFullAdmin || userPermissions.includes(permission), [isFullAdmin, userPermissions]);
    const [activeTab, setActiveTab] = useState('overview');
    const [siteStats, setSiteStats] = useState({});
    const [verifyLog, setVerifyLog] = useState([]);
    const [vLogPage, setVLogPage] = useState(1);
    const [vLogTotalPages, setVLogTotalPages] = useState(1);
    const [vLogTotal, setVLogTotal] = useState(0);
    const vLogPageRef = useRef(1);
    const [vLogSearch, setVLogSearch] = useState('');
    const vLogSearchRef = useRef('');
    const vLogSearchTimer = useRef(null);
    const [config, setConfig] = useState(null);
    const [showSaveNotice, setShowSaveNotice] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [testing, setTesting] = useState(false);
    const [saving, setSaving] = useState(false);

    // Audit Logs State
    const [auditLogs, setAuditLogs] = useState([]);
    const [auditLogPage, setAuditLogPage] = useState(1);
    const [auditLogTotalPages, setAuditLogTotalPages] = useState(1);
    const [auditLogTotal, setAuditLogTotal] = useState(0);
    const [auditLogSearch, setAuditLogSearch] = useState('');
    const auditLogSearchRef = useRef('');
    const auditLogSearchTimer = useRef(null);

    // Verification history state
    const [historyData, setHistoryData] = useState([]);
    const [historyStats, setHistoryStats] = useState({ pass: 0, failed: 0, processing: 0, cancel: 0, total: 0 });
    const [hoveredStatusItem, setHoveredStatusItem] = useState(null);
    const [addCount, setAddCount] = useState(1);
    const [addingStatus, setAddingStatus] = useState(null);
    const [autoRules, setAutoRules] = useState([]);
    const [newRule, setNewRule] = useState({ intervalMinutes: 5, status: 'pass', durationHours: 0, count: 1, successRate: 80 });
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
    const [routingStrategy, setRoutingStrategy] = useState({
        mode: 'mixed',
        allocation: { getgem: 50, bot: 50 },
        fallbackEnabled: true,
        fallbackErrors: ['timeout', 'internalError', 'rateLimited', 'cooldown', 'error'],
        autoDegradeThreshold: 30
    });
    const [routingStats, setRoutingStats] = useState(null);
    const [nodeHealth, setNodeHealth] = useState(null);
    const [showTemplates, setShowTemplates] = useState(false);
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

    // Email SMTP settings
    const [emailSettings, setEmailSettings] = useState({
        smtpHost: '',
        smtpPort: '465',
        smtpUser: '',
        smtpPassword: '',
        senderName: 'OnePASS',
        useSsl: true,
        hasStoredPassword: false
    });
    const [emailTesting, setEmailTesting] = useState(false);
    const [emailTestResult, setEmailTestResult] = useState(null);
    const [emailSaving, setEmailSaving] = useState(false);
    const [emailSaved, setEmailSaved] = useState(false);
    const [siteUrl, setSiteUrl] = useState('');
    // Alert notification state
    const [alertConfig, setAlertConfig] = useState({ enabled: false, email: '', cooldownMinutes: 60 });
    const [alertSaving, setAlertSaving] = useState(false);
    const [alertTesting, setAlertTesting] = useState(false);

    // Service maintenance toggles (used in settings tab)
    const [serviceMaint, setServiceMaint] = useState({ gemini_normal: false, gemini_advanced: false, gpt_plus: false, gpt_team: false });

    // User management state
    const [users, setUsers] = useState([]);
    const [userSearch, setUserSearch] = useState('');
    const [userPage, setUserPage] = useState(1);
    const [usersLoading, setUsersLoading] = useState(false);
    const [usersError, setUsersError] = useState('');
    const [roleConfig, setRoleConfig] = useState({ permissions: [], presets: [] });
    const [roleConfigLoading, setRoleConfigLoading] = useState(false);
    const [roleConfigSaving, setRoleConfigSaving] = useState(false);

    useEffect(() => {
        setUserPage(1);
    }, [userSearch]);

    const filteredUsers = users.filter(u => 
        (u.email && u.email.toLowerCase().includes(userSearch.toLowerCase())) ||
        (u.username && u.username.toLowerCase().includes(userSearch.toLowerCase())) ||
        (u.id && String(u.id).includes(userSearch)) ||
        (u.invite_code && u.invite_code.toLowerCase().includes(userSearch.toLowerCase())) ||
        (u.status && u.status.toLowerCase().includes(userSearch.toLowerCase()))
    );
    const userTotalPages = Math.max(1, Math.ceil(filteredUsers.length / 100));
    const displayUsers = filteredUsers.slice((userPage - 1) * 100, userPage * 100);
    const [editingUser, setEditingUser] = useState(null);
    const [editCredits, setEditCredits] = useState('');
    const [editRole, setEditRole] = useState('user');
    const [editPermissions, setEditPermissions] = useState([]);
    const [historyUser, setHistoryUser] = useState(null);
    const [userHistory, setUserHistory] = useState([]);
    const [userHistoryLoading, setUserHistoryLoading] = useState(false);

    // Region mode state: 'global' (default) or 'us_only'
    const [regionMode, setRegionMode] = useState('global');

    // Maintenance mode state
    const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
    const [maintenanceMessage, setMaintenanceMessage] = useState('系统维护中，请稍后再试');
    const [maintenanceEstEnd, setMaintenanceEstEnd] = useState('');
    const [maintenanceSaving, setMaintenanceSaving] = useState(false);
    const [maintenanceSaved, setMaintenanceSaved] = useState(false);

    // Announcement state
    const [annEnabled, setAnnEnabled] = useState(false);
    const [annContent, setAnnContent] = useState('');
    const [annType, setAnnType] = useState('info');
    const [annSaving, setAnnSaving] = useState(false);
    const [annSaved, setAnnSaved] = useState(false);

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

    // Inline edit message state
    const [editingMsgVid, setEditingMsgVid] = useState(null);
    const [editingMsgText, setEditingMsgText] = useState('');

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
        } else if (!loading && user && user.role !== 'admin' && !(user.admin_permissions || []).length) {
            navigate('/');
        }
    }, [user, loading, navigate]);

    // Load configuration on mount
    useEffect(() => {
        fetchConfig();
        fetchTgAccounts();
        fetchUsers();
        fetchRoleConfig();
        // Fetch site-wide stats for Overview tab
        const fetchSiteStats = async () => {
            try {
                const token = user?.token || localStorage.getItem('verifykey-token');
                const headers = { 'Authorization': `Bearer ${token}` };
                const statsRes = await fetch(`${API_BASE}/api/admin/bot-stats`, { headers });
                if (statsRes.ok) setSiteStats(await statsRes.json());
            } catch (e) { console.error('Failed to fetch site stats:', e); }
            // Also fetch node health data
            try {
                const token = user?.token || localStorage.getItem('verifykey-token');
                const nhRes = await fetch(`${API_BASE}/api/admin/node-health`, { headers: { 'Authorization': `Bearer ${token}` } });
                if (nhRes.ok) setNodeHealth(await nhRes.json());
            } catch (e) { /* ignore */ }
        };
        fetchSiteStats();
        fetchVerifyHistory(1);
        const statsInterval = setInterval(fetchSiteStats, 15000);
        const logInterval = setInterval(() => fetchVerifyHistory(), 10000);
        return () => { clearInterval(statsInterval); clearInterval(logInterval); };
    }, []);

    // Fetch audit logs
    const fetchAuditLogs = async (page = auditLogPage) => {
        try {
            const token = user?.token || localStorage.getItem('verifykey-token');
            const headers = { 'Authorization': `Bearer ${token}` };
            const searchParam = auditLogSearchRef.current ? `&search=${encodeURIComponent(auditLogSearchRef.current)}` : '';
            const res = await fetch(`${API_BASE}/api/admin/credit-transactions?page=${page}&pageSize=50${searchParam}`, { headers });
            if (res.ok) {
                const data = await res.json();
                setAuditLogs(data.transactions || []);
                setAuditLogTotal(data.total || 0);
                setAuditLogTotalPages(data.totalPages || 1);
            }
        } catch (e) { console.error('Failed to fetch audit logs:', e); }
    };

    // Fetch verification history with pagination
    const fetchVerifyHistory = useCallback(async (page) => {
        const p = page ?? vLogPageRef.current;
        try {
            const token = user?.token || localStorage.getItem('verifykey-token');
            const headers = { 'Authorization': `Bearer ${token}` };
            const searchParam = vLogSearchRef.current ? `&search=${encodeURIComponent(vLogSearchRef.current)}` : '';
            const logRes = await fetch(`${API_BASE}/api/admin/verify-history?page=${p}&pageSize=100${searchParam}`, { headers });
            if (logRes.ok) {
                const logData = await logRes.json();
                const apiLog = (logData.history || []).filter(r => r.verificationId?.trim() && !r.verificationId.startsWith('auto-'));
                setVLogTotal(logData.total || 0);
                setVLogTotalPages(logData.totalPages || 1);
                // When searching, show only API results (no SSE merge)
                // When not searching and on page 1, merge SSE live entries
                if (vLogSearchRef.current || p !== 1) {
                    setVerifyLog(apiLog);
                } else {
                    setVerifyLog(prev => {
                        const sseOnly = prev.filter(e =>
                            typeof e.id === 'string' && e.id.startsWith('sse-') &&
                            !apiLog.some(a => a.verificationId === e.verificationId)
                        );
                        return sseOnly.length > 0 ? [...sseOnly, ...apiLog] : apiLog;
                    });
                }
            }
        } catch (e) { console.error('Failed to fetch verify history:', e); }
    }, []);

    const handleVLogPageChange = useCallback((newPage) => {
        const p = Math.max(1, Math.min(newPage, vLogTotalPages));
        setVLogPage(p);
        vLogPageRef.current = p;
        fetchVerifyHistory(p);
    }, [vLogTotalPages, fetchVerifyHistory]);

    const handleVLogSearch = useCallback((value) => {
        setVLogSearch(value);
        vLogSearchRef.current = value;
        if (vLogSearchTimer.current) clearTimeout(vLogSearchTimer.current);
        vLogSearchTimer.current = setTimeout(() => {
            setVLogPage(1);
            vLogPageRef.current = 1;
            fetchVerifyHistory(1);
        }, 400);
    }, [fetchVerifyHistory]);

    // SSE Real-time updates for overview verification log
    useEffect(() => {
        const token = user?.token || localStorage.getItem('verifykey-token');
        if (!token) return;

        const sseUrl = `${API_BASE}/api/admin/verify-stream?authorization=Bearer ${token}`;
        const es = new EventSource(sseUrl);

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // Only apply SSE live updates when viewing page 1 with no search active
                if (vLogPageRef.current !== 1 || vLogSearchRef.current) return;

                if (data.type === 'progress') {
                    const vid = data.vid || '';
                    if (!vid) return;

                    // Determine status: per-link result events carry final status
                    let entryStatus = 'processing';
                    if (data.step === 'result') {
                        entryStatus = data.success ? 'pass' : 'failed';
                    } else if (data.step === 'submit_failed') {
                        entryStatus = 'failed';
                    } else if (data.step === 'submitted') {
                        entryStatus = 'processing';
                    }

                    setVerifyLog(prev => {
                        const existingIdx = prev.findIndex(l => l.verificationId === vid);
                        const existingEntry = existingIdx >= 0 ? prev[existingIdx] : null;
                        const existingIsTerminal = existingEntry && (existingEntry.status === 'pass' || existingEntry.status === 'failed');
                        const canOverrideTerminal = Boolean(data.forceTerminalUpdate);

                        // Terminal entries stay frozen unless backend explicitly emits a compensation override.
                        if (existingIsTerminal && !canOverrideTerminal) {
                            return prev;
                        }

                        const newEntry = {
                            id: existingIdx >= 0 ? prev[existingIdx].id : `sse-${Date.now()}-${Math.random()}`,
                            verificationId: vid,
                            status: entryStatus,
                            message: data.message || (entryStatus === 'processing' ? '处理中...' : ''),
                            timestamp: new Date().toISOString(),
                            cdk: existingIdx >= 0 ? prev[existingIdx].cdk : '',
                            via: data.via || data.source || (existingIdx >= 0 ? prev[existingIdx].via : ''),
                            source: data.source || (existingIdx >= 0 ? prev[existingIdx].source : ''),
                            method: data.method || (existingIdx >= 0 ? prev[existingIdx].method : ''),
                            submitEmail: data.submitEmail || data.link || (existingIdx >= 0 ? prev[existingIdx].submitEmail : ''),
                            userId: data.userId || (existingIdx >= 0 ? prev[existingIdx].userId : ''),
                            cardKey: data.cardKey || (existingIdx >= 0 ? prev[existingIdx].cardKey : ''),
                            channel: data.channel || (existingIdx >= 0 ? prev[existingIdx].channel : ''),
                            requestStage: data.requestStage || (existingIdx >= 0 ? prev[existingIdx].requestStage : ''),
                            httpStatus: data.httpStatus || (existingIdx >= 0 ? prev[existingIdx].httpStatus : ''),
                            upstreamStatus: data.upstreamStatus || (existingIdx >= 0 ? prev[existingIdx].upstreamStatus : ''),
                            refunded: typeof data.refunded === 'boolean' ? data.refunded : (existingIdx >= 0 ? prev[existingIdx].refunded : false),
                            creditCost: data.creditCost || (existingIdx >= 0 ? prev[existingIdx].creditCost : null),
                        };
                        if (existingIdx >= 0) {
                            const newLog = [...prev];
                            newLog[existingIdx] = { ...newLog[existingIdx], ...newEntry };
                            return newLog;
                        } else {
                            return [newEntry, ...prev];
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
                                    via: res.via || res.botType || newLog[existingIdx].via || '',
                                    source: res.source || newLog[existingIdx].source || '',
                                    method: res.method || newLog[existingIdx].method || '',
                                    submitEmail: res.submitEmail || res.link || newLog[existingIdx].submitEmail || '',
                                    userId: res.userId || newLog[existingIdx].userId || '',
                                    cardKey: res.cardKey || newLog[existingIdx].cardKey || '',
                                    channel: res.channel || newLog[existingIdx].channel || '',
                                    timestamp: new Date().toISOString(),
                                };
                            } else {
                                newLog.unshift({
                                    id: `sse-done-${Date.now()}-${Math.random()}`,
                                    verificationId: vid,
                                    status,
                                    message: msg,
                                    via: res.via || res.botType || '',
                                    source: res.source || '',
                                    method: res.method || '',
                                    submitEmail: res.submitEmail || res.link || '',
                                    userId: res.userId || '',
                                    cardKey: res.cardKey || '',
                                    channel: res.channel || '',
                                    timestamp: new Date().toISOString(),
                                    cdk: data.cdkRemaining != null ? '' : '',
                                });
                            }
                        }
                        return newLog;
                    });
                } else if (data.type === 'recheck_success') {
                    // Delayed recheck discovered a timed-out VID actually succeeded
                    const vid = data.vid || '';
                    if (vid) {
                        setVerifyLog(prev => {
                            const existingIdx = prev.findIndex(l => l.verificationId === vid);
                            if (existingIdx >= 0) {
                                const newLog = [...prev];
                                newLog[existingIdx] = {
                                    ...newLog[existingIdx],
                                    status: 'pass',
                                    message: data.message || '延迟复查：验证已通过',
                                    timestamp: new Date().toISOString(),
                                };
                                return newLog;
                            } else {
                                return [{
                                    id: `sse-recheck-${Date.now()}-${Math.random()}`,
                                    verificationId: vid,
                                    status: 'pass',
                                    message: data.message || '延迟复查：验证已通过',
                                    timestamp: new Date().toISOString(),
                                    cdk: '',
                                }, ...prev];
                            }
                        });
                    }
                } else if (data.type === 'history_updated') {
                    // Manual status override from admin — update in-place
                    const recordId = data.id || '';
                    if (recordId && data.status) {
                        setVerifyLog(prev => prev.map(l =>
                            l.id === recordId
                                ? { ...l, status: data.status === 'pass' ? 'pass' : 'failed', message: data.message || l.message, timestamp: new Date().toISOString() }
                                : l
                        ));
                    }
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
                    const token = user?.token || localStorage.getItem('verifykey-token');
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
                // Fetch service maintenance toggles
                try {
                    const smRes = await fetch(`${API_BASE}/api/service-status`);
                    if (smRes.ok) {
                        const smData = await smRes.json();
                        if (smData.manual) setServiceMaint(smData.manual);
                    }
                } catch (e) {
                    console.warn('Failed to fetch service maintenance:', e);
                }
                // Fetch announcement
                try {
                    const res = await fetch(`${API_BASE}/api/announcement`);
                    if (res.ok) {
                        const data = await res.json();
                        setAnnEnabled(data.enabled);
                        setAnnContent(data.content || '');
                        setAnnType(data.type || 'info');
                    }
                } catch (e) {
                    console.warn('Failed to fetch announcement:', e);
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

    const handleSaveAnnouncement = async () => {
        setAnnSaving(true);
        setAnnSaved(false);
        try {
            const token = user?.token || localStorage.getItem('verifykey-token');
            const res = await fetch(`${API_BASE}/api/announcement`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ enabled: annEnabled, content: annContent, type: annType })
            });
            if (res.ok) { setAnnSaved(true); setTimeout(() => setAnnSaved(false), 2000); }
            else { const err = await res.json(); alert(err.error || '保存失败'); }
        } catch (e) { alert('保存失败: ' + e.message); }
        finally { setAnnSaving(false); }
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

    // ========= User Management =========
    const fetchUsers = async () => {
        setUsersLoading(true);
        setUsersError('');
        try {
            const token = user?.token || localStorage.getItem('verifykey-token');
            const res = await fetch(`${API_BASE}/api/admin/users`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setUsers(data.users || []);
            } else {
                setUsers([]);
                setUsersError(data.detail || `加载用户失败 (${res.status})`);
            }
        } catch (e) {
            setUsers([]);
            setUsersError('加载用户失败: ' + e.message);
            console.error('Failed to fetch users:', e);
        } finally {
            setUsersLoading(false);
        }
    };

    const fetchRoleConfig = async () => {
        if (!can('super_admin')) return;
        setRoleConfigLoading(true);
        try {
            const token = user?.token || localStorage.getItem('verifykey-token');
            const res = await fetch(`${API_BASE}/api/admin/roles`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                setRoleConfig(await res.json());
            }
        } catch (e) {
            console.error('Failed to fetch role config:', e);
        } finally {
            setRoleConfigLoading(false);
        }
    };

    const handleSaveRoleConfig = async () => {
        setRoleConfigSaving(true);
        try {
            const token = user?.token || localStorage.getItem('verifykey-token');
            const res = await fetch(`${API_BASE}/api/admin/roles`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ presets: roleConfig.presets })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setRoleConfig(data);
                alert('子管理员配置已保存');
            } else {
                alert(data.detail || '保存失败');
            }
        } catch (e) {
            alert('保存失败: ' + e.message);
        } finally {
            setRoleConfigSaving(false);
        }
    };

    const handleToggleUser = async (userId, currentStatus) => {
        const newStatus = currentStatus === 'suspended' ? 'active' : 'suspended';
        const action = newStatus === 'suspended' ? '禁用' : '启用';
        if (!confirm(`确定${action}该用户？`)) return;
        try {
            const token = user?.token || localStorage.getItem('verifykey-token');
            const res = await fetch(`${API_BASE}/api/admin/users/${userId}/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ status: newStatus })
            });
            if (res.ok) {
                fetchUsers();
            } else {
                alert('操作失败');
            }
        } catch (e) {
            alert('操作失败: ' + e.message);
        }
    };

    const handleUpdateUser = async () => {
        if (!editingUser) return;
        const credits = parseFloat(editCredits);
        if (isNaN(credits) || credits < 0) {
            alert('请输入有效的积分数值');
            return;
        }
        try {
            const token = user?.token || localStorage.getItem('verifykey-token');
            const res = await fetch(`${API_BASE}/api/admin/users/${editingUser.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    credits,
                    currentCredits: editingUser.credits ?? 0,
                    role: can('super_admin') ? editRole : undefined,
                    admin_permissions: can('super_admin') ? editPermissions : undefined,
                })
            });
            if (res.ok) {
                setEditingUser(null);
                fetchUsers();
            } else {
                const data = await res.json().catch(() => ({}));
                alert(data.detail || '修改失败');
            }
        } catch (e) {
            alert('修改失败: ' + e.message);
        }
    };

    const handleViewUserHistory = async (targetUser) => {
        setHistoryUser(targetUser);
        setUserHistory([]);
        setUserHistoryLoading(true);
        try {
            const token = user?.token || localStorage.getItem('verifykey-token');
            const res = await fetch(`${API_BASE}/api/admin/users/${targetUser.id}/history`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setUserHistory(data.history || []);
            } else {
                alert(data.detail || '加载历史失败');
                setHistoryUser(null);
            }
        } catch (e) {
            alert('加载历史失败: ' + e.message);
            setHistoryUser(null);
        } finally {
            setUserHistoryLoading(false);
        }
    };

    const handleSaveEmailConfig = async () => {
        setEmailSaving(true);
        setEmailSaved(false);
        try {
            const token = user?.token || localStorage.getItem('verifykey-token');
            const updates = {
                email: {
                    smtpHost: emailSettings.smtpHost,
                    smtpPort: emailSettings.smtpPort,
                    smtpUser: emailSettings.smtpUser,
                    smtpPassword: emailSettings.smtpPassword || undefined,
                    senderName: emailSettings.senderName,
                    useSsl: emailSettings.useSsl
                },
                siteUrl: siteUrl
            };
            const res = await fetch(`${API_BASE}/api/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(updates)
            });
            if (res.ok) {
                setEmailSaved(true);
                setTimeout(() => setEmailSaved(false), 2000);
                fetchConfig();
            } else {
                const err = await res.json();
                alert(err.error || '保存失败');
            }
        } catch (e) {
            alert('保存失败: ' + e.message);
        } finally {
            setEmailSaving(false);
        }
    };

    const handleTestEmail = async () => {
        setEmailTesting(true);
        setEmailTestResult(null);
        try {
            // Save first, then test
            await handleSaveEmailConfig();
            const token = user?.token || localStorage.getItem('verifykey-token');
            const res = await fetch(`${API_BASE}/api/email/test`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setEmailTestResult(data);
        } catch (e) {
            setEmailTestResult({ success: false, message: e.message });
        } finally {
            setEmailTesting(false);
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
                if (data.aiGenerator?.routingStrategy) {
                    setRoutingStrategy(prev => ({ ...prev, ...data.aiGenerator.routingStrategy }));
                }
                // Fetch routing stats if mixed mode
                if (data.aiGenerator?.provider === 'mixed') {
                    fetch(`${API_BASE}/api/routing/stats`).then(r => r.ok ? r.json() : null).then(stats => {
                        if (stats) setRoutingStats(stats);
                    }).catch(() => { });
                }
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
                // Load email settings
                if (data.email) {
                    setEmailSettings(prev => ({
                        ...prev,
                        smtpHost: data.email.smtpHost || prev.smtpHost,
                        smtpPort: data.email.smtpPort || prev.smtpPort,
                        smtpUser: data.email.smtpUser || prev.smtpUser,
                        smtpPassword: data.email.smtpPassword?.includes('...') ? '' : (data.email.smtpPassword || ''),
                        senderName: data.email.senderName || prev.senderName,
                        useSsl: data.email.useSsl !== false,
                        hasStoredPassword: !!data.email.smtpPassword?.includes('...')
                    }));
                }
                if (data.siteUrl) {
                    setSiteUrl(data.siteUrl);
                }
                // Load alert config
                try {
                    const alertRes = await fetch(`${API_BASE}/api/alerts/config`, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });
                    if (alertRes.ok) { setAlertConfig(await alertRes.json()); }
                } catch {}
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
                        enabled: aiProvider === 'getgem' || aiProvider === 'mixed',
                        apiUrl: getgemSettings.apiUrl,
                        cdk: getgemSettings.cdk || undefined,
                        appendCdk: appendGetgemCdk
                    },
                    routingStrategy: aiProvider === 'mixed' ? routingStrategy : undefined,
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
                    gptRechargeBot: {
                        ...(config?.verification?.gptRechargeBot || {}),
                        enabled: config?.verification?.gptRechargeBot?.enabled || false,
                        targetBot: config?.verification?.gptRechargeBot?.targetBot || '@AutoRechargeProbot',
                        sendFormat: config?.verification?.gptRechargeBot?.sendFormat || '{accessToken}',
                        botFirstFallbackToKey: config?.verification?.gptRechargeBot?.botFirstFallbackToKey === true,
                        preCommandEnabled: config?.verification?.gptRechargeBot?.preCommandEnabled !== false,
                        preCommand: config?.verification?.gptRechargeBot?.preCommand || '⚡ 激活plus母号',
                        preCommandTimeout: Number(config?.verification?.gptRechargeBot?.preCommandTimeout || 45),
                        timeout: Number(config?.verification?.gptRechargeBot?.timeout || 120),
                        maxRetries: Number(config?.verification?.gptRechargeBot?.maxRetries || 5),
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

    // Auto-fetch audit logs when tab is selected
    useEffect(() => {
        if (activeTab === 'audit') {
            fetchAuditLogs(1);
        }
    }, [activeTab]);

    // 模拟数据
    const stats = {
        totalUsers: 1247,
        activeUsers: 892,
        totalVerifications: 34582,
        successRate: 98.7,
        revenue: 12580,
        pendingWithdrawals: 3
    };

    // users is state, fetched from API - see fetchUsers()

    const tabs = [
        { id: 'overview', label: t('tabOverview'), icon: '📊', permission: 'view_logs' },
        { id: 'live-monitor', label: '实时监控', icon: '📺', permission: 'view_logs' },
        { id: 'pixel-api', label: 'Pixel API', icon: '📡', permission: 'manage_config' },
        { id: 'gpt-recharge', label: 'GPT 充值', icon: '🤖', permission: 'manage_config' },
        { id: 'gpt-team', label: 'GPT Team', icon: '🧩', permission: 'manage_config' },
        { id: 'cdk', label: t('tabCdk'), icon: '🔑', permission: 'view_orders' },
        { id: 'users', label: t('tabUsers'), icon: '👥', permission: 'view_users' },
        { id: 'admin-roles', label: '子管理员', icon: '🛡️', permission: 'super_admin' },
        { id: 'audit', label: '资金对账单', icon: '💸', permission: 'view_orders' },
        { id: 'ai-generator', label: t('tabAiGen'), icon: '🤖', permission: 'manage_config' },
        { id: 'verify-status', label: t('tabVerifyStatus'), icon: '📋', permission: 'view_logs' },
        { id: 'telegram-bot', label: t('tabTgBot'), icon: '🤖', permission: 'manage_config' },
        { id: 'settings', label: t('tabSettings'), icon: '⚙️', permission: 'manage_maintenance' },
    ].filter(tab => can(tab.permission));

    useEffect(() => {
        if (tabs.length > 0 && !tabs.some(tab => tab.id === activeTab)) {
            setActiveTab(tabs[0].id);
        }
    }, [tabs, activeTab]);

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
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
                            <button className="btn btn-sm btn-secondary" style={{ fontSize: '12px', color: '#ef4444' }} onClick={async () => {
                                if (!window.confirm('确定要清空所有概览统计数据吗？此操作不可撤销。')) return;
                                try {
                                    const tk = user?.token || localStorage.getItem('verifykey-token');
                                    const res = await fetch(`${API_BASE}/api/admin/reset-overview-stats`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tk}` } });
                                    if (res.ok) { alert('已清空'); fetchSiteStats(); }
                                    else alert('清空失败');
                                } catch (e) { alert('错误: ' + e.message); }
                            }}>🗑️ 清空数据</button>
                        </div>
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
                            {/* Search Bar */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                                <div style={{ position: 'relative', flex: 1 }}>
                                    <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '14px', color: 'var(--text-muted)', pointerEvents: 'none' }}>🔍</span>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="搜索 VID、邮箱、消息、来源、状态..."
                                        value={vLogSearch}
                                        onChange={e => handleVLogSearch(e.target.value)}
                                        style={{
                                            paddingLeft: '36px',
                                            paddingRight: vLogSearch ? '36px' : '12px',
                                            height: '38px',
                                            fontSize: '13px',
                                            borderRadius: '8px',
                                            width: '100%',
                                        }}
                                    />
                                    {vLogSearch && (
                                        <span
                                            onClick={() => handleVLogSearch('')}
                                            style={{
                                                position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                                                cursor: 'pointer', fontSize: '14px', color: 'var(--text-muted)',
                                                width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                borderRadius: '50%', background: 'var(--bg-tertiary)',
                                            }}
                                        >✕</span>
                                    )}
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px', fontSize: '14px', flexWrap: 'wrap' }}>
                                <span>{t('logTotal')} <strong>{vLogTotal}</strong> {t('logEntries')}{vLogSearch && <span style={{ color: 'var(--text-muted)', fontSize: '12px', marginLeft: '4px' }}>(搜索中)</span>}</span>
                                <span>|</span>
                                {verifyLog.filter(r => r.status === 'processing').length > 0 && (
                                    <span style={{ color: '#f59e0b', fontWeight: 600 }}>{verifyLog.filter(r => r.status === 'processing').length} 处理中</span>
                                )}
                                <span style={{ color: '#16a34a', fontWeight: 600 }}>{verifyLog.filter(r => r.status === 'pass').length} {t('logSuccess')}</span>
                                <span style={{ color: '#dc2626', fontWeight: 600 }}>{verifyLog.filter(r => r.status === 'failed').length} {t('logFailed')}</span>
                                <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: '13px' }}>
                                    第 {vLogPage}/{vLogTotalPages} 页
                                </span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '800px', overflowY: 'auto' }}>
                                {verifyLog.length === 0 && <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '24px' }}>{t('logNoRecords')}</div>}
                                {verifyLog.map(r => {
                                    const isPass = r.status === 'pass';
                                    const isProcessing = r.status === 'processing';
                                    const isSubmissionFailure = r.requestStage === 'submission' && r.status === 'failed';
                                    const vid = r.verificationId || '';
                                    const shortVid = vid.length > 20 ? `${vid.slice(0, 8)}...${vid.slice(-8)}` : vid;
                                    const ts = r.timestamp ? new Date(r.timestamp).toLocaleString('zh-CN', { hour12: false }) : '';
                                    const submitEmail = r.submitEmail || '';
                                    const shortSubmitEmail = submitEmail && submitEmail.length > 48 ? `${submitEmail.slice(0, 45)}...` : submitEmail;
                                    const method = r.method || '';
                                    const cardKey = r.cardKey || '';
                                    const shortCardKey = cardKey && cardKey.length > 24 ? `${cardKey.slice(0, 10)}...${cardKey.slice(-8)}` : cardKey;
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
                                                    <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>{isSubmissionFailure ? `ATTEMPT: ${shortVid}` : `VID: ${shortVid}`}</span>
                                                    {isProcessing && (
                                                        <span style={{
                                                            fontSize: '11px', padding: '1px 8px', borderRadius: '10px',
                                                            background: '#f59e0b', color: '#fff', fontWeight: 600,
                                                        }}>处理中</span>
                                                    )}
                                                    {isSubmissionFailure && (
                                                        <span style={{
                                                            fontSize: '11px', padding: '1px 8px', borderRadius: '10px',
                                                            background: '#dc2626', color: '#fff', fontWeight: 600,
                                                        }}>提交失败</span>
                                                    )}
                                                    {r.via && (() => {
                                                        const viaColors = {
                                                            pixel: { bg: '#059669', label: 'UPixel' },
                                                            pixel_auto: { bg: '#ea580c', label: 'UPixel Auto' },
                                                            kpixel: { bg: '#7c5cfc', label: 'KPixel' },
                                                            vpixel: { bg: '#0891b2', label: 'VPixel' },
                                                            ypixel: { bg: '#d97706', label: 'YPixel' },
                                                            gpt: { bg: '#d97706', label: 'GPT' },
                                                        };
                                                        const vc = viaColors[r.via] || null;
                                                        const bg = vc ? vc.bg : r.via.includes('getgem') ? '#6366F1' : r.via.includes('fallback') ? '#f59e0b' : '#0088cc';
                                                        const label = vc ? vc.label : (r.via.includes('fallback') ? '🔄 ' : '') + r.via;
                                                        return (
                                                            <span style={{
                                                                fontSize: '10px', padding: '1px 6px', borderRadius: '4px',
                                                                background: bg, color: '#fff', fontWeight: 500,
                                                            }}>{label}</span>
                                                        );
                                                    })()}
                                                    {r.cost > 0 && (() => {
                                                        let cBg, cColor, cBorder, cText;
                                                        if (r.status === 'processing') {
                                                            cBg = 'rgba(245, 158, 11, 0.1)'; cColor = '#d97706'; cBorder = '1px solid rgba(245, 158, 11, 0.2)';
                                                            cText = `预扣 ${r.cost} 积分`;
                                                        } else if (r.status === 'pass') {
                                                            cBg = 'rgba(22, 163, 74, 0.1)'; cColor = '#16a34a'; cBorder = '1px solid rgba(22, 163, 74, 0.2)';
                                                            cText = `实扣 ${r.cost} 积分`;
                                                        } else {
                                                            if (r.isRefunded === 1) {
                                                                cBg = 'rgba(16, 185, 129, 0.1)'; cColor = '#059669'; cBorder = '1px solid rgba(16, 185, 129, 0.2)';
                                                                cText = `已退 ${r.cost} 积分`;
                                                            } else {
                                                                cBg = 'rgba(244, 63, 94, 0.1)'; cColor = '#e11d48'; cBorder = '1px solid rgba(244, 63, 94, 0.2)';
                                                                cText = `未退 ${r.cost} 积分`;
                                                            }
                                                        }
                                                        return (
                                                            <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: cBg, color: cColor, border: cBorder, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                                💰 {cText}
                                                            </span>
                                                        );
                                                    })()}
                                                </div>
                                                {(r.message || (!isPass && !isProcessing)) && (
                                                    editingMsgVid === r.verificationId ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', marginTop: '4px', background: 'var(--bg-card)', padding: '10px', borderRadius: '8px', border: `1px solid ${borderColor}` }} onClick={e => e.stopPropagation()}>
                                                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>编辑失败提示：</div>
                                                            <textarea 
                                                                autoFocus
                                                                className="input" 
                                                                style={{ minHeight: '60px', padding: '8px', fontSize: '13px', resize: 'vertical' }}
                                                                value={editingMsgText}
                                                                onChange={e => setEditingMsgText(e.target.value)}
                                                                placeholder="输入此条记录的新报错信息..."
                                                            />
                                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                                                                <button 
                                                                    style={{ padding: '6px 14px', fontSize: '12px', background: 'var(--bg-tertiary)', border: 'none', borderRadius: '6px', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 500 }}
                                                                    onClick={(e) => { e.stopPropagation(); setEditingMsgVid(null); }}
                                                                >取消</button>
                                                                <button 
                                                                    style={{ padding: '6px 14px', fontSize: '12px', background: 'var(--color-primary)', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation();
                                                                        const newMsg = editingMsgText.trim();
                                                                        if (newMsg) {
                                                                            try {
                                                                                const token = user?.token || localStorage.getItem('verifykey-token');
                                                                                await fetch(`${API_BASE}/api/admin/override-message`, {
                                                                                    method: 'POST',
                                                                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                                                                    body: JSON.stringify({ vid: r.verificationId || '', message: newMsg })
                                                                                });
                                                                                setVerifyLog(prev => prev.map(item => 
                                                                                    item.verificationId === r.verificationId 
                                                                                        ? { ...item, message: newMsg } 
                                                                                        : item
                                                                                ));
                                                                                setEditingMsgVid(null);
                                                                            } catch(err) { alert('修改失败'); }
                                                                        }
                                                                    }}
                                                                >保存并推送</button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div style={{ fontSize: '13px', fontWeight: 600, color: msgColor, marginTop: '3px', wordBreak: 'break-all', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                                            {r.message && <span>{r.message}</span>}
                                                            {(!isPass && !isProcessing && !isSubmissionFailure) && (
                                                                <span
                                                                    title="自定义编辑报错信息并推送给用户"
                                                                    style={{ cursor: 'pointer', opacity: 0.6, fontSize: '12px', display: 'inline-flex', alignItems: 'center', padding: '1px 6px', background: 'var(--bg-secondary)', borderRadius: '4px', flexShrink: 0, color: 'var(--text-secondary)', transition: 'all 0.2s' }}
                                                                    onMouseOver={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-tertiary)'; }}
                                                                    onMouseOut={e => { e.currentTarget.style.opacity = 0.6; e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setEditingMsgText(r.message || "");
                                                                        setEditingMsgVid(r.verificationId);
                                                                    }}
                                                                >✏️ 编辑</span>
                                                            )}
                                                        </div>
                                                    )
                                                )}
                                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                    <span>{ts}</span>
                                                    {submitEmail && <span style={{ background: 'var(--bg-tertiary)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px' }}>📧 {shortSubmitEmail}</span>}
                                                    {r.userId && <span style={{ background: 'var(--bg-tertiary)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' }}>🔑 {r.userId}</span>}
                                                    {r.cdk && <span style={{ background: 'var(--bg-tertiary)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' }}>🔑 {r.cdk}</span>}
                                                </div>
                                                {((!r.via && method) || cardKey || r.channel || r.httpStatus || r.upstreamStatus || isSubmissionFailure || r.refunded) && (
                                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                        {method && !r.via && <span style={{ background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' }}>method: {method}</span>}
                                                        {r.channel && <span style={{ background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' }}>channel: {String(r.channel).toUpperCase()}</span>}
                                                        {cardKey && <span style={{ background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' }}>card: {shortCardKey}</span>}
                                                        {isSubmissionFailure && <span style={{ background: 'rgba(220, 38, 38, 0.08)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace', color: '#dc2626' }}>stage: submission</span>}
                                                        {r.httpStatus ? <span style={{ background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' }}>http: {r.httpStatus}</span> : null}
                                                        {r.upstreamStatus ? <span style={{ background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' }}>upstream: {r.upstreamStatus}</span> : null}
                                                        {r.refunded ? <span style={{ background: 'rgba(22, 163, 74, 0.08)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace', color: '#16a34a' }}>refunded</span> : null}
                                                    </div>
                                                )}
                                            </div>
                                            {/* Manual override buttons - rightmost */}
                                            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end', marginLeft: 'auto', alignSelf: 'center' }}>
                                                {!isPass && !isSubmissionFailure && (
                                                    <button
                                                        title="手动标记为通过"
                                                        style={{
                                                            background: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px',
                                                            padding: '2px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                                                            lineHeight: '20px', whiteSpace: 'nowrap', minWidth: '70px', textAlign: 'center',
                                                        }}
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            if (!confirm(`确认将 ${shortVid} 手动标记为通过？`)) return;
                                                            try {
                                                                if (typeof r.id === 'string' && r.id.startsWith('sse-')) {
                                                                    // SSE-only entry: use VID-based override
                                                                    await fetch(`${API_BASE}/api/admin/override-vid`, {
                                                                        method: 'POST',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ vid: r.verificationId, status: 'pass' })
                                                                    });
                                                                    setVerifyLog(prev => prev.map(item =>
                                                                        item.verificationId === r.verificationId
                                                                            ? { ...item, status: 'pass', message: '管理员手动标记为通过' }
                                                                            : item
                                                                    ));
                                                                } else {
                                                                    await fetch(`${API_BASE}/api/verify/history/${r.id}`, {
                                                                        method: 'PATCH',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ status: 'pass' })
                                                                    });
                                                                    fetchVerifyHistory();
                                                                }
                                                            } catch (err) { console.error(err); }
                                                        }}
                                                    >✓ Pass</button>
                                                )}
                                                {(isPass || isProcessing) && !isSubmissionFailure && (
                                                    <button
                                                        title="手动标记为失败"
                                                        style={{
                                                            background: '#dc2626', color: '#fff', border: 'none', borderRadius: '4px',
                                                            padding: '2px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                                                            lineHeight: '20px', whiteSpace: 'nowrap', minWidth: '70px', textAlign: 'center',
                                                        }}
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            if (!confirm(`确认将 ${shortVid} 手动标记为失败？`)) return;
                                                            try {
                                                                if (typeof r.id === 'string' && r.id.startsWith('sse-')) {
                                                                    // SSE-only entry: use VID-based override
                                                                    await fetch(`${API_BASE}/api/admin/override-vid`, {
                                                                        method: 'POST',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ vid: r.verificationId, status: 'failed' })
                                                                    });
                                                                    setVerifyLog(prev => prev.map(item =>
                                                                        item.verificationId === r.verificationId
                                                                            ? { ...item, status: 'failed', message: '认证失败' }
                                                                            : item
                                                                    ));
                                                                } else {
                                                                    await fetch(`${API_BASE}/api/verify/history/${r.id}`, {
                                                                        method: 'PATCH',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ status: 'failed' })
                                                                    });
                                                                    fetchVerifyHistory();
                                                                }
                                                            } catch (err) { console.error(err); }
                                                        }}
                                                    >✕ Fail</button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Pagination Controls */}
                            {vLogTotalPages > 1 && (
                                <div style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    gap: '8px', marginTop: '20px', padding: '12px 0',
                                    borderTop: '1px solid var(--border-color, rgba(128,128,128,0.15))',
                                }}>
                                    <button
                                        className="btn btn-sm btn-secondary"
                                        disabled={vLogPage <= 1}
                                        onClick={() => handleVLogPageChange(1)}
                                        style={{ minWidth: '36px' }}
                                    >«</button>
                                    <button
                                        className="btn btn-sm btn-secondary"
                                        disabled={vLogPage <= 1}
                                        onClick={() => handleVLogPageChange(vLogPage - 1)}
                                        style={{ minWidth: '36px' }}
                                    >‹</button>
                                    {(() => {
                                        const pages = [];
                                        let start = Math.max(1, vLogPage - 2);
                                        let end = Math.min(vLogTotalPages, vLogPage + 2);
                                        if (end - start < 4) {
                                            if (start === 1) end = Math.min(vLogTotalPages, start + 4);
                                            else start = Math.max(1, end - 4);
                                        }
                                        for (let p = start; p <= end; p++) {
                                            pages.push(
                                                <button
                                                    key={p}
                                                    className={`btn btn-sm ${p === vLogPage ? 'btn-primary' : 'btn-secondary'}`}
                                                    onClick={() => handleVLogPageChange(p)}
                                                    style={{ minWidth: '36px' }}
                                                >{p}</button>
                                            );
                                        }
                                        return pages;
                                    })()}
                                    <button
                                        className="btn btn-sm btn-secondary"
                                        disabled={vLogPage >= vLogTotalPages}
                                        onClick={() => handleVLogPageChange(vLogPage + 1)}
                                        style={{ minWidth: '36px' }}
                                    >›</button>
                                    <button
                                        className="btn btn-sm btn-secondary"
                                        disabled={vLogPage >= vLogTotalPages}
                                        onClick={() => handleVLogPageChange(vLogTotalPages)}
                                        style={{ minWidth: '36px' }}
                                    >»</button>
                                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)', marginLeft: '12px' }}>
                                        共 {vLogTotal} 条
                                    </span>
                                </div>
                            )}
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 600 }}>用户管理</span>
                                <input
                                    type="text"
                                    placeholder="搜索邮箱/用户名/ID/状态..."
                                    className="input"
                                    style={{ padding: '4px 10px', fontSize: '13px', width: '220px', borderRadius: '6px' }}
                                    value={userSearch}
                                    onChange={(e) => setUserSearch(e.target.value)}
                                />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>共 {filteredUsers.length} 个用户</span>
                                {userTotalPages > 1 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <button
                                            onClick={() => setUserPage(p => Math.max(1, p - 1))}
                                            disabled={userPage === 1}
                                            style={{ padding: '2px 8px', fontSize: '13px', border: '1px solid var(--border-primary)', borderRadius: '4px', background: 'var(--bg-secondary)', cursor: userPage === 1 ? 'not-allowed' : 'pointer', opacity: userPage === 1 ? 0.5 : 1 }}
                                        >
                                            上一页
                                        </button>
                                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', minWidth: '40px', textAlign: 'center' }}>{userPage} / {userTotalPages}</span>
                                        <button
                                            onClick={() => setUserPage(p => Math.min(userTotalPages, p + 1))}
                                            disabled={userPage === userTotalPages}
                                            style={{ padding: '2px 8px', fontSize: '13px', border: '1px solid var(--border-primary)', borderRadius: '4px', background: 'var(--bg-secondary)', cursor: userPage === userTotalPages ? 'not-allowed' : 'pointer', opacity: userPage === userTotalPages ? 0.5 : 1 }}
                                        >
                                            下一页
                                        </button>
                                    </div>
                                )}
                                <button className="btn btn-sm btn-secondary" onClick={fetchUsers} disabled={usersLoading}
                                    style={{ padding: '6px 16px', borderRadius: '8px', fontSize: '13px' }}>
                                    {usersLoading ? '加载中...' : '🔄 刷新'}
                                </button>
                            </div>
                        </div>
                        <div className="users-table card">
                            {usersError && (
                                <div style={{ margin: '12px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', color: '#dc2626', fontSize: '13px', fontWeight: 600 }}>
                                    {usersError}
                                </div>
                            )}
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>用户名</th>
                                        <th>邮箱</th>
                                        <th>角色</th>
                                        <th>积分</th>
                                        <th>邀请码</th>
                                        <th>邀请数</th>
                                        <th>状态</th>
                                        <th>注册时间</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.length === 0 && !usersLoading && (
                                        <tr><td colSpan={10} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>暂无用户数据</td></tr>
                                    )}
                                    {usersLoading && (
                                        <tr><td colSpan={10} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>加载中...</td></tr>
                                    )}
                                    {displayUsers.map(u => (
                                        <tr key={u.id}>
                                            <td>{u.id}</td>
                                            <td style={{ fontWeight: 600 }}>{u.username || '-'}</td>
                                            <td>{u.email}</td>
                                            <td>
                                                <span className={`badge ${u.role === 'admin' ? 'badge-warning' : u.role === 'user' ? 'badge-info' : 'badge-success'}`} style={{ fontSize: '11px' }}>
                                                    {ROLE_LABELS[u.role] || u.role || '用户'}
                                                </span>
                                            </td>
                                            <td style={{ fontWeight: 600, color: u.credits > 0 ? '#16a34a' : '#94a3b8' }}>{u.credits ?? 0}</td>
                                            <td>
                                                {u.invite_code ? (
                                                    <code style={{ fontSize: '12px', padding: '2px 6px', background: 'rgba(124,92,252,0.08)', borderRadius: '4px', color: '#7c5cfc', cursor: 'pointer' }}
                                                        onClick={() => { navigator.clipboard.writeText(u.invite_code); }}
                                                        title="点击复制">
                                                        {u.invite_code}
                                                    </code>
                                                ) : '-'}
                                            </td>
                                            <td>
                                                {u.invite_count > 0 ? (
                                                    <span style={{ fontWeight: 600, color: '#f59e0b' }}>👥 {u.invite_count}</span>
                                                ) : (
                                                    <span style={{ color: '#cbd5e1' }}>0</span>
                                                )}
                                            </td>
                                            <td>
                                                <span className={`badge badge-${(!u.status || u.status === 'active') ? 'success' : 'error'}`}>
                                                    {(!u.status || u.status === 'active') ? '正常' : '禁用'}
                                                </span>
                                            </td>
                                            <td style={{ fontSize: '13px', color: '#64748b' }}>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
                                            <td>
                                                <div className="action-btns" style={{ display: 'flex', gap: '6px' }}>
                                                    <button className="btn btn-sm btn-secondary"
                                                        style={{ padding: '4px 12px', fontSize: '12px', borderRadius: '6px' }}
                                                        onClick={() => {
                                                            setEditingUser(u);
                                                            setEditCredits(String(u.credits ?? 0));
                                                            setEditRole(u.role || 'user');
                                                            setEditPermissions(u.admin_permissions || []);
                                                        }}>
                                                        编辑
                                                    </button>
                                                    <button className="btn btn-sm btn-secondary"
                                                        style={{ padding: '4px 12px', fontSize: '12px', borderRadius: '6px' }}
                                                        onClick={() => handleViewUserHistory(u)}>
                                                        历史
                                                    </button>
                                                    {u.role !== 'admin' && (
                                                        <button
                                                            className={`btn btn-sm ${(!u.status || u.status === 'active') ? 'btn-outline' : 'btn-primary'}`}
                                                            style={{ padding: '4px 12px', fontSize: '12px', borderRadius: '6px' }}
                                                            onClick={() => handleToggleUser(u.id, u.status || 'active')}>
                                                            {(!u.status || u.status === 'active') ? '禁用' : '启用'}
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Edit User Modal */}
                        {editingUser && (
                            <div onClick={() => { setEditingUser(null); }} style={{
                                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                            }}>
                                <div onClick={e => e.stopPropagation()} style={{
                                    background: 'var(--bg-card, #fff)', borderRadius: '16px', padding: '28px',
                                    width: '400px', maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.15)'
                                }}>
                                    <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 700 }}>✏️ 编辑用户</h3>
                                    <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: '14px' }}>
                                        {editingUser.username || editingUser.email} (ID: {editingUser.id})
                                    </p>
                                    <div style={{ marginBottom: '16px' }}>
                                        <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>积分</label>
                                        <input
                                            className="input" type="number" min="0" step="0.1"
                                            value={editCredits}
                                            onChange={e => setEditCredits(e.target.value)}
                                            disabled={!can('manage_credits')}
                                            style={{ width: '100%', boxSizing: 'border-box' }}
                                        />
                                    </div>
                                    {can('super_admin') && (
                                        <>
                                            <div style={{ marginBottom: '16px' }}>
                                                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>角色</label>
                                                <select
                                                    className="input"
                                                    value={editRole}
                                                    onChange={e => {
                                                        const nextRole = e.target.value;
                                                        setEditRole(nextRole);
                                                        const preset = roleConfig.presets.find(p => p.id === nextRole);
                                                        setEditPermissions(nextRole === 'admin' ? Object.keys(ADMIN_PERMISSION_LABELS) : (preset?.permissions || []));
                                                    }}
                                                    style={{ width: '100%', boxSizing: 'border-box' }}
                                                >
                                                    <option value="user">用户</option>
                                                    <option value="admin">管理员（全权限）</option>
                                                    {roleConfig.presets.map(p => (
                                                        <option key={p.id} value={p.id}>{p.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            {editRole !== 'user' && editRole !== 'admin' && (
                                                <div style={{ marginBottom: '16px' }}>
                                                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'block' }}>权限</label>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', maxHeight: '180px', overflow: 'auto', padding: '10px', border: '1px solid var(--border-primary)', borderRadius: '10px' }}>
                                                        {roleConfig.permissions.map(p => (
                                                            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={editPermissions.includes(p.id)}
                                                                    onChange={e => setEditPermissions(prev => e.target.checked ? [...new Set([...prev, p.id])] : prev.filter(x => x !== p.id))}
                                                                />
                                                                {p.label}
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                        <button className="btn" onClick={() => { setEditingUser(null); }}
                                            style={{ background: '#f1f5f9', color: '#64748b', border: 'none', padding: '8px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                                            取消
                                        </button>
                                        <button className="btn btn-primary" onClick={handleUpdateUser}
                                            style={{ padding: '8px 24px', borderRadius: '8px', fontWeight: 600 }}>
                                            保存
                                        </button>
                                    </div>
                                </div>
                            </div>
                )}

                {/* Admin Roles Tab */}
                {activeTab === 'admin-roles' && can('super_admin') && (
                    <div className="tab-content">
                        <div className="card" style={{ padding: '20px', marginBottom: '16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '14px' }}>
                                <div>
                                    <h3 style={{ margin: '0 0 6px', fontSize: '18px' }}>子管理员配置</h3>
                                    <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px' }}>配置运营/代理、技术运维等子管理员默认权限。保存后，用户管理处选择对应 role 即可套用，也可以单独微调。</p>
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button className="btn btn-sm btn-secondary" onClick={fetchRoleConfig} disabled={roleConfigLoading}>{roleConfigLoading ? '加载中...' : '刷新'}</button>
                                    <button className="btn btn-sm btn-primary" onClick={handleSaveRoleConfig} disabled={roleConfigSaving}>{roleConfigSaving ? '保存中...' : '保存配置'}</button>
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
                                {roleConfig.presets.map((preset, idx) => (
                                    <div key={preset.id} style={{ border: '1px solid var(--border-primary)', borderRadius: '12px', padding: '14px', background: 'var(--bg-secondary)' }}>
                                        <input
                                            className="input"
                                            value={preset.label}
                                            onChange={e => setRoleConfig(prev => ({ ...prev, presets: prev.presets.map((p, i) => i === idx ? { ...p, label: e.target.value } : p) }))}
                                            style={{ width: '100%', boxSizing: 'border-box', marginBottom: '8px', fontWeight: 700 }}
                                        />
                                        <code style={{ display: 'inline-block', fontSize: '12px', marginBottom: '8px', color: '#7c5cfc' }}>{preset.id}</code>
                                        <textarea
                                            className="input"
                                            value={preset.description || ''}
                                            onChange={e => setRoleConfig(prev => ({ ...prev, presets: prev.presets.map((p, i) => i === idx ? { ...p, description: e.target.value } : p) }))}
                                            style={{ width: '100%', boxSizing: 'border-box', minHeight: '64px', marginBottom: '10px', fontSize: '12px' }}
                                        />
                                        <div style={{ display: 'grid', gap: '7px' }}>
                                            {roleConfig.permissions.map(permission => (
                                                <label key={permission.id} title={permission.description} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={(preset.permissions || []).includes(permission.id)}
                                                        onChange={e => setRoleConfig(prev => ({
                                                            ...prev,
                                                            presets: prev.presets.map((p, i) => {
                                                                if (i !== idx) return p;
                                                                const current = p.permissions || [];
                                                                return { ...p, permissions: e.target.checked ? [...new Set([...current, permission.id])] : current.filter(x => x !== permission.id) };
                                                            })
                                                        }))}
                                                    />
                                                    <span>{permission.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* User History Modal */}
                {historyUser && (
                            <div onClick={() => setHistoryUser(null)} style={{
                                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                            }}>
                                <div onClick={e => e.stopPropagation()} style={{
                                    background: 'var(--bg-card, #fff)', borderRadius: '16px', padding: '24px',
                                    width: '860px', maxWidth: '95vw', maxHeight: '85vh', overflow: 'auto',
                                    boxShadow: '0 20px 60px rgba(0,0,0,0.15)'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '16px' }}>
                                        <div>
                                            <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 700 }}>📜 用户历史提交</h3>
                                            <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
                                                {historyUser.username || historyUser.email} (ID: {historyUser.id})
                                            </p>
                                        </div>
                                        <button className="btn" onClick={() => setHistoryUser(null)}
                                            style={{ background: '#f1f5f9', color: '#64748b', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                                            关闭
                                        </button>
                                    </div>

                                    {userHistoryLoading ? (
                                        <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>加载中...</div>
                                    ) : userHistory.length === 0 ? (
                                        <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>暂无历史记录</div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            {userHistory.map(item => {
                                                const isPass = item.status === 'pass';
                                                const isFailed = item.status === 'failed';
                                                const badgeBg = (item.via === 'gpt' || item.type === 'gpt') ? '#d97706' : (item.via === 'kpixel' ? '#7c5cfc' : item.via === 'vpixel' ? '#0891b2' : item.via === 'ypixel' ? '#d97706' : item.via === 'pixel_auto' ? '#ea580c' : '#059669');
                                                return (
                                                    <div key={item.id} style={{
                                                        border: '1px solid var(--border-primary)',
                                                        borderRadius: '12px',
                                                        padding: '14px 16px',
                                                        background: isPass ? 'rgba(22,163,74,0.04)' : isFailed ? 'rgba(220,38,38,0.04)' : 'var(--bg-card)'
                                                    }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{item.verificationId || item.id}</span>
                                                                <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '999px', background: badgeBg, color: '#fff', fontWeight: 600 }}>
                                                                    {(item.via || item.type || 'task').toUpperCase()}
                                                                </span>
                                                                <span style={{ fontSize: '12px', color: isPass ? '#16a34a' : isFailed ? '#dc2626' : '#64748b', fontWeight: 600 }}>
                                                                    {isPass ? '成功' : isFailed ? '失败' : item.status}
                                                                </span>
                                                            </div>
                                                            <span style={{ fontSize: '12px', color: '#64748b' }}>
                                                                {item.timestamp ? new Date(item.timestamp).toLocaleString('zh-CN', { hour12: false }) : '-'}
                                                            </span>
                                                        </div>
                                                        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
                                                            <div><strong>提交信息：</strong>{item.submitInfo || item.email || item.verificationId || '未记录'}</div>
                                                            {item.email && <div><strong>邮箱：</strong>{item.email}</div>}
                                                            {item.cardKey && <div><strong>卡密：</strong><code>{item.cardKey}</code></div>}
                                                            {item.via && <div><strong>方法：</strong>{item.via}</div>}
                                                            {item.message && <div><strong>结果：</strong>{item.message}</div>}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Admin Roles Tab */}
                {activeTab === 'admin-roles' && can('super_admin') && (
                    <div className="tab-content">
                        <div className="card" style={{ padding: '20px', marginBottom: '16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '14px' }}>
                                <div>
                                    <h3 style={{ margin: '0 0 6px', fontSize: '18px' }}>子管理员配置</h3>
                                    <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px' }}>配置运营/代理、技术运维等子管理员默认权限。保存后，用户管理处选择对应 role 即可套用，也可以单独微调。</p>
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button className="btn btn-sm btn-secondary" onClick={fetchRoleConfig} disabled={roleConfigLoading}>{roleConfigLoading ? '加载中...' : '刷新'}</button>
                                    <button className="btn btn-sm btn-primary" onClick={handleSaveRoleConfig} disabled={roleConfigSaving}>{roleConfigSaving ? '保存中...' : '保存配置'}</button>
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
                                {roleConfig.presets.map((preset, idx) => (
                                    <div key={preset.id} style={{ border: '1px solid var(--border-primary)', borderRadius: '12px', padding: '14px', background: 'var(--bg-secondary)' }}>
                                        <input className="input" value={preset.label} onChange={e => setRoleConfig(prev => ({ ...prev, presets: prev.presets.map((p, i) => i === idx ? { ...p, label: e.target.value } : p) }))} style={{ width: '100%', boxSizing: 'border-box', marginBottom: '8px', fontWeight: 700 }} />
                                        <code style={{ display: 'inline-block', fontSize: '12px', marginBottom: '8px', color: '#7c5cfc' }}>{preset.id}</code>
                                        <textarea className="input" value={preset.description || ''} onChange={e => setRoleConfig(prev => ({ ...prev, presets: prev.presets.map((p, i) => i === idx ? { ...p, description: e.target.value } : p) }))} style={{ width: '100%', boxSizing: 'border-box', minHeight: '64px', marginBottom: '10px', fontSize: '12px' }} />
                                        <div style={{ display: 'grid', gap: '7px' }}>
                                            {roleConfig.permissions.map(permission => (
                                                <label key={permission.id} title={permission.description} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={(preset.permissions || []).includes(permission.id)}
                                                        onChange={e => setRoleConfig(prev => ({
                                                            ...prev,
                                                            presets: prev.presets.map((p, i) => {
                                                                if (i !== idx) return p;
                                                                const current = p.permissions || [];
                                                                return { ...p, permissions: e.target.checked ? [...new Set([...current, permission.id])] : current.filter(x => x !== permission.id) };
                                                            })
                                                        }))}
                                                    />
                                                    <span>{permission.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* AI Generator Tab */}
                {/* Audit Logs Tab */}
                {activeTab === 'audit' && (
                    <div className="tab-content">
                        <div className="card" style={{ padding: '24px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
                                <h3>💸 资金对账单 <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 'normal' }}>({auditLogTotal} 条记录)</span></h3>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                    <input
                                        type="text"
                                        className="input input-sm"
                                        placeholder="搜索 User ID 或 单号..."
                                        value={auditLogSearch}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setAuditLogSearch(val);
                                            auditLogSearchRef.current = val;
                                            if (auditLogSearchTimer.current) clearTimeout(auditLogSearchTimer.current);
                                            auditLogSearchTimer.current = setTimeout(() => {
                                                setAuditLogPage(1);
                                                fetchAuditLogs(1);
                                            }, 500);
                                        }}
                                        style={{ width: '220px' }}
                                    />
                                    <button className="btn btn-sm btn-secondary" onClick={() => fetchAuditLogs(1)}>🔄 刷新</button>
                                </div>
                            </div>
                            <div className="users-table">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>流水 ID</th>
                                            <th>用户 ID</th>
                                            <th>变动额度</th>
                                            <th>变动后余额</th>
                                            <th>操作类型</th>
                                            <th>关联单号</th>
                                            <th>发生时间</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {auditLogs.map((log) => (
                                            <tr key={log.id}>
                                                <td style={{ fontFamily: "'SF Mono', monospace", fontSize: '12px' }}>{log.id}</td>
                                                <td><span className="badge badge-info">{log.user_id}</span></td>
                                                <td style={{ fontWeight: 600, color: log.amount > 0 ? '#16a34a' : '#dc2626' }}>
                                                    {log.amount > 0 ? `+${log.amount}` : log.amount}
                                                </td>
                                                <td style={{ fontWeight: 600 }}>{log.balance_after}</td>
                                                <td><span className="badge">{log.reason}</span></td>
                                                <td style={{ fontFamily: "'SF Mono', monospace", fontSize: '11px' }}>{log.ref_id || '-'}</td>
                                                <td style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                                    {log.timestamp ? new Date(log.timestamp).toLocaleString('zh-CN', { hour12: false }) : '-'}
                                                </td>
                                            </tr>
                                        ))}
                                        {auditLogs.length === 0 && (
                                            <tr><td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>暂无财务流水记录</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            
                            {/* Pagination Controls */}
                            {auditLogTotalPages > 1 && (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '20px', padding: '12px 0', borderTop: '1px solid var(--border-color, rgba(128,128,128,0.15))' }}>
                                    <button className="btn btn-sm btn-secondary" disabled={auditLogPage <= 1} onClick={() => {setAuditLogPage(1); fetchAuditLogs(1);}}>«</button>
                                    <button className="btn btn-sm btn-secondary" disabled={auditLogPage <= 1} onClick={() => {const np = Math.max(1, auditLogPage - 1); setAuditLogPage(np); fetchAuditLogs(np);}}>‹</button>
                                    <span style={{ fontSize: '14px', margin: '0 8px' }}>第 {auditLogPage}/{auditLogTotalPages} 页</span>
                                    <button className="btn btn-sm btn-secondary" disabled={auditLogPage >= auditLogTotalPages} onClick={() => {const np = Math.min(auditLogTotalPages, auditLogPage + 1); setAuditLogPage(np); fetchAuditLogs(np);}}>›</button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

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

                                    <div
                                        className={`provider-card ${aiProvider === 'mixed' ? 'active' : ''}`}
                                        onClick={() => {
                                            setAiProvider('mixed');
                                            fetch(`${API_BASE}/api/routing/stats`).then(r => r.ok ? r.json() : null).then(stats => {
                                                if (stats) setRoutingStats(stats);
                                            }).catch(() => { });
                                        }}
                                    >
                                        <div className="provider-icon">🔀</div>
                                        <div className="provider-info">
                                            <h4>混合模式</h4>
                                            <p>API + Bot 统一调度，自动分配</p>
                                        </div>
                                        <div className="provider-status">
                                            <span className="badge badge-info">新</span>
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
                                    <button
                                        onClick={() => setShowTemplates(prev => !prev)}
                                        style={{
                                            marginLeft: 'auto', background: 'none', border: '1px solid var(--border-color)',
                                            borderRadius: '6px', padding: '2px 10px', fontSize: '11px', cursor: 'pointer',
                                            color: 'var(--text-secondary)'
                                        }}
                                    >{showTemplates ? '收起' : '展开'}</button>
                                </div>
                                {showTemplates && <div className="provider-cards">

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

                                </div>}
                            </div>

                            {/* Mixed Mode — Unified Smart Routing Panel */}
                            {aiProvider === 'mixed' && (() => {
                                const nh = nodeHealth || {};
                                const nodes = nh.nodes || {};
                                const config = nh.config || {};
                                const thresholds = config.thresholds || {};
                                const allocation = nh.allocation || {};
                                const cooldowns = nh.cooldowns || {};
                                const nodeOrder = ['getgem', 'oldbot', 'blackbot', 'dualbot'];
                                const nodeLabels = { getgem: 'GetGem', oldbot: 'OldBot', blackbot: 'BlackBot', dualbot: 'DualBot' };
                                const nodeColors = { getgem: '#10b981', oldbot: '#3b82f6', blackbot: '#8b5cf6', dualbot: '#6b7280' };
                                const statusColors = { healthy: '#10b981', degraded: '#f59e0b', circuit_broken: '#ef4444' };
                                const statusLabels = { healthy: 'Healthy', degraded: 'Degraded', circuit_broken: 'Broken' };

                                const saveConfig = async (updates) => {
                                    try {
                                        const token = user?.token || localStorage.getItem('verifykey-token');
                                        await fetch(`${API_BASE}/api/admin/node-health/config`, {
                                            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                            body: JSON.stringify(updates)
                                        });
                                        const res = await fetch(`${API_BASE}/api/admin/node-health`, { headers: { 'Authorization': `Bearer ${token}` } });
                                        if (res.ok) setNodeHealth(await res.json());
                                    } catch (e) { console.error(e); }
                                };

                                const toggleNode = async (nodeId, enabled) => {
                                    try {
                                        const token = user?.token || localStorage.getItem('verifykey-token');
                                        await fetch(`${API_BASE}/api/admin/node-health/toggle`, {
                                            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                            body: JSON.stringify({ nodeId, enabled })
                                        });
                                        const res = await fetch(`${API_BASE}/api/admin/node-health`, { headers: { 'Authorization': `Bearer ${token}` } });
                                        if (res.ok) setNodeHealth(await res.json());
                                    } catch (e) { console.error(e); }
                                };

                                const setNodeWeight = async (nodeId, weight) => {
                                    try {
                                        const token = user?.token || localStorage.getItem('verifykey-token');
                                        await fetch(`${API_BASE}/api/admin/node-health/weight`, {
                                            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                            body: JSON.stringify({ nodeId, weight })
                                        });
                                        const res = await fetch(`${API_BASE}/api/admin/node-health`, { headers: { 'Authorization': `Bearer ${token}` } });
                                        if (res.ok) setNodeHealth(await res.json());
                                    } catch (e) { console.error(e); }
                                };

                                const clearCooldown = async (nodeId) => {
                                    try {
                                        const token = user?.token || localStorage.getItem('verifykey-token');
                                        await fetch(`${API_BASE}/api/admin/node-health/clear-cooldown`, {
                                            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                            body: JSON.stringify({ nodeId })
                                        });
                                        const res = await fetch(`${API_BASE}/api/admin/node-health`, { headers: { 'Authorization': `Bearer ${token}` } });
                                        if (res.ok) setNodeHealth(await res.json());
                                    } catch (e) { console.error(e); }
                                };

                                const toggleAutoMaintenance = async () => {
                                    try {
                                        const token = user?.token || localStorage.getItem('verifykey-token');
                                        await fetch(`${API_BASE}/api/admin/node-health/auto-maintenance`, {
                                            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                            body: JSON.stringify({ enabled: !config.autoMaintenance })
                                        });
                                        const res = await fetch(`${API_BASE}/api/admin/node-health`, { headers: { 'Authorization': `Bearer ${token}` } });
                                        if (res.ok) setNodeHealth(await res.json());
                                    } catch (e) { console.error(e); }
                                };

                                const forceRefresh = async (e) => {
                                    const btn = e?.currentTarget;
                                    if (btn) { btn.disabled = true; btn.textContent = '⏳ 刷新中...'; btn.style.opacity = '0.6'; }
                                    try {
                                        const token = user?.token || localStorage.getItem('verifykey-token');
                                        const res = await fetch(`${API_BASE}/api/admin/node-health/refresh`, {
                                            method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
                                        });
                                        if (res.ok) {
                                            const data = await res.json();
                                            setNodeHealth(prev => ({ ...prev, nodes: data.nodes, allocation: data.allocation }));
                                            if (btn) { btn.textContent = '✅ 已刷新'; btn.style.background = '#10b981'; btn.style.color = '#fff'; }
                                            setTimeout(() => { if (btn) { btn.textContent = '🔄 手动刷新'; btn.style.background = ''; btn.style.color = ''; btn.style.opacity = '1'; btn.disabled = false; } }, 1500);
                                            return;
                                        }
                                    } catch (e) { console.error(e); }
                                    if (btn) { btn.textContent = '🔄 手动刷新'; btn.style.opacity = '1'; btn.style.background = ''; btn.style.color = ''; btn.disabled = false; }
                                };

                                return (
                                    <div className="provider-settings">
                                        <h4>🔀 混合模式 智能路由</h4>
                                        <div className="settings-form">
                                            <div style={{
                                                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                                color: 'white', padding: '16px 20px', borderRadius: '8px', marginBottom: '16px'
                                            }}>
                                                <p style={{ margin: 0, fontSize: '14px' }}>
                                                    <strong>混合模式</strong> 将 GetGem API 与 Telegram Bot 统一为一个验证池。
                                                    根据各节点实时成功率、权重和并发容量智能分配验证链接。
                                                </p>
                                            </div>

                                            {/* ── Node Health Cards ── */}
                                            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
                                                {nodeOrder.map(nid => {
                                                    const n = nodes[nid] || { nodeId: nid, status: 'healthy', successRate: 50, enabled: true, sparkline: [], extra: {} };
                                                    const color = statusColors[n.status] || '#6b7280';
                                                    const label = statusLabels[n.status] || n.status;
                                                    return (
                                                        <div key={nid} style={{
                                                            flex: '1 1 0', minWidth: '140px',
                                                            background: 'var(--bg-secondary)', borderRadius: '12px', padding: '14px 16px',
                                                            border: `1px solid ${n.enabled ? color + '30' : 'var(--border-color)'}`,
                                                            opacity: n.enabled ? 1 : 0.5, transition: 'all .2s',
                                                            display: 'flex', flexDirection: 'column',
                                                        }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                                <span style={{ fontWeight: 700, fontSize: '14px' }}>{nodeLabels[nid]}</span>
                                                                <span style={{ fontSize: '11px', color, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
                                                                    {label}
                                                                </span>
                                                            </div>
                                                            <div style={{ fontSize: '24px', fontWeight: 800, color, marginBottom: '6px' }}>
                                                                {n.successRate?.toFixed(1) ?? '—'}%
                                                            </div>
                                                            {/* Variable-height content area — grows to push controls to bottom */}
                                                            <div style={{ flex: 1, marginBottom: '8px' }}>
                                                                {n.sparkline && n.sparkline.length > 0 && (
                                                                    <div style={{ display: 'flex', gap: '2px', marginBottom: '8px', height: '18px', alignItems: 'flex-end' }}>
                                                                        {n.sparkline.map((r, i) => (
                                                                            <div key={i} style={{
                                                                                width: '4px', borderRadius: '1px',
                                                                                height: r === 0 ? '18px' : r === 2 ? '8px' : '12px',
                                                                                background: r === 0 ? '#10b981' : r === 2 ? '#f59e0b' : '#ef4444',
                                                                                opacity: 0.8,
                                                                            }} />
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                                    {nid === 'getgem' && n.extra?.availableSlots !== undefined && (
                                                                        <span>{n.extra.availableSlots}/{n.extra.maxConcurrent || '?'} slots</span>
                                                                    )}
                                                                    {nid === 'oldbot' && n.extra?.pending !== undefined && (
                                                                        <span>{n.extra.pending} pending</span>
                                                                    )}
                                                                    {(nid === 'blackbot' || nid === 'dualbot') && n.extra?.total !== undefined && (
                                                                        <span>{n.extra.total} verified</span>
                                                                    )}
                                                                    {n.extra?.decayed && (
                                                                        <span style={{ color: '#f59e0b', marginLeft: '4px' }} title={n.extra.idleMinutes ? `空闲 ${n.extra.idleMinutes} 分钟` : '无历史数据'}>
                                                                            ⏳ {n.extra.idleMinutes ? `空闲${Math.round(n.extra.idleMinutes)}m` : '无数据'}
                                                                        </span>
                                                                    )}
                                                                    {n.extra?.maintenance && <span style={{ color: '#ef4444', marginLeft: '6px' }}>⚠️ Maintenance</span>}
                                                                    {n.extra?.offline && <span style={{ color: '#ef4444', marginLeft: '6px' }} title={n.extra.offlineReason || n.extra.pollError || ''}>🔌 掉线</span>}
                                                                    {n.source === 'external' && <span style={{ marginLeft: '6px' }}>🌐</span>}
                                                                </div>
                                                            </div>
                                                            {/* Controls pinned to bottom */}
                                                            <div>
                                                                {/* Cooldown badge */}
                                                                {cooldowns[nid] > 0 && (
                                                                    <div style={{
                                                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                                        background: '#fef2f2', border: '1px solid #fecaca',
                                                                        borderRadius: '8px', padding: '6px 10px', marginBottom: '8px',
                                                                    }}>
                                                                        <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: 600 }}>
                                                                            🧊 冷却中 {Math.floor(cooldowns[nid] / 60)}:{String(cooldowns[nid] % 60).padStart(2, '0')}
                                                                        </span>
                                                                        <button
                                                                            onClick={() => clearCooldown(nid)}
                                                                            style={{
                                                                                fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
                                                                                background: '#dc2626', color: 'white', border: 'none',
                                                                                cursor: 'pointer', fontWeight: 600,
                                                                            }}
                                                                        >解除</button>
                                                                    </div>
                                                                )}
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                    <span style={{ fontSize: '12px' }}>启用</span>
                                                                    <label style={{ position: 'relative', width: '36px', height: '20px', cursor: 'pointer' }}>
                                                                        <input type="checkbox" checked={n.enabled} onChange={(e) => toggleNode(nid, e.target.checked)}
                                                                            style={{ opacity: 0, width: 0, height: 0 }} />
                                                                        <span style={{
                                                                            position: 'absolute', inset: 0, borderRadius: '10px', transition: '.2s',
                                                                            background: n.enabled ? nodeColors[nid] : '#ccc',
                                                                        }}>
                                                                            <span style={{
                                                                                position: 'absolute', width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
                                                                                top: '2px', left: n.enabled ? '18px' : '2px', transition: '.2s',
                                                                            }} />
                                                                        </span>
                                                                    </label>
                                                                </div>
                                                                {/* Weight slider */}
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                                                                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', minWidth: '28px' }}>权重</span>
                                                                    <input type="range" min="0.1" max="1.0" step="0.1"
                                                                        defaultValue={n.weight ?? 1.0}
                                                                        key={`${nid}-${n.weight}`}
                                                                        onMouseUp={(e) => setNodeWeight(nid, parseFloat(e.target.value))}
                                                                        onTouchEnd={(e) => setNodeWeight(nid, parseFloat(e.target.value))}
                                                                        style={{ flex: 1, height: '4px', accentColor: nodeColors[nid] || '#6b7280' }}
                                                                    />
                                                                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)', minWidth: '28px', textAlign: 'right' }}>
                                                                        ×{(n.weight ?? 1.0).toFixed(1)}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* ── Traffic Allocation Bar ── */}
                                            <div style={{ marginBottom: '24px' }}>
                                                <label className="input-label">📊 流量分配</label>
                                                <div style={{ display: 'flex', borderRadius: '10px', overflow: 'hidden', height: '36px', marginBottom: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
                                                    {nodeOrder.map(nid => {
                                                        const pct = allocation[nid] || 0;
                                                        if (pct <= 0) return null;
                                                        return (
                                                            <div key={nid} style={{
                                                                width: `${pct}%`, background: nodeColors[nid],
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                color: '#fff', fontSize: '13px', fontWeight: 700, transition: 'width .3s',
                                                                minWidth: pct > 0 ? '40px' : '0',
                                                            }}>
                                                                {pct}%
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
                                                    {nodeOrder.map(nid => (
                                                        <span key={nid} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                                                            <span style={{ width: 10, height: 10, borderRadius: '3px', background: nodeColors[nid] }} />
                                                            {nodeLabels[nid]} <strong>{allocation[nid] || 0}%</strong>
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* ── Threshold Sliders ── */}
                                            <div style={{ marginBottom: '24px' }}>
                                                <label className="input-label">⚙️ 阈值配置</label>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                                                    {[
                                                        { key: 'degradeThreshold', label: '降级阈值', color: '#f59e0b', desc: '成功率低于此值时，该节点流量分配减半' },
                                                        { key: 'circuitBreakThreshold', label: '熔断阈值', color: '#ef4444', desc: '成功率低于此值时，停止分配流量' },
                                                        { key: 'recoverThreshold', label: '恢复阈值', color: '#10b981', desc: '成功率连续3次高于此值后恢复' },
                                                    ].map(({ key, label, color, desc }) => (
                                                        <div key={key} style={{
                                                            background: 'var(--bg-secondary)', borderRadius: '10px', padding: '14px 18px',
                                                            border: `1px solid ${color}20`
                                                        }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                                <span style={{ fontSize: '13px', fontWeight: 600, color }}>{label}</span>
                                                                <span style={{ fontSize: '18px', fontWeight: 800, color }}>{thresholds[key] || 50}%</span>
                                                            </div>
                                                            <input type="range" min="0" max="100" step="5"
                                                                value={thresholds[key] || 50}
                                                                onChange={(e) => {
                                                                    const val = parseInt(e.target.value);
                                                                    setNodeHealth(prev => ({
                                                                        ...prev, config: { ...prev.config, thresholds: { ...prev.config.thresholds, [key]: val } }
                                                                    }));
                                                                }}
                                                                onMouseUp={(e) => saveConfig({ thresholds: { [key]: parseInt(e.target.value) } })}
                                                                style={{ width: '100%', accentColor: color }}
                                                            />
                                                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '6px' }}>{desc}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* ── Mode Buttons ── */}
                                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px', justifyContent: 'center' }}>
                                                <button className="btn btn-sm"
                                                    style={{ background: 'var(--bg-tertiary)', padding: '8px 20px', fontSize: '13px', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer' }}
                                                    onClick={forceRefresh}
                                                >🔄 手动刷新</button>
                                                <button className="btn btn-sm"
                                                    style={{
                                                        background: config.mode === 'auto' ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'var(--bg-tertiary)',
                                                        color: config.mode === 'auto' ? '#fff' : 'inherit',
                                                        padding: '8px 20px', fontSize: '13px', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer',
                                                        boxShadow: config.mode === 'auto' ? '0 2px 8px rgba(59,130,246,0.3)' : 'none'
                                                    }}
                                                    onClick={() => saveConfig({ mode: 'auto' })}
                                                >⚡ 自动路由</button>
                                                <button className="btn btn-sm"
                                                    style={{
                                                        background: config.mode === 'locked' ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'var(--bg-tertiary)',
                                                        color: config.mode === 'locked' ? '#fff' : 'inherit',
                                                        padding: '8px 20px', fontSize: '13px', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer',
                                                        boxShadow: config.mode === 'locked' ? '0 2px 8px rgba(245,158,11,0.3)' : 'none'
                                                    }}
                                                    onClick={() => saveConfig({ mode: 'locked', lockedAllocation: allocation })}
                                                >📌 锁定分配</button>
                                                <button className="btn btn-sm"
                                                    style={{
                                                        background: config.autoMaintenance ? 'linear-gradient(135deg, #10b981, #059669)' : 'var(--bg-tertiary)',
                                                        color: config.autoMaintenance ? '#fff' : 'inherit',
                                                        padding: '8px 20px', fontSize: '13px', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer',
                                                        boxShadow: config.autoMaintenance ? '0 2px 8px rgba(16,185,129,0.3)' : 'none'
                                                    }}
                                                    onClick={toggleAutoMaintenance}
                                                >{config.autoMaintenance ? '✅' : '🔧'} 自动维护</button>
                                                {config.mode === 'locked' && (
                                                    <span style={{ fontSize: '11px', color: '#f59e0b', alignSelf: 'center' }}>⚠️ 当前为锁定模式，不会自动调整分配</span>
                                                )}
                                                {config.maintenanceActive && (
                                                    <span style={{ fontSize: '11px', color: '#ef4444', alignSelf: 'center' }}>🚨 自动维护已触发 — 所有节点掉线</span>
                                                )}
                                            </div>


                                        </div>
                                    </div>
                                );
                            })()}

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
                                                                        { key: 'gptbot', label: 'GPTBot' },
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

                                                                        {/* Message (Chinese) + InterMsg (International) */}
                                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '6px' }}>
                                                                            <div>
                                                                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>消息 (message) - 中文</label>
                                                                                <input type="text" className="input"
                                                                                    value={rule.message || ''}
                                                                                    onChange={e => setConfig(prev => {
                                                                                        const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                        const newRules = [...(dualBot.responseRules || [])];
                                                                                        newRules[ri] = { ...newRules[ri], message: e.target.value };
                                                                                        dualBot.responseRules = newRules;
                                                                                        return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                    })}
                                                                                    placeholder="验证成功 / 文档可能失效..."
                                                                                    style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                                                                />
                                                                            </div>
                                                                            <div>
                                                                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>国际消息 (interMsg) - English</label>
                                                                                <input type="text" className="input"
                                                                                    value={rule.interMsg || ''}
                                                                                    onChange={e => setConfig(prev => {
                                                                                        const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                        const newRules = [...(dualBot.responseRules || [])];
                                                                                        newRules[ri] = { ...newRules[ri], interMsg: e.target.value };
                                                                                        dualBot.responseRules = newRules;
                                                                                        return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                    })}
                                                                                    placeholder="Verified successfully / Doc may be invalid..."
                                                                                    style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                ))}

                                                                {(config?.verification?.dualBot?.responseRules || []).length === 0 && (
                                                                    <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12px', padding: '12px 0', margin: 0 }}>
                                                                        暂无规则，点击「+ 添加规则」开始配置
                                                                    </p>
                                                                )}
                                                            </div>

                                                            {/* ── DualBot: Suspension Rules ── */}
                                                            <div style={{ marginTop: '12px' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                                                    <label style={{ fontSize: '13px', fontWeight: 700 }}>🚫 停用规则 (suspensionRules)</label>
                                                                    <button className="btn" style={{ fontSize: '11px', padding: '3px 10px' }}
                                                                        onClick={() => setConfig(prev => {
                                                                            const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                            dualBot.suspensionRules = [...(dualBot.suspensionRules || []), { keywords: [], duration: 300 }];
                                                                            return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                        })}>+ 添加停用规则</button>
                                                                </div>
                                                                {(config?.verification?.dualBot?.suspensionRules || []).map((srule, sri) => (
                                                                    <div key={sri} style={{
                                                                        padding: '10px', marginBottom: '8px', borderRadius: '8px',
                                                                        border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)'
                                                                    }}>
                                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                                            <span style={{ fontSize: '12px', fontWeight: 700, color: '#ef4444' }}>🚫 停用规则 #{sri + 1}</span>
                                                                            <button className="btn" style={{ fontSize: '10px', padding: '2px 8px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
                                                                                onClick={() => setConfig(prev => {
                                                                                    const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                    const newRules = [...(dualBot.suspensionRules || [])];
                                                                                    newRules.splice(sri, 1);
                                                                                    dualBot.suspensionRules = newRules;
                                                                                    return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                })}>🗑️</button>
                                                                        </div>
                                                                        <div style={{ marginBottom: '6px' }}>
                                                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>关键词 (匹配 messageKey 或 raw_response)</label>
                                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                                                                {(srule.keywords || []).map((kw, kwi) => (
                                                                                    <span key={kwi} style={{
                                                                                        display: 'inline-flex', alignItems: 'center', gap: '3px',
                                                                                        padding: '2px 8px', fontSize: '11px', fontWeight: 600, fontFamily: 'monospace',
                                                                                        background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                                                                                        borderRadius: '10px', border: '1px solid rgba(239,68,68,0.2)'
                                                                                    }}>
                                                                                        {kw}
                                                                                        <span style={{ cursor: 'pointer', fontSize: '12px', lineHeight: 1 }}
                                                                                            onClick={() => setConfig(prev => {
                                                                                                const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                                const newRules = [...(dualBot.suspensionRules || [])];
                                                                                                const newKws = [...(newRules[sri].keywords || [])];
                                                                                                newKws.splice(kwi, 1);
                                                                                                newRules[sri] = { ...newRules[sri], keywords: newKws };
                                                                                                dualBot.suspensionRules = newRules;
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
                                                                                            const newRules = [...(dualBot.suspensionRules || [])];
                                                                                            const newKws = [...(newRules[sri].keywords || []), val];
                                                                                            newRules[sri] = { ...newRules[sri], keywords: newKws };
                                                                                            dualBot.suspensionRules = newRules;
                                                                                            return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                        });
                                                                                        e.target.value = '';
                                                                                    }
                                                                                }}
                                                                            />
                                                                        </div>
                                                                        <div>
                                                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>停用时长 (秒)</label>
                                                                            <input type="number" className="input"
                                                                                value={srule.duration || 300}
                                                                                onChange={e => setConfig(prev => {
                                                                                    const dualBot = { ...(prev.verification?.dualBot || {}) };
                                                                                    const newRules = [...(dualBot.suspensionRules || [])];
                                                                                    newRules[sri] = { ...newRules[sri], duration: parseInt(e.target.value) || 300 };
                                                                                    dualBot.suspensionRules = newRules;
                                                                                    return { ...prev, verification: { ...prev.verification, dualBot } };
                                                                                })}
                                                                                style={{ width: '120px', fontSize: '12px' }}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                                {(config?.verification?.dualBot?.suspensionRules || []).length === 0 && (
                                                                    <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '11px', padding: '8px 0', margin: 0 }}>
                                                                        暂无停用规则。当 bot 返回匹配关键词的消息时，bot 将暂停指定时间
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

                                                                                    {/* Message (Chinese) + InterMsg (International) */}
                                                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '6px' }}>
                                                                                        <div>
                                                                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>消息 (message) - 中文</label>
                                                                                            <input type="text" className="input"
                                                                                                value={rule.message || ''}
                                                                                                onChange={e => setConfig(prev => {
                                                                                                    const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                    const newRules = [...(newBots[idx].responseRules || [])];
                                                                                                    newRules[ri] = { ...newRules[ri], message: e.target.value };
                                                                                                    newBots[idx] = { ...newBots[idx], responseRules: newRules };
                                                                                                    return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                                })}
                                                                                                placeholder="验证成功 / 文档可能失效..."
                                                                                                style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                                                                            />
                                                                                        </div>
                                                                                        <div>
                                                                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>国际消息 (interMsg) - English</label>
                                                                                            <input type="text" className="input"
                                                                                                value={rule.interMsg || ''}
                                                                                                onChange={e => setConfig(prev => {
                                                                                                    const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                    const newRules = [...(newBots[idx].responseRules || [])];
                                                                                                    newRules[ri] = { ...newRules[ri], interMsg: e.target.value };
                                                                                                    newBots[idx] = { ...newBots[idx], responseRules: newRules };
                                                                                                    return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                                })}
                                                                                                placeholder="Verified successfully / Doc may be invalid..."
                                                                                                style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                                                                            />
                                                                                        </div>
                                                                                    </div>
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

                                                                        {/* ── Suspension Rules ── */}
                                                                        <div style={{ marginTop: '12px' }}>
                                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                                                                <label style={{ fontSize: '13px', fontWeight: 700 }}>🚫 停用规则 (suspensionRules)</label>
                                                                                <button className="btn" style={{ fontSize: '11px', padding: '3px 10px' }}
                                                                                    onClick={() => setConfig(prev => {
                                                                                        const newBots = [...(prev.verification?.singleBots || [])];
                                                                                        const newRules = [...(newBots[idx].suspensionRules || []), {
                                                                                            keywords: [], duration: 300
                                                                                        }];
                                                                                        newBots[idx] = { ...newBots[idx], suspensionRules: newRules };
                                                                                        return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                    })}>+ 添加停用规则</button>
                                                                            </div>
                                                                            {(bot.suspensionRules || []).map((srule, sri) => (
                                                                                <div key={sri} style={{
                                                                                    padding: '10px', marginBottom: '8px', borderRadius: '8px',
                                                                                    border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)'
                                                                                }}>
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                                                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#ef4444' }}>🚫 停用规则 #{sri + 1}</span>
                                                                                        <button className="btn" style={{ fontSize: '10px', padding: '2px 8px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
                                                                                            onClick={() => setConfig(prev => {
                                                                                                const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                const newRules = [...(newBots[idx].suspensionRules || [])];
                                                                                                newRules.splice(sri, 1);
                                                                                                newBots[idx] = { ...newBots[idx], suspensionRules: newRules };
                                                                                                return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                            })}>🗑️</button>
                                                                                    </div>
                                                                                    <div style={{ marginBottom: '6px' }}>
                                                                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>关键词 (匹配 messageKey 或 raw_response)</label>
                                                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                                                                            {(srule.keywords || []).map((kw, kwi) => (
                                                                                                <span key={kwi} style={{
                                                                                                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                                                                                                    padding: '2px 8px', fontSize: '11px', fontWeight: 600, fontFamily: 'monospace',
                                                                                                    background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                                                                                                    borderRadius: '10px', border: '1px solid rgba(239,68,68,0.2)'
                                                                                                }}>
                                                                                                    {kw}
                                                                                                    <span style={{ cursor: 'pointer', fontSize: '12px', lineHeight: 1 }}
                                                                                                        onClick={() => setConfig(prev => {
                                                                                                            const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                            const newRules = [...(newBots[idx].suspensionRules || [])];
                                                                                                            const newKws = [...(newRules[sri].keywords || [])];
                                                                                                            newKws.splice(kwi, 1);
                                                                                                            newRules[sri] = { ...newRules[sri], keywords: newKws };
                                                                                                            newBots[idx] = { ...newBots[idx], suspensionRules: newRules };
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
                                                                                                        const newRules = [...(newBots[idx].suspensionRules || [])];
                                                                                                        const newKws = [...(newRules[sri].keywords || []), val];
                                                                                                        newRules[sri] = { ...newRules[sri], keywords: newKws };
                                                                                                        newBots[idx] = { ...newBots[idx], suspensionRules: newRules };
                                                                                                        return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                                    });
                                                                                                    e.target.value = '';
                                                                                                }
                                                                                            }}
                                                                                        />
                                                                                    </div>
                                                                                    <div>
                                                                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>停用时长 (秒)</label>
                                                                                        <input type="number" className="input"
                                                                                            value={srule.duration || 300}
                                                                                            onChange={e => setConfig(prev => {
                                                                                                const newBots = [...(prev.verification?.singleBots || [])];
                                                                                                const newRules = [...(newBots[idx].suspensionRules || [])];
                                                                                                newRules[sri] = { ...newRules[sri], duration: parseInt(e.target.value) || 300 };
                                                                                                newBots[idx] = { ...newBots[idx], suspensionRules: newRules };
                                                                                                return { ...prev, verification: { ...prev.verification, singleBots: newBots } };
                                                                                            })}
                                                                                            style={{ width: '120px', fontSize: '12px' }}
                                                                                        />
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                            {(bot.suspensionRules || []).length === 0 && (
                                                                                <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '11px', padding: '8px 0', margin: 0 }}>
                                                                                    暂无停用规则。当 bot 返回匹配关键词的消息时，bot 将暂停指定时间
                                                                                </p>
                                                                            )}
                                                                        </div>
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
                            {!['getgem', 'batch_api', 'telegram', 'mixed'].includes(aiProvider) && (
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
                            {!['getgem', 'batch_api', 'telegram', 'mixed'].includes(aiProvider) && (
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
                )
                }

                {/* Verify Status Tab */}
                {
                    activeTab === 'verify-status' && (
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
                                    </div>
                                </div>
                                <div className="status-grid-container">
                                    <div className="status-grid three-rows">
                                        {historyData.slice(-120).map((item) => (
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
                                        onClick={async (e) => {
                                            if (!confirm('确定要重置验证状态显示吗？（不会删除数据库记录）')) return;
                                            const btn = e.currentTarget;
                                            btn.textContent = '⏳ 重置中...';
                                            btn.disabled = true;
                                            try {
                                                // Set reset point on backend
                                                await fetch(`${API_BASE}/api/verify/history/reset`, { method: 'POST' });
                                                // Re-fetch (will return empty since all records before reset)
                                                const res = await fetch(`${API_BASE}/api/verify/history`);
                                                if (res.ok) {
                                                    const data = await res.json();
                                                    setHistoryData(data.history || []);
                                                    const h = data.history || [];
                                                    setHistoryStats({
                                                        pass: h.filter(r => r.status === 'pass').length,
                                                        failed: h.filter(r => r.status === 'failed').length,
                                                        processing: h.filter(r => r.status === 'processing').length,
                                                        cancel: h.filter(r => r.status === 'cancel').length,
                                                        total: h.length,
                                                    });
                                                }
                                                btn.textContent = '✅ 已重置';
                                            } catch (err) {
                                                btn.textContent = '❌ 错误';
                                                console.error(err);
                                            }
                                            setTimeout(() => { btn.textContent = '🔄 重新计算'; btn.disabled = false; }, 1500);
                                        }}
                                    >
                                        🔄 重新计算
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
                                                        每 {rule.intervalMinutes || Math.round((rule.intervalSeconds || 60) / 60)} 分钟 → {rule.count || 1} 条 · 成功率 {rule.successRate ?? 100}%
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
                                        style={{ width: '80px', textAlign: 'center' }}
                                    />
                                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>分钟 添加</span>
                                    <input
                                        type="number"
                                        min="1"
                                        max="100"
                                        value={newRule.count}
                                        onChange={(e) => setNewRule(prev => ({ ...prev, count: Math.max(1, parseInt(e.target.value) || 1) }))}
                                        className="input"
                                        style={{ width: '80px', textAlign: 'center' }}
                                    />
                                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>条 成功率</span>
                                    <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={newRule.successRate}
                                        onChange={(e) => setNewRule(prev => ({ ...prev, successRate: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) }))}
                                        className="input"
                                        style={{ width: '80px', textAlign: 'center' }}
                                    />
                                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>%  时效</span>
                                    <input
                                        type="number"
                                        min="0"
                                        max="72"
                                        step="1"
                                        value={newRule.durationHours}
                                        onChange={(e) => setNewRule(prev => ({ ...prev, durationHours: Math.max(0, parseFloat(e.target.value) || 0) }))}
                                        className="input"
                                        style={{ width: '80px', textAlign: 'center' }}
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
                    )
                }

                {/* Telegram Bot Tab */}
                {
                    activeTab === 'telegram-bot' && (
                        <TelegramBotTab />
                    )
                }

                {/* Settings Tab */}
                {
                    activeTab === 'settings' && (
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

                            {/* Service Maintenance Toggles */}
                            <div className="settings-section card">
                                <h3>🔧 服务维护开关</h3>
                                <p className="settings-desc">
                                    手动控制各服务的维护状态。开启维护后用户将看到"维护中"提示，无法使用该服务。
                                </p>
                                {[
                                    { key: 'gemini_normal', label: '📦 Gemini 普通验证', desc: '开启后用户无法提交 Gemini 普通验证（1 积分）' },
                                    { key: 'gemini_advanced', label: '⚡ Gemini 高级验证', desc: '开启后用户无法提交 Gemini 高级验证（1.5 积分）' },
                                    { key: 'gpt_plus', label: '🤖 ChatGPT Plus 充值', desc: '开启后用户无法提交 GPT Plus 月度充值（3 积分）' },
                                    { key: 'gpt_team', label: '👥 ChatGPT Team 邀请', desc: '开启后用户无法使用 GPT Team 邀请功能（0.6 积分）' },
                                ].map(s => (
                                    <div key={s.key} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '12px 0', borderBottom: '1px solid var(--border-primary)',
                                    }}>
                                        <div>
                                            <div style={{ fontSize: '13px', fontWeight: 600 }}>{s.label}</div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{s.desc}</div>
                                        </div>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                            <span style={{
                                                fontSize: '11px', fontWeight: 600,
                                                color: serviceMaint[s.key] ? '#dc2626' : '#16a34a',
                                            }}>
                                                {serviceMaint[s.key] ? '维护中' : '正常'}
                                            </span>
                                            <input
                                                type="checkbox"
                                                checked={!!serviceMaint[s.key]}
                                                onChange={async (e) => {
                                                    const val = e.target.checked;
                                                    setServiceMaint(prev => ({ ...prev, [s.key]: val }));
                                                    try {
                                                        const _token = user?.token || localStorage.getItem('verifykey-token');
                                                        await fetch(`${API_BASE}/api/service-status`, {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_token}` },
                                                            body: JSON.stringify({ [s.key]: val }),
                                                        });
                                                    } catch (err) {
                                                        console.warn('Service maint toggle failed:', err);
                                                        setServiceMaint(prev => ({ ...prev, [s.key]: !val }));
                                                    }
                                                }}
                                                style={{ width: '36px', height: '20px', accentColor: '#dc2626' }}
                                            />
                                        </label>
                                    </div>
                                ))}
                            </div>

                            {/* Feature Flags */}
                            <div className="settings-section card">
                                <h3>🔀 功能开关</h3>
                                <p className="settings-desc">控制前台功能模块的显示与隐藏。</p>
                                <div style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '12px 0',
                                }}>
                                    <div>
                                        <div style={{ fontSize: '13px', fontWeight: 600 }}>🛒 订阅工具按钮</div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                            开启后普通档位显示"自行绑卡点击订阅工具"按钮
                                        </div>
                                    </div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                        <span style={{
                                            fontSize: '11px', fontWeight: 600,
                                            color: config?.features?.showSubscriptionTool ? '#16a34a' : '#64748b',
                                        }}>
                                            {config?.features?.showSubscriptionTool ? '显示中' : '已隐藏'}
                                        </span>
                                        <input
                                            type="checkbox"
                                            checked={!!config?.features?.showSubscriptionTool}
                                            onChange={async (e) => {
                                                const val = e.target.checked;
                                                setConfig(prev => ({ ...prev, features: { ...(prev?.features || {}), showSubscriptionTool: val } }));
                                                try {
                                                    await fetch(`${API_BASE}/api/config`, {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ features: { showSubscriptionTool: val } }),
                                                    });
                                                } catch (err) {
                                                    console.warn('Feature flag update failed:', err);
                                                    setConfig(prev => ({ ...prev, features: { ...(prev?.features || {}), showSubscriptionTool: !val } }));
                                                }
                                            }}
                                            style={{ width: '36px', height: '20px', accentColor: '#16a34a' }}
                                        />
                                    </label>
                                </div>
                                <div style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '12px 0',
                                    borderTop: '1px solid var(--border-primary)',
                                }}>
                                    <div>
                                        <div style={{ fontSize: '13px', fontWeight: 600 }}>🤖 ChatGPT 充值入口</div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                            关闭后前台不显示 ChatGPT 充值 tab，同时 Gemini 顶部 tab 也会一起隐藏，仅保留教程折叠栏
                                        </div>
                                    </div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                        <span style={{
                                            fontSize: '11px', fontWeight: 600,
                                            color: config?.features?.showGptRechargeTab !== false ? '#16a34a' : '#64748b',
                                        }}>
                                            {config?.features?.showGptRechargeTab !== false ? '显示中' : '已隐藏'}
                                        </span>
                                        <input
                                            type="checkbox"
                                            checked={config?.features?.showGptRechargeTab !== false}
                                            onChange={async (e) => {
                                                const val = e.target.checked;
                                                setConfig(prev => ({ ...prev, features: { ...(prev?.features || {}), showGptRechargeTab: val } }));
                                                try {
                                                    await fetch(`${API_BASE}/api/config`, {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ features: { showGptRechargeTab: val } }),
                                                    });
                                                } catch (err) {
                                                    console.warn('Feature flag update failed:', err);
                                                    setConfig(prev => ({ ...prev, features: { ...(prev?.features || {}), showGptRechargeTab: !val } }));
                                                }
                                            }}
                                            style={{ width: '36px', height: '20px', accentColor: '#16a34a' }}
                                        />
                                    </label>
                                </div>
                            </div>

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

                            {/* Announcement Banner Card */}
                            <div className="settings-section card" style={{ overflow: 'hidden', padding: 0 }}>
                                {/* Header */}
                                <div style={{
                                    padding: '14px 20px',
                                    background: annEnabled
                                        ? 'linear-gradient(135deg,#eff6ff,#dbeafe)'
                                        : 'linear-gradient(135deg,#f8fafc,#f1f5f9)',
                                    borderBottom: `1px solid ${annEnabled ? '#bfdbfe' : '#e2e8f0'}`,
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    transition: 'all 0.3s ease'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span style={{
                                            width: '10px', height: '10px', borderRadius: '50%',
                                            background: annEnabled ? '#3b82f6' : '#cbd5e1',
                                            boxShadow: annEnabled ? '0 0 8px rgba(59,130,246,0.5)' : 'none',
                                            flexShrink: 0
                                        }} />
                                        <span style={{ fontSize: '14px', fontWeight: 600, color: annEnabled ? '#1d4ed8' : '#64748b' }}>
                                            {annEnabled ? '公告已开启' : '公告未开启'}
                                        </span>
                                    </div>
                                    <div onClick={() => setAnnEnabled(!annEnabled)} style={{
                                        width: '52px', height: '28px', borderRadius: '14px', cursor: 'pointer',
                                        background: annEnabled ? 'linear-gradient(135deg,#3b82f6,#2563eb)' : '#d1d5db',
                                        position: 'relative', transition: 'all 0.3s ease', flexShrink: 0,
                                        boxShadow: annEnabled ? '0 0 12px rgba(59,130,246,0.3)' : 'inset 0 1px 3px rgba(0,0,0,0.1)'
                                    }}>
                                        <div style={{
                                            width: '22px', height: '22px', borderRadius: '50%', background: '#fff',
                                            position: 'absolute', top: '3px',
                                            left: annEnabled ? '27px' : '3px',
                                            transition: 'left 0.25s cubic-bezier(0.4,0,0.2,1)',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.15)'
                                        }} />
                                    </div>
                                </div>

                                {/* Body */}
                                <div style={{ padding: '20px 20px 0' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                                        <span style={{ fontSize: '20px' }}>📢</span>
                                        <h3 style={{ margin: 0, fontSize: '16px' }}>网站公告设置</h3>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                        {/* Type selector */}
                                        <div>
                                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary,#64748b)', marginBottom: '8px' }}>
                                                🎨 公告类型
                                            </label>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                {[
                                                    { value: 'info', label: '📢 通知', color: '#3b82f6', bg: '#eff6ff' },
                                                    { value: 'warning', label: '⚠️ 警告', color: '#d97706', bg: '#fffbeb' },
                                                    { value: 'success', label: '✅ 成功', color: '#16a34a', bg: '#f0fdf4' }
                                                ].map(opt => (
                                                    <button key={opt.value} onClick={() => setAnnType(opt.value)} style={{
                                                        padding: '6px 14px', borderRadius: '8px', border: '1.5px solid',
                                                        borderColor: annType === opt.value ? opt.color : '#e2e8f0',
                                                        background: annType === opt.value ? opt.bg : 'transparent',
                                                        color: annType === opt.value ? opt.color : '#94a3b8',
                                                        fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                                                        transition: 'all 0.15s'
                                                    }}>{opt.label}</button>
                                                ))}
                                            </div>
                                        </div>
                                        {/* Content */}
                                        <div>
                                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary,#64748b)', marginBottom: '6px' }}>
                                                📝 公告内容
                                            </label>
                                            <textarea
                                                className="input textarea"
                                                placeholder="输入向用户显示的公告内容..."
                                                rows={3}
                                                value={annContent}
                                                onChange={(e) => setAnnContent(e.target.value)}
                                                style={{ resize: 'vertical', minHeight: '72px', fontSize: '14px', lineHeight: '1.5', width: '100%', boxSizing: 'border-box' }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Action Bar */}
                                <div style={{
                                    display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px',
                                    padding: '16px 20px', marginTop: '20px',
                                    borderTop: '1px solid var(--border-color,#e2e8f0)',
                                    background: 'var(--bg-secondary,#f8fafc)'
                                }}>
                                    {annSaved && (
                                        <span style={{ color: '#10b981', fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span>✓</span> 已保存
                                        </span>
                                    )}
                                    <button onClick={handleSaveAnnouncement} disabled={annSaving} style={{
                                        padding: '8px 24px', borderRadius: '8px', border: 'none',
                                        cursor: annSaving ? 'not-allowed' : 'pointer',
                                        fontSize: '14px', fontWeight: 600, color: '#fff',
                                        background: 'linear-gradient(135deg,#3b82f6,#2563eb)',
                                        boxShadow: '0 2px 8px rgba(59,130,246,0.3)',
                                        opacity: annSaving ? 0.7 : 1,
                                        display: 'flex', alignItems: 'center', gap: '6px'
                                    }}>
                                        {annSaving ? <><span className="loading-spinner small" /> 保存中...</> : '保存公告'}
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

                            {/* Email SMTP Configuration Card */}
                            <div className="settings-section card" style={{ overflow: 'hidden', padding: 0 }}>
                                <div style={{
                                    padding: '14px 20px',
                                    background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                                    borderBottom: '1px solid #fcd34d',
                                    display: 'flex', alignItems: 'center', gap: '10px'
                                }}>
                                    <span style={{ fontSize: '20px' }}>📧</span>
                                    <h3 style={{ margin: 0, fontSize: '16px', color: '#92400e' }}>邮箱配置</h3>
                                    <span style={{ fontSize: '12px', color: '#b45309', marginLeft: 'auto' }}>用于发送密码重置邮件</span>
                                </div>

                                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    {/* SMTP Host & Port */}
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <div style={{ flex: 2 }}>
                                            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>SMTP 服务器</label>
                                            <input
                                                className="input"
                                                value={emailSettings.smtpHost}
                                                onChange={e => setEmailSettings(p => ({ ...p, smtpHost: e.target.value }))}
                                                placeholder="smtp.qq.com"
                                                style={{ width: '100%', boxSizing: 'border-box' }}
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>端口</label>
                                            <input
                                                className="input"
                                                value={emailSettings.smtpPort}
                                                onChange={e => setEmailSettings(p => ({ ...p, smtpPort: e.target.value }))}
                                                placeholder="465"
                                                style={{ width: '100%', boxSizing: 'border-box' }}
                                            />
                                        </div>
                                    </div>

                                    {/* SMTP User & Password */}
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>用户名 / 邮箱</label>
                                            <input
                                                className="input"
                                                value={emailSettings.smtpUser}
                                                onChange={e => setEmailSettings(p => ({ ...p, smtpUser: e.target.value }))}
                                                placeholder="noreply@example.com"
                                                style={{ width: '100%', boxSizing: 'border-box' }}
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>
                                                密码 / 授权码
                                                {emailSettings.hasStoredPassword && <span style={{ color: '#7c5cfc', marginLeft: '6px', fontSize: '11px' }}>✓ 已保存</span>}
                                            </label>
                                            <input
                                                className="input"
                                                type="password"
                                                value={emailSettings.smtpPassword}
                                                onChange={e => setEmailSettings(p => ({ ...p, smtpPassword: e.target.value }))}
                                                placeholder={emailSettings.hasStoredPassword ? '留空保留原密码' : '输入 SMTP 密码'}
                                                style={{ width: '100%', boxSizing: 'border-box' }}
                                            />
                                        </div>
                                    </div>

                                    {/* Sender Name & SSL */}
                                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>发件人名称</label>
                                            <input
                                                className="input"
                                                value={emailSettings.senderName}
                                                onChange={e => setEmailSettings(p => ({ ...p, senderName: e.target.value }))}
                                                placeholder="OnePASS"
                                                style={{ width: '100%', boxSizing: 'border-box' }}
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>网站地址 (用于重置链接)</label>
                                            <input
                                                className="input"
                                                value={siteUrl}
                                                onChange={e => setSiteUrl(e.target.value)}
                                                placeholder="https://yourdomain.com"
                                                style={{ width: '100%', boxSizing: 'border-box' }}
                                            />
                                        </div>
                                        <label style={{
                                            display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                                            padding: '10px 16px', borderRadius: '8px', background: emailSettings.useSsl ? '#f0ecff' : '#f8fafc',
                                            border: `1px solid ${emailSettings.useSsl ? '#7c5cfc' : '#e2e8f0'}`,
                                            fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap',
                                            transition: 'all 0.2s'
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={emailSettings.useSsl}
                                                onChange={e => setEmailSettings(p => ({ ...p, useSsl: e.target.checked }))}
                                                style={{ accentColor: '#7c5cfc' }}
                                            />
                                            SSL
                                        </label>
                                    </div>

                                    {/* Test Result */}
                                    {emailTestResult && (
                                        <div style={{
                                            padding: '10px 14px', borderRadius: '8px',
                                            background: emailTestResult.success ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.06)',
                                            border: `1px solid ${emailTestResult.success ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.15)'}`,
                                            color: emailTestResult.success ? '#16a34a' : '#dc2626',
                                            fontSize: '13px', fontWeight: 500
                                        }}>
                                            {emailTestResult.success ? '✅' : '❌'} {emailTestResult.message}
                                        </div>
                                    )}
                                </div>

                                <div style={{
                                    display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px',
                                    padding: '16px 20px',
                                    borderTop: '1px solid var(--border-color, #e2e8f0)',
                                    background: 'var(--bg-secondary, #f8fafc)'
                                }}>
                                    {emailSaved && (
                                        <span style={{ color: '#10b981', fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span>✓</span> 已保存
                                        </span>
                                    )}
                                    <button
                                        onClick={handleTestEmail}
                                        disabled={emailTesting || !emailSettings.smtpHost}
                                        style={{
                                            padding: '8px 20px', borderRadius: '8px', border: '1px solid #e2e8f0',
                                            cursor: emailTesting ? 'not-allowed' : 'pointer',
                                            fontSize: '13px', fontWeight: 600, color: '#64748b',
                                            background: '#fff', transition: 'all 0.2s',
                                            opacity: emailTesting ? 0.7 : 1
                                        }}
                                    >
                                        {emailTesting ? '测试中...' : '🔌 测试连接'}
                                    </button>
                                    <button
                                        onClick={handleSaveEmailConfig}
                                        disabled={emailSaving}
                                        style={{
                                            padding: '8px 24px', borderRadius: '8px', border: 'none',
                                            cursor: emailSaving ? 'not-allowed' : 'pointer',
                                            fontSize: '14px', fontWeight: 600, color: '#fff',
                                            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                                            boxShadow: '0 2px 8px rgba(245,158,11,0.3)',
                                            transition: 'all 0.2s', opacity: emailSaving ? 0.7 : 1
                                        }}
                                    >
                                        {emailSaving ? '保存中...' : '保存邮箱配置'}
                                    </button>
                                </div>
                            </div>

                            {/* Alert Notification Card */}
                            <div className="settings-section card" style={{ overflow: 'hidden', padding: 0 }}>
                                <div style={{
                                    padding: '14px 20px',
                                    background: 'linear-gradient(135deg, #fecaca 0%, #fca5a5 100%)',
                                    borderBottom: '1px solid #f87171',
                                    display: 'flex', alignItems: 'center', gap: '10px'
                                }}>
                                    <span style={{ fontSize: '20px' }}>🔔</span>
                                    <h3 style={{ margin: 0, fontSize: '16px', color: '#991b1b' }}>警报通知</h3>
                                    <span style={{ fontSize: '12px', color: '#b91c1c', marginLeft: 'auto' }}>API 异常时自动发送邮件</span>
                                </div>
                                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={alertConfig.enabled}
                                            onChange={e => setAlertConfig(p => ({ ...p, enabled: e.target.checked }))}
                                            style={{ accentColor: '#ef4444', width: 18, height: 18 }} />
                                        <span style={{ fontWeight: 600, color: alertConfig.enabled ? '#16a34a' : '#64748b' }}>
                                            {alertConfig.enabled ? '🟢 已启用警报' : '🔴 未启用警报'}
                                        </span>
                                    </label>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <div style={{ flex: 2 }}>
                                            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>收件邮箱</label>
                                            <input className="input" value={alertConfig.email || ''}
                                                onChange={e => setAlertConfig(p => ({ ...p, email: e.target.value }))}
                                                placeholder="admin@example.com"
                                                style={{ width: '100%', boxSizing: 'border-box' }} />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>冷却时间(分钟)</label>
                                            <input className="input" type="number" value={alertConfig.cooldownMinutes || 60}
                                                onChange={e => setAlertConfig(p => ({ ...p, cooldownMinutes: parseInt(e.target.value) || 60 }))}
                                                style={{ width: '100%', boxSizing: 'border-box' }} />
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                                        监控项目：UPixel 离线/余额不足 · KPixel 离线/余额不足 · VPixel 卡密耗尽 · GPT 通道卡密耗尽<br/>
                                        检查间隔：每 5 分钟 · 同一问题在冷却期内不重复通知
                                    </div>
                                </div>
                                <div style={{
                                    display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px',
                                    padding: '16px 20px', borderTop: '1px solid var(--border-color, #e2e8f0)',
                                    background: 'var(--bg-secondary, #f8fafc)'
                                }}>
                                    <button
                                        onClick={async () => {
                                            setAlertTesting(true);
                                            try {
                                                const _tk = user?.token || localStorage.getItem('verifykey-token');
                                                const res = await fetch(`${API_BASE}/api/alerts/test`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_tk}` } });
                                                const d = await res.json();
                                                alert(res.ok ? `✅ ${d.message}` : `❌ ${d.detail}`);
                                            } catch (e) { alert('发送失败: ' + e.message); }
                                            finally { setAlertTesting(false); }
                                        }}
                                        disabled={alertTesting || !alertConfig.email}
                                        style={{
                                            padding: '8px 20px', borderRadius: '8px', border: '1px solid #e2e8f0',
                                            cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#64748b',
                                            background: '#fff'
                                        }}
                                    >{alertTesting ? '发送中...' : '📨 发送测试'}</button>
                                    <button
                                        onClick={async () => {
                                            setAlertSaving(true);
                                            try {
                                                const _tk = user?.token || localStorage.getItem('verifykey-token');
                                                const res = await fetch(`${API_BASE}/api/alerts/config`, {
                                                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_tk}` },
                                                    body: JSON.stringify(alertConfig),
                                                });
                                                if (res.ok) alert('✅ 警报配置已保存');
                                                else alert('保存失败');
                                            } catch (e) { alert('保存失败: ' + e.message); }
                                            finally { setAlertSaving(false); }
                                        }}
                                        disabled={alertSaving}
                                        style={{
                                            padding: '8px 24px', borderRadius: '8px', border: 'none',
                                            cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: '#fff',
                                            background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                                            boxShadow: '0 2px 8px rgba(239,68,68,0.3)'
                                        }}
                                    >{alertSaving ? '保存中...' : '保存警报配置'}</button>
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
                    )
                }

                {activeTab === 'live-monitor' && (
                    <LiveTaskMonitor />
                )}

                {activeTab === 'pixel-api' && (
                    <PixelApiTab />
                )}

                {/* GPT Recharge Tab */}
                {activeTab === 'gpt-recharge' && (
                    <GptKeysTab config={config} setConfig={setConfig} />
                )}

                {activeTab === 'gpt-team' && (
                    <GptTeamTab />
                )}
            </div >
        </div >
    );
}
