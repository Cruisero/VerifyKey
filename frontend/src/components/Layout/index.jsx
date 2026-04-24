import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '../../stores/ThemeContext';
import { useLang } from '../../stores/LanguageContext';
import { useAuth } from '../../stores/AuthContext';
import logoImg from '../../assets/logo.png';
import logoDarkImg from '../../assets/logo-dark.png';
import './Layout.css';

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3003' : '');

export default function Layout({ children }) {
    const { theme, toggleTheme } = useTheme();
    const { lang, toggleLang, t } = useLang();
    const { user, logout, getToken, refreshUser } = useAuth();
    const navigate = useNavigate();
    const [announcement, setAnnouncement] = useState(null);
    const [annDismissed, setAnnDismissed] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [showCreditsPopover, setShowCreditsPopover] = useState(false);
    const [inviteStats, setInviteStats] = useState(null);
    const [copied, setCopied] = useState(false);
    const [headerCdkCode, setHeaderCdkCode] = useState('');
    const [headerCdkStatus, setHeaderCdkStatus] = useState('');
    const [headerCdkMsg, setHeaderCdkMsg] = useState('');
    const dropdownRef = useRef(null);
    const inviteRef = useRef(null);
    const creditsRef = useRef(null);

    useEffect(() => {
        fetch(`${API_BASE}/api/announcement`)
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data?.enabled && data.content) setAnnouncement(data); })
            .catch(() => {});
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setShowDropdown(false);
            }
            if (inviteRef.current && !inviteRef.current.contains(event.target)) {
                setShowInviteModal(false);
            }
            if (creditsRef.current && !creditsRef.current.contains(event.target)) {
                setShowCreditsPopover(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (showInviteModal && user) {
            const token = getToken();
            if (token) {
                fetch(`${API_BASE}/api/auth/invite-stats`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
                    .then(r => r.json())
                    .then(data => setInviteStats(data))
                    .catch(() => {});
            }
        }
    }, [showInviteModal, user]);

    const handleLogout = () => {
        setShowDropdown(false);
        logout();
        navigate('/');
    };

    const inviteLink = user?.invite_code
        ? `${window.location.origin}/login?ref=${user.invite_code}`
        : '';

    const handleCopyInvite = () => {
        navigator.clipboard.writeText(inviteLink).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleHeaderCdkRedeem = useCallback(async () => {
        const code = headerCdkCode.trim();
        if (!code) return;
        if (!user) {
            setHeaderCdkStatus('error');
            setHeaderCdkMsg('请先登录后再兑换积分');
            return;
        }
        setHeaderCdkStatus('checking');
        setHeaderCdkMsg('');
        try {
            const token = getToken();
            const res = await fetch(`${API_BASE}/api/cdk/redeem`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ code })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setHeaderCdkStatus('success');
                setHeaderCdkMsg(`✅ 兑换成功！+${data.credits_added} 积分`);
                setHeaderCdkCode('');
                refreshUser?.();
                setTimeout(() => { setHeaderCdkStatus(''); setHeaderCdkMsg(''); }, 3000);
            } else {
                setHeaderCdkStatus('error');
                setHeaderCdkMsg(data.detail || data.message || '兑换失败');
            }
        } catch {
            setHeaderCdkStatus('error');
            setHeaderCdkMsg('网络错误，请重试');
        }
    }, [headerCdkCode, user, getToken, refreshUser]);

    return (
        <div className="layout">
            <header className="header glass">
                <div className="header-content">
                    <Link to="/" className="logo">
                        <img src={theme === 'dark' ? logoDarkImg : logoImg} alt="OnePASS" className="logo-img" />
                    </Link>

                    <div className="header-actions">
                        {/* Credits Pill - Always visible */}
                        <div className="credits-container" ref={creditsRef}>
                            <button
                                className="header-credits-pill"
                                onClick={() => setShowCreditsPopover(!showCreditsPopover)}
                            >
                                <span className="credits-pill-icon">💎</span>
                                <span className="credits-pill-amount">
                                    {user ? (typeof user.credits === 'number' ? user.credits.toFixed(1) : user.credits) : '0.0'}
                                </span>
                                <span className="credits-pill-label">积分</span>
                            </button>

                            {showCreditsPopover && (
                                <div className="credits-popover">
                                    <div className="credits-popover-balance">
                                        <span className="credits-popover-balance-icon">💎</span>
                                        <span className="credits-popover-balance-amount">
                                            {user ? (typeof user.credits === 'number' ? user.credits.toFixed(1) : user.credits) : '0.0'}
                                        </span>
                                        <span className="credits-popover-balance-label">积分余额</span>
                                    </div>
                                    <div className="credits-popover-divider"></div>
                                    <div className="credits-popover-section">
                                        <div className="credits-popover-section-title">🎁 兑换积分</div>
                                        <div className="credits-popover-cdk-row">
                                            <input
                                                type="text"
                                                className="credits-popover-cdk-input"
                                                placeholder="VK-XXXX-XXXX-XXXX"
                                                value={headerCdkCode}
                                                onChange={(e) => setHeaderCdkCode(e.target.value.toUpperCase().replace(/O/g, '0').replace(/I/g, '1'))}
                                                onKeyDown={(e) => e.key === 'Enter' && handleHeaderCdkRedeem()}
                                            />
                                            <button
                                                className="credits-popover-cdk-btn"
                                                onClick={handleHeaderCdkRedeem}
                                                disabled={headerCdkStatus === 'checking'}
                                            >
                                                {headerCdkStatus === 'checking' ? '...' : '兑换'}
                                            </button>
                                        </div>
                                        {headerCdkMsg && (
                                            <div className={`credits-popover-cdk-msg ${headerCdkStatus}`}>
                                                {headerCdkMsg}
                                            </div>
                                        )}
                                    </div>
                                    <div className="credits-popover-divider"></div>
                                    <a
                                        href="https://haodongxi.shop"
                                        className="credits-popover-buy-btn"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        🛒 购买积分
                                    </a>
                                </div>
                            )}
                        </div>

                        {/* Invite Button - Always visible */}
                        <div className="invite-container" ref={inviteRef}>
                            <button
                                className="header-invite-btn"
                                onClick={() => setShowInviteModal(!showInviteModal)}
                                title="邀请好友"
                            >
                                <span>🎁</span>
                                <span>邀请</span>
                            </button>

                            {showInviteModal && (
                                <div className="invite-popover">
                                    <div className="invite-popover-title">🎁 邀请好友赚积分</div>
                                    <p className="invite-popover-desc">
                                        好友通过你的链接注册并购买积分后，你获得 <strong>+0.2 积分</strong>
                                    </p>
                                    {user ? (
                                        <>
                                            <div className="invite-link-box">
                                                <input
                                                    type="text"
                                                    value={inviteLink}
                                                    readOnly
                                                    className="invite-link-input"
                                                />
                                                <button
                                                    className="invite-copy-btn"
                                                    onClick={handleCopyInvite}
                                                >
                                                    {copied ? '✓ 已复制' : '复制'}
                                                </button>
                                            </div>
                                            <div className="invite-stats-row">
                                                <div className="invite-stat">
                                                    <span className="invite-stat-val">{inviteStats?.invitedCount ?? 0}</span>
                                                    <span className="invite-stat-label">已邀请</span>
                                                </div>
                                                <div className="invite-stat">
                                                    <span className="invite-stat-val">+{inviteStats?.totalRewards?.toFixed(1) ?? '0.0'}</span>
                                                    <span className="invite-stat-label">获得积分</span>
                                                </div>
                                            </div>
                                            {inviteStats?.details && inviteStats.details.length > 0 && (
                                                <div className="invite-details-section">
                                                    <div className="invite-details-title">最近邀请记录</div>
                                                    <div className="invite-details-list">
                                                        {inviteStats.details.map((d, i) => (
                                                            <div className="invite-detail-item" key={i}>
                                                                <div className="invite-detail-left">
                                                                    <span className="invite-detail-email">{d.email}</span>
                                                                    <span className="invite-detail-time">
                                                                        {d.registeredAt ? new Date(d.registeredAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : ''}
                                                                    </span>
                                                                </div>
                                                                <span className={`invite-detail-badge ${d.rewarded ? 'rewarded' : 'pending'}`}>
                                                                    {d.rewarded ? '✓ 已返利' : '待购买'}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {inviteStats && inviteStats.details && inviteStats.details.length === 0 && (
                                                <div className="invite-empty-hint">还没有邀请记录，分享链接给好友吧 🚀</div>
                                            )}
                                        </>
                                    ) : (
                                        <div className="invite-login-hint">
                                            <Link to="/login" onClick={() => setShowInviteModal(false)}>登录</Link> 后即可获取邀请链接
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <button
                            className="lang-toggle"
                            onClick={toggleLang}
                            title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
                        >
                            {lang === 'zh' ? 'EN' : '中'}
                        </button>
                        <button
                            className="theme-toggle"
                            onClick={toggleTheme}
                            title={theme === 'dark' ? t('switchThemeLight') : t('switchThemeDark')}
                        >
                            {theme === 'dark' ? '☀️' : '🌙'}
                        </button>

                        {user ? (
                            <div className="user-menu-container" ref={dropdownRef}>
                                <button
                                    className="user-trigger"
                                    onClick={() => setShowDropdown(!showDropdown)}
                                >
                                    <span className="user-avatar-small">
                                        {user.username?.charAt(0).toUpperCase()}
                                    </span>
                                </button>

                                {showDropdown && (
                                    <div className="user-dropdown">
                                        <div className="dropdown-header">
                                            <span className="dropdown-name">{user.username}</span>
                                            <span className="dropdown-email">{user.email}</span>
                                        </div>
                                        <div className="dropdown-divider"></div>
                                        {user.role === 'admin' && (
                                            <Link
                                                to="/admin"
                                                className="dropdown-item"
                                                onClick={() => setShowDropdown(false)}
                                            >
                                                <span>⚙️</span>
                                                <span>{t('adminPanel')}</span>
                                            </Link>
                                        )}
                                        <div className="dropdown-divider"></div>
                                        <button
                                            className="dropdown-item logout"
                                            onClick={handleLogout}
                                        >
                                            <span>🚪</span>
                                            <span>{t('logout')}</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <Link to="/login" className="header-login-btn">
                                <span>👤</span>
                                <span>登录</span>
                            </Link>
                        )}
                    </div>
                </div>
            </header>

            {announcement && !annDismissed && (
                <div style={{
                    background: announcement.type === 'warning' ? 'linear-gradient(90deg,#fffbeb,#fef9c3)' :
                                announcement.type === 'success' ? 'linear-gradient(90deg,#f0fdf4,#dcfce7)' :
                                'linear-gradient(90deg,#eff6ff,#dbeafe)',
                    borderBottom: `1px solid ${announcement.type === 'warning' ? '#fde68a' : announcement.type === 'success' ? '#bbf7d0' : '#bfdbfe'}`,
                    padding: '8px 20px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                    fontSize: '13px', color: '#1e293b', position: 'relative'
                }}>
                    <span>{announcement.type === 'warning' ? '⚠️' : announcement.type === 'success' ? '✅' : '📢'}</span>
                    <span>{announcement.content}</span>
                    <button onClick={() => setAnnDismissed(true)} style={{
                        position: 'absolute', right: '14px', background: 'none', border: 'none',
                        cursor: 'pointer', fontSize: '15px', color: '#94a3b8', lineHeight: 1, padding: '2px 4px'
                    }}>✕</button>
                </div>
            )}
            <main className="main-content">
                {children}
            </main>

            <footer className="footer">
                <div className="footer-content">
                    <p>{t('footerRights')}</p>
                    <div className="footer-links">
                        <Link to="/api-docs">API 文档</Link>
                        <a href="#">{t('terms')}</a>
                        <a href="#">{t('privacy')}</a>
                        <a href="#">{t('contact')}</a>
                    </div>
                </div>
            </footer>
        </div>
    );
}
