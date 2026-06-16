import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/AuthContext';
import { useLang } from '../../stores/LanguageContext';
import logoImg from '../../assets/logo.png';
import './Home.css';

export default function Home() {
    const { lang, t } = useLang();
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [username, setUsername] = useState('');
    const [inviteCode, setInviteCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Forgot password state
    const [showForgot, setShowForgot] = useState(false);
    const [forgotEmail, setForgotEmail] = useState('');
    const [forgotLoading, setForgotLoading] = useState(false);
    const [forgotMsg, setForgotMsg] = useState('');
    const [forgotError, setForgotError] = useState('');

    const { login, register } = useAuth();
    const navigate = useNavigate();

    // Parse invite code from URL or session storage
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get('ref') || sessionStorage.getItem('invite_ref');
        if (ref) {
            setInviteCode(ref);
            setIsLogin(false); // Switch to register tab when coming from invite link
            sessionStorage.removeItem('invite_ref'); // Clean up after use
        }
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (isLogin) {
                await login(email, password);
            } else {
                await register(email, password, username, inviteCode || undefined);
            }
            // 登录/注册成功后跳转到首页
            navigate('/');
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const API_BASE = import.meta.env.VITE_API_URL || '';

    const handleForgotPassword = async (e) => {
        e.preventDefault();
        if (!forgotEmail.trim()) return;
        setForgotLoading(true);
        setForgotMsg('');
        setForgotError('');
        try {
            const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: forgotEmail.trim() })
            });
            const data = await res.json();
            if (res.ok) {
                setForgotMsg(data.message || t('forgotLinkSent'));
            } else {
                setForgotError(data.detail || t('forgotLinkFailed'));
            }
        } catch {
            setForgotError(t('networkError'));
        } finally {
            setForgotLoading(false);
        }
    };

    const features = [
        {
            icon: '💎',
            title: t('featureCreditsTitle'),
            desc: t('featureCreditsDesc')
        },
        {
            icon: '⚡',
            title: t('geminiServiceTitle'),
            desc: t('featureVerifyDesc')
        },
        {
            icon: '🤖',
            title: t('gptRecharge'),
            desc: t('featureGptDesc')
        },
        {
            icon: '🎁',
            title: t('featureInviteTitle'),
            desc: t('featureInviteDesc')
        }
    ];

    return (
        <div className="home-page">
            <div className="home-background">
                <div className="bg-gradient"></div>
                <div className="bg-pattern"></div>
            </div>

            <div className="home-container">
                {/* Hero Section */}
                <section className="hero-section">
                    <div className="hero-content">
                        <div className="hero-badge">
                            <span>🚀</span>
                            <span>{t('heroBadgeText')}</span>
                        </div>

                        <h1 className="hero-title">
                            <img src={logoImg} alt="OnePASS" className="hero-logo" />
                            <br />
                            {t('heroTitleText')}
                        </h1>

                        <p className="hero-desc">
                            {t('heroDescText')}
                        </p>

                        <div className="hero-stats">
                            <div className="stat-item">
                                <span className="stat-value">10K+</span>
                                <span className="stat-label">{t('statVerified')}</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-value">99.9%</span>
                                <span className="stat-label">{t('statRate')}</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-value">24/7</span>
                                <span className="stat-label">{t('statServices')}</span>
                            </div>
                        </div>
                    </div>

                    {/* Auth Card */}
                    <div className="auth-card glass">
                        <div className="auth-tabs">
                            <button
                                className={`auth-tab ${isLogin ? 'active' : ''}`}
                                onClick={() => setIsLogin(true)}
                            >
                                {t('loginTab')}
                            </button>
                            <button
                                className={`auth-tab ${!isLogin ? 'active' : ''}`}
                                onClick={() => setIsLogin(false)}
                            >
                                {t('registerTab')}
                            </button>
                        </div>

                        <form className="auth-form" onSubmit={handleSubmit}>
                            {!isLogin && (
                                <div className="input-group">
                                    <label className="input-label">{t('usernameLabel')}</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder={t('usernamePlaceholder')}
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        required={!isLogin}
                                    />
                                </div>
                            )}

                            <div className="input-group">
                                <label className="input-label">{t('emailLabel')}</label>
                                <input
                                    type="email"
                                    className="input"
                                    placeholder="your@email.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="input-group">
                                <label className="input-label">{t('passwordLabel')}</label>
                                <input
                                    type="password"
                                    className="input"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                />
                            </div>

                            {error && <div className="auth-error">{error}</div>}

                            <button
                                type="submit"
                                className="btn btn-primary btn-lg auth-submit"
                                disabled={loading}
                            >
                                {loading ? (
                                    <span className="loading-spinner"></span>
                                ) : (
                                    isLogin ? t('loginTab') : t('btnRegister')
                                )}
                            </button>

                            {isLogin && (
                                <a href="#" className="forgot-password" onClick={(e) => { e.preventDefault(); setShowForgot(true); setForgotMsg(''); setForgotError(''); setForgotEmail(email || ''); }}>{t('forgotPasswordBtn')}</a>
                            )}
                        </form>

                        {/* Forgot Password Modal */}
                        {showForgot && (
                            <div className="forgot-modal-overlay" onClick={() => setShowForgot(false)}>
                                <div className="forgot-modal" onClick={e => e.stopPropagation()}>
                                    <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 700 }}>{t('resetPasswordTitle')}</h3>
                                    <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#64748b' }}>{t('resetPasswordDesc')}</p>
                                    <form onSubmit={handleForgotPassword}>
                                        <input
                                            className="input"
                                            type="email"
                                            placeholder="your@email.com"
                                            value={forgotEmail}
                                            onChange={e => setForgotEmail(e.target.value)}
                                            required
                                            autoFocus
                                            style={{ width: '100%', boxSizing: 'border-box', marginBottom: '12px' }}
                                        />
                                        {forgotMsg && <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(34,197,94,0.08)', color: '#16a34a', fontSize: '13px', fontWeight: 500, marginBottom: '12px' }}>✅ {forgotMsg}</div>}
                                        {forgotError && <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.06)', color: '#ef4444', fontSize: '13px', fontWeight: 500, marginBottom: '12px' }}>❌ {forgotError}</div>}
                                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                            <button type="button" className="btn" onClick={() => setShowForgot(false)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', padding: '8px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>{t('cancelBtn')}</button>
                                            <button type="submit" className="btn btn-primary" disabled={forgotLoading} style={{ padding: '8px 24px', borderRadius: '8px', fontWeight: 600 }}>{forgotLoading ? t('sendingBtn') : t('sendResetLinkBtn')}</button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        )}

                    </div>
                </section>

                {/* Features Section */}
                <section className="features-section">

                    <div className="features-grid">
                        {features.map((feature, index) => (
                            <div key={index} className="feature-card card animate-slide-up" style={{ animationDelay: `${index * 0.1}s` }}>
                                <div className="feature-icon">{feature.icon}</div>
                                <h3 className="feature-title">{feature.title}</h3>
                                <p className="feature-desc">{feature.desc}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* How it Works */}
                <section className="steps-section">

                    <div className="steps-list">
                        <div className="step-item">
                            <div className="step-number">1</div>
                            <div className="step-content">
                                <h3>{t('stepRegisterTitle')}</h3>
                                <p>{t('stepRegisterDesc')}</p>
                            </div>
                        </div>
                        <div className="step-item">
                            <div className="step-number">2</div>
                            <div className="step-content">
                                <h3>{t('stepRedeemTitle')}</h3>
                                <p>{lang === 'zh' ? '从 haodongxi.shop 购买 CDK 卡密，在平台内兑换积分到账户' : 'Purchase CDK keys from haodongxi.shop and redeem them to your account'}</p>
                            </div>
                        </div>
                        <div className="step-item">
                            <div className="step-number">3</div>
                            <div className="step-content">
                                <h3>{t('stepSubmitTitle')}</h3>
                                <p>{lang === 'zh' ? '输入 Google 账号批量验证，或一键 GPT 充值，积分自动扣除' : 'Submit Google accounts for batch verification, or recharge GPT with one click. Credits are deducted automatically.'}</p>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
