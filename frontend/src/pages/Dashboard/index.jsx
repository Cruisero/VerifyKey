import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/AuthContext';
import './Dashboard.css';

// 生成随机状态 (pass为主, 每20个允许2个fail/timeout)
const generateStatus = (index) => {
    const rand = Math.random();
    // 每20个中有2个非pass (10%概率)
    if (rand < 0.05) return 'fail';
    if (rand < 0.10) return 'timeout';
    return 'pass';
};

// 生成初始状态数据
const generateInitialData = (count) => {
    const data = [];
    const now = Date.now();
    for (let i = 0; i < count; i++) {
        data.push({
            id: i,
            status: generateStatus(i),
            timestamp: now - (count - i) * 20000 // 每20秒一个
        });
    }
    return data;
};

export default function Dashboard() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [statusData, setStatusData] = useState(() => generateInitialData(180));
    const [hoveredItem, setHoveredItem] = useState(null);

    useEffect(() => {
        if (!user) {
            navigate('/');
        }
    }, [user, navigate]);

    // 添加新状态
    const addNewStatus = useCallback(() => {
        setStatusData(prev => {
            const newData = [...prev];
            newData.push({
                id: Date.now(),
                status: generateStatus(newData.length),
                timestamp: Date.now()
            });
            // 保持最多200个
            if (newData.length > 200) {
                newData.shift();
            }
            return newData;
        });
    }, []);

    // 每分钟更新3次，随机间隔
    useEffect(() => {
        const scheduleNextUpdate = () => {
            // 随机 5-25 秒后更新
            const delay = 5000 + Math.random() * 20000;
            return setTimeout(() => {
                addNewStatus();
                scheduleNextUpdate();
            }, delay);
        };

        const timeoutId = scheduleNextUpdate();
        return () => clearTimeout(timeoutId);
    }, [addNewStatus]);

    // 格式化时间
    const formatTime = (timestamp) => {
        const diff = Date.now() - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);

        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes}分钟前`;
        return `${Math.floor(minutes / 60)}小时前`;
    };

    // 统计
    const stats = {
        pass: statusData.filter(d => d.status === 'pass').length,
        fail: statusData.filter(d => d.status === 'fail').length,
        timeout: statusData.filter(d => d.status === 'timeout').length
    };

    const quickActions = [
        { label: '开始验证', icon: '⚡', path: '/verify', primary: true },
        { label: '充值配额', icon: '💰', path: '/recharge', primary: false },
        { label: '查看历史', icon: '📋', path: '/verify', primary: false },
    ];

    const userStats = [
        { label: '当前配额', value: `${user?.credits || 0} 次`, icon: '🎫', color: 'primary' },
        { label: '本月验证', value: stats.pass + stats.fail + stats.timeout, icon: '⚡', color: 'success' },
        { label: '成功率', value: `${Math.round(stats.pass / statusData.length * 100)}%`, icon: '📈', color: 'info' },
        { label: '节省时间', value: `${Math.round(stats.pass * 0.5)}h`, icon: '⏱️', color: 'secondary' },
    ];

    if (!user) return null;

    return (
        <div className="dashboard-page">
            <div className="container">
                {/* Welcome Section */}
                <div className="welcome-section">
                    <div className="welcome-content">
                        <h1 className="welcome-title">
                            欢迎回来，<span className="gradient-text">{user.username}</span> 👋
                        </h1>
                        <p className="welcome-desc">
                            今天是个好日子，开始您的验证任务吧！
                        </p>
                    </div>
                    <div className="quick-actions">
                        {quickActions.map((action, index) => (
                            <Link
                                key={index}
                                to={action.path}
                                className={`quick-action-btn ${action.primary ? 'primary' : ''}`}
                            >
                                <span className="action-icon">{action.icon}</span>
                                <span>{action.label}</span>
                            </Link>
                        ))}
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="stats-grid">
                    {userStats.map((stat, index) => (
                        <div
                            key={index}
                            className={`stat-card card ${stat.color}`}
                            style={{ animationDelay: `${index * 0.1}s` }}
                        >
                            <div className="stat-icon">{stat.icon}</div>
                            <div className="stat-info">
                                <span className="stat-value">{stat.value}</span>
                                <span className="stat-label">{stat.label}</span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Main Content */}
                <div className="dashboard-content">
                    {/* Live Status Grid */}
                    <div className="activity-section card">
                        <div className="section-header">
                            <h2>📊 实时验证状态 (最近10分钟)</h2>
                            <div className="status-legend">
                                <span className="legend-item">
                                    <span className="legend-dot pass"></span>
                                    {stats.pass} Pass
                                </span>
                                <span className="legend-item">
                                    <span className="legend-dot fail"></span>
                                    {stats.fail} Fail
                                </span>
                                <span className="legend-item">
                                    <span className="legend-dot timeout"></span>
                                    {stats.timeout} Timeout
                                </span>
                            </div>
                        </div>
                        <div className="status-grid-container">
                            <div className="status-grid">
                                {statusData.map((item, index) => (
                                    <div
                                        key={item.id}
                                        className={`status-block ${item.status}`}
                                        onMouseEnter={() => setHoveredItem(item)}
                                        onMouseLeave={() => setHoveredItem(null)}
                                        style={{ animationDelay: `${index * 0.005}s` }}
                                    >
                                        {hoveredItem?.id === item.id && (
                                            <div className="status-tooltip">
                                                <span className="tooltip-status">
                                                    {item.status === 'pass' ? '✓ Pass' :
                                                        item.status === 'fail' ? '✕ Fail' : '◷ Timeout'}
                                                </span>
                                                <span className="tooltip-time">{formatTime(item.timestamp)}</span>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div className="status-timeline">
                                <span>10分钟前</span>
                                <span>NOW</span>
                            </div>
                        </div>
                    </div>

                    {/* Usage Chart / Tips */}
                    <div className="tips-section card">
                        <div className="section-header">
                            <h2>💡 使用技巧</h2>
                        </div>
                        <div className="tips-list">
                            <div className="tip-item">
                                <span className="tip-icon">🎯</span>
                                <div className="tip-content">
                                    <h4>批量验证</h4>
                                    <p>一次性粘贴多个验证链接，提高效率</p>
                                </div>
                            </div>
                            <div className="tip-item">
                                <span className="tip-icon">📤</span>
                                <div className="tip-content">
                                    <h4>导出结果</h4>
                                    <p>成功的验证可以导出为文本文件</p>
                                </div>
                            </div>
                            <div className="tip-item">
                                <span className="tip-icon">🌙</span>
                                <div className="tip-content">
                                    <h4>深色模式</h4>
                                    <p>点击右上角切换深浅主题</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
