import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/AuthContext';
import './Admin.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function Admin() {
    const { user, loading } = useAuth();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('overview');
    const [config, setConfig] = useState(null);
    const [showSaveNotice, setShowSaveNotice] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [testing, setTesting] = useState(false);
    const [saving, setSaving] = useState(false);

    // Test document generation state
    const [testingDocument, setTestingDocument] = useState(false);
    const [testDocumentResult, setTestDocumentResult] = useState(null);

    // AI Generator form state
    const [aiProvider, setAiProvider] = useState('gemini');
    const [batchApiSettings, setBatchApiSettings] = useState({
        apiUrl: 'https://batch.1key.me/api/batch',
        apiKey: ''
    });
    const [geminiSettings, setGeminiSettings] = useState({
        apiKey: '',
        model: 'gemini-3-pro-image-preview'
    });
    const [puppeteerSettings, setPuppeteerSettings] = useState({
        template: 'student-id-generator.html',
        useGeminiPhoto: true,
        availableTemplates: []
    });
    const [proxySettings, setProxySettings] = useState({
        enabled: true,
        host: 'proxy.global.ip2up.com',
        port: '12348',
        user: '',
        password: ''
    });

    // Region mode state: 'global' (default) or 'us_only'
    const [regionMode, setRegionMode] = useState('global');

    // University source: 'sheerid_api' (dynamic) or 'custom_list' (local list)
    const [universitySource, setUniversitySource] = useState('sheerid_api');

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
                setAiProvider(data.aiGenerator?.provider || 'gemini');
                if (data.aiGenerator?.batchApi) {
                    setBatchApiSettings(prev => ({
                        ...prev,
                        apiUrl: data.aiGenerator.batchApi.apiUrl || prev.apiUrl,
                        apiKey: data.aiGenerator.batchApi.apiKey?.includes('...')
                            ? ''
                            : (data.aiGenerator.batchApi.apiKey || '')
                    }));
                    if (data.aiGenerator.batchApi.apiKey?.includes('...')) {
                        setBatchApiSettings(prev => ({ ...prev, hasStoredKey: true }));
                    }
                }
                if (data.aiGenerator?.gemini) {
                    setGeminiSettings(prev => ({
                        ...prev,
                        apiKey: data.aiGenerator.gemini.apiKey?.includes('...')
                            ? ''
                            : (data.aiGenerator.gemini.apiKey || ''),
                        model: data.aiGenerator.gemini.model || prev.model
                    }));
                    if (data.aiGenerator.gemini.apiKey?.includes('...')) {
                        setGeminiSettings(prev => ({ ...prev, hasStoredKey: true }));
                    }
                }
                if (data.aiGenerator?.puppeteer) {
                    setPuppeteerSettings(prev => ({
                        ...prev,
                        template: data.aiGenerator.puppeteer.template || prev.template,
                        useGeminiPhoto: data.aiGenerator.puppeteer.useGeminiPhoto !== false
                    }));
                }
                // Load proxy settings
                if (data.proxy) {
                    setProxySettings(prev => ({
                        ...prev,
                        enabled: data.proxy.enabled !== false,
                        host: data.proxy.host || prev.host,
                        port: data.proxy.port || prev.port,
                        user: data.proxy.user?.includes('...') ? '' : (data.proxy.user || ''),
                        password: data.proxy.password?.includes('...') ? '' : (data.proxy.password || ''),
                        hasStoredCredentials: data.proxy.user?.includes('...')
                    }));
                }
                // Load region mode setting
                if (data.aiGenerator?.regionMode) {
                    setRegionMode(data.aiGenerator.regionMode);
                }
                // Load university source setting
                if (data.aiGenerator?.universitySource) {
                    setUniversitySource(data.aiGenerator.universitySource);
                }
            }

            // Fetch available templates
            const templatesRes = await fetch(`${API_BASE}/api/templates`);
            if (templatesRes.ok) {
                const templatesData = await templatesRes.json();
                setPuppeteerSettings(prev => ({
                    ...prev,
                    availableTemplates: templatesData.templates || []
                }));
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
                    regionMode: regionMode,
                    universitySource: universitySource,
                    batchApi: {
                        enabled: aiProvider === 'batch_api',
                        apiUrl: batchApiSettings.apiUrl,
                        apiKey: batchApiSettings.apiKey || undefined
                    },
                    gemini: {
                        enabled: aiProvider === 'gemini' || aiProvider === 'puppeteer',
                        apiKey: geminiSettings.apiKey || undefined,
                        model: geminiSettings.model
                    },
                    puppeteer: {
                        enabled: aiProvider === 'puppeteer',
                        template: puppeteerSettings.template,
                        useGeminiPhoto: puppeteerSettings.useGeminiPhoto
                    },
                    svgFallback: { enabled: true }
                },
                proxy: {
                    enabled: proxySettings.enabled,
                    host: proxySettings.host,
                    port: proxySettings.port,
                    user: proxySettings.user || undefined,
                    password: proxySettings.password || undefined
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
                apiUrl: aiProvider === 'batch_api' ? batchApiSettings.apiUrl : undefined,
                apiKey: aiProvider === 'batch_api' ? batchApiSettings.apiKey : geminiSettings.apiKey,
                model: geminiSettings.model
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

    const handleTestDocument = async () => {
        setTestingDocument(true);
        setTestDocumentResult(null);

        try {
            // Build config based on selected provider
            const testConfig = {
                provider: aiProvider
            };

            if (aiProvider === 'puppeteer') {
                testConfig.template = puppeteerSettings.template;
                testConfig.useGeminiPhoto = puppeteerSettings.useGeminiPhoto;
                if (puppeteerSettings.useGeminiPhoto && geminiSettings.apiKey) {
                    testConfig.geminiApiKey = geminiSettings.apiKey;
                }
            } else if (aiProvider === 'gemini') {
                testConfig.geminiApiKey = geminiSettings.apiKey;
                testConfig.geminiModel = geminiSettings.model;
            } else if (aiProvider === 'batch_api') {
                testConfig.batchApiUrl = batchApiSettings.apiUrl;
                testConfig.batchApiKey = batchApiSettings.apiKey;
            }

            const res = await fetch(`${API_BASE}/api/config/test-document`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(testConfig)
            });

            const data = await res.json();
            setTestDocumentResult(data);
        } catch (error) {
            setTestDocumentResult({ success: false, message: error.message });
        }
        setTestingDocument(false);
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
                                    className={`provider-card ${aiProvider === 'batch_api' ? 'active' : ''}`}
                                    onClick={() => setAiProvider('batch_api')}
                                >
                                    <div className="provider-icon">🔗</div>
                                    <div className="provider-info">
                                        <h4>batch.1key.me API</h4>
                                        <p>使用第三方批量验证 API</p>
                                    </div>
                                    <div className="provider-status">
                                        <span className="badge badge-warning">需配置</span>
                                    </div>
                                </div>

                                <div
                                    className={`provider-card ${aiProvider === 'gemini' ? 'active' : ''}`}
                                    onClick={() => setAiProvider('gemini')}
                                >
                                    <div className="provider-icon">✨</div>
                                    <div className="provider-info">
                                        <h4>Gemini API</h4>
                                        <p>直接调用 Google Gemini API</p>
                                    </div>
                                    <div className="provider-status">
                                        <span className="badge badge-warning">需配置</span>
                                    </div>
                                </div>

                                <div
                                    className={`provider-card ${aiProvider === 'puppeteer' ? 'active' : ''}`}
                                    onClick={() => setAiProvider('puppeteer')}
                                >
                                    <div className="provider-icon">🎨</div>
                                    <div className="provider-info">
                                        <h4>Puppeteer HTML 模板</h4>
                                        <p>使用 Puppeteer 渲染 HTML 模板生成高质量证件</p>
                                    </div>
                                    <div className="provider-status">
                                        <span className="badge badge-success">推荐</span>
                                    </div>
                                </div>
                            </div>

                            {/* batch.1key.me API Settings */}
                            {aiProvider === 'batch_api' && (
                                <div className="provider-settings">
                                    <h4>batch.1key.me API 配置</h4>
                                    <div className="settings-form">
                                        <div className="input-group">
                                            <label className="input-label">API URL</label>
                                            <input
                                                type="text"
                                                className="input"
                                                value={batchApiSettings.apiUrl}
                                                onChange={(e) => setBatchApiSettings(s => ({ ...s, apiUrl: e.target.value }))}
                                                placeholder="https://batch.1key.me/api/batch"
                                            />
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">API Key</label>
                                            <input
                                                type="password"
                                                className="input"
                                                value={batchApiSettings.apiKey}
                                                onChange={(e) => setBatchApiSettings(s => ({ ...s, apiKey: e.target.value, hasStoredKey: false }))}
                                                placeholder={batchApiSettings.hasStoredKey ? "••••••••••（已保存，留空保持不变）" : "输入 batch.1key.me API Key"}
                                            />
                                            {batchApiSettings.hasStoredKey && (
                                                <p className="input-hint"><span className="key-stored">✓ API Key 已保存</span></p>
                                            )}
                                            <p className="input-hint">
                                                从 <a href="https://batch.1key.me" target="_blank" rel="noreferrer">batch.1key.me</a> 获取 API Key
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Gemini API Settings */}
                            {aiProvider === 'gemini' && (
                                <div className="provider-settings">
                                    <h4>Gemini API 配置</h4>
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
                                                    <option value="gemini-3-pro-image-preview">gemini-3-pro-image-preview (推荐)</option>
                                                    <option value="gemini-2.0-flash-exp-image-generation">gemini-2.0-flash-exp-image-generation</option>
                                                    <option value="imagen-4.0-generate-001">imagen-4.0-generate-001</option>
                                                </optgroup>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Puppeteer HTML Template Settings */}
                            {aiProvider === 'puppeteer' && (
                                <div className="provider-settings">
                                    <h4>🎨 Puppeteer HTML 模板配置</h4>
                                    <div className="settings-form">
                                        <div className="input-group">
                                            <label className="input-label">选择 HTML 模板</label>
                                            <select
                                                className="input"
                                                value={puppeteerSettings.template}
                                                onChange={(e) => setPuppeteerSettings(s => ({ ...s, template: e.target.value }))}
                                            >
                                                {puppeteerSettings.availableTemplates.length > 0 ? (
                                                    puppeteerSettings.availableTemplates.map(tpl => (
                                                        <option key={tpl.filename} value={tpl.filename}>
                                                            {tpl.name} ({tpl.filename})
                                                        </option>
                                                    ))
                                                ) : (
                                                    <option value="student-id-generator.html">student-id-generator.html (默认)</option>
                                                )}
                                            </select>
                                            <p className="input-hint">
                                                模板文件位于 <code>VerifyKey/templates/</code> 目录
                                            </p>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">
                                                <input
                                                    type="checkbox"
                                                    checked={puppeteerSettings.useGeminiPhoto}
                                                    onChange={(e) => setPuppeteerSettings(s => ({ ...s, useGeminiPhoto: e.target.checked }))}
                                                    style={{ marginRight: '8px' }}
                                                />
                                                使用 Gemini AI 生成学生证件照
                                            </label>
                                            <p className="input-hint">
                                                启用后将使用 Gemini AI 自动生成逼真的学生头像（使用上方 Gemini 配置中的 API Key）
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Region Mode Settings - Always visible */}
                            <div className="provider-settings region-settings" style={{ marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '24px' }}>
                                <h4>🌍 验证地区配置</h4>
                                <p className="settings-desc" style={{ marginBottom: '16px' }}>
                                    选择生成验证文档时使用的学校地区范围
                                </p>
                                <div className="settings-form">
                                    <div className="input-group">
                                        <label className="input-label">地区模式</label>
                                        <select
                                            className="input"
                                            value={regionMode}
                                            onChange={(e) => setRegionMode(e.target.value)}
                                        >
                                            <option value="us_only">🇺🇸 仅美国学校 (US Only)</option>
                                            <option value="global">🌏 全球学校 (Global)</option>
                                        </select>
                                        <p className="input-hint">
                                            {regionMode === 'us_only'
                                                ? '仅使用美国学校生成验证文档，更稳定的验证通过率'
                                                : '随机选择全球学校生成验证文档，包括美国、欧洲、亚洲等地区'}
                                        </p>
                                    </div>
                                    <div className="input-group" style={{ marginTop: '16px' }}>
                                        <label className="input-label">学校来源</label>
                                        <select
                                            className="input"
                                            value={universitySource}
                                            onChange={(e) => setUniversitySource(e.target.value)}
                                        >
                                            <option value="sheerid_api">🔗 SheerID API 动态获取</option>
                                            <option value="custom_list">📋 自定义名单 (本地列表)</option>
                                        </select>
                                        <p className="input-hint">
                                            {universitySource === 'sheerid_api'
                                                ? '从 SheerID API 实时获取学校列表，确保 ID 准确匹配'
                                                : '使用预设的高成功率学校名单 (来自 ThanhNguyxn)，不依赖 API'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Proxy Settings - Always visible */}
                            <div className="provider-settings proxy-settings" style={{ marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '24px' }}>
                                <h4>🌐 住宅代理配置 (Residential Proxy)</h4>
                                <p className="settings-desc" style={{ marginBottom: '16px' }}>
                                    配置住宅代理可有效防止 SheerID 的 IP 风控检测 (fraudRulesReject)
                                </p>
                                <div className="settings-form">
                                    <div className="input-group">
                                        <label className="input-label">
                                            <input
                                                type="checkbox"
                                                checked={proxySettings.enabled}
                                                onChange={(e) => setProxySettings(s => ({ ...s, enabled: e.target.checked }))}
                                                style={{ marginRight: '8px' }}
                                            />
                                            启用代理
                                        </label>
                                    </div>
                                    {proxySettings.enabled && (
                                        <>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '12px' }}>
                                                <div className="input-group">
                                                    <label className="input-label">代理主机 (Host)</label>
                                                    <input
                                                        type="text"
                                                        className="input"
                                                        value={proxySettings.host}
                                                        onChange={(e) => setProxySettings(s => ({ ...s, host: e.target.value }))}
                                                        placeholder="proxy.global.ip2up.com"
                                                    />
                                                </div>
                                                <div className="input-group">
                                                    <label className="input-label">端口 (Port)</label>
                                                    <input
                                                        type="text"
                                                        className="input"
                                                        value={proxySettings.port}
                                                        onChange={(e) => setProxySettings(s => ({ ...s, port: e.target.value }))}
                                                        placeholder="12348"
                                                    />
                                                </div>
                                            </div>
                                            <div className="input-group">
                                                <label className="input-label">用户名 (Username)</label>
                                                <input
                                                    type="text"
                                                    className="input"
                                                    value={proxySettings.user}
                                                    onChange={(e) => setProxySettings(s => ({ ...s, user: e.target.value, hasStoredCredentials: false }))}
                                                    placeholder={proxySettings.hasStoredCredentials ? "••••••••••（已保存，留空保持不变）" : "hW32EF_200_0_0_..."}
                                                />
                                                <p className="input-hint">
                                                    ip2up 格式: <code>[account]_[country]_[province]_[city]_[session]_[sessionTime]_[flag]</code>
                                                </p>
                                            </div>
                                            <div className="input-group">
                                                <label className="input-label">密码 (Password)</label>
                                                <input
                                                    type="password"
                                                    className="input"
                                                    value={proxySettings.password}
                                                    onChange={(e) => setProxySettings(s => ({ ...s, password: e.target.value, hasStoredCredentials: false }))}
                                                    placeholder={proxySettings.hasStoredCredentials ? "••••••••••（已保存，留空保持不变）" : ""}
                                                />
                                                {proxySettings.hasStoredCredentials && (
                                                    <p className="input-hint">
                                                        <span className="key-stored">✓ 代理凭据已保存</span>
                                                    </p>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>

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
                                    className="btn btn-secondary"
                                    onClick={handleTestDocument}
                                    disabled={testingDocument}
                                >
                                    {testingDocument ? '生成中...' : '🖼️ 测试文档生成'}
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

                            {/* Test Document Result */}
                            {testDocumentResult && (
                                <div className="test-document-result">
                                    <h4>📄 文档生成测试结果</h4>
                                    {testDocumentResult.success ? (
                                        <div className="test-document-content">
                                            {testDocumentResult.providerNote && (
                                                <div className="provider-note" style={{
                                                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                                    color: 'white',
                                                    padding: '8px 16px',
                                                    borderRadius: '6px',
                                                    marginBottom: '16px',
                                                    fontSize: '14px'
                                                }}>
                                                    ⚙️ {testDocumentResult.providerNote}
                                                </div>
                                            )}
                                            <div className="test-document-image">
                                                <img
                                                    src={testDocumentResult.image}
                                                    alt="Generated Document"
                                                    style={{ maxWidth: '400px', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
                                                />
                                                <p className="filename">{testDocumentResult.filename}</p>
                                            </div>
                                            <div className="test-document-form-data">
                                                <h5>📝 表单数据 (将提交到 SheerID)</h5>
                                                <table className="form-data-table">
                                                    <tbody>
                                                        {Object.entries(testDocumentResult.formData || {})
                                                            .filter(([key]) => ['firstName', 'lastName', 'university', 'birthDate', 'dob', 'email'].includes(key))
                                                            .map(([key, value]) => (
                                                                <tr key={key}>
                                                                    <td className="key">{key}</td>
                                                                    <td className="value">{value}</td>
                                                                </tr>
                                                            ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="test-result error">
                                            <span className="test-icon">❌</span>
                                            <span className="test-message">{testDocumentResult.message}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Info Card */}
                        <div className="settings-section card">
                            <h3>💡 说明</h3>
                            <div className="info-content">
                                <p><strong>🎨 Puppeteer HTML 模板（推荐）：</strong>使用 Puppeteer 渲染自定义 HTML 模板生成高质量学生证图片，支持 Gemini AI 生成逼真的学生证件照，效果最佳。</p>
                                <p><strong>Gemini 官方 API：</strong>直接调用 Google Gemini API 生成学生证图像，需要有效的 API Key。</p>
                                <p><strong>batch.1key.me API：</strong>使用第三方批量验证 API，需要配置 API Key。</p>
                                <p className="info-warning">⚠️ 如果 AI 生成失败，系统会自动回退到备用生成方式。</p>
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

