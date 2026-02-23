import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '../../stores/ThemeContext';
import { useLang } from '../../stores/LanguageContext';
import { useAuth } from '../../stores/AuthContext';
import logoImg from '../../assets/logo.png';
import logoDarkImg from '../../assets/logo-dark.png';
import './Layout.css';

export default function Layout({ children }) {
    const { theme, toggleTheme } = useTheme();
    const { lang, toggleLang, t } = useLang();
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef(null);

    // 点击外部关闭下拉菜单
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleLogout = () => {
        setShowDropdown(false);
        logout();
        navigate('/');
    };

    return (
        <div className="layout">
            <header className="header glass">
                <div className="header-content">
                    <Link to="/" className="logo">
                        <img src={theme === 'dark' ? logoDarkImg : logoImg} alt="OnePASS" className="logo-img" />
                    </Link>

                    <div className="header-actions">
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
                                    <span className="user-name">{user.username}</span>
                                    <span className="dropdown-arrow">{showDropdown ? '▲' : '▼'}</span>
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
                        ) : null}
                    </div>
                </div>
            </header>

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
