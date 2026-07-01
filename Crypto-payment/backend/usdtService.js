// USDT-TRC20 支付服务
const prisma = require('../config/database')
const logger = require('../utils/logger')

// 默认配置
const DEFAULT_CONFIG = {
    USDT_CONTRACT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT-TRC20 合约地址
    TRONGRID_API: 'https://api.trongrid.io',
    POLL_INTERVAL: 30000, // 30秒轮询一次
    AMOUNT_PRECISION: 2 // 金额精度（小数位数）
}

// 从数据库获取USDT配置
async function getConfig() {
    try {
        const settings = await prisma.setting.findMany({
            where: {
                key: {
                    in: ['usdtEnabled', 'usdtWalletAddress', 'usdtExchangeRate']
                }
            }
        })

        const settingsMap = {}
        settings.forEach(s => {
            settingsMap[s.key] = s.value
        })

        return {
            ...DEFAULT_CONFIG,
            WALLET_ADDRESS: settingsMap.usdtWalletAddress || '',
            EXCHANGE_RATE: parseFloat(settingsMap.usdtExchangeRate) || 7,
            ENABLED: settingsMap.usdtEnabled === 'true'
        }
    } catch (error) {
        logger.error('获取USDT配置失败:', error)
        return {
            ...DEFAULT_CONFIG,
            WALLET_ADDRESS: '',
            EXCHANGE_RATE: 7,
            ENABLED: false
        }
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

    // 获取所有待支付的USDT订单金额
    const pendingOrders = await prisma.order.findMany({
        where: {
            status: 'PENDING',
            paymentMethod: 'usdt'
        },
        select: { usdtAmount: true }
    })

    const usedAmounts = new Set(pendingOrders.map(o => o.usdtAmount?.toString()))

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

// 生成USDT支付信息
async function createUsdtPayment(order) {
    const config = await getConfig()

    if (!config.WALLET_ADDRESS) {
        throw new Error('USDT收款地址未配置')
    }

    const baseUsdt = await cnyToUsdt(parseFloat(order.totalAmount))
    const usdtAmount = await generateUniqueAmount(baseUsdt)

    // 更新订单的USDT金额
    await prisma.order.update({
        where: { id: order.id },
        data: {
            usdtAmount: usdtAmount,
            paymentMethod: 'usdt'
        }
    })

    // 生成支付二维码内容（TRC20转账链接）
    const qrContent = `tron:${config.WALLET_ADDRESS}?amount=${usdtAmount}&token=${config.USDT_CONTRACT}`

    return {
        walletAddress: config.WALLET_ADDRESS,
        usdtAmount: usdtAmount,
        qrContent: qrContent,
        exchangeRate: config.EXCHANGE_RATE
    }
}

// 查询钱包最近的TRC20转账
async function getRecentTransactions(limit = 50) {
    const config = await getConfig()

    if (!config.WALLET_ADDRESS) {
        return []
    }

    try {
        const url = `${config.TRONGRID_API}/v1/accounts/${config.WALLET_ADDRESS}/transactions/trc20?limit=${limit}&contract_address=${config.USDT_CONTRACT}`

        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json'
            }
        })

        if (!response.ok) {
            throw new Error(`TronGrid API error: ${response.status}`)
        }

        const data = await response.json()
        return data.data || []
    } catch (error) {
        logger.error('获取TRC20交易失败:', error)
        return []
    }
}

// 检查并处理USDT支付
async function checkUsdtPayments() {
    try {
        const config = await getConfig()

        // 如果USDT未启用或钱包未配置，跳过
        if (!config.ENABLED || !config.WALLET_ADDRESS) {
            return
        }

        // 获取待支付的USDT订单
        const pendingOrders = await prisma.order.findMany({
            where: {
                status: 'PENDING',
                paymentMethod: 'usdt',
                usdtAmount: { not: null }
            },
            include: { payment: true }
        })

        if (pendingOrders.length === 0) {
            return // 没有待处理的订单
        }

        // 获取最近的转账记录
        const transactions = await getRecentTransactions()

        for (const tx of transactions) {
            // 只处理转入的交易
            if (tx.to !== config.WALLET_ADDRESS) continue

            // 解析金额（USDT是6位小数）
            const txAmount = parseFloat(tx.value) / 1000000

            // 查找匹配的订单
            const matchedOrder = pendingOrders.find(order => {
                const orderAmount = parseFloat(order.usdtAmount)
                // 允许0.001的误差
                return Math.abs(txAmount - orderAmount) < 0.001
            })

            if (matchedOrder) {
                // 检查是否已处理过这笔交易
                const existingPayment = await prisma.payment.findFirst({
                    where: { tradeNo: tx.transaction_id }
                })

                if (existingPayment) continue // 已处理

                logger.info(`USDT支付匹配成功: 订单 ${matchedOrder.orderNo}, 金额 ${txAmount} USDT, 交易 ${tx.transaction_id}`)

                // 处理支付成功
                await processUsdtPaymentSuccess(matchedOrder, tx.transaction_id, txAmount)
            }
        }
    } catch (error) {
        logger.error('检查USDT支付失败:', error)
    }
}

// 处理USDT支付成功
async function processUsdtPaymentSuccess(order, txHash, usdtAmount) {
    const { dispenseCards } = require('../controllers/cardController')

    // 开启事务
    await prisma.$transaction(async (tx) => {
        // 更新支付记录
        await tx.payment.upsert({
            where: { orderId: order.id },
            create: {
                orderId: order.id,
                paymentMethod: 'usdt',
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

        logger.info(`USDT订单 ${order.orderNo} 卡密发放成功`)
    } catch (error) {
        logger.error(`USDT订单 ${order.orderNo} 卡密发放失败:`, error)
    }

    // 发送邮件通知
    try {
        const emailService = require('./emailService')
        const fullOrder = await prisma.order.findUnique({
            where: { id: order.id },
            include: { product: true, cards: true }
        })
        await emailService.sendOrderCompletedEmail(fullOrder, fullOrder.cards)
        logger.info(`USDT订单 ${order.orderNo} 邮件通知已发送`)

        // 通知管理员
        const { notifyOrderPaid } = require('./adminNotifyService')
        notifyOrderPaid(fullOrder).catch(e => logger.error('管理员通知失败:', e))
    } catch (error) {
        logger.error(`USDT订单 ${order.orderNo} 邮件发送失败:`, error)
    }
}

// 启动轮询
let pollingInterval = null

function startPolling() {
    if (pollingInterval) return

    logger.info('USDT支付监控已启动')
    pollingInterval = setInterval(checkUsdtPayments, DEFAULT_CONFIG.POLL_INTERVAL)

    // 立即执行一次
    checkUsdtPayments()
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval)
        pollingInterval = null
        logger.info('USDT支付监控已停止')
    }
}

module.exports = {
    getConfig,
    cnyToUsdt,
    createUsdtPayment,
    checkUsdtPayments,
    startPolling,
    stopPolling
}
