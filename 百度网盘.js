/*
 * @File: baidu_checkin.js
 * @Author: Gemini
 * @Date: 2025-08-25
 * @Description: 百度网盘每日签到和自动答题脚本，适用于青龙面板。
 *
 * @Env
 * - BAIDU_COOKIE: 百度网盘的完整 Cookie。多个账号用换行分隔。
 *
 * @OptionalEnv
 * - MAX_RAND_DELAY: 脚本执行前的最大随机延迟（秒），默认 300。
 * - RANDOM_SIGNIN: 是否开启随机延迟，默认 true。
 * - PRIVACY_MODE: 是否开启隐私模式（脱敏处理用户名），默认 true。
 *
 * @Usage
 * 1. 在青龙面板 -> 依赖管理 -> NodeJs -> 添加依赖 `got`。
 * 2. 在环境变量中添加 `BAIDU_COOKIE`。
 * 3. 添加定时任务，例如: 0 9 * * *
 */

const {
    sendNotify
} = require('./sendNotify');
const got = require('got');
const name = '百度网盘签到';

// --- 从环境变量读取配置 ---
const baiduCookies = process.env.BAIDU_COOKIE || "";
const maxRandomDelay = parseInt(process.env.MAX_RANDOM_DELAY, 10) || 300;
const randomSignIn = (process.env.RANDOM_SIGNIN || "true").toLowerCase() === "true";
const privacyMode = (process.env.PRIVACY_MODE || "true").toLowerCase() === "true";

// --- 通用请求头 ---
const HEADERS = {
    'Connection': 'keep-alive',
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    'Referer': 'https://pan.baidu.com/wap/svip/growth/task',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
};

// --- 辅助函数 ---

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

// --- 百度网盘核心类 ---

class BaiduPan {
    constructor(cookie, index) {
        this.cookie = cookie;
        this.index = index;
        this.headers = { ...HEADERS,
            'Cookie': this.cookie
        };
    }

    /**
     * 执行每日签到
     */
    async signin() {
        console.log("📝 正在执行签到...");
        const url = "https://pan.baidu.com/rest/2.0/membership/level?app_id=250528&web=5&method=signin";
        try {
            const {
                body: bodyText
            } = await got(url, {
                headers: this.headers
            });
            const pointsMatch = bodyText.match(/"points":\s*(\d+)/);
            const errorMsgMatch = bodyText.match(/"error_msg":\s*"(.*?)"/);

            if (pointsMatch) {
                const points = pointsMatch[1];
                console.log(`🎁 今日奖励: ${points}积分`);
                return {
                    success: true,
                    message: `签到成功，获得 ${points} 积分`
                };
            } else if (errorMsgMatch) {
                const errorMsg = errorMsgMatch[1];
                if (errorMsg.includes("已签到") || errorMsg.includes("not allow")) {
                    console.log("📅 今日已签到");
                    return {
                        success: true,
                        message: "今日已签到"
                    };
                }
                throw new Error(errorMsg);
            } else {
                return {
                    success: true,
                    message: "签到成功，但未获取到积分信息"
                };
            }
        } catch (error) {
            console.error(`❌ 签到失败: ${error.message}`);
            return {
                success: false,
                message: `签到失败: ${error.message}`
            };
        }
    }

    /**
     * 获取并回答每日问题
     */
    async doDailyQuestion() {
        console.log("🤔 正在处理每日问答...");
        const getQuestionUrl = "https://pan.baidu.com/act/v2/membergrowv2/getdailyquestion?app_id=250528&web=5";
        try {
            const {
                body: questionText
            } = await got(getQuestionUrl, {
                headers: this.headers
            });
            const answerMatch = questionText.match(/"answer":\s*(\d+)/);
            const askIdMatch = questionText.match(/"ask_id":\s*(\d+)/);
            const questionMatch = questionText.match(/"question":\s*"(.*?)"/);

            if (!answerMatch || !askIdMatch) {
                console.log("⚠️ 未找到今日问题或答案。");
                return {
                    success: true,
                    message: "未进行"
                };
            }
            const answer = answerMatch[1];
            const ask_id = askIdMatch[1];
            const question = questionMatch ? questionMatch[1] : "未知问题";
            console.log(`❓ 今日问题: ${question}`);
            console.log(`💡 正确答案: ${answer}`);

            const answerUrl = `https://pan.baidu.com/act/v2/membergrowv2/answerquestion?app_id=250528&web=5&ask_id=${ask_id}&answer=${answer}`;
            const {
                body: answerText
            } = await got(answerUrl, {
                headers: this.headers
            });
            const scoreMatch = answerText.match(/"score":\s*(\d+)/);
            const showMsgMatch = answerText.match(/"show_msg":\s*"(.*?)"/);

            if (scoreMatch) {
                const score = scoreMatch[1];
                console.log(`🎁 答题奖励: ${score}积分`);
                return {
                    success: true,
                    message: `答题成功，获得 ${score} 积分`
                };
            } else if (showMsgMatch) {
                const showMsg = showMsgMatch[1];
                if (showMsg.includes("已回答") || showMsg.includes("exceeded")) {
                    console.log("📅 今日已答题或次数已用完");
                    return {
                        success: true,
                        message: "今日已答题"
                    };
                }
                throw new Error(showMsg);
            } else {
                return {
                    success: true,
                    message: "答题成功，但未获取到积分信息"
                };
            }
        } catch (error) {
            console.error(`❌ 答题失败: ${error.message}`);
            return {
                success: false,
                message: `答题失败: ${error.message}`
            };
        }
    }

    /**
     * 获取用户信息
     */
    async getUserInfo() {
        console.log("👤 正在获取用户信息...");
        const url = "https://pan.baidu.com/rest/2.0/membership/user?app_id=250528&web=5&method=query";
        try {
            const {
                body: bodyText
            } = await got(url, {
                headers: this.headers
            });

            const usernameMatch = bodyText.match(/"username":\s*"(.*?)"/);
            const levelMatch = bodyText.match(/"current_level":\s*(\d+)/);
            const valueMatch = bodyText.match(/"current_value":\s*(\d+)/);
            const vipTypeMatch = bodyText.match(/"vip_type":\s*(\d+)/);

            let username = usernameMatch ? usernameMatch[1] : "未知用户";
            const level = levelMatch ? levelMatch[1] : "未知";
            const value = valueMatch ? valueMatch[1] : "未知";
            const vipTypeMap = {
                0: "普通用户",
                1: "普通会员",
                2: "超级会员",
                3: "至尊会员"
            };
            let vipStatus = "普通用户";
            if (vipTypeMatch) {
                vipStatus = vipTypeMap[vipTypeMatch[1]] || "未知";
            }

            if (privacyMode && username !== "未知用户") {
                username = username.length > 2 ? `${username[0]}***${username.slice(-1)}` : "***";
            }

            console.log(`👤 用户: ${username}, 🏆 等级: Lv.${level}, 💎 会员: ${vipStatus}`);
            return {
                username,
                level,
                value,
                vipStatus
            };
        } catch (error) {
            console.error("⚠️ 获取用户信息失败", error.response ? error.response.body : error);
            return {
                username: "未知用户",
                level: "未知",
                value: "未知",
                vipStatus: "未知"
            };
        }
    }

    /**
     * 主程序入口
     */
    async main() {
        console.log(`\n--- 百度网盘账号 ${this.index} 开始 ---`);
        if (!this.cookie) {
            return {
                success: false,
                message: "Cookie 未配置，任务跳过。"
            };
        }

        const signinResult = await this.signin();
        await new Promise(resolve => setTimeout(resolve, (Math.random() * 3 + 2) * 1000));
        const questionResult = await this.doDailyQuestion();
        const userInfo = await this.getUserInfo();

        // --- 判断是否发生真正的异常 ---
        // 成功、今日已签到、已答题 等都算作没有异常
        // 如果 message 中包含 "失败" 或 "未配置"，则认为是异常
        const hasError = (signinResult.message && signinResult.message.includes("失败")) || 
                         (questionResult.message && questionResult.message.includes("失败"));
                         
        const message = this.buildNotificationMessage(userInfo, signinResult, questionResult);

        return {
            success: !hasError, // 这里 true 代表没有异常，false 代表有异常需要通知
            message: message,
            hasError: hasError,
            account: userInfo.username
        };
    }

    /**
     * 构建通知消息
     */
    buildNotificationMessage(userInfo, signinResult, questionResult) {
        let msg = `🌟 百度网盘签到结果
        
👤 账号: ${userInfo.username}
🏆 等级: Lv.${userInfo.level} (${userInfo.value} 成长值)
💎 会员: ${userInfo.vipStatus}

📝 签到: ${signinResult.message}`;

        // 只有在进行了答题操作时才显示答题结果
        if (questionResult.message !== "未进行") {
            msg += `\n🤔 答题: ${questionResult.message}`;
        }

        msg += `\n\n⏰ 时间: ${new Date().toLocaleString('zh-CN')}`;
        return msg;
    }
}

/**
 * 主程序入口
 */
(async () => {
    console.log(`==== ${name} 开始 - ${new Date().toLocaleString('zh-CN')} ====`);

    if (!baiduCookies) {
        const errorMsg = "❌ 未找到 BAIDU_COOKIE 环境变量，请配置后再运行！";
        console.log(errorMsg);
        await notifyUser(name, errorMsg);
        return;
    }

    if (randomSignIn) {
        const delay = Math.floor(Math.random() * maxRandomDelay);
        await waitWithCountdown(delay, name);
    }

    const cookies = baiduCookies.split('\n').filter(c => c.trim());
    console.log(`📝 共发现 ${cookies.length} 个账号`);
    const results = [];
    
    // 收集所有失败的消息
    let allFailureMessages = "";
    let totalFailures = 0;

    for (let i = 0; i < cookies.length; i++) {
        const pan = new BaiduPan(cookies[i], i + 1);
        const result = await pan.main();
        results.push(result);

        // --- 只记录失败信息，不再逐个发送通知 ---
        if (result.hasError || !result.success) {
            totalFailures++;
            allFailureMessages += `\n❌ 账号 ${i + 1} (${result.account || '未知'}):\n${result.message}\n`;
        } else {
             console.log(`✅ 账号 ${i + 1} (${result.account || '未知'}) 任务成功，无异常。`);
        }

        if (i < cookies.length - 1) {
            const delay = Math.floor(Math.random() * 10) + 10;
            console.log(`\n⏱️  随机等待 ${delay} 秒后处理下一个账号...`);
            await new Promise(resolve => setTimeout(resolve, delay * 1000));
        }
    }

    // --- 最终判定：只有遇到失败的账号才发送汇总通知 ---
    if (totalFailures > 0) {
        console.log(`\n⚠️ 检测到 ${totalFailures} 个账号任务失败，准备发送通知...`);
        const title = `⚠️ 百度网盘签到异常 (${totalFailures}/${cookies.length})`;
        await notifyUser(title, allFailureMessages);
    } else {
        console.log(`\n🎉 所有 ${cookies.length} 个账号任务均已成功执行，本次不发送通知。`);
    }

    console.log(`\n==== ${name} 结束 - ${new Date().toLocaleString('zh-CN')} ====`);
})();
