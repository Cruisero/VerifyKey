import { useState } from 'react';
import { useAuth } from '../../stores/AuthContext';
import './Home.css';

export default function Home() {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [username, setUsername] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const { login, register } = useAuth();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (isLogin) {
                await login(email, password);
            } else {
                await register(email, password, username);
            }
            // 登录/注册成功后，AuthContext 会更新 user 状态
            // HomePage 组件会自动检测到状态变化并切换显示 Verify 页面
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const features = [
        {
            icon: '⚡',
            title: '高速验证',
            desc: '批量自动化验证，快速完成 Google Student 等学生资格认证'
        },
        {
            icon: '🔒',
            title: '安全可靠',
            desc: '采用先进加密技术，保护您的数据安全'
        },
        {
            icon: '💰',
            title: '灵活计费',
            desc: '按次计费，用多少付多少，无需订阅'
        },
        {
            icon: '📊',
            title: '实时追踪',
            desc: '查看验证状态和历史记录，一目了然'
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
                            <img src="/src/assets/logo.png" alt="VerifyKey" className="hero-logo" />
                            <br />
                            批量自动化验证工具
                        </h1>

                        <p className="hero-desc">
                            为您提供高效、安全的学生资格验证服务。支持 Google Student、Gemini Advanced 等多种验证场景，
                            一键完成批量验证，节省您的宝贵时间。
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
                                <a href="#" className="forgot-password">忘记密码？</a>
                            )}
                        </form>

                        <div className="auth-divider">
                            <span>或使用以下方式</span>
                        </div>

                        <div className="social-login">
                            <button className="social-btn">
                                <span>🌐</span>
                                Google
                            </button>
                            <button className="social-btn">
                                <span>📧</span>
                                GitHub
                            </button>
                        </div>
                    </div>
                </section>

                {/* Features Section */}
                <section className="features-section">
                    <h2 className="section-title">为什么选择 VerifyKey？</h2>
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
                    <h2 className="section-title">使用流程</h2>
                    <div className="steps-list">
                        <div className="step-item">
                            <div className="step-number">1</div>
                            <div className="step-content">
                                <h3>获取验证链接</h3>
                                <p>在 one.google.com/ai-student 等页面获取验证链接</p>
                            </div>
                        </div>
                        <div className="step-item">
                            <div className="step-number">2</div>
                            <div className="step-content">
                                <h3>提交验证请求</h3>
                                <p>将链接粘贴到验证工具中，点击开始验证</p>
                            </div>
                        </div>
                        <div className="step-item">
                            <div className="step-number">3</div>
                            <div className="step-content">
                                <h3>等待验证完成</h3>
                                <p>系统自动处理，几秒钟内完成验证</p>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
