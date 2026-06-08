/*
 * @File: aliyunpan_checkin.js
 * @Author: Gemini
 * @Date: 2023-09-15
 * @LastModified: 2025-08-25
 * @Description: 阿里云盘每日签到脚本，支持自动更新青龙面板的Token环境变量。
 *
 * @Env
 * - ALIYUN_REFRESH_TOKEN: 阿里云盘的 refresh_token，多个账号用换行或 & 分隔。
 *
 * @OptionalEnv
 * - MAX_RANDOM_DELAY: 最大随机延迟（秒），默认 300。
 * - RANDOM_SIGNIN: 是否开启随机延迟，默认 true。
 * - PRIVACY_MODE: 是否开启隐私模式（脱敏处理日志和通知），默认 true。
 */

const { sendNotify } = require('./sendNotify');
const got = require('got');
const crypto = require('crypto');
const fs = require('fs');
const name = '阿里云盘签到';

// --- 配置项 ---
const ali_user_agent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AopApp/1.0 AliApp(AP/10.3.101.1) ALIYUNPAN/4.9.1';

// --- 从环境变量读取配置 ---
const envVarName = 'ALIYUN_REFRESH_TOKEN';
const refreshTokens = process.env[envVarName] || "";
const maxRandomDelay = parseInt(process.env.MAX_RANDOM_DELAY, 10) || 300;
const randomSignIn = (process.env.RANDOM_SIGNIN || "true").toLowerCase() === "true";
const privacyMode = (process.env.PRIVACY_MODE || "true").toLowerCase() === "true";

// --- 自动更新青龙环境变量的辅助函数 ---
async function updateQinglongEnv(envName, envValue) {
    console.log(`\n⚙️ 准备尝试自动更新青龙环境变量: ${envName}...`);
    try {
        let authFile = '/ql/data/config/auth.json'; // 适配青龙 2.11+
        if (!fs.existsSync(authFile)) authFile = '/ql/config/auth.json'; // 适配老版本青龙
        
        if (!fs.existsSync(authFile)) {
            console.log("❌ 找不到青龙 auth.json 配置文件，自动更新失败。");
            return false;
        }

        const authInfo = JSON.parse(fs.readFileSync(authFile, 'utf8'));
        const token = authInfo.token;
        if (!token) return false;

        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };

        // 1. 获取当前环境变量的 ID
        const getUrl = `http://127.0.0.1:5600/api/envs?searchValue=${envName}`;
        const { body: getBody } = await got.get(getUrl, { headers, responseType: 'json' });
        const targetEnv = getBody.data.find(e => e.name === envName);

        if (!targetEnv) {
            console.log(`❌ 找不到名为 ${envName} 的环境变量`);
            return false;
        }

        // 2. 提交更新
        const payload = {
            name: envName,
            value: envValue,
            remarks: targetEnv.remarks || ""
        };
        // 兼容新老青龙的ID字段
        if (targetEnv.id) payload.id = targetEnv.id;
        if (targetEnv._id) payload._id = targetEnv._id;

        const putUrl = 'http://127.0.0.1:5600/api/envs';
        const { body: putBody } = await got.put(putUrl, { headers, json: payload, responseType: 'json' });

        if (putBody.code === 200) {
            console.log("✅ 成功更新青龙面板环境变量！");
            return true;
        } else {
            console.log(`❌ 更新失败: ${putBody.message}`);
            return false;
        }
    } catch (err) {
        console.error("❌ 自动更新青龙变量时发生异常:", err.message);
        return false;
    }
}

// --- 其他辅助函数 ---
function maskSensitiveData(data, type = "token") {
    if (!data) return "未知";
    if (!privacyMode) return data;
    switch (type) {
        case "token": return data.length <= 10 ? "**********" : `${data.substring(0, 6)}...${data.substring(data.length - 4)}`;
        case "phone": return data.length >= 7 ? `${data.substring(0, 3)}****${data.substring(data.length - 4)}` : "****";
        default: return "******";
    }
}

function generateAccountId(token) {
    if (!token) return "未知账号";
    return `账号${crypto.createHash('md5').update(token).digest('hex').substring(0, 8).toUpperCase()}`;
}

function formatTimeRemaining(seconds) {
    if (seconds <= 0) return "立即执行";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours > 0 ? hours + '小时' : ''}${minutes > 0 ? minutes + '分' : ''}${secs}秒`;
}

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

    async updateToken() {
        console.log("🔄 正在更新访问令牌...");
        try {
            const { body } = await this.requestWithRetry('https://auth.aliyundrive.com/v2/account/token', {
                json: { grant_type: 'refresh_token', refresh_token: this.refreshToken },
                responseType: 'json',
                headers: { 'User-Agent': ali_user_agent },
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
            this.error = JSON.stringify(errorBody).includes("InvalidParameter.RefreshToken") 
                ? "refresh_token 无效或已过期，请重新获取。" 
                : "Token 更新失败，请检查网络或 refresh_token。";
            return false;
        }
    }

    async getUserInfo() {
        try {
            const { body } = await this.requestWithRetry('https://user.aliyundrive.com/v2/user/get', {
                headers: { 'Authorization': this.accessToken, 'User-Agent': ali_user_agent },
                json: {}, responseType: 'json', timeout: 10000
            });
            this.userName = body.nick_name || body.user_name || "未知用户";
        } catch (error) {
            this.userName = "未知用户";
        }
    }

    async signIn() {
        console.log("📝 正在执行签到...");
        try {
            const { body } = await this.requestWithRetry('https://member.aliyundrive.com/v1/activity/sign_in_list', {
                headers: { 'Authorization': this.accessToken, 'User-Agent': ali_user_agent },
                json: {}, responseType: 'json', timeout: 10000
            });

            if (!body.success) throw new Error(body.message || "签到失败");

            const signInCount = body.result.signInCount;
            const todayLog = body.result.signInLogs[signInCount - 1];
            this.signInMsg = `签到成功，累计 ${signInCount} 天`;
            this.rewardInfo = "今天奖励是空的~";

            if (todayLog && todayLog.status === 'normal' && todayLog.isReward && todayLog.reward) {
                this.rewardInfo = `${todayLog.reward.name} - ${todayLog.reward.description}`;
            }
            console.log(`✅ ${this.signInMsg} | 🎁 奖励: ${this.rewardInfo}`);
            return true;
        } catch (error) {
            const errorBody = error.response ? error.response.body : error.message;
            if (typeof errorBody === 'object' && errorBody.code === 'SignInRepeated') {
                this.signInMsg = "今天已经签到过了";
                this.rewardInfo = "无需重复操作";
                return true; 
            }
            this.signInMsg = "签到失败";
            this.error = errorBody.message || "未知错误";
            return false;
        }
    }

    async main() {
        console.log(`\n--- 账号 ${this.index} (${this.accountId}) 开始 ---`);
        if (!await this.updateToken()) return { success: false, hasNewToken: false };
        await this.getUserInfo();
        const signInSuccess = await this.signIn();
        return { success: signInSuccess, hasNewToken: !!this.newRefreshToken };
    }
}

/**
 * 主程序入口
 */
(async () => {
    console.log(`==== ${name} 开始 - ${new Date().toLocaleString('zh-CN')} ====`);

    if (!refreshTokens) {
        await notifyUser(name, "❌ 未找到 ALIYUN_REFRESH_TOKEN 环境变量，请配置后再运行！");
        return;
    }

    if (randomSignIn) {
        const delay = Math.floor(Math.random() * maxRandomDelay);
        await waitWithCountdown(delay, name);
    }

    const tokens = refreshTokens.includes('\n') ? refreshTokens.split('\n').filter(t => t.trim()) : refreshTokens.split('&').filter(t => t.trim());
    console.log(`📝 共发现 ${tokens.length} 个账号`);
    
    let allNoticeMessages = "";
    let shouldNotify = false;
    let hasEnvUpdate = false;
    let currentEnvString = refreshTokens; // 用于存储最新的环境变量全量字符串

    for (let i = 0; i < tokens.length; i++) {
        const aliyun = new AliYun(tokens[i], i + 1);
        const result = await aliyun.main();

        // 核心自动更新逻辑
        if (result.hasNewToken) {
            // 将旧的 token 替换为新的 token
            currentEnvString = currentEnvString.replace(tokens[i], aliyun.newRefreshToken);
            hasEnvUpdate = true;
        }

        // 记录日志，但不一定会发送通知
        if (!result.success || result.hasNewToken) {
            
            // ⭐️ 核心修改：只有遇到真正的失败，才会触发发通知的开关
            if (!result.success) {
                shouldNotify = true; 
            }
            
            const icon = result.success ? "⚠️" : "❌";
            let accMsg = `\n${icon} 账号 ${i + 1} (${aliyun.userName || aliyun.accountId}):\n`;
            
            if (result.success) {
                accMsg += `📝 签到: ${aliyun.signInMsg}\n🎁 奖励: ${aliyun.rewardInfo}\n`;
            } else {
                accMsg += `📄 失败原因: ${aliyun.error || aliyun.signInMsg}\n`;
            }

            if (result.hasNewToken) {
                accMsg += `🔄 已获取到新 Token！脚本尝试自动为您更新青龙环境变量。\n`;
            }
            allNoticeMessages += accMsg;
        } else {
             console.log(`✅ 账号 ${i + 1} (${aliyun.userName || aliyun.accountId}) 签到成功且Token无变化。`);
        }

        if (i < tokens.length - 1) {
            await new Promise(resolve => setTimeout(resolve, (Math.floor(Math.random() * 5) + 5) * 1000));
        }
    }

    // --- 执行环境变量自动更新 ---
    if (hasEnvUpdate) {
        const isUpdateSuccess = await updateQinglongEnv(envVarName, currentEnvString);
        if (isUpdateSuccess) {
            allNoticeMessages += `\n✅ 报告: 青龙面板的 [${envVarName}] 环境变量已自动更新为最新 Token！您无需手动操作。`;
            console.log(`✅ 青龙环境变量自动更新成功，无异常无需通知。`);
        } else {
            allNoticeMessages += `\n❌ 报告: 自动更新青龙变量失败，请手动去面板修改以防失效。`;
            // ⭐️ 核心修改：如果自动更新失败，也算作严重的异常，必须通知提醒！
            shouldNotify = true; 
        }
    }

    // --- 最终通知判定 ---
    if (shouldNotify) {
        console.log(`\n⚠️ 准备发送异常通知...`);
        await notifyUser(`⚠️ 阿里云盘签到异常`, allNoticeMessages);
    } else {
        console.log(`\n🎉 所有账号均签到成功（包含已处理的新Token），本次静默不通知。`);
    }

    console.log(`\n==== ${name} 结束 - ${new Date().toLocaleString('zh-CN')} ====`);
})();
