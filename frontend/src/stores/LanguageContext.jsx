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
        welcomeTitle: '自助AI服务平台',
        welcomeDesc: '根据提示提交 Google 账号信息，获取服务',
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
        statusSubmitting: '提交中...',

        // Verify - service tabs
        geminiVerify: 'Gemini 验证',
        gptRecharge: 'ChatGPT 充值',
        maintenance: '🔧 维护中',

        // Verify - guide section
        guideToggle: '使用教程 & 积分规则',
        creditsRulesTitle: '积分规则 & 邀请奖励',
        geminiStandard: 'Gemini 普通认证',
        geminiPro: 'Gemini 高级认证',
        gptMonthly: 'ChatGPT 月度充值',
        gptTeamInviteRule: 'ChatGPT Team 邀请',
        inviteReward: '邀请奖励',
        inviteRewardVal: '+0.2 积分 / 人',
        inviteNote: '⚠️ 被邀请用户注册后需首次兑换卡密，邀请人才能获得奖励积分',
        creditsUniversal: '✨ 所有服务积分通用，可通过 CDK 兑换或邀请获取',
        geminiServiceTitle: 'Gemini 验证服务',
        geminiServiceDesc: '此服务为通过 Pixel 获取 <strong>Gemini Advanced 1 年 Pro 订阅</strong>，由 OnePASS 全自动完成。',
        guide2faTitle: '2FA 验证：',
        guide2faDesc: '必须开启，并设置好 Google Authenticator',
        guide2faTutorial: '查看教程 ▸',
        guideRegion: '地区要求：',
        guideRegionDesc: '需在支持区域内',
        guideRegionBtn: '查看支持地区 ▸',
        guideRegionTitle: '🌍 支持的国家和地区',
        guideRegionCount: '共 33 个',
        guideFamily: '家庭组：',
        guideFamilyDesc: '必须退出，确保无订阅过',
        guideAccount: '账号建议：',
        guideAccountDesc: '只能Gmail，建议使用老号，新号极其容易封控，导致账号无法登录',
        guideBindCard: '绑卡注意：',
        guideBindCardDesc: '绑卡时浏览器只能登录你要升级的账号，请先退出其他 Google 账号',
        tierNormal: '普通',
        tierPro: '高级',
        tierNormalDesc: '认证完成后需 <strong>自行绑卡</strong>，如无信用卡可往商城购买',
        tierProDesc: '一条龙服务，认证完成后 <strong>自动绑卡</strong>',
        gptServiceTitle: 'ChatGPT 充值服务',
        gptServiceDesc: '应用户需求，现推出 <strong>ChatGPT Plus 月度自动充值</strong>服务，产品无质保。',
        gptGuide1: '获取Session的前提是浏览器已经登陆ChatGPT',
        gptGuide2: '新号 / 老号均可充值',
        gptGuide3: '提前续费，时间会直接覆盖并非延续',

        // Verify - input panel
        inputVerifyLinks: '输入验证链接',
        inputVerifyIds: '输入验证 ID',
        panelTitlePro: '高级提交-自动完成绑卡',
        panelTitleStandard: '普通提交-验证完成之后需自行绑卡',
        tierStandardTab: '📦 普通验证',
        tierProTab: '⚡ 高级验证',
        singleSubmit: '单个提交',
        batchSubmit: '批量提交',
        emailLabel: '账号邮箱',
        passwordLabel: '账号密码',
        totpLabel: '2FA 密钥',
        batchPlaceholder: '邮箱----密码----辅助邮箱----2FA密钥\n或：邮箱----密码----2FA密钥\n\n示例：\ntest@gmail.com----password----backup@mail.com----JBSWY3DPEHPK3PXP\ntest@gmail.com----password----JBSWY3DPEHPK3PXP',
        batchRecognized: '已识别',
        accountUnit: '个账号',
        remaining: '剩余:',
        credits: '积分',
        notLoggedIn: '未登录',
        submitting: '提交中...',
        submitVerify: '🚀 提交验证',

        // Verify - alert messages
        alertLoginFirst: '请先登录后再提交验证',
        alertInsufficientCredits: '账户积分不足（需要 {cost} 积分，当前 {current}）',
        alertFillAll: '请填写所有字段',
        alertInvalidFormat: '请输入有效的账号信息，格式：邮箱----密码----2FA密钥',

        textareaPlaceholderTelegram: `粘贴验证链接，每行一个...
例如：
https://services.sheerid.com/verify/67c8c14f5f17a83b745e3f82/?verificationId=699528d723c407520aeadc45

注意：右键复制链接，不要点击打开！
链接验证失败后等待几秒钟刷新页面即可得到新链接。
如果失败之后链接没有重置，可手动到 https://onepass.fun/pass 重置。

验证失败不消耗额度`,
        textareaPlaceholderApi: `粘贴验证 ID 或链接，每行一个...
例如：
699528d723c407520aeadc45
https://services.sheerid.com/verify/...?verificationId=699528d723c407520aeadc45

注意：右键复制链接，不要点击打开！
链接验证失败后等待几秒钟刷新页面即可得到新链接。
如果失败之后链接没有重置，可手动到 https://onepass.fun/pass 重置。

验证失败不消耗额度`,

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
        historyTitle: '历史记录',
        verifyResults: '验证结果',
        historyBtn: '📜 历史',
        backBtn: '← 返回',
        clearBtn: '清除',
        noHistory: '暂无历史记录',
        noHistoryHint: '提交完成后的结果会自动保存在这里',
        noResultsMsg: '暂无结果',
        noResultsHintAlt: '提交账号信息后，结果将显示在这里',
        copyLink: '复制链接',
        verifySuccess: '验证成功',
        verifyFailed: '验证失败',

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
        stepFailed: '验证失败，链接刷新中...',
        stepBypass: '链接刷新中...',
        msgBypassDone: '{reason}，链接已刷新，请重新获取新链接',
        msgBypassStarted: '{reason}，链接正在刷新中...',
        msgBypassFailed: '{reason}，请等待几分钟后刷新页面获取新链接',
        reasonFraud: '检测到欺诈',
        reasonDocRejected: '文档被拒绝',
        reasonFailed: '验证失败',

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
        defaultTip1: '📡 提交 Google 账号信息（邮箱、密码、2FA密钥），系统将自动登录并获取 Google One 合作伙伴链接。',
        defaultTip2: '⚠️ 2FA 密钥必须是 Base32 编码的原始密钥（不是 6 位数字验证码）。',
        defaultTip3: '💰 一次消耗一个 CDK 配额，仅在任务成功后扣除。',

        // Format time
        justNow: '刚刚',
        minutesAgo: '分钟前',
        hoursAgo: '小时前',

        // Verify results messages
        msgApproved: '✅ 验证通过！',
        msgRejected: '❌ 验证被拒绝',
        msgError: '❌ 验证出错',
        msgNoCredits: '⚠️ CDK 配额不足',
        msgTimeout: '⏱️ 验证超时，请等待几分钟后刷新链接重试',
        msgApiSuccess: '✅ 验证通过',
        msgApiFail: '❌ ',

        // Verify - polling messages
        submitted: '⏳ 已提交，排队中...',
        queueing: '⏳ 排队中...',
        running: '运行中',
        queuePosition: '排队中',
        fetchSuccess: '✅ 获取成功',
        subscribeSuccess: '✅ 订阅成功',
        processingMsg: '处理中...',
        queueWaiting: '⏳ 排队中 (位置: {pos})',

        // Verify - error descriptions
        errInternalError: '系统内部错误',
        errDeviceUnavailable: '设备不可用',
        errDevicePrepFailed: '设备准备失败',
        errDeviceError: '设备异常',
        errProxyError: '代理连接错误',
        errPasskeyBlocked: '账号要求 Passkey 验证',
        errCaptcha: '遇到人机验证',
        errAccountDisabled: '账号已被停用/锁定',
        errInvalidEmail: '邮箱地址无效',
        errWrongPassword: '密码错误',
        errTotpError: '2FA 密钥错误',
        errNoAuthenticator: '账号未启用 TOTP 验证器',
        errSigninPageFailed: '登录页面加载失败',
        errTwofactorPageError: '两步验证页面异常',
        errGoogleLoginError: 'Google 登录异常',
        errGoogleOneUnavailable: '该账号不可使用 Google One',
        errOfferUnavailable: 'Google One 优惠不可用',
        errAlreadySubscribed: '该账号已有订阅',
        errCardFailed: '信用卡被拒',
        errLoginFailed: '登录失败',
        errNetworkError: '网络连接失败',
        errUrlCaptureFailed: '链接获取失败',
        errSigninFailed: '登录失败',
        errAccountNotDetected: '未检测到账号',
        errBrowserLoginFailed: '浏览器登录失败',
        errUnknownError: '未知错误',
        errServiceUnavailable: '服务暂时不可用，请稍后重试',
        errGenericFailed: '操作失败，请稍后重试',

        // GPT recharge
        gptPanelTitle: 'ChatGPT Plus 月度充值',
        gptCostBadge: '⚡ 1.5 积分 / 次',
        gptModePlus: '🤖 Plus 充值',
        gptModeTeam: '👥 Team 邀请',
        gptTeamPanelTitle: 'ChatGPT Team 邀请',
        gptTeamCostBadge: '⚡ 0.3 积分 / 次',
        gptPasteSession: '粘贴 ChatGPT Session',
        gptGetSession: '🔗 获取 Session',
        gptHelp1: '在浏览器登录 ChatGPT',
        gptHelp2: '点击上方「获取 Session」按钮',
        gptHelp3: '复制内容粘贴到下方',
        gptParseError: '无法识别账号，请确保粘贴了完整的 Session JSON',
        gptAccountLinked: '已绑定 ChatGPT 账号',
        gptChangeAccount: '更换',
        gptStartRecharge: '⚡ 开始充值',
        gptRecharging: '正在充值，请稍候...',
        gptInsufficientCredits: '积分不足，需要 1.5 积分，当前剩余 {credits} 积分',
        gptCardExchangeFailed: '卡密兑换失败',
        gptRechargeFailed: '充值失败，请稍后重试',
        gptRechargeSuccess: '充值成功！',
        gptRechargeHistoryTitle: '充值历史',
        gptRechargeResultTitle: '充值结果',
        gptNoHistory: '暂无充值记录',
        gptNoHistoryHint: '充值完成后的结果会显示在这里',
        gptSuccessTitle: '充值成功！',
        gptSuccessDesc: '账号 <strong>{email}</strong> 已成功充值 ChatGPT Plus',
        gptContinue: '继续充值',
        gptResultHint: '📡 粘贴 ChatGPT Session 信息后点击充值按钮',
        gptResultNote: '⚠️ 请确保 ChatGPT 已登录，充值成功后扣除 1.5 积分',
        gptRechargingMsg: '充值进行中，请稍候...',
        gptTeamInviteEmail: '输入被邀请邮箱',
        gptTeamInvitePlaceholder: 'member@example.com',
        gptTeamInviteNote: '系统会自动选择有空位的 Team 发送邀请，邀请创建成功后扣除 0.3 积分。',
        gptTeamStartInvite: '✉️ 发送 Team 邀请',
        gptTeamInviting: '正在发送邀请，请稍候...',
        gptTeamInvitingMsg: '正在创建 Team 邀请，请稍候...',
        gptTeamInsufficientCredits: '积分不足，需要 0.3 积分，当前剩余 {credits} 积分',
        gptTeamInviteFailed: 'Team 邀请失败，请稍后重试',
        gptTeamInviteSuccess: 'Team 邀请发送成功！',
        gptTeamResultHint: '📨 输入被邀请邮箱后点击发送按钮',
        gptTeamResultNote: '⚠️ 邀请成功创建后扣除 0.3 积分，邮件投递可能有延迟',
        gptTeamSuccessTitle: 'Team 邀请成功！',
        gptTeamSuccessDesc: '邮箱 <strong>{email}</strong> 已成功加入待邀请列表',
        rechargeSuccess: '充值成功',
        rechargeFailed: '充值失败',

        // CDK Redeem
        redeemCredits: '兑换积分',
        purchaseCredits: '购买积分',
        cdkRedeemTitle: '兑换积分',
        cdkRedeemSubtitle: '输入 CDK 卡密，积分将充入您的账户',
        cdkRedeem: '兑换',
        cdkRedeemHint: '从 <a>haodongxi.shop</a> 购买 CDK 卡密后在此兑换',
        cdkLoginFirst: '请先登录后再兑换积分',
        cdkRedeemFailed: '兑换失败',
        cdkNetworkError: '网络错误，请稍后重试',

        // Verify - region list (Chinese)
        regionAustralia: '🇦🇺 澳洲', regionAustria: '🇦🇹 奥地利', regionBelgium: '🇧🇪 比利时',
        regionCanada: '🇨🇦 加拿大', regionCzechia: '🇨🇿 捷克', regionDenmark: '🇩🇰 丹麦',
        regionEstonia: '🇪🇪 爱沙尼亚', regionFinland: '🇫🇮 芬兰', regionFrance: '🇫🇷 法国',
        regionGermany: '🇩🇪 德国', regionHungary: '🇭🇺 匈牙利', regionIndia: '🇮🇳 印度',
        regionIreland: '🇮🇪 爱尔兰', regionItaly: '🇮🇹 意大利', regionJapan: '🇯🇵 日本',
        regionLatvia: '🇱🇻 拉脱维亚', regionLithuania: '🇱🇹 立陶宛', regionMalaysia: '🇲🇾 马来西亚',
        regionMexico: '🇲🇽 墨西哥', regionNetherlands: '🇳🇱 荷兰', regionNorway: '🇳🇴 挪威',
        regionPoland: '🇵🇱 波兰', regionPortugal: '🇵🇹 葡萄牙', regionRomania: '🇷🇴 罗马尼亚',
        regionSingapore: '🇸🇬 新加坡', regionSlovakia: '🇸🇰 斯洛伐克', regionSlovenia: '🇸🇮 斯洛维尼亚',
        regionSpain: '🇪🇸 西班牙', regionSweden: '🇸🇪 瑞典', regionSwitzerland: '🇨🇭 瑞士',
        regionTaiwan: '🇹🇼 台湾', regionUK: '🇬🇧 英国', regionUS: '🇺🇸 美国',

        // Admin - page
        adminTitle: '⚙️ 管理后台',
        adminDesc: '管理用户、配置系统和查看统计数据',

        // Admin - tabs
        tabOverview: '概览',
        tabCdk: 'CDK 管理',
        tabUsers: '用户管理',
        tabAiGen: 'AI 文档生成',
        tabVerifyStatus: '验证状态',
        tabTgBot: '验证 Bot',
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
        welcomeTitle: 'Self-Service AI Platform',
        welcomeDesc: 'Submit Google account info as prompted to get started',
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
        statusSubmitting: 'Submitting...',

        // Verify - service tabs
        geminiVerify: 'Gemini Verify',
        gptRecharge: 'ChatGPT Recharge',
        maintenance: '🔧 Maintenance',

        // Verify - guide section
        guideToggle: 'Tutorial & Credit Rules',
        creditsRulesTitle: 'Credit Rules & Referral Rewards',
        geminiStandard: 'Gemini Standard',
        geminiPro: 'Gemini Pro',
        gptMonthly: 'ChatGPT Monthly Recharge',
        gptTeamInviteRule: 'ChatGPT Team Invite',
        inviteReward: 'Referral Reward',
        inviteRewardVal: '+0.2 credits / person',
        inviteNote: '⚠️ Invited users must redeem a CDK after registration for the referrer to receive the reward',
        creditsUniversal: '✨ Credits are universal across all services. Get them via CDK or referrals',
        geminiServiceTitle: 'Gemini Verification Service',
        geminiServiceDesc: 'This service obtains a <strong>1-year Gemini Advanced Pro subscription</strong> via Pixel, fully automated by OnePASS.',
        guide2faTitle: '2FA Required:',
        guide2faDesc: 'Must be enabled with Google Authenticator set up',
        guide2faTutorial: 'View Tutorial ▸',
        guideRegion: 'Region Requirement:',
        guideRegionDesc: 'Must be in a supported region',
        guideRegionBtn: 'View Supported Regions ▸',
        guideRegionTitle: '🌍 Supported Countries & Regions',
        guideRegionCount: '33 total',
        guideFamily: 'Family Group:',
        guideFamilyDesc: 'Must leave family group, ensure no prior subscription',
        guideAccount: 'Account Tip:',
        guideAccountDesc: 'Use an aged account. New accounts are easily flagged and may get locked',
        guideBindCard: 'Card Binding Note:',
        guideBindCardDesc: 'Only log in with the account you want to upgrade. Sign out of other Google accounts first',
        tierNormal: 'Standard',
        tierPro: 'Pro',
        tierNormalDesc: 'After verification, you need to <strong>bind a card yourself</strong>. Buy one from the store if needed',
        tierProDesc: 'Full service — <strong>auto card binding</strong> after verification',
        gptServiceTitle: 'ChatGPT Recharge Service',
        gptServiceDesc: 'By popular demand, we now offer <strong>ChatGPT Plus monthly auto-recharge</strong>. No warranty.',
        gptGuide1: 'You must be logged in to ChatGPT in your browser to get the Session',
        gptGuide2: 'Works for both new and old accounts',
        gptGuide3: 'Early renewal will overwrite (not extend) the current period',

        // Verify - input panel
        inputVerifyLinks: 'Enter Verification Links',
        inputVerifyIds: 'Enter Verification IDs',
        panelTitlePro: 'Pro Submit — Auto Card Binding',
        panelTitleStandard: 'Standard Submit — Manual Card Binding After Verification',
        tierStandardTab: '📦 Standard',
        tierProTab: '⚡ Pro',
        singleSubmit: 'Single',
        batchSubmit: 'Batch',
        emailLabel: 'Email',
        passwordLabel: 'Password',
        totpLabel: '2FA Secret Key',
        batchPlaceholder: 'email----password----backup_email----2FA_secret\nor: email----password----2FA_secret\n\nExample:\ntest@gmail.com----password----backup@mail.com----JBSWY3DPEHPK3PXP\ntest@gmail.com----password----JBSWY3DPEHPK3PXP',
        batchRecognized: 'Recognized',
        accountUnit: 'account(s)',
        remaining: 'Remaining:',
        credits: 'credits',
        notLoggedIn: 'Not logged in',
        submitting: 'Submitting...',
        submitVerify: '🚀 Submit',

        // Verify - alert messages
        alertLoginFirst: 'Please log in before submitting verification',
        alertInsufficientCredits: 'Insufficient credits (need {cost}, current {current})',
        alertFillAll: 'Please fill in all fields',
        alertInvalidFormat: 'Please enter valid account info. Format: email----password----2FA_secret',

        textareaPlaceholderTelegram: `Paste verification links, one per line...

Example:
https://services.sheerid.com/verify/67c8c14f5f17a83b745e3f82/?verificationId=699528d723c407520aeadc45

⚠️ Note: Right-click to copy the link, don't click it!`,
        textareaPlaceholderApi: `Paste verification IDs or links, one per line...
Example:
699528d723c407520aeadc45
https://services.sheerid.com/verify/...?verificationId=699528d723c407520aeadc45

After a link verification fails, wait a few seconds and refresh the page to get a new link.
If the link is not reset after a failure, you can manually reset it at https://onepass.fun/pass.

Failed verification does not consume quota.`,

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
        historyTitle: 'History',
        verifyResults: 'Verification Results',
        historyBtn: '📜 History',
        backBtn: '← Back',
        clearBtn: 'Clear',
        noHistory: 'No history yet',
        noHistoryHint: 'Completed results will be automatically saved here',
        noResultsMsg: 'No results yet',
        noResultsHintAlt: 'Results will appear here after submission',
        copyLink: 'Copy link',
        verifySuccess: 'Verification passed',
        verifyFailed: 'Verification failed',

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
        stepFailed: 'Verification failed, refreshing link...',
        stepBypass: 'Refreshing link...',
        msgBypassDone: '{reason}, link refreshed, please get a new link',
        msgBypassStarted: '{reason}, link is being refreshed...',
        msgBypassFailed: '{reason}, please wait a few minutes then refresh for a new link',
        reasonFraud: 'Fraud detected',
        reasonDocRejected: 'Document rejected',
        reasonFailed: 'Verification failed',

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
        defaultTip1: '📡 Submit Google account info (email, password, 2FA secret). The system will auto-login and obtain the Google One partner link.',
        defaultTip2: '⚠️ The 2FA secret must be the raw Base32 key (not the 6-digit code).',
        defaultTip3: '💰 Each task consumes 1 CDK quota, deducted only on success.',

        // Format time
        justNow: 'Just now',
        minutesAgo: 'm ago',
        hoursAgo: 'h ago',

        // Verify results messages
        msgApproved: '✅ Approved!',
        msgRejected: '❌ Rejected',
        msgError: '❌ Error',
        msgNoCredits: '⚠️ Insufficient CDK credits',
        msgTimeout: '⏱️ Verification timed out. Please wait a few minutes and try again with a refreshed link',
        msgApiSuccess: '✅ Approved',
        msgApiFail: '❌ ',

        // Verify - polling messages
        submitted: '⏳ Submitted, queuing...',
        queueing: '⏳ Queuing...',
        running: 'Running',
        queuePosition: 'In queue',
        fetchSuccess: '✅ Success',
        subscribeSuccess: '✅ Subscribed',
        processingMsg: 'Processing...',
        queueWaiting: '⏳ In queue (position: {pos})',

        // Verify - error descriptions
        errInternalError: 'Internal system error',
        errDeviceUnavailable: 'Device unavailable',
        errDevicePrepFailed: 'Device preparation failed',
        errDeviceError: 'Device error',
        errProxyError: 'Proxy connection error',
        errPasskeyBlocked: 'Account requires Passkey verification',
        errCaptcha: 'CAPTCHA encountered',
        errAccountDisabled: 'Account disabled/locked',
        errInvalidEmail: 'Invalid email address',
        errWrongPassword: 'Wrong password',
        errTotpError: '2FA secret key error',
        errNoAuthenticator: 'TOTP authenticator not enabled',
        errSigninPageFailed: 'Sign-in page failed to load',
        errTwofactorPageError: '2FA page error',
        errGoogleLoginError: 'Google login error',
        errGoogleOneUnavailable: 'Google One unavailable for this account',
        errOfferUnavailable: 'Google One offer unavailable',
        errAlreadySubscribed: 'Account already has a subscription',
        errCardFailed: 'Credit card declined',
        errLoginFailed: 'Login failed',
        errNetworkError: 'Network connection failed',
        errUrlCaptureFailed: 'URL capture failed',
        errSigninFailed: 'Sign-in failed',
        errAccountNotDetected: 'Account not detected',
        errBrowserLoginFailed: 'Browser login failed',
        errUnknownError: 'Unknown error',
        errServiceUnavailable: 'Service temporarily unavailable, please try again later',
        errGenericFailed: 'Operation failed, please try again later',

        // GPT recharge
        gptPanelTitle: 'ChatGPT Plus Monthly Recharge',
        gptCostBadge: '⚡ 1.5 credits / time',
        gptModePlus: '🤖 Plus Recharge',
        gptModeTeam: '👥 Team Invite',
        gptTeamPanelTitle: 'ChatGPT Team Invite',
        gptTeamCostBadge: '⚡ 0.3 credits / time',
        gptPasteSession: 'Paste ChatGPT Session',
        gptGetSession: '🔗 Get Session',
        gptHelp1: 'Log in to ChatGPT in your browser',
        gptHelp2: 'Click the "Get Session" button above',
        gptHelp3: 'Copy and paste the content below',
        gptParseError: 'Cannot identify account. Please paste the complete Session JSON',
        gptAccountLinked: 'Linked ChatGPT Account',
        gptChangeAccount: 'Change',
        gptStartRecharge: '⚡ Start Recharge',
        gptRecharging: 'Recharging, please wait...',
        gptInsufficientCredits: 'Insufficient credits. Need 1.5, current balance: {credits}',
        gptCardExchangeFailed: 'Card key exchange failed',
        gptRechargeFailed: 'Recharge failed, please try again later',
        gptRechargeSuccess: 'Recharge successful!',
        gptRechargeHistoryTitle: 'Recharge History',
        gptRechargeResultTitle: 'Recharge Result',
        gptNoHistory: 'No recharge records',
        gptNoHistoryHint: 'Results will appear here after recharge',
        gptSuccessTitle: 'Recharge Successful!',
        gptSuccessDesc: 'Account <strong>{email}</strong> has been recharged with ChatGPT Plus',
        gptContinue: 'Continue Recharging',
        gptResultHint: '📡 Paste ChatGPT Session info then click the recharge button',
        gptResultNote: '⚠️ Make sure you are logged in to ChatGPT. 1.5 credits will be deducted on success',
        gptRechargingMsg: 'Recharge in progress, please wait...',
        gptTeamInviteEmail: 'Invitee Email',
        gptTeamInvitePlaceholder: 'member@example.com',
        gptTeamInviteNote: 'The system will automatically pick a Team with available seats and create an invite. 0.3 credits are deducted after success.',
        gptTeamStartInvite: '✉️ Send Team Invite',
        gptTeamInviting: 'Sending invite, please wait...',
        gptTeamInvitingMsg: 'Creating Team invite, please wait...',
        gptTeamInsufficientCredits: 'Insufficient credits. Need 0.3, current balance: {credits}',
        gptTeamInviteFailed: 'Team invite failed, please try again later',
        gptTeamInviteSuccess: 'Team invite sent successfully!',
        gptTeamResultHint: '📨 Enter the invitee email and click the send button',
        gptTeamResultNote: '⚠️ 0.3 credits are deducted after the invite is created successfully. Email delivery may be delayed',
        gptTeamSuccessTitle: 'Team Invite Successful!',
        gptTeamSuccessDesc: 'Email <strong>{email}</strong> has been added to the pending invite list',
        rechargeSuccess: 'Recharge successful',
        rechargeFailed: 'Recharge failed',

        // CDK Redeem
        redeemCredits: 'Redeem Credits',
        purchaseCredits: 'Buy Credits',
        cdkRedeemTitle: 'Redeem Credits',
        cdkRedeemSubtitle: 'Enter a CDK code to add credits to your account',
        cdkRedeem: 'Redeem',
        cdkRedeemHint: 'Purchase CDK codes from <a>haodongxi.shop</a> and redeem here',
        cdkLoginFirst: 'Please log in before redeeming credits',
        cdkRedeemFailed: 'Redemption failed',
        cdkNetworkError: 'Network error, please try again later',

        // Verify - region list (English)
        regionAustralia: '🇦🇺 Australia', regionAustria: '🇦🇹 Austria', regionBelgium: '🇧🇪 Belgium',
        regionCanada: '🇨🇦 Canada', regionCzechia: '🇨🇿 Czechia', regionDenmark: '🇩🇰 Denmark',
        regionEstonia: '🇪🇪 Estonia', regionFinland: '🇫🇮 Finland', regionFrance: '🇫🇷 France',
        regionGermany: '🇩🇪 Germany', regionHungary: '🇭🇺 Hungary', regionIndia: '🇮🇳 India',
        regionIreland: '🇮🇪 Ireland', regionItaly: '🇮🇹 Italy', regionJapan: '🇯🇵 Japan',
        regionLatvia: '🇱🇻 Latvia', regionLithuania: '🇱🇹 Lithuania', regionMalaysia: '🇲🇾 Malaysia',
        regionMexico: '🇲🇽 Mexico', regionNetherlands: '🇳🇱 Netherlands', regionNorway: '🇳🇴 Norway',
        regionPoland: '🇵🇱 Poland', regionPortugal: '🇵🇹 Portugal', regionRomania: '🇷🇴 Romania',
        regionSingapore: '🇸🇬 Singapore', regionSlovakia: '🇸🇰 Slovakia', regionSlovenia: '🇸🇮 Slovenia',
        regionSpain: '🇪🇸 Spain', regionSweden: '🇸🇪 Sweden', regionSwitzerland: '🇨🇭 Switzerland',
        regionTaiwan: '🇹🇼 Taiwan', regionUK: '🇬🇧 United Kingdom', regionUS: '🇺🇸 United States',

        // Admin - page
        adminTitle: '⚙️ Admin Dashboard',
        adminDesc: 'Manage users, configure system, and view analytics',

        // Admin - tabs
        tabOverview: 'Overview',
        tabCdk: 'CDK Management',
        tabUsers: 'User Management',
        tabAiGen: 'AI Doc Generator',
        tabVerifyStatus: 'Verify Status',
        tabTgBot: 'Verify Bot',
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
