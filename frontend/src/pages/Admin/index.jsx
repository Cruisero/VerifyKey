import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/AuthContext';
import './Admin.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';

export default function Admin() {
    const { user, loading } = useAuth();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('overview');
    const [config, setConfig] = useState(null);
    const [showSaveNotice, setShowSaveNotice] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [testing, setTesting] = useState(false);
    const [saving, setSaving] = useState(false);

    // AI Generator form state
    const [aiProvider, setAiProvider] = useState('svg');
    const [antigravitySettings, setAntigravitySettings] = useState({
        apiBase: 'http://127.0.0.1:8045/v1',
        apiKey: '',
        model: 'gemini-3-pro-image'
    });
    const [geminiSettings, setGeminiSettings] = useState({
        apiKey: '',
        model: 'gemini-2.0-flash-exp-image-generation'
    });

    useEffect(() => {
        if (!loading && !user) {
            navigate('/');
        }
    }, [user, loading, navigate]);

    // Load configuration on mount
    useEffect(() => {
        fetchConfig();
    }, []);

    const fetchConfig = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/config`);
            if (res.ok) {
                const data = await res.json();
                setConfig(data);
                setAiProvider(data.aiGenerator?.provider || 'svg');
                if (data.aiGenerator?.antigravity) {
                    setAntigravitySettings(prev => ({
                        ...prev,
                        apiBase: data.aiGenerator.antigravity.apiBase || prev.apiBase,
                        // Show masked key indicator if key exists on server
                        apiKey: data.aiGenerator.antigravity.apiKey?.includes('...')
                            ? '' // Keep empty, user can re-enter if needed
                            : (data.aiGenerator.antigravity.apiKey || ''),
                        model: data.aiGenerator.antigravity.model || prev.model
                    }));
                    // Store indicator that key exists on server
                    if (data.aiGenerator.antigravity.apiKey?.includes('...')) {
                        setAntigravitySettings(prev => ({ ...prev, hasStoredKey: true }));
                    }
                }
                if (data.aiGenerator?.geminiOfficial) {
                    setGeminiSettings(prev => ({
                        ...prev,
                        apiKey: data.aiGenerator.geminiOfficial.apiKey?.includes('...')
                            ? ''
                            : (data.aiGenerator.geminiOfficial.apiKey || ''),
                        model: data.aiGenerator.geminiOfficial.model || prev.model
                    }));
                    if (data.aiGenerator.geminiOfficial.apiKey?.includes('...')) {
                        setGeminiSettings(prev => ({ ...prev, hasStoredKey: true }));
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load config:', error);
        }
    };

    const handleSaveAiConfig = async () => {
        setSaving(true);
        try {
            const updates = {
                aiGenerator: {
                    provider: aiProvider,
                    antigravity: {
                        enabled: aiProvider === 'antigravity',
                        apiBase: antigravitySettings.apiBase,
                        apiKey: antigravitySettings.apiKey || undefined,
                        model: antigravitySettings.model
                    },
                    geminiOfficial: {
                        enabled: aiProvider === 'gemini_official',
                        apiKey: geminiSettings.apiKey || undefined,
                        model: geminiSettings.model
                    },
                    svgFallback: { enabled: true }
                }
            };

            const res = await fetch(`${API_BASE}/api/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });

            if (res.ok) {
                setShowSaveNotice(true);
                setTimeout(() => setShowSaveNotice(false), 2000);
                fetchConfig();
            }
        } catch (error) {
            console.error('Failed to save config:', error);
        }
        setSaving(false);
    };

    const handleTestConnection = async () => {
        setTesting(true);
        setTestResult(null);

        try {
            const body = {
                provider: aiProvider,
                apiBase: antigravitySettings.apiBase,
                apiKey: aiProvider === 'antigravity' ? antigravitySettings.apiKey : geminiSettings.apiKey,
                model: aiProvider === 'antigravity' ? antigravitySettings.model : geminiSettings.model
            };

            const res = await fetch(`${API_BASE}/api/config/test`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await res.json();
            setTestResult(data);
        } catch (error) {
            setTestResult({ success: false, message: error.message });
        }
        setTesting(false);
    };

    // 模拟数据
    const stats = {
        totalUsers: 1247,
        activeUsers: 892,
        totalVerifications: 34582,
        successRate: 98.7,
        revenue: 12580,
        pendingWithdrawals: 3
    };

    const users = [
        { id: 1, username: 'user1', email: 'user1@example.com', credits: 150, status: 'active', joined: '2026-01-15' },
        { id: 2, username: 'user2', email: 'user2@example.com', credits: 45, status: 'active', joined: '2026-01-18' },
        { id: 3, username: 'user3', email: 'user3@example.com', credits: 0, status: 'suspended', joined: '2026-01-20' },
        { id: 4, username: 'user4', email: 'user4@example.com', credits: 320, status: 'active', joined: '2026-01-22' },
    ];

    const tabs = [
        { id: 'overview', label: '概览', icon: '📊' },
        { id: 'users', label: '用户管理', icon: '👥' },
        { id: 'ai-generator', label: 'AI 文档生成', icon: '🤖' },
        { id: 'settings', label: '系统设置', icon: '⚙️' },
    ];

    if (loading || !user) return null;

    return (
        <div className="admin-page">
            <div className="container">
                {/* Header */}
                <div className="admin-header">
                    <h1 className="page-title">⚙️ 管理后台</h1>
                    <p className="page-desc">管理用户、配置系统和查看统计数据</p>
                </div>

                {/* Tabs */}
                <div className="admin-tabs">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            className={`admin-tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            <span className="tab-icon">{tab.icon}</span>
                            <span className="tab-label">{tab.label}</span>
                        </button>
                    ))}
                </div>

                {/* Overview Tab */}
                {activeTab === 'overview' && (
                    <div className="tab-content">
                        <div className="stats-grid">
                            <div className="stat-card card">
                                <div className="stat-icon">👥</div>
                                <div className="stat-info">
                                    <span className="stat-value">{stats.totalUsers}</span>
                                    <span className="stat-label">总用户数</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">✅</div>
                                <div className="stat-info">
                                    <span className="stat-value">{stats.activeUsers}</span>
                                    <span className="stat-label">活跃用户</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">⚡</div>
                                <div className="stat-info">
                                    <span className="stat-value">{stats.totalVerifications.toLocaleString()}</span>
                                    <span className="stat-label">总验证次数</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">📈</div>
                                <div className="stat-info">
                                    <span className="stat-value">{stats.successRate}%</span>
                                    <span className="stat-label">成功率</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">💰</div>
                                <div className="stat-info">
                                    <span className="stat-value">¥{stats.revenue.toLocaleString()}</span>
                                    <span className="stat-label">总收入</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">📋</div>
                                <div className="stat-info">
                                    <span className="stat-value">{stats.pendingWithdrawals}</span>
                                    <span className="stat-label">待处理提现</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Users Tab */}
                {activeTab === 'users' && (
                    <div className="tab-content">
                        <div className="users-table card">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>用户名</th>
                                        <th>邮箱</th>
                                        <th>积分</th>
                                        <th>状态</th>
                                        <th>注册时间</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map(u => (
                                        <tr key={u.id}>
                                            <td>{u.id}</td>
                                            <td>{u.username}</td>
                                            <td>{u.email}</td>
                                            <td>{u.credits}</td>
                                            <td>
                                                <span className={`badge badge-${u.status === 'active' ? 'success' : 'error'}`}>
                                                    {u.status === 'active' ? '正常' : '禁用'}
                                                </span>
                                            </td>
                                            <td>{u.joined}</td>
                                            <td>
                                                <div className="action-btns">
                                                    <button className="btn btn-sm btn-secondary">编辑</button>
                                                    <button className="btn btn-sm btn-outline">禁用</button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* AI Generator Tab */}
                {activeTab === 'ai-generator' && (
                    <div className="tab-content">
                        <div className="settings-section card">
                            <h3>🤖 AI 文档生成器配置</h3>
                            <p className="settings-desc">
                                选择用于生成验证文档（学生证、成绩单）的 AI 提供商。
                            </p>

                            {/* Provider Selection */}
                            <div className="provider-cards">
                                <div
                                    className={`provider-card ${aiProvider === 'svg' ? 'active' : ''}`}
                                    onClick={() => setAiProvider('svg')}
                                >
                                    <div className="provider-icon">📄</div>
                                    <div className="provider-info">
                                        <h4>SVG 模板</h4>
                                        <p>使用内置 SVG 模板生成，无需 API</p>
                                    </div>
                                    <div className="provider-status">
                                        <span className="badge badge-success">始终可用</span>
                                    </div>
                                </div>

                                <div
                                    className={`provider-card ${aiProvider === 'antigravity' ? 'active' : ''}`}
                                    onClick={() => setAiProvider('antigravity')}
                                >
                                    <div className="provider-icon">🚀</div>
                                    <div className="provider-info">
                                        <h4>Antigravity Tools</h4>
                                        <p>使用本地 API 反代服务</p>
                                    </div>
                                    <div className="provider-status">
                                        <span className="badge badge-warning">需配置</span>
                                    </div>
                                </div>

                                <div
                                    className={`provider-card ${aiProvider === 'gemini_official' ? 'active' : ''}`}
                                    onClick={() => setAiProvider('gemini_official')}
                                >
                                    <div className="provider-icon">✨</div>
                                    <div className="provider-info">
                                        <h4>Gemini 官方 API</h4>
                                        <p>直接调用 Google Gemini API</p>
                                    </div>
                                    <div className="provider-status">
                                        <span className="badge badge-warning">需配置</span>
                                    </div>
                                </div>
                            </div>

                            {/* Antigravity Settings */}
                            {aiProvider === 'antigravity' && (
                                <div className="provider-settings">
                                    <h4>Antigravity Tools 配置</h4>
                                    <div className="settings-form">
                                        <div className="input-group">
                                            <label className="input-label">API Base URL</label>
                                            <input
                                                type="text"
                                                className="input"
                                                value={antigravitySettings.apiBase}
                                                onChange={(e) => setAntigravitySettings(s => ({ ...s, apiBase: e.target.value }))}
                                                placeholder="http://127.0.0.1:8045/v1"
                                            />
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">API Key</label>
                                            <input
                                                type="password"
                                                className="input"
                                                value={antigravitySettings.apiKey}
                                                onChange={(e) => setAntigravitySettings(s => ({ ...s, apiKey: e.target.value, hasStoredKey: false }))}
                                                placeholder={antigravitySettings.hasStoredKey ? "••••••••••（已保存，留空保持不变）" : "sk-xxxxxxxxxxxxxxxxxxxxxx"}
                                            />
                                            {antigravitySettings.hasStoredKey && (
                                                <p className="input-hint"><span className="key-stored">✓ API Key 已保存</span></p>
                                            )}
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">图像生成模型</label>
                                            <select
                                                className="input"
                                                value={antigravitySettings.model}
                                                onChange={(e) => setAntigravitySettings(s => ({ ...s, model: e.target.value }))}
                                            >
                                                <option value="gemini-3-pro-image">gemini-3-pro-image (1:1)</option>
                                                <option value="gemini-3-pro-image-4x3">gemini-3-pro-image-4x3</option>
                                                <option value="gemini-3-pro-image-16x9">gemini-3-pro-image-16x9</option>
                                                <option value="gemini-3-pro-image-2k">gemini-3-pro-image-2k</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Gemini Official Settings */}
                            {aiProvider === 'gemini_official' && (
                                <div className="provider-settings">
                                    <h4>Gemini 官方 API 配置</h4>
                                    <div className="settings-form">
                                        <div className="input-group">
                                            <label className="input-label">API Key</label>
                                            <input
                                                type="password"
                                                className="input"
                                                value={geminiSettings.apiKey}
                                                onChange={(e) => setGeminiSettings(s => ({ ...s, apiKey: e.target.value, hasStoredKey: false }))}
                                                placeholder={geminiSettings.hasStoredKey ? "••••••••••（已保存，留空保持不变）" : "AIzaSy..."}
                                            />
                                            <p className="input-hint">
                                                {geminiSettings.hasStoredKey && <span className="key-stored">✓ API Key 已保存 · </span>}
                                                从 <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio</a> 获取
                                            </p>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">模型</label>
                                            <select
                                                className="input"
                                                value={geminiSettings.model}
                                                onChange={(e) => setGeminiSettings(s => ({ ...s, model: e.target.value }))}
                                            >
                                                <optgroup label="🖼️ 图像生成模型">
                                                    <option value="gemini-2.0-flash-exp-image-generation">gemini-2.0-flash-exp-image-generation (推荐)</option>
                                                    <option value="gemini-3-pro-image-preview">gemini-3-pro-image-preview</option>
                                                    <option value="imagen-4.0-generate-001">imagen-4.0-generate-001</option>
                                                    <option value="imagen-4.0-fast-generate-001">imagen-4.0-fast-generate-001</option>
                                                </optgroup>
                                                <optgroup label="💬 文本模型 (仅测试连接)">
                                                    <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                                                    <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                                                </optgroup>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Test & Save Buttons */}
                            <div className="settings-actions">
                                <button
                                    className="btn btn-secondary"
                                    onClick={handleTestConnection}
                                    disabled={testing}
                                >
                                    {testing ? '测试中...' : '🔌 测试连接'}
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleSaveAiConfig}
                                    disabled={saving}
                                >
                                    {saving ? '保存中...' : '💾 保存配置'}
                                </button>
                                {showSaveNotice && (
                                    <span className="save-notice">✓ 已保存</span>
                                )}
                            </div>

                            {/* Test Result */}
                            {testResult && (
                                <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                                    <span className="test-icon">{testResult.success ? '✅' : '❌'}</span>
                                    <span className="test-message">{testResult.message}</span>
                                </div>
                            )}
                        </div>

                        {/* Info Card */}
                        <div className="settings-section card">
                            <h3>💡 说明</h3>
                            <div className="info-content">
                                <p><strong>SVG 模板：</strong>使用预设模板生成简单的学生证/成绩单 SVG 图像，始终可用，无需任何配置。</p>
                                <p><strong>Antigravity Tools：</strong>使用本地运行的 Antigravity Manager API 反代服务，支持 gemini-3-pro-image 模型生成高质量图像。</p>
                                <p><strong>Gemini 官方 API：</strong>直接调用 Google Gemini API，需要有效的 API Key。</p>
                                <p className="info-warning">⚠️ 如果 AI 生成失败，系统会自动回退到 SVG 模板。</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Settings Tab */}
                {activeTab === 'settings' && (
                    <div className="tab-content">
                        <div className="settings-section card">
                            <h3>💰 定价设置</h3>
                            <p className="settings-desc">
                                设置每次验证消耗的积分数量。
                            </p>
                            <div className="settings-form">
                                <div className="input-group">
                                    <label className="input-label">每次验证消耗积分</label>
                                    <input
                                        type="number"
                                        className="input"
                                        defaultValue={1}
                                        min={1}
                                    />
                                </div>
                                <button className="btn btn-primary">保存</button>
                            </div>
                        </div>

                        <div className="settings-section card">
                            <h3>📢 公告设置</h3>
                            <p className="settings-desc">
                                设置在验证工具页面显示的公告内容。
                            </p>
                            <div className="settings-form">
                                <div className="input-group">
                                    <label className="input-label">公告内容</label>
                                    <textarea
                                        className="input textarea"
                                        placeholder="输入公告内容..."
                                        rows={3}
                                    />
                                </div>
                                <button className="btn btn-primary">保存</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

