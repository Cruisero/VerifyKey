import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLang } from '../../stores/LanguageContext';
import logoImg from '../../assets/logo.png';
import '../Home/Home.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function ResetPassword() {
    const { t } = useLang();
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
            setError(t('resetPasswordAlertLength'));
            return;
        }
        if (password !== confirmPassword) {
            setError(t('resetPasswordAlertMismatch'));
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
                setError(data.detail || t('resetPasswordFailed'));
            }
        } catch {
            setError(t('networkError'));
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
                        <h2 style={{ margin: '0 0 8px', fontSize: '20px' }}>{t('invalidResetLinkTitle')}</h2>
                        <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '20px' }}>
                            {t('invalidResetLinkDesc')}
                        </p>
                        <button className="btn btn-primary" onClick={() => navigate('/login')} style={{ padding: '10px 32px', borderRadius: '10px', fontWeight: 600 }}>
                            {t('btnGoToLogin')}
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
                        <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>{t('setNewPasswordTitle')}</h2>
                        <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: '14px' }}>{t('setNewPasswordDesc')}</p>
                    </div>

                    {success ? (
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
                            <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 700, color: '#16a34a' }}>{t('resetSuccessTitle')}</h3>
                            <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '20px' }}>{t('resetSuccessDesc')}</p>
                            <button className="btn btn-primary btn-lg auth-submit" onClick={() => navigate('/login')}>
                                {t('goToLoginBtn')}
                            </button>
                        </div>
                    ) : (
                        <form className="auth-form" onSubmit={handleSubmit}>
                            <div className="input-group">
                                <label className="input-label">{t('newPasswordLabel')}</label>
                                <input
                                    type="password"
                                    className="input"
                                    placeholder={t('min6Chars')}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    autoFocus
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">{t('confirmNewPasswordLabel')}</label>
                                <input
                                    type="password"
                                    className="input"
                                    placeholder={t('inputNewPasswordAgain')}
                                    value={confirmPassword}
                                    onChange={e => setConfirmPassword(e.target.value)}
                                    required
                                />
                            </div>

                            {error && <div className="auth-error">{error}</div>}

                            <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={loading}>
                                {loading ? <span className="loading-spinner"></span> : t('resetPasswordBtn')}
                            </button>

                            <a href="/login" style={{ textAlign: 'center', fontSize: '13px', color: '#64748b', display: 'block' }}>
                                {t('backToLoginBtn')}
                            </a>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
