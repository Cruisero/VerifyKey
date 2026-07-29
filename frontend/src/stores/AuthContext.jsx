import { useState, createContext, useContext, useEffect } from 'react';

const AuthContext = createContext();

// In production (served via nginx), use relative path. In development, use localhost.
const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3003' : '');

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [token, setToken] = useState(null);

    useEffect(() => {
        // Check for saved token
        const savedToken = localStorage.getItem('verifykey-token');
        if (savedToken) {
            // Verify token with backend
            fetchCurrentUser(savedToken);
        } else {
            setLoading(false);
        }
    }, []);

    // Real-time polling & event-based credits auto-refresh
    useEffect(() => {
        const savedToken = token || localStorage.getItem('verifykey-token');
        if (!savedToken) return;

        // Poll credits silently every 3 seconds for real-time accuracy
        const interval = setInterval(() => {
            fetchCurrentUser(savedToken, true);
        }, 3000);

        // Immediate refresh when tab regains focus or becomes visible
        const handleFocus = () => {
            fetchCurrentUser(savedToken, true);
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchCurrentUser(savedToken, true);
            }
        };

        // Custom event for instant refresh on action completion (e.g. submit, redeem)
        const handleRefreshEvent = () => {
            fetchCurrentUser(savedToken, true);
        };

        window.addEventListener('focus', handleFocus);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('credits:refresh', handleRefreshEvent);

        return () => {
            clearInterval(interval);
            window.removeEventListener('focus', handleFocus);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('credits:refresh', handleRefreshEvent);
        };
    }, [token]);

    const fetchCurrentUser = async (authToken, silent = false) => {
        try {
            const res = await fetch(`${API_BASE}/api/auth/me`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            });

            if (res.ok) {
                const data = await res.json();
                setUser(data.user);
                setToken(authToken);
            } else if (!silent) {
                // Token invalid, clear storage
                localStorage.removeItem('verifykey-token');
            }
        } catch (error) {
            console.error('Failed to fetch user:', error);
            if (!silent) {
                localStorage.removeItem('verifykey-token');
            }
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    };

    const login = async (email, password) => {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.detail || data.error || '登录失败');
        }

        setUser(data.user);
        setToken(data.token);
        localStorage.setItem('verifykey-token', data.token);

        return data.user;
    };

    const register = async (email, password, username, inviteCode) => {
        const res = await fetch(`${API_BASE}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, username, inviteCode })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.detail || data.error || '注册失败');
        }

        setUser(data.user);
        setToken(data.token);
        localStorage.setItem('verifykey-token', data.token);

        return data.user;
    };

    const logout = () => {
        setUser(null);
        setToken(null);
        localStorage.removeItem('verifykey-token');
    };

    const updateCredits = async (amount) => {
        if (!token) return;

        try {
            const res = await fetch(`${API_BASE}/api/auth/credits`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ amount })
            });

            if (res.ok) {
                const data = await res.json();
                setUser(data.user);
            }
        } catch (error) {
            console.error('Failed to update credits:', error);
        }
    };

    // Expose token for other API calls
    const getToken = () => token;

    // Refresh user data from server
    const refreshUser = async () => {
        const savedToken = token || localStorage.getItem('verifykey-token');
        if (savedToken) {
            await fetchCurrentUser(savedToken);
        }
    };

    return (
        <AuthContext.Provider value={{
            user,
            loading,
            login,
            register,
            logout,
            updateCredits,
            refreshUser,
            getToken
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
