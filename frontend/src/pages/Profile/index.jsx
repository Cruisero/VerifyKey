import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/AuthContext';
import { useLang } from '../../stores/LanguageContext';
import './Profile.css';

export default function Profile() {
    const { lang, t } = useLang();
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
        { id: 'info', label: t('tabPersonalInfo'), icon: '👤' },
        { id: 'quota', label: t('tabQuotaHistory'), icon: '🎫' },
        { id: 'records', label: t('tabVerifyRecords'), icon: '📊' },
        { id: 'security', label: t('tabSecuritySettings'), icon: '🔐' },
    ];

    const handleChangePassword = () => {
        if (passwords.new !== passwords.confirm) {
            alert(t('alertPasswordsMismatch'));
            return;
        }
        if (passwords.new.length < 6) {
            alert(t('alertPasswordLength'));
            return;
        }
        // 模拟修改密码
        alert(t('alertPasswordSuccess'));
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
                        <span className="user-role">{user.role === 'admin' ? t('roleAdmin') : t('roleUser')}</span>
                    </div>
                    <div className="header-stats">
                        <div className="stat-item">
                            <span className="stat-value">{user.credits}</span>
                            <span className="stat-label">{t('quotaBalance')}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-value">{stats.totalVerifications}</span>
                            <span className="stat-label">{t('totalVerificationsLabel')}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-value">{stats.successRate}%</span>
                            <span className="stat-label">{t('statRate')}</span>
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
                            <h3>{t('basicInfoTitle')}</h3>
                            <div className="info-grid">
                                <div className="info-item">
                                    <label>{t('usernameLabel')}</label>
                                    <span>{user.username}</span>
                                </div>
                                <div className="info-item">
                                    <label>{t('emailLabel')}</label>
                                    <span>{user.email}</span>
                                </div>
                                <div className="info-item">
                                    <label>{lang === 'zh' ? '用户角色' : 'Role'}</label>
                                    <span>{user.role === 'admin' ? t('roleAdminLabel') : t('roleUserLabel')}</span>
                                </div>
                                <div className="info-item">
                                    <label>{t('regTime')}</label>
                                    <span>{user.createdAt?.split('T')[0] || '2026-01-20'}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 配额记录 */}
                    {activeTab === 'quota' && (
                        <div className="quota-section card">
                            <div className="section-header">
                                <h3>{t('quotaUsageHistoryTitle')}</h3>
                                <span className="current-quota" dangerouslySetInnerHTML={{ __html: t('currentBalanceUnit').replace('{credits}', user.credits) }} />
                            </div>
                            <div className="history-table">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>{t('thDate')}</th>
                                            <th>{t('thAction')}</th>
                                            <th>{t('thChange')}</th>
                                            <th>{t('thBalance')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {usageHistory.map(item => (
                                            <tr key={item.id}>
                                                <td>{item.date}</td>
                                                <td>{item.action === '验证成功' ? t('verifySuccess') : item.action === '验证失败' ? t('verifyFailed') : item.action === '充值' ? t('rechargeAction') : item.action === '注册赠送' ? t('regGift') : item.action}</td>
                                                <td className={item.quota > 0 ? 'positive' : item.quota < 0 ? 'negative' : ''}>
                                                    {item.quota > 0 ? `+${item.quota}` : item.quota}
                                                </td>
                                                <td>{item.balance} {t('timesUnit')}</td>
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
                                <h3>📊 {t('tabVerifyRecords')}</h3>
                                <div className="stats-summary">
                                    <span className="stat success">✓ {stats.successCount} {t('verifySuccess')}</span>
                                    <span className="stat fail">✕ {stats.failCount} {t('verifyFailed')}</span>
                                </div>
                            </div>
                            <div className="records-table">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>{t('thVerifyId')}</th>
                                            <th>{t('thStatus')}</th>
                                            <th>{t('thTime')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {verificationRecords.map(record => (
                                            <tr key={record.id}>
                                                <td className="mono">{record.verificationId}</td>
                                                <td>
                                                    <span className={`status-badge ${record.status}`}>
                                                        {record.status === 'success' ? `✓ ${t('verifySuccess')}` : `✕ ${t('verifyFailed')}`}
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
                            <h3>{t('tabSecuritySettings')}</h3>
                            <div className="security-items">
                                <div className="security-item">
                                    <div className="security-info">
                                        <span className="security-title">{lang === 'zh' ? '修改密码' : 'Change Password'}</span>
                                        <span className="security-desc">{lang === 'zh' ? '定期更换密码可以提高账号安全性' : 'Change password regularly to improve security'}</span>
                                    </div>
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => setShowPasswordModal(true)}
                                    >
                                        {t('editBtn')}
                                    </button>
                                </div>
                                <div className="security-item">
                                    <div className="security-info">
                                        <span className="security-title">{lang === 'zh' ? '退出登录' : 'Log Out'}</span>
                                        <span className="security-desc">{lang === 'zh' ? '退出当前账号' : 'Log out of current account'}</span>
                                    </div>
                                    <button
                                        className="btn btn-outline"
                                        onClick={handleLogout}
                                    >
                                        {t('exitBtn')}
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
                            <h2>{t('changePasswordTitle')}</h2>
                            <button className="modal-close" onClick={() => setShowPasswordModal(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="input-group">
                                <label>{t('labelCurrentPassword')}</label>
                                <input
                                    type="password"
                                    className="input"
                                    value={passwords.current}
                                    onChange={e => setPasswords({ ...passwords, current: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label>{t('labelNewPassword')}</label>
                                <input
                                    type="password"
                                    className="input"
                                    value={passwords.new}
                                    onChange={e => setPasswords({ ...passwords, new: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label>{t('labelConfirmNewPassword')}</label>
                                <input
                                    type="password"
                                    className="input"
                                    value={passwords.confirm}
                                    onChange={e => setPasswords({ ...passwords, confirm: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowPasswordModal(false)}>{t('cancelBtn')}</button>
                            <button className="btn btn-primary" onClick={handleChangePassword}>{t('confirmChangeBtn')}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
