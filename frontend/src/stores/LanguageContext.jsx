import { useState, createContext, useContext } from 'react';

const LanguageContext = createContext();

const translations = {
    zh: {
        // Layout
        switchThemeLight: '切换到浅色模式',
        switchThemeDark: '切换到深色模式',
        adminPanel: '管理后台',
        logout: '退出登录',
        footerRights: '© 2026 OnePASS. All rights reserved.',
        terms: '使用条款',
        privacy: '隐私政策',
        contact: '联系我们',

        // Verify - header
        welcomeDesc: '提示：无需登录，直接使用链接即可开始验证。支持多线程并发处理。',
        programOnline: '程序在线',
        programOffline: '程序离线',
        browserModeLabel: '🌐 浏览器模式',
        apiModeLabel: '⚡ API 模式',
        lastSuccess: '上次成功',
        none: '无',

        // Verify - status badges
        statusReady: '就绪',
        statusProcessing: '处理中',
        statusComplete: '完成',

        // Verify - input panel
        inputVerifyLinks: '输入验证链接',
        inputVerifyIds: '输入验证 ID',
        textareaPlaceholderTelegram: `粘贴验证链接，每行一个...
例如：
https://services.sheerid.com/verify/67c8c14f5f17a83b745e3f82/?verificationId=699528d723c407520aeadc45

注意：右键复制链接，不要点击打开！
链接验证失败后等待几秒钟刷新页面即可得到新链接。

验证失败不消耗额度`,
        textareaPlaceholderApi: `粘贴验证 ID 或链接，每行一个...

例如：
699528d723c407520aeadc45
https://services.sheerid.com/verify/...?verificationId=699528d723c407520aeadc45`,

        // Verify - CDK
        cdkRemaining: 'CDK 剩余额度',
        change: '更改',
        buy: '购买',
        buyCdk: '购买CDK',
        verifying: '验证中...',
        invalidCdk: '❌ 无效',
        linksCount: '个链接',
        idsCount: '个ID',
        remainingQuota: '剩余配额',
        quotaTimes: '次',
        notActivated: '未激活',

        // Verify - actions
        processing: '处理中...',
        startVerify: '🚀 开始验证',

        // Verify - results
        results: '结果',
        clear: '🗑️ 清空',
        export: '📤 导出',
        noResults: '暂无结果',
        noResultsHint: '粘贴验证链接后点击开始',
        resultProcessing: '处理中...',
        stepWarmup: '文档生成中...',
        stepVerify: '提交文档中...',
        stepWaiting: '等待验证...',
        // Backend messageKey translations
        msgLinkFailed: '该链接已失败，请刷新页面获取新链接',
        msgAlreadyVerified: '该链接已验证成功，无需重复提交',
        msgLinkRejected: '该链接已被拒绝，请刷新页面获取新链接',
        msgWarmupTimeout: '文档生成超时，请重试',
        msgWarmupFailed: '文档生成失败',
        msgVerifyTimeout: '验证超时，请重试',
        msgVerifyFailedRefresh: '验证失败，请刷新页面获取新链接',
        msgFraudDetected: '检测到欺诈行为，请刷新页面获取新链接',
        msgCrashed: '程序崩溃，请重试',
        msgVerifyFailedDetail: '验证失败',
        msgRequestFailed: '请求失败',

        // Verify - live status
        liveStatusTitle: '📊 实时验证状态',

        // Verify - tips
        tip1pre: '在 ',
        tip1link: 'one.google.com/ai-student',
        tip1post: ' 的蓝色按钮上',
        tip1bold: '右键复制链接',
        tip1end: '，不要点进去！建议用无痕窗口登录账户获取。',
        tip2: '如果验证链接中 verificationId= 后面是空的，建议直接换号。',
        tip3: '一次消耗一个配额，成功后自动扣除。',

        // Format time
        justNow: '刚刚',
        minutesAgo: '分钟前',
        hoursAgo: '小时前',

        // Verify results messages
        msgApproved: '✅ 验证通过！',
        msgRejected: '❌ 验证被拒绝',
        msgError: '❌ 验证出错',
        msgNoCredits: '⚠️ CDK 配额不足',
        msgApiSuccess: '✅ 验证通过',
        msgApiFail: '❌ ',

        // Admin - page
        adminTitle: '⚙️ 管理后台',
        adminDesc: '管理用户、配置系统和查看统计数据',

        // Admin - tabs
        tabOverview: '概览',
        tabCdk: 'CDK 管理',
        tabUsers: '用户管理',
        tabAiGen: 'AI 文档生成',
        tabVerifyStatus: '验证状态',
        tabTgBot: 'Telegram Bot',
        tabSettings: '系统设置',

        // Admin - overview stats
        statTotalSuccess: '总验证成功',
        stat1hRate: '1小时成功率',
        stat5hRate: '5小时成功率',
        statApiUsage: 'API 消耗',
        statLocalUsage: '本地消耗',

        // Admin - verify log
        logTotal: '共',
        logEntries: '条',
        logSuccess: '成功',
        logFailed: '失败',
        logNoRecords: '暂无验证记录',

        // Admin - telegram bot sections
        tgStats: '📊 统计',
        tgVerifyLog: '📋 验证日志',
        tgConfig: '⚙️ 配置',
        tgServices: '📋 服务',
        tgUsers: '👥 用户',
        tgOrders: '💰 订单',
        tgNoBotLog: '暂无 Bot 验证记录',

        // Admin common
        loading: '⏳ 加载中...',
        save: '保存',
        saving: '保存中...',
        refresh: '🔄',
    },
    en: {
        // Layout
        switchThemeLight: 'Switch to Light Mode',
        switchThemeDark: 'Switch to Dark Mode',
        adminPanel: 'Admin Panel',
        logout: 'Log Out',
        footerRights: '© 2026 OnePASS. All rights reserved.',
        terms: 'Terms of Use',
        privacy: 'Privacy Policy',
        contact: 'Contact Us',

        // Verify - header
        welcomeDesc: 'Tip: No login needed. Start verifying with links directly. Supports concurrent processing.',
        programOnline: 'Online',
        programOffline: 'Offline',
        browserModeLabel: '🌐 Browser Mode',
        apiModeLabel: '⚡ API Mode',
        lastSuccess: 'Last success',
        none: 'None',

        // Verify - status badges
        statusReady: 'Ready',
        statusProcessing: 'Processing',
        statusComplete: 'Complete',

        // Verify - input panel
        inputVerifyLinks: 'Enter Verification Links',
        inputVerifyIds: 'Enter Verification IDs',
        textareaPlaceholderTelegram: `Paste verification links, one per line...

Example:
https://services.sheerid.com/verify/67c8c14f5f17a83b745e3f82/?verificationId=699528d723c407520aeadc45

⚠️ Note: Right-click to copy the link, don't click it!`,
        textareaPlaceholderApi: `Paste verification IDs or links, one per line...

Example:
699528d723c407520aeadc45
https://services.sheerid.com/verify/...?verificationId=699528d723c407520aeadc45`,

        // Verify - CDK
        cdkRemaining: 'CDK Remaining',
        change: 'Change',
        buy: 'Buy',
        buyCdk: 'Buy CDK',
        verifying: 'Verifying...',
        invalidCdk: '❌ Invalid',
        linksCount: ' link(s)',
        idsCount: ' ID(s)',
        remainingQuota: 'Remaining',
        quotaTimes: '',
        notActivated: 'Not activated',

        // Verify - actions
        processing: 'Processing...',
        startVerify: '🚀 Start Verify',

        // Verify - results
        results: 'Results',
        clear: '🗑️ Clear',
        export: '📤 Export',
        noResults: 'No results yet',
        noResultsHint: 'Paste verification links and click Start',
        resultProcessing: 'Processing...',
        stepWarmup: 'Generating document...',
        stepVerify: 'Submitting document...',
        stepWaiting: 'Waiting for verification...',
        // Backend messageKey translations
        msgLinkFailed: 'Link already failed, please refresh for a new link',
        msgAlreadyVerified: 'Link already verified, no need to resubmit',
        msgLinkRejected: 'Link already rejected, please refresh for a new link',
        msgWarmupTimeout: 'Document generation timed out, please retry',
        msgWarmupFailed: 'Document generation failed',
        msgVerifyTimeout: 'Verification timed out, please retry',
        msgVerifyFailedRefresh: 'Verification failed, please refresh for a new link',
        msgFraudDetected: 'Fraud detected, please refresh for a new link',
        msgCrashed: 'Program crashed, please retry',
        msgVerifyFailedDetail: 'Verification failed',
        msgRequestFailed: 'Request failed',

        // Verify - live status
        liveStatusTitle: '📊 Live Verification Status',

        // Verify - tips
        tip1pre: 'Right-click the blue button on ',
        tip1link: 'one.google.com/ai-student',
        tip1post: ' to ',
        tip1bold: 'copy the link',
        tip1end: ", don't click it! Use incognito to get the link.",
        tip2: 'If verificationId= is empty in the link, try a different account.',
        tip3: 'Each verification uses 1 quota, deducted after success.',

        // Format time
        justNow: 'Just now',
        minutesAgo: 'm ago',
        hoursAgo: 'h ago',

        // Verify results messages
        msgApproved: '✅ Approved!',
        msgRejected: '❌ Rejected',
        msgError: '❌ Error',
        msgNoCredits: '⚠️ Insufficient CDK credits',
        msgApiSuccess: '✅ Approved',
        msgApiFail: '❌ ',

        // Admin - page
        adminTitle: '⚙️ Admin Dashboard',
        adminDesc: 'Manage users, configure system, and view analytics',

        // Admin - tabs
        tabOverview: 'Overview',
        tabCdk: 'CDK Management',
        tabUsers: 'User Management',
        tabAiGen: 'AI Doc Generator',
        tabVerifyStatus: 'Verify Status',
        tabTgBot: 'Telegram Bot',
        tabSettings: 'Settings',

        // Admin - overview stats
        statTotalSuccess: 'Total Verified',
        stat1hRate: '1h Success Rate',
        stat5hRate: '5h Success Rate',
        statApiUsage: 'API Usage',
        statLocalUsage: 'Local Usage',

        // Admin - verify log
        logTotal: 'Total',
        logEntries: 'entries',
        logSuccess: 'Success',
        logFailed: 'Failed',
        logNoRecords: 'No verification records',

        // Admin - telegram bot sections
        tgStats: '📊 Stats',
        tgVerifyLog: '📋 Verify Log',
        tgConfig: '⚙️ Config',
        tgServices: '📋 Services',
        tgUsers: '👥 Users',
        tgOrders: '💰 Orders',
        tgNoBotLog: 'No bot verification records',

        // Admin common
        loading: '⏳ Loading...',
        save: 'Save',
        saving: 'Saving...',
        refresh: '🔄',
    }
};

export function LanguageProvider({ children }) {
    const [lang, setLang] = useState(() => {
        return localStorage.getItem('verifykey-lang') || 'zh';
    });

    const toggleLang = () => {
        setLang(prev => {
            const next = prev === 'zh' ? 'en' : 'zh';
            localStorage.setItem('verifykey-lang', next);
            return next;
        });
    };

    const t = (key) => translations[lang]?.[key] || translations['zh'][key] || key;

    return (
        <LanguageContext.Provider value={{ lang, toggleLang, t }}>
            {children}
        </LanguageContext.Provider>
    );
}

export const useLang = () => useContext(LanguageContext);
