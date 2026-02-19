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

⚠️ 注意：右键复制链接，不要点击打开！`,
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
