import { useState, createContext, useContext, useEffect } from 'react';

const AuthContext = createContext();

// 管理员账号配置
const ADMIN_CREDENTIALS = {
    email: 'admin@verifykey.com',
    password: 'admin123'
};

// 模拟用户数据（后续替换为真实后端）
const createUserData = (email, username, isAdmin = false) => ({
    id: Date.now(),
    email,
    username: username || email.split('@')[0],
    credits: 100,
    role: isAdmin ? 'admin' : 'user',
    createdAt: new Date().toISOString()
});

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // 检查本地存储的登录状态
        const savedUser = localStorage.getItem('verifykey-user');
        if (savedUser) {
            setUser(JSON.parse(savedUser));
        }
        setLoading(false);
    }, []);

    const login = async (email, password) => {
        // 模拟登录（后续替换为真实 API）
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                if (email && password) {
                    // 检查是否是管理员账号
                    const isAdmin = email === ADMIN_CREDENTIALS.email && password === ADMIN_CREDENTIALS.password;
                    const userData = createUserData(email, isAdmin ? '管理员' : null, isAdmin);
                    setUser(userData);
                    localStorage.setItem('verifykey-user', JSON.stringify(userData));
                    resolve(userData);
                } else {
                    reject(new Error('请输入邮箱和密码'));
                }
            }, 500);
        });
    };

    const register = async (email, password, username) => {
        // 模拟注册
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                if (email && password && username) {
                    const userData = createUserData(email, username, false);
                    setUser(userData);
                    localStorage.setItem('verifykey-user', JSON.stringify(userData));
                    resolve(userData);
                } else {
                    reject(new Error('请填写所有字段'));
                }
            }, 500);
        });
    };

    const logout = () => {
        setUser(null);
        localStorage.removeItem('verifykey-user');
    };

    const updateCredits = (amount) => {
        if (user) {
            const updatedUser = { ...user, credits: user.credits + amount };
            setUser(updatedUser);
            localStorage.setItem('verifykey-user', JSON.stringify(updatedUser));
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, register, logout, updateCredits }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
