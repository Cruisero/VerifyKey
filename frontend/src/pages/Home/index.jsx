import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/AuthContext';
import logoImg from '../../assets/logo.png';
import './Home.css';

export default function Home() {
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

    // Parse invite code from URL
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get('ref');
        if (ref) {
            setInviteCode(ref);
            setIsLogin(false); // Switch to register tab when coming from invite link
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
                setForgotMsg(data.message || '重置链接已发送到您的邮箱');
            } else {
                setForgotError(data.detail || '发送失败，请稍后重试');
            }
        } catch {
            setForgotError('网络错误，请稍后重试');
        } finally {
            setForgotLoading(false);
        }
    };

    const features = [
        {
            icon: '💎',
            title: '账户积分系统',
            desc: '购买 CDK 卡密兑换积分到账户，积分统一管理，随用随扣'
        },
        {
            icon: '⚡',
            title: 'Google One 验证',
            desc: '批量提交 Google 账号，自动完成学生资格验证，支持普通/Pro 双通道'
        },
        {
            icon: '🤖',
            title: 'GPT 充值',
            desc: '一键为 ChatGPT Plus 账户充值，快速便捷'
        },
        {
            icon: '🎁',
            title: '邀请返利',
            desc: '邀请好友注册，双方都可获得积分奖励'
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
                            <span>领先的验证自动化平台</span>
                        </div>

                        <h1 className="hero-title">
                            <img src={logoImg} alt="OnePASS" className="hero-logo" />
                            <br />
                            批量自动化验证工具
                        </h1>

                        <p className="hero-desc">
                            一站式 Google One 学生验证 & GPT 充值平台。注册账户后使用 CDK 卡密兑换积分，
                            即可批量提交验证或为 ChatGPT 充值，全程自动化处理。
                        </p>

                        <div className="hero-stats">
                            <div className="stat-item">
                                <span className="stat-value">10K+</span>
                                <span className="stat-label">成功验证</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-value">99.9%</span>
                                <span className="stat-label">成功率</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-value">24/7</span>
                                <span className="stat-label">在线服务</span>
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
                                登录
                            </button>
                            <button
                                className={`auth-tab ${!isLogin ? 'active' : ''}`}
                                onClick={() => setIsLogin(false)}
                            >
                                注册
                            </button>
                        </div>

                        <form className="auth-form" onSubmit={handleSubmit}>
                            {!isLogin && (
                                <div className="input-group">
                                    <label className="input-label">用户名</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="输入用户名"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        required={!isLogin}
                                    />
                                </div>
                            )}

                            <div className="input-group">
                                <label className="input-label">邮箱</label>
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
                                <label className="input-label">密码</label>
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
                                    isLogin ? '登录' : '创建账户'
                                )}
                            </button>

                            {isLogin && (
                                <a href="#" className="forgot-password" onClick={(e) => { e.preventDefault(); setShowForgot(true); setForgotMsg(''); setForgotError(''); setForgotEmail(email || ''); }}>忘记密码？</a>
                            )}
                        </form>

                        {/* Forgot Password Modal */}
                        {showForgot && (
                            <div className="forgot-modal-overlay" onClick={() => setShowForgot(false)}>
                                <div className="forgot-modal" onClick={e => e.stopPropagation()}>
                                    <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 700 }}>🔑 重置密码</h3>
                                    <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#64748b' }}>输入您注册时使用的邮箱，我们将发送密码重置链接</p>
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
                                            <button type="button" className="btn" onClick={() => setShowForgot(false)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', padding: '8px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>取消</button>
                                            <button type="submit" className="btn btn-primary" disabled={forgotLoading} style={{ padding: '8px 24px', borderRadius: '8px', fontWeight: 600 }}>{forgotLoading ? '发送中...' : '发送重置链接'}</button>
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
                                <h3>注册 / 登录账户</h3>
                                <p>创建您的 OnePASS 账户，所有积分和记录统一管理</p>
                            </div>
                        </div>
                        <div className="step-item">
                            <div className="step-number">2</div>
                            <div className="step-content">
                                <h3>购买并兑换 CDK</h3>
                                <p>从 haodongxi.shop 购买 CDK 卡密，在平台内兑换积分到账户</p>
                            </div>
                        </div>
                        <div className="step-item">
                            <div className="step-number">3</div>
                            <div className="step-content">
                                <h3>提交验证 / 充值</h3>
                                <p>输入 Google 账号批量验证，或一键 GPT 充值，积分自动扣除</p>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
