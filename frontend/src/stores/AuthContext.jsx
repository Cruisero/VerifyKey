import { useState, createContext, useContext, useEffect } from 'react';

const AuthContext = createContext();

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';

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

    const fetchCurrentUser = async (authToken) => {
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
            } else {
                // Token invalid, clear storage
                localStorage.removeItem('verifykey-token');
            }
        } catch (error) {
            console.error('Failed to fetch user:', error);
            localStorage.removeItem('verifykey-token');
        } finally {
            setLoading(false);
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
            throw new Error(data.error || '登录失败');
        }

        setUser(data.user);
        setToken(data.token);
        localStorage.setItem('verifykey-token', data.token);

        return data.user;
    };

    const register = async (email, password, username) => {
        const res = await fetch(`${API_BASE}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, username })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || '注册失败');
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

    return (
        <AuthContext.Provider value={{
            user,
            loading,
            login,
            register,
            logout,
            updateCredits,
            getToken
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
