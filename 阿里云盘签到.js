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
const showTokenInNotification = (process.env.SHOW_TOKEN_IN_NOTIFICATION || "false").toLowerCase() === "false";

// --- 辅助函数 ---

/**
 * 脱敏处理敏感数据
 * @param {string} data - 原始数据
 * @param {string} type - 数据类型 (token, phone, email)
 * @returns {string} - 脱敏后的数据
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
 * @param {string} token - refresh_token
 * @returns {string} - 账号标识
 */
function generateAccountId(token) {
    if (!token) return "未知账号";
    const hash = crypto.createHash('md5').update(token).digest('hex');
    return `账号${hash.substring(0, 8).toUpperCase()}`;
}

/**
 * 格式化剩余时间
 * @param {number} seconds - 秒数
 * @returns {string} - 格式化后的时间字符串
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
 * @param {number} delaySeconds - 延迟秒数
 * @param {string} taskName - 任务名称
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
 * @param {string} title - 通知标题
 * @param {string} content - 通知内容
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
     * 更新访问令牌
     */
    async updateToken() {
        console.log("🔄 正在更新访问令牌...");
        try {
            const {
                body
            } = await got.post('https://auth.aliyundrive.com/v2/account/token', {
                json: {
                    grant_type: 'refresh_token',
                    refresh_token: this.refreshToken,
                },
                responseType: 'json',
                headers: {
                    'User-Agent': ali_user_agent
                }
            });

            if (body.access_token) {
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
            console.error(`❌ Token更新失败: ${errorBody}`);
            if (errorBody.includes("InvalidParameter.RefreshToken")) {
                this.error = "refresh_token 无效或已过期，请重新获取。";
            } else {
                this.error = `Token 更新失败，请检查 refresh_token。`;
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
            const {
                body
            } = await got.post('https://user.aliyundrive.com/v2/user/get', {
                headers: {
                    'Authorization': this.accessToken,
                    'User-Agent': ali_user_agent
                },
                json: {}, // 添加空的json体
                responseType: 'json'
            });
            this.userName = body.nick_name || body.user_name || "未知用户";
            this.userPhone = body.phone ? maskSensitiveData(body.phone, "phone") : "";
            console.log(`👤 用户: ${this.userName}`);
        } catch (error) {
            console.error("⚠️ 获取用户信息失败", error.response ? error.response.body : error);
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
            const {
                body
            } = await got.post('https://api.aliyundrive.com/v2/user/get', {
                headers: {
                    'Authorization': this.accessToken,
                    'User-Agent': ali_user_agent
                },
                json: {}, // 添加空的json体
                responseType: 'json'
            });
            const {
                used_size,
                total_size
            } = body.personal_space_info || {};
            this.usedGb = used_size ? (used_size / Math.pow(1024, 3)).toFixed(2) : 0;
            this.totalGb = total_size ? (total_size / Math.pow(1024, 3)).toFixed(2) : 0;
            console.log(`💾 存储空间: ${this.usedGb}GB / ${this.totalGb}GB`);
        } catch (error) {
            console.error("⚠️ 获取存储信息失败", error.response ? error.response.body : error);
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
            const {
                body
            } = await got.post('https://member.aliyundrive.com/v1/activity/sign_in_list', {
                headers: {
                    'Authorization': this.accessToken,
                    'User-Agent': ali_user_agent
                },
                json: {},
                responseType: 'json'
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
            console.error(`❌ 签到失败: ${errorBody}`);
            if (typeof errorBody === 'object' && errorBody.code === 'SignInRepeated') {
                this.signInMsg = "今天已经签到过了";
                this.rewardInfo = "无需重复操作";
                return true; // 已经签到也算成功
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
                message: this.buildNotificationMessage(false)
            };
        }

        await this.getUserInfo();
        await this.getStorageInfo();
        const signInSuccess = await this.signIn();

        return {
            success: signInSuccess,
            message: this.buildNotificationMessage(signInSuccess)
        };
    }

    /**
     * 构建通知消息
     */
    buildNotificationMessage(isSuccess) {
        let msg = `🌟 阿里云盘签到结果\n\n`;
        msg += `👤 账号: ${this.userName || this.accountId}\n`;
        if (this.userPhone) msg += `📱 手机: ${this.userPhone}\n`;

        if (isSuccess) {
            if (this.totalGb > 0) {
                const usagePercent = ((this.usedGb / this.totalGb) * 100).toFixed(1);
                msg += `💾 存储: ${this.usedGb}GB / ${this.totalGb}GB (${usagePercent}%)\n`;
            }
            msg += `📝 签到: ${this.signInMsg}\n`;
            msg += `🎁 奖励: ${this.rewardInfo}\n`;
        } else {
            msg += `❌ 状态: 签到失败\n`;
            msg += `📄 原因: ${this.error || this.signInMsg}\n`;
            if (this.error) {
                msg += `\n🔧 请检查环境变量 ALIYUN_REFRESH_TOKEN 是否正确或已过期。`;
            }
        }

        if (this.newRefreshToken) {
            msg += `\n🔄 Token: 检测到新 token，建议手动更新环境变量以保证长期有效。`;
            if (showTokenInNotification && !privacyMode) {
                msg += `\n  新 Token: ${this.newRefreshToken}`;
            }
        }

        msg += `\n⏰ 时间: ${new Date().toLocaleString('zh-CN')}`;
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
    const results = [];

    for (let i = 0; i < tokens.length; i++) {
        const aliyun = new AliYun(tokens[i], i + 1);
        const result = await aliyun.main();
        results.push({ ...result,
            accountId: aliyun.accountId
        });

        // 单独发送通知
        const status = result.success ? "成功" : "失败";
        await notifyUser(`${name} - ${aliyun.accountId} ${status}`, result.message);

        if (i < tokens.length - 1) {
            const delay = Math.floor(Math.random() * 5) + 5; // 账号间随机等待5-10秒
            console.log(`\n⏱️  随机等待 ${delay} 秒后处理下一个账号...`);
            await new Promise(resolve => setTimeout(resolve, delay * 1000));
        }
    }

    // 发送汇总通知
    if (tokens.length > 1) {
        const successCount = results.filter(r => r.success).length;
        const totalCount = tokens.length;
        let summaryMsg = `📊 阿里云盘签到汇总\n\n`;
        summaryMsg += `📈 总计: ${totalCount}个，成功: ${successCount}个，失败: ${totalCount - successCount}个\n`;
        summaryMsg += `\n📋 详细结果:\n`;
        results.forEach(r => {
            const icon = r.success ? "✅" : "❌";
            summaryMsg += `${icon} ${r.accountId}\n`;
        });
        await notifyUser(`${name} - 汇总`, summaryMsg);
    }

    console.log(`\n==== ${name} 结束 - ${new Date().toLocaleString('zh-CN')} ====`);
})();