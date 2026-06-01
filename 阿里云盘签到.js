/*
 * @File: aliyunpan_checkin.js
 * @Author: Gemini
 * @Date: 2023-09-15
 * @LastModified: 2025-08-25
 * @Description: 阿里云盘每日签到脚本，适用于青龙面板。功能丰富，支持多账号、随机延迟和详细通知。
 *
 * @Env
 * - ALIYUN_REFRESH_TOKEN: 阿里云盘的 refresh_token，多个账号用换行或 & 分隔。
 *
 * @OptionalEnv
 * - MAX_RANDOM_DELAY: 脚本执行前的最大随机延迟（秒），默认 300。
 * - RANDOM_SIGNIN: 是否开启随机延迟，默认 true。
 * - PRIVACY_MODE: 是否开启隐私模式（脱敏处理日志和通知），默认 true。
 * - SHOW_TOKEN_IN_NOTIFICATION: 是否在通知中显示新 token 的提示，默认 false。
 *
 * @Usage
 * 1. 在青龙面板 -> 依赖管理 -> NodeJs -> 添加依赖 `got` 和 `crypto-js`。
 * 2. 在环境变量中添加 `ALIYUN_REFRESH_TOKEN`。
 * 3. 添加定时任务，例如: 10 7 * * *
 */

const {
    sendNotify
} = require('./sendNotify');
const got = require('got');
const crypto = require('crypto');
const name = '阿里云盘签到';

// --- 配置项 ---
const ali_user_agent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AopApp/1.0 AliApp(AP/10.3.101.1) ALIYUNPAN/4.9.1';

// --- 从环境变量读取配置 ---
const refreshTokens = process.env.ALIYUN_REFRESH_TOKEN || "";
const maxRandomDelay = parseInt(process.env.MAX_RANDOM_DELAY, 10) || 300;
const randomSignIn = (process.env.RANDOM_SIGNIN || "true").toLowerCase() === "true";
const privacyMode = (process.env.PRIVACY_MODE || "true").toLowerCase() === "true";
// 建议如果需要知道新Token，在青龙环境变量配置 SHOW_TOKEN_IN_NOTIFICATION="true"
const showTokenInNotification = (process.env.SHOW_TOKEN_IN_NOTIFICATION || "false").toLowerCase() === "true";

// --- 辅助函数 ---

/**
 * 脱敏处理敏感数据
 */
function maskSensitiveData(data, type = "token") {
    if (!data) return "未知";
    if (!privacyMode) return data;

    switch (type) {
        case "token":
            return data.length <= 10 ? "**********" : `${data.substring(0, 6)}...${data.substring(data.length - 4)}`;
        case "phone":
            return data.length >= 7 ? `${data.substring(0, 3)}****${data.substring(data.length - 4)}` : "****";
        default:
            return "******";
    }
}

/**
 * 生成账号唯一标识
 */
function generateAccountId(token) {
    if (!token) return "未知账号";
    const hash = crypto.createHash('md5').update(token).digest('hex');
    return `账号${hash.substring(0, 8).toUpperCase()}`;
}

/**
 * 格式化剩余时间
 */
function formatTimeRemaining(seconds) {
    if (seconds <= 0) return "立即执行";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    let result = "";
    if (hours > 0) result += `${hours}小时`;
    if (minutes > 0) result += `${minutes}分`;
    result += `${secs}秒`;
    return result;
}

/**
 * 带倒计时的延迟等待
 */
async function waitWithCountdown(delaySeconds, taskName) {
    if (delaySeconds <= 0) return;
    console.log(`🎲 ${taskName} 需要等待 ${formatTimeRemaining(delaySeconds)}`);
    let remaining = delaySeconds;
    while (remaining > 0) {
        if (remaining <= 10 || remaining % 10 === 0) {
            console.log(`⏳ ${taskName} 倒计时: ${formatTimeRemaining(remaining)}`);
        }
        const sleepTime = Math.min(1, remaining);
        await new Promise(resolve => setTimeout(resolve, sleepTime * 1000));
        remaining -= sleepTime;
    }
}

/**
 * 统一发送通知
 */
async function notifyUser(title, content) {
    try {
        await sendNotify(title, content);
        console.log(`✅ 通知发送完成: ${title}`);
    } catch (e) {
        console.error(`❌ 通知发送失败: ${e}`);
    }
}


// --- 阿里云盘核心类 ---

class AliYun {
    constructor(refreshToken, index) {
        this.refreshToken = refreshToken;
        this.index = index;
        this.accessToken = null;
        this.newRefreshToken = null;
        this.accountId = generateAccountId(refreshToken);
    }

    /**
     * 带重试机制的网络请求辅助函数
     */
    async requestWithRetry(url, options, maxRetries = 2) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await got.post(url, options);
            } catch (error) {
                if (attempt === maxRetries) throw error;
                console.log(`⏳ 请求遇到波动，等待 3 秒后进行第 ${attempt + 1} 次重试...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    }

    /**
     * 更新访问令牌
     */
    async updateToken() {
        console.log("🔄 正在更新访问令牌...");
        try {
            const { body } = await this.requestWithRetry('https://auth.aliyundrive.com/v2/account/token', {
                json: {
                    grant_type: 'refresh_token',
                    refresh_token: this.refreshToken,
                },
                responseType: 'json',
                headers: {
                    'User-Agent': ali_user_agent
                },
                timeout: 10000
            });

            if (body && body.access_token) {
                console.log("✅ 访问令牌更新成功");
                this.accessToken = `Bearer ${body.access_token}`;
                if (body.refresh_token && body.refresh_token !== this.refreshToken) {
                    this.newRefreshToken = body.refresh_token;
                    console.log(`🔄 检测到新的 refresh_token: ${maskSensitiveData(this.newRefreshToken)}`);
                }
                return true;
            } else {
                throw new Error(body.message || "响应中缺少 access_token");
            }
        } catch (error) {
            const errorBody = error.response ? error.response.body : error.message;
            console.error(`❌ Token更新失败: ${JSON.stringify(errorBody)}`);
            if (JSON.stringify(errorBody).includes("InvalidParameter.RefreshToken")) {
                this.error = "refresh_token 无效或已过期，请重新获取。";
            } else {
                this.error = `Token 更新失败，请检查网络或 refresh_token。`;
            }
            return false;
        }
    }

    /**
     * 获取用户信息
     */
    async getUserInfo() {
        console.log("👤 正在获取用户信息...");
        try {
            const { body } = await this.requestWithRetry('https://user.aliyundrive.com/v2/user/get', {
                headers: {
                    'Authorization': this.accessToken,
                    'User-Agent': ali_user_agent
                },
                json: {}, 
                responseType: 'json',
                timeout: 10000
            });
            this.userName = body.nick_name || body.user_name || "未知用户";
            this.userPhone = body.phone ? maskSensitiveData(body.phone, "phone") : "";
            console.log(`👤 用户: ${this.userName}`);
        } catch (error) {
            console.error("⚠️ 获取用户信息失败", error.response ? error.response.body : error.message);
            this.userName = "未知用户";
            this.userPhone = "";
        }
    }

    /**
     * 获取存储空间信息
     */
    async getStorageInfo() {
        console.log("💾 正在获取存储空间信息...");
        try {
            const { body } = await this.requestWithRetry('https://api.aliyundrive.com/v2/user/get', {
                headers: {
                    'Authorization': this.accessToken,
                    'User-Agent': ali_user_agent
                },
                json: {}, 
                responseType: 'json',
                timeout: 10000
            });
            const { used_size, total_size } = body.personal_space_info || {};
            this.usedGb = used_size ? (used_size / Math.pow(1024, 3)).toFixed(2) : 0;
            this.totalGb = total_size ? (total_size / Math.pow(1024, 3)).toFixed(2) : 0;
            console.log(`💾 存储空间: ${this.usedGb}GB / ${this.totalGb}GB`);
        } catch (error) {
            console.error("⚠️ 获取存储信息失败", error.response ? error.response.body : error.message);
            this.usedGb = 0;
            this.totalGb = 0;
        }
    }

    /**
     * 执行签到
     */
    async signIn() {
        console.log("📝 正在执行签到...");
        try {
            const { body } = await this.requestWithRetry('https://member.aliyundrive.com/v1/activity/sign_in_list', {
                headers: {
                    'Authorization': this.accessToken,
                    'User-Agent': ali_user_agent
                },
                json: {},
                responseType: 'json',
                timeout: 10000
            });

            if (!body.success) {
                throw new Error(body.message || "签到失败");
            }

            const signInCount = body.result.signInCount;
            const signInLogs = body.result.signInLogs;
            const todayLog = signInLogs[signInCount - 1];

            this.signInMsg = `签到成功，累计 ${signInCount} 天`;
            this.rewardInfo = "今天奖励是空的~";

            if (todayLog && todayLog.status === 'normal' && todayLog.isReward) {
                const reward = todayLog.reward;
                if (reward) {
                    this.rewardInfo = `${reward.name} - ${reward.description}`;
                }
            }
            console.log(`✅ ${this.signInMsg}`);
            console.log(`🎁 今日奖励: ${this.rewardInfo}`);
            return true;

        } catch (error) {
            const errorBody = error.response ? error.response.body : error.message;
            console.error(`❌ 签到失败: ${JSON.stringify(errorBody)}`);
            if (typeof errorBody === 'object' && errorBody.code === 'SignInRepeated') {
                this.signInMsg = "今天已经签到过了";
                this.rewardInfo = "无需重复操作";
                return true; // 已经签到也算成功，不需要报警
            }
            this.signInMsg = "签到失败";
            this.rewardInfo = errorBody.message || "请检查脚本或网络";
            return false;
        }
    }

    /**
     * 主执行函数
     */
    async main() {
        console.log(`\n--- 账号 ${this.index} (${this.accountId}) 开始 ---`);

        if (!await this.updateToken()) {
            return {
                success: false,
                message: this.buildNotificationMessage(false),
                hasNewToken: false
            };
        }

        await this.getUserInfo();
        await this.getStorageInfo();
        const signInSuccess = await this.signIn();

        return {
            success: signInSuccess,
            message: this.buildNotificationMessage(signInSuccess),
            hasNewToken: !!this.newRefreshToken
        };
    }

    /**
     * 构建通知消息（仅组装文本内容）
     */
    buildNotificationMessage(isSuccess) {
        let msg = ``;
        if (isSuccess) {
            msg += `📝 签到: ${this.signInMsg}\n`;
            msg += `🎁 奖励: ${this.rewardInfo}\n`;
        } else {
            msg += `📄 原因: ${this.error || this.signInMsg}\n`;
            if (this.error) {
                msg += `🔧 请检查环境变量 ALIYUN_REFRESH_TOKEN 是否正确或已过期。\n`;
            }
        }

        // 强提醒新 Token
        if (this.newRefreshToken) {
            msg += `🔄 检测到新 Token! 旧Token即将失效，请尽快去青龙修改环境变量。`;
            if (showTokenInNotification && !privacyMode) {
                msg += `\n[新Token内容]: ${this.newRefreshToken}`;
            } else if (!showTokenInNotification && !privacyMode) {
                msg += `\n(可设置 SHOW_TOKEN_IN_NOTIFICATION="true" 在通知中直接显示Token)`;
            }
        }

        return msg;
    }
}


/**
 * 主程序入口
 */
(async () => {
    console.log(`==== ${name} 开始 - ${new Date().toLocaleString('zh-CN')} ====`);
    console.log(`🎲 随机延迟: ${randomSignIn ? '已启用' : '已禁用'}`);
    console.log(`🔒 隐私模式: ${privacyMode ? '已启用' : '已禁用'}`);

    if (!refreshTokens) {
        const errorMsg = "❌ 未找到 ALIYUN_REFRESH_TOKEN 环境变量，请配置后再运行！";
        console.log(errorMsg);
        await notifyUser(name, errorMsg);
        return;
    }

    if (randomSignIn) {
        const delay = Math.floor(Math.random() * maxRandomDelay);
        await waitWithCountdown(delay, name);
    }

    const tokens = refreshTokens.includes('\n') ?
        refreshTokens.split('\n').filter(t => t.trim()) :
        refreshTokens.split('&').filter(t => t.trim());

    console.log(`📝 共发现 ${tokens.length} 个账号`);
    
    let allNoticeMessages = "";
    let shouldNotify = false;

    for (let i = 0; i < tokens.length; i++) {
        const aliyun = new AliYun(tokens[i], i + 1);
        const result = await aliyun.main();

        // 核心修改：如果签到失败，或者签到成功但检测到Token已刷新，才会被加入通知列表
        if (!result.success || result.hasNewToken) {
            shouldNotify = true;
            const icon = result.success ? "⚠️" : "❌";
            allNoticeMessages += `\n${icon} 账号 ${i + 1} (${aliyun.userName || aliyun.accountId}):\n${result.message}\n`;
        } else {
             console.log(`✅ 账号 ${i + 1} (${aliyun.userName || aliyun.accountId}) 签到成功，无异常无需通知。`);
        }

        if (i < tokens.length - 1) {
            const delay = Math.floor(Math.random() * 5) + 5; 
            console.log(`\n⏱️  随机等待 ${delay} 秒后处理下一个账号...`);
            await new Promise(resolve => setTimeout(resolve, delay * 1000));
        }
    }

    // --- 最终判定：只有异常或Token更新才发送通知 ---
    if (shouldNotify) {
        console.log(`\n⚠️ 检测到异常任务或新Token，准备发送通知...`);
        const title = `⚠️ 阿里云盘签到通知`;
        await notifyUser(title, allNoticeMessages);
    } else {
        console.log(`\n🎉 所有 ${tokens.length} 个账号均已静默签到成功，且Token无变化，本次不发送通知。`);
    }

    console.log(`\n==== ${name} 结束 - ${new Date().toLocaleString('zh-CN')} ====`);
})();
