import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '../../stores/ThemeContext';
import { useAuth } from '../../stores/AuthContext';
import './Layout.css';

export default function Layout({ children }) {
    const { theme, toggleTheme } = useTheme();
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
                        <img src="/src/assets/logo.png" alt="OnePASS" className="logo-img" />
                    </Link>

                    <div className="header-actions">
                        <button
                            className="theme-toggle"
                            onClick={toggleTheme}
                            title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
                        >
                            {theme === 'dark' ? '☀️' : '🌙'}
                        </button>

                        {user ? (
                            <div className="user-menu-container" ref={dropdownRef}>
                                <div className="credits-display">
                                    <span className="credits-icon">🎫</span>
                                    <span className="credits-amount">{user.credits} 次</span>
                                </div>
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
                                        <Link
                                            to="/profile"
                                            className="dropdown-item"
                                            onClick={() => setShowDropdown(false)}
                                        >
                                            <span>👤</span>
                                            <span>个人中心</span>
                                        </Link>
                                        <Link
                                            to="/recharge"
                                            className="dropdown-item"
                                            onClick={() => setShowDropdown(false)}
                                        >
                                            <span>💰</span>
                                            <span>充值配额</span>
                                        </Link>
                                        {user.role === 'admin' && (
                                            <Link
                                                to="/admin"
                                                className="dropdown-item"
                                                onClick={() => setShowDropdown(false)}
                                            >
                                                <span>⚙️</span>
                                                <span>管理后台</span>
                                            </Link>
                                        )}
                                        <div className="dropdown-divider"></div>
                                        <button
                                            className="dropdown-item logout"
                                            onClick={handleLogout}
                                        >
                                            <span>🚪</span>
                                            <span>退出登录</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <Link to="/" className="btn btn-primary btn-sm">
                                登录
                            </Link>
                        )}
                    </div>
                </div>
            </header>

            <main className="main-content">
                {children}
            </main>

            <footer className="footer">
                <div className="footer-content">
                    <p>© 2026 VerifyKey. All rights reserved.</p>
                    <div className="footer-links">
                        <a href="#">使用条款</a>
                        <a href="#">隐私政策</a>
                        <a href="#">联系我们</a>
                    </div>
                </div>
            </footer>
        </div>
    );
}
