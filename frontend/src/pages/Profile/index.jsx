import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/AuthContext';
import './Profile.css';

export default function Profile() {
    const { user, loading, logout, updateCredits } = useAuth();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('info');
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });

    useEffect(() => {
        if (!loading && !user) {
            navigate('/');
        }
    }, [user, loading, navigate]);

    // 模拟使用历史
    const usageHistory = [
        { id: 1, date: '2026-01-24', action: '验证成功', quota: -1, balance: 99 },
        { id: 2, date: '2026-01-23', action: '充值', quota: 100, balance: 100 },
        { id: 3, date: '2026-01-22', action: '验证成功', quota: -1, balance: 0 },
        { id: 4, date: '2026-01-22', action: '验证失败', quota: 0, balance: 1 },
        { id: 5, date: '2026-01-21', action: '注册赠送', quota: 1, balance: 1 },
    ];

    // 模拟验证记录
    const verificationRecords = [
        { id: 1, verificationId: '6931007a35dfed...', status: 'success', time: '2026-01-24 14:30:25' },
        { id: 2, verificationId: '6930abc123def...', status: 'success', time: '2026-01-24 14:28:10' },
        { id: 3, verificationId: '6930xyz789ghi...', status: 'failed', time: '2026-01-23 10:15:33' },
        { id: 4, verificationId: '6929mno456pqr...', status: 'success', time: '2026-01-22 16:45:00' },
    ];

    const stats = {
        totalVerifications: 128,
        successCount: 120,
        failCount: 8,
        successRate: 93.75
    };

    const tabs = [
        { id: 'info', label: '个人信息', icon: '👤' },
        { id: 'quota', label: '配额记录', icon: '🎫' },
        { id: 'records', label: '验证记录', icon: '📊' },
        { id: 'security', label: '安全设置', icon: '🔐' },
    ];

    const handleChangePassword = () => {
        if (passwords.new !== passwords.confirm) {
            alert('两次输入的密码不一致');
            return;
        }
        if (passwords.new.length < 6) {
            alert('密码长度至少6位');
            return;
        }
        // 模拟修改密码
        alert('密码修改成功');
        setShowPasswordModal(false);
        setPasswords({ current: '', new: '', confirm: '' });
    };

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    if (loading || !user) return null;

    return (
        <div className="profile-page">
            <div className="container">
                {/* Header */}
                <div className="profile-header">
                    <div className="user-avatar">
                        <span className="avatar-text">{user.username?.charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="user-details">
                        <h1 className="user-name">{user.username}</h1>
                        <p className="user-email">{user.email}</p>
                        <span className="user-role">{user.role === 'admin' ? '👑 管理员' : '👤 普通用户'}</span>
                    </div>
                    <div className="header-stats">
                        <div className="stat-item">
                            <span className="stat-value">{user.credits}</span>
                            <span className="stat-label">配额余额</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-value">{stats.totalVerifications}</span>
                            <span className="stat-label">总验证次数</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-value">{stats.successRate}%</span>
                            <span className="stat-label">成功率</span>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="profile-tabs">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            className={`profile-tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            <span className="tab-icon">{tab.icon}</span>
                            <span className="tab-label">{tab.label}</span>
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <div className="tab-content">
                    {/* 个人信息 */}
                    {activeTab === 'info' && (
                        <div className="info-section card">
                            <h3>👤 基本信息</h3>
                            <div className="info-grid">
                                <div className="info-item">
                                    <label>用户名</label>
                                    <span>{user.username}</span>
                                </div>
                                <div className="info-item">
                                    <label>邮箱</label>
                                    <span>{user.email}</span>
                                </div>
                                <div className="info-item">
                                    <label>用户角色</label>
                                    <span>{user.role === 'admin' ? '管理员' : '普通用户'}</span>
                                </div>
                                <div className="info-item">
                                    <label>注册时间</label>
                                    <span>{user.createdAt?.split('T')[0] || '2026-01-20'}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 配额记录 */}
                    {activeTab === 'quota' && (
                        <div className="quota-section card">
                            <div className="section-header">
                                <h3>🎫 配额使用记录</h3>
                                <span className="current-quota">当前余额: <strong>{user.credits} 次</strong></span>
                            </div>
                            <div className="history-table">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>日期</th>
                                            <th>操作</th>
                                            <th>变动</th>
                                            <th>余额</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {usageHistory.map(item => (
                                            <tr key={item.id}>
                                                <td>{item.date}</td>
                                                <td>{item.action}</td>
                                                <td className={item.quota > 0 ? 'positive' : item.quota < 0 ? 'negative' : ''}>
                                                    {item.quota > 0 ? `+${item.quota}` : item.quota}
                                                </td>
                                                <td>{item.balance} 次</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* 验证记录 */}
                    {activeTab === 'records' && (
                        <div className="records-section card">
                            <div className="section-header">
                                <h3>📊 验证记录</h3>
                                <div className="stats-summary">
                                    <span className="stat success">✓ {stats.successCount} 成功</span>
                                    <span className="stat fail">✕ {stats.failCount} 失败</span>
                                </div>
                            </div>
                            <div className="records-table">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>验证ID</th>
                                            <th>状态</th>
                                            <th>时间</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {verificationRecords.map(record => (
                                            <tr key={record.id}>
                                                <td className="mono">{record.verificationId}</td>
                                                <td>
                                                    <span className={`status-badge ${record.status}`}>
                                                        {record.status === 'success' ? '✓ 成功' : '✕ 失败'}
                                                    </span>
                                                </td>
                                                <td>{record.time}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* 安全设置 */}
                    {activeTab === 'security' && (
                        <div className="security-section card">
                            <h3>🔐 安全设置</h3>
                            <div className="security-items">
                                <div className="security-item">
                                    <div className="security-info">
                                        <span className="security-title">修改密码</span>
                                        <span className="security-desc">定期更换密码可以提高账号安全性</span>
                                    </div>
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => setShowPasswordModal(true)}
                                    >
                                        修改
                                    </button>
                                </div>
                                <div className="security-item">
                                    <div className="security-info">
                                        <span className="security-title">退出登录</span>
                                        <span className="security-desc">退出当前账号</span>
                                    </div>
                                    <button
                                        className="btn btn-outline"
                                        onClick={handleLogout}
                                    >
                                        退出
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Password Modal */}
            {showPasswordModal && (
                <div className="modal-overlay" onClick={() => setShowPasswordModal(false)}>
                    <div className="modal card" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>🔐 修改密码</h2>
                            <button className="modal-close" onClick={() => setShowPasswordModal(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="input-group">
                                <label>当前密码</label>
                                <input
                                    type="password"
                                    className="input"
                                    value={passwords.current}
                                    onChange={e => setPasswords({ ...passwords, current: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label>新密码</label>
                                <input
                                    type="password"
                                    className="input"
                                    value={passwords.new}
                                    onChange={e => setPasswords({ ...passwords, new: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label>确认新密码</label>
                                <input
                                    type="password"
                                    className="input"
                                    value={passwords.confirm}
                                    onChange={e => setPasswords({ ...passwords, confirm: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowPasswordModal(false)}>取消</button>
                            <button className="btn btn-primary" onClick={handleChangePassword}>确认修改</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
