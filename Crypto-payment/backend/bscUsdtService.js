// USDT-BEP20 支付服务 - 使用免费 BSC RPC 余额轮询方式
const prisma = require('../config/database')
const logger = require('../utils/logger')

// 默认配置
const DEFAULT_CONFIG = {
    USDT_CONTRACT: '0x55d398326f99059fF775485246999027B3197955', // USDT-BEP20 合约地址
    BSC_RPC_URLS: [
        'https://bsc-dataseed.binance.org/',
        'https://bsc-dataseed1.binance.org/',
        'https://bsc-dataseed2.binance.org/',
        'https://bsc-dataseed3.binance.org/',
        'https://bsc-dataseed4.binance.org/'
    ],
    POLL_INTERVAL: 30000, // 30秒轮询一次
    AMOUNT_PRECISION: 2 // 金额精度（小数位数）
}

// 上次记录的钱包余额（用于检测余额变化）
let lastKnownBalance = null

// 从数据库获取BSC USDT配置
async function getConfig() {
    try {
        const settings = await prisma.setting.findMany({
            where: {
                key: {
                    in: ['bscUsdtEnabled', 'bscUsdtWalletAddress', 'bscUsdtExchangeRate', 'bscUsdtApiKey']
                }
            }
        })

        const settingsMap = {}
        settings.forEach(s => {
            settingsMap[s.key] = s.value
        })

        return {
            ...DEFAULT_CONFIG,
            WALLET_ADDRESS: settingsMap.bscUsdtWalletAddress || '',
            EXCHANGE_RATE: parseFloat(settingsMap.bscUsdtExchangeRate) || 7,
            ENABLED: settingsMap.bscUsdtEnabled === 'true',
            API_KEY: settingsMap.bscUsdtApiKey || ''
        }
    } catch (error) {
        logger.error('获取BSC USDT配置失败:', error)
        return {
            ...DEFAULT_CONFIG,
            WALLET_ADDRESS: '',
            EXCHANGE_RATE: 7,
            ENABLED: false,
            API_KEY: ''
        }
    }
}

// 通过 BSC RPC 查询 USDT 余额（免费，不需要 API Key）
async function getUsdtBalance(walletAddress) {
    const balanceOfSelector = '0x70a08231' // balanceOf(address) 函数选择器
    const paddedAddress = walletAddress.replace('0x', '').toLowerCase().padStart(64, '0')
    const data = balanceOfSelector + paddedAddress

    // 尝试多个 RPC 节点（容错）
    for (const rpcUrl of DEFAULT_CONFIG.BSC_RPC_URLS) {
        try {
            const response = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'eth_call',
                    params: [{
                        to: DEFAULT_CONFIG.USDT_CONTRACT,
                        data: data
                    }, 'latest'],
                    id: 1
                })
            })

            const result = await response.json()
            if (result.result) {
                // BSC USDT 是 18 位小数
                const balanceWei = BigInt(result.result)
                const balance = Number(balanceWei) / 1e18
                return balance
            }
        } catch (error) {
            // 当前节点失败，尝试下一个
            continue
        }
    }

    throw new Error('所有BSC RPC节点查询余额均失败')
}

// 通过 Etherscan API V2 查询最近的 BEP20 转账（如果有API Key）
async function getRecentTransactionsViaApi(config, limit = 50) {
    if (!config.API_KEY || !config.WALLET_ADDRESS) {
        return null // 返回 null 表示无法使用API方式
    }

    try {
        const url = `https://api.etherscan.io/v2/api?chainid=56&module=account&action=tokentx&contractaddress=${config.USDT_CONTRACT}&address=${config.WALLET_ADDRESS}&page=1&offset=${limit}&sort=desc&apikey=${config.API_KEY}`

        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' }
        })

        if (!response.ok) {
            return null
        }

        const data = await response.json()
        if (data.status === '1' && data.message === 'OK') {
            return data.result || []
        }
        // 如果 API 返回错误（如免费版不支持），返回 null 以回退到余额检测
        if (data.status === '0') {
            logger.info(`Etherscan API V2 不可用: ${data.result}，将使用余额变化检测方式`)
            return null
        }
        return null
    } catch (error) {
        return null
    }
}

// 人民币转USDT
async function cnyToUsdt(cnyAmount) {
    const config = await getConfig()
    return parseFloat((cnyAmount / config.EXCHANGE_RATE).toFixed(config.AMOUNT_PRECISION))
}

// 生成唯一USDT金额（避免金额重复）
async function generateUniqueAmount(baseAmount) {
    const config = await getConfig()

    // 获取所有待支付的 BSC USDT订单金额
    const pendingOrders = await prisma.order.findMany({
        where: {
            status: 'PENDING',
            paymentMethod: 'bsc_usdt'
        },
        select: { bscUsdtAmount: true }
    })

    const usedAmounts = new Set(pendingOrders.map(o => o.bscUsdtAmount?.toString()))

    // 尝试找到一个未使用的金额（在基础金额上加减0.01-0.99）
    for (let i = 0; i < 100; i++) {
        const offset = (i % 2 === 0 ? 1 : -1) * Math.floor(i / 2 + 1) * 0.01
        const uniqueAmount = parseFloat((baseAmount + offset).toFixed(config.AMOUNT_PRECISION))

        if (uniqueAmount > 0 && !usedAmounts.has(uniqueAmount.toString())) {
            return uniqueAmount
        }
    }

    // 如果都被占用，返回基础金额（理论上不会发生）
    return baseAmount
}

// 生成BSC USDT支付信息
async function createBscUsdtPayment(order) {
    const config = await getConfig()

    if (!config.WALLET_ADDRESS) {
        throw new Error('BSC USDT收款地址未配置')
    }

    const baseUsdt = await cnyToUsdt(parseFloat(order.totalAmount))
    const usdtAmount = await generateUniqueAmount(baseUsdt)

    // 更新订单的BSC USDT金额
    await prisma.order.update({
        where: { id: order.id },
        data: {
            bscUsdtAmount: usdtAmount,
            paymentMethod: 'bsc_usdt'
        }
    })

    // 生成支付二维码内容（BEP20转账链接，由于不是所有钱包支持协议，也可以直接传地址）
    const qrContent = `ethereum:${config.WALLET_ADDRESS}?contractAddress=${config.USDT_CONTRACT}&value=${usdtAmount}`

    return {
        walletAddress: config.WALLET_ADDRESS,
        usdtAmount: usdtAmount,
        qrContent: qrContent,
        exchangeRate: config.EXCHANGE_RATE
    }
}

// 检查并处理 BSC USDT支付（余额变化检测 + API 双模式）
async function checkBscUsdtPayments() {
    try {
        const config = await getConfig()

        // 如果未启用或钱包未配置，跳过
        if (!config.ENABLED || !config.WALLET_ADDRESS) {
            return
        }

        // 获取待支付的 BSC USDT订单
        const pendingOrders = await prisma.order.findMany({
            where: {
                status: 'PENDING',
                paymentMethod: 'bsc_usdt',
                bscUsdtAmount: { not: null }
            },
            include: { payment: true }
        })

        if (pendingOrders.length === 0) {
            return // 没有待处理的订单
        }

        // 优先尝试 Etherscan API V2（如果有Key且支持的话）
        const apiTransactions = await getRecentTransactionsViaApi(config)

        if (apiTransactions !== null && apiTransactions.length > 0) {
            // API 模式：精确匹配交易
            await matchTransactionsFromApi(apiTransactions, pendingOrders, config)
            return
        }

        // 回退到余额变化检测模式（免费，不需要任何 API Key）
        await checkBalanceChange(pendingOrders, config)
    } catch (error) {
        logger.error('检查BSC USDT支付失败:', error)
    }
}

// API 模式：通过交易列表精确匹配
async function matchTransactionsFromApi(transactions, pendingOrders, config) {
    for (const tx of transactions) {
        if (tx.to.toLowerCase() !== config.WALLET_ADDRESS.toLowerCase()) continue

        // BSC USDT 是18位小数
        const txAmount = parseFloat(tx.value) / 1e18

        const matchedOrder = pendingOrders.find(order => {
            const orderAmount = parseFloat(order.bscUsdtAmount)
            return Math.abs(txAmount - orderAmount) < 0.001
        })

        if (matchedOrder) {
            const existingPayment = await prisma.payment.findFirst({
                where: { tradeNo: tx.hash }
            })
            if (existingPayment) continue

            logger.info(`BSC USDT支付匹配成功(API模式): 订单 ${matchedOrder.orderNo}, 金额 ${txAmount} USDT, 交易 ${tx.hash}`)
            await processBscUsdtPaymentSuccess(matchedOrder, tx.hash, txAmount)
        }
    }
}

// 余额变化检测模式：通过余额差值匹配订单（支持多笔并发）
async function checkBalanceChange(pendingOrders, config) {
    try {
        const currentBalance = await getUsdtBalance(config.WALLET_ADDRESS)

        if (lastKnownBalance === null) {
            // 首次启动，记录当前余额
            lastKnownBalance = currentBalance
            logger.info(`BSC USDT钱包初始余额: ${currentBalance} USDT`)
            return
        }

        const balanceDiff = currentBalance - lastKnownBalance

        if (balanceDiff <= 0) {
            return // 余额没有增加
        }

        logger.info(`BSC USDT钱包余额变化检测: +${balanceDiff.toFixed(6)} USDT (之前: ${lastKnownBalance}, 现在: ${currentBalance})`)

        // 第一步：尝试单笔精确匹配（最快路径）
        const singleMatch = pendingOrders.find(order => {
            const orderAmount = parseFloat(order.bscUsdtAmount)
            return Math.abs(balanceDiff - orderAmount) < 0.01
        })

        if (singleMatch) {
            const virtualTxId = `bsc_balance_${Date.now()}_${singleMatch.orderNo}`
            logger.info(`BSC USDT支付匹配成功(单笔): 订单 ${singleMatch.orderNo}, 余额增加 ${balanceDiff.toFixed(6)} USDT`)
            await processBscUsdtPaymentSuccess(singleMatch, virtualTxId, parseFloat(singleMatch.bscUsdtAmount))
            lastKnownBalance = currentBalance
            return
        }

        // 第二步：多笔组合匹配（处理同一轮询周期内多笔转账同时到账）
        // 限制最多处理 10 个待处理订单，避免组合爆炸
        const ordersToMatch = pendingOrders.slice(0, 10)
        const matchedCombination = findMatchingCombination(ordersToMatch, balanceDiff)

        if (matchedCombination && matchedCombination.length > 0) {
            logger.info(`BSC USDT多笔支付组合匹配成功: ${matchedCombination.length} 笔订单, 总计 ${balanceDiff.toFixed(6)} USDT`)

            for (const order of matchedCombination) {
                const virtualTxId = `bsc_balance_${Date.now()}_${order.orderNo}`
                logger.info(`  → 处理订单 ${order.orderNo}, 金额 ${order.bscUsdtAmount} USDT`)
                await processBscUsdtPaymentSuccess(order, virtualTxId, parseFloat(order.bscUsdtAmount))
            }
        } else {
            logger.info(`BSC USDT余额增加 ${balanceDiff.toFixed(6)} USDT，但未找到匹配的订单或订单组合`)
        }

        // 更新已知余额
        lastKnownBalance = currentBalance
    } catch (error) {
        logger.error('BSC USDT余额检测失败:', error)
    }
}

// 查找金额组合匹配：在待处理订单中找到一组订单，其金额之和等于目标差值
function findMatchingCombination(orders, targetAmount) {
    const n = orders.length
    if (n === 0) return null

    // 遍历所有子集（位掩码），从小子集开始（优先匹配少的订单）
    // 2^10 = 1024 次循环，性能完全可控
    const totalSubsets = 1 << n

    // 按子集大小从小到大排序搜索（优先匹配最少订单数的组合）
    for (let size = 2; size <= n; size++) {
        for (let mask = 0; mask < totalSubsets; mask++) {
            // 只检查恰好包含 size 个订单的子集
            if (countBits(mask) !== size) continue

            let sum = 0
            const subset = []
            for (let i = 0; i < n; i++) {
                if (mask & (1 << i)) {
                    sum += parseFloat(orders[i].bscUsdtAmount)
                    subset.push(orders[i])
                }
            }

            // 允许 0.01 * 订单数 的误差（每笔订单允许 0.01 误差）
            if (Math.abs(sum - targetAmount) < 0.01 * size) {
                return subset
            }
        }
    }

    return null
}

// 计算二进制中 1 的个数
function countBits(n) {
    let count = 0
    while (n) {
        count += n & 1
        n >>= 1
    }
    return count
}

// 处理 BSC USDT支付成功
async function processBscUsdtPaymentSuccess(order, txHash, usdtAmount) {
    const { dispenseCards } = require('../controllers/cardController')

    // 开启事务
    await prisma.$transaction(async (tx) => {
        // 更新支付记录
        await tx.payment.upsert({
            where: { orderId: order.id },
            create: {
                orderId: order.id,
                paymentMethod: 'bsc_usdt',
                amount: order.totalAmount,
                tradeNo: txHash,
                status: 'SUCCESS'
            },
            update: {
                status: 'SUCCESS',
                tradeNo: txHash
            }
        })

        // 更新订单状态
        await tx.order.update({
            where: { id: order.id },
            data: {
                status: 'PAID',
                paymentNo: txHash,
                paidAt: new Date()
            }
        })
    })

    // 发放卡密
    let cards = []
    try {
        cards = await dispenseCards(order.id, order.productId, order.quantity, order.variantId)

        await prisma.order.update({
            where: { id: order.id },
            data: {
                status: 'COMPLETED',
                completedAt: new Date()
            }
        })

        logger.info(`BSC USDT订单 ${order.orderNo} 卡密发放成功`)
    } catch (error) {
        logger.error(`BSC USDT订单 ${order.orderNo} 卡密发放失败:`, error)
    }

    // 发送邮件通知
    try {
        const emailService = require('./emailService')
        const fullOrder = await prisma.order.findUnique({
            where: { id: order.id },
            include: { product: true, cards: true }
        })
        await emailService.sendOrderCompletedEmail(fullOrder, fullOrder.cards)
        logger.info(`BSC USDT订单 ${order.orderNo} 邮件通知已发送`)

        // 通知管理员
        const { notifyOrderPaid } = require('./adminNotifyService')
        notifyOrderPaid(fullOrder).catch(e => logger.error('管理员通知失败:', e))
    } catch (error) {
        logger.error(`BSC USDT订单 ${order.orderNo} 邮件发送失败:`, error)
    }
}

// 启动轮询
let pollingInterval = null

function startPolling() {
    if (pollingInterval) return

    logger.info('BSC USDT支付监控已启动')
    pollingInterval = setInterval(checkBscUsdtPayments, DEFAULT_CONFIG.POLL_INTERVAL)

    // 立即执行一次
    checkBscUsdtPayments()
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval)
        pollingInterval = null
        logger.info('BSC USDT支付监控已停止')
    }
}

module.exports = {
    getConfig,
    cnyToUsdt,
    createBscUsdtPayment,
    checkBscUsdtPayments,
    startPolling,
    stopPolling
}
