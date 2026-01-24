import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/AuthContext';
import './Admin.css';

export default function Admin() {
    const { user, loading } = useAuth();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('overview');
    const [apiKey, setApiKey] = useState('');
    const [showSaveNotice, setShowSaveNotice] = useState(false);

    useEffect(() => {
        // 等待加载完成后再检查用户状态
        if (!loading && !user) {
            navigate('/');
        }
    }, [user, loading, navigate]);

    useEffect(() => {
        const savedKey = localStorage.getItem('verifykey-admin-api-key');
        if (savedKey) setApiKey(savedKey);
    }, []);

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
        { id: 'overview', label: '概览', icon: '📊' },
        { id: 'users', label: '用户管理', icon: '👥' },
        { id: 'settings', label: '系统设置', icon: '⚙️' },
    ];

    const handleSaveApiKey = () => {
        localStorage.setItem('verifykey-admin-api-key', apiKey);
        setShowSaveNotice(true);
        setTimeout(() => setShowSaveNotice(false), 2000);
    };

    // 加载中或未登录时不渲染
    if (loading || !user) return null;

    return (
        <div className="admin-page">
            <div className="container">
                {/* Header */}
                <div className="admin-header">
                    <h1 className="page-title">⚙️ 管理后台</h1>
                    <p className="page-desc">管理用户、配置系统和查看统计数据</p>
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
                                <div className="stat-icon">👥</div>
                                <div className="stat-info">
                                    <span className="stat-value">{stats.totalUsers}</span>
                                    <span className="stat-label">总用户数</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">✅</div>
                                <div className="stat-info">
                                    <span className="stat-value">{stats.activeUsers}</span>
                                    <span className="stat-label">活跃用户</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">⚡</div>
                                <div className="stat-info">
                                    <span className="stat-value">{stats.totalVerifications.toLocaleString()}</span>
                                    <span className="stat-label">总验证次数</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">📈</div>
                                <div className="stat-info">
                                    <span className="stat-value">{stats.successRate}%</span>
                                    <span className="stat-label">成功率</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">💰</div>
                                <div className="stat-info">
                                    <span className="stat-value">¥{stats.revenue.toLocaleString()}</span>
                                    <span className="stat-label">总收入</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">📋</div>
                                <div className="stat-info">
                                    <span className="stat-value">{stats.pendingWithdrawals}</span>
                                    <span className="stat-label">待处理提现</span>
                                </div>
                            </div>
                        </div>
                    </div>
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

                {/* Settings Tab */}
                {activeTab === 'settings' && (
                    <div className="tab-content">
                        <div className="settings-section card">
                            <h3>🔑 API 配置</h3>
                            <p className="settings-desc">
                                配置 batch.1key.me 的 API Key 以启用验证服务代理功能。
                            </p>
                            <div className="settings-form">
                                <div className="input-group">
                                    <label className="input-label">batch.1key.me API Key</label>
                                    <input
                                        type="password"
                                        className="input"
                                        placeholder="sk-xxxxxxxxxxxxxxxxxxxxxx"
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                    />
                                </div>
                                <button className="btn btn-primary" onClick={handleSaveApiKey}>
                                    保存配置
                                </button>
                                {showSaveNotice && (
                                    <span className="save-notice">✓ 已保存</span>
                                )}
                            </div>
                        </div>

                        <div className="settings-section card">
                            <h3>💰 定价设置</h3>
                            <p className="settings-desc">
                                设置每次验证消耗的积分数量。
                            </p>
                            <div className="settings-form">
                                <div className="input-group">
                                    <label className="input-label">每次验证消耗积分</label>
                                    <input
                                        type="number"
                                        className="input"
                                        defaultValue={1}
                                        min={1}
                                    />
                                </div>
                                <button className="btn btn-primary">保存</button>
                            </div>
                        </div>

                        <div className="settings-section card">
                            <h3>📢 公告设置</h3>
                            <p className="settings-desc">
                                设置在验证工具页面显示的公告内容。
                            </p>
                            <div className="settings-form">
                                <div className="input-group">
                                    <label className="input-label">公告内容</label>
                                    <textarea
                                        className="input textarea"
                                        placeholder="输入公告内容..."
                                        rows={3}
                                    />
                                </div>
                                <button className="btn btn-primary">保存</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
