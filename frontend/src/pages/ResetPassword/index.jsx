import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import logoImg from '../../assets/logo.png';
import '../Home/Home.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function ResetPassword() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token') || '';
    const navigate = useNavigate();

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (password.length < 6) {
            setError('密码长度不能少于 6 位');
            return;
        }
        if (password !== confirmPassword) {
            setError('两次输入的密码不一致');
            return;
        }

        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setSuccess(true);
            } else {
                setError(data.detail || '重置失败');
            }
        } catch {
            setError('网络错误，请稍后重试');
        } finally {
            setLoading(false);
        }
    };

    if (!token) {
        return (
            <div className="home-page">
                <div className="home-background">
                    <div className="bg-gradient"></div>
                    <div className="bg-pattern"></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
                    <div className="auth-card glass" style={{ maxWidth: '440px', textAlign: 'center' }}>
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>❌</div>
                        <h2 style={{ margin: '0 0 8px', fontSize: '20px' }}>无效的重置链接</h2>
                        <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '20px' }}>
                            请从邮件中重新点击重置链接，或重新申请密码重置
                        </p>
                        <button className="btn btn-primary" onClick={() => navigate('/login')} style={{ padding: '10px 32px', borderRadius: '10px', fontWeight: 600 }}>
                            返回登录
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="home-page">
            <div className="home-background">
                <div className="bg-gradient"></div>
                <div className="bg-pattern"></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
                <div className="auth-card glass" style={{ maxWidth: '440px', width: '100%' }}>
                    <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                        <img src={logoImg} alt="OnePASS" style={{ maxWidth: '180px', marginBottom: '16px' }} />
                        <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>设置新密码</h2>
                        <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: '14px' }}>请输入您的新密码</p>
                    </div>

                    {success ? (
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
                            <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 700, color: '#16a34a' }}>密码重置成功！</h3>
                            <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '20px' }}>您的密码已更新，请使用新密码登录</p>
                            <button className="btn btn-primary btn-lg auth-submit" onClick={() => navigate('/login')}>
                                前往登录
                            </button>
                        </div>
                    ) : (
                        <form className="auth-form" onSubmit={handleSubmit}>
                            <div className="input-group">
                                <label className="input-label">新密码</label>
                                <input
                                    type="password"
                                    className="input"
                                    placeholder="至少 6 位"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    autoFocus
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">确认新密码</label>
                                <input
                                    type="password"
                                    className="input"
                                    placeholder="再次输入新密码"
                                    value={confirmPassword}
                                    onChange={e => setConfirmPassword(e.target.value)}
                                    required
                                />
                            </div>

                            {error && <div className="auth-error">{error}</div>}

                            <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={loading}>
                                {loading ? <span className="loading-spinner"></span> : '重置密码'}
                            </button>

                            <a href="/login" style={{ textAlign: 'center', fontSize: '13px', color: '#64748b', display: 'block' }}>
                                返回登录页面
                            </a>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
