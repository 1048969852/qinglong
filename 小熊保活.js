/*
 * @name         ArcticCloud VPS 自动续期
 * @version      1.0
 * @description  用于青龙面板的 ArcticCloud VPS 自动续期脚本，并通过 Telegram 发送结果通知。续期后会抓取最新到期时间。
 * @author       (Your Name)
 * @script-type  nodejs
 *
 * =================================================================================
 *
 * 使用说明：
 * 1. **环境要求**: 此脚本需要 Node.js v18 或更高版本。
 * 2. **依赖安装**: 此脚本无任何外部 Node.js 依赖，无需安装。
 * 3. **定时任务**: 在“定时任务”中，添加此脚本并设置定时规则（例如：0 5 * * *）。
 * 4. **环境变量**: (与之前版本相同)
 *
 * - 名称: ARCTICCLOUD_TOKEN
 * 值: "用户名:密码"
 *
 * - 名称: VPS_LIST
 * 值: "ID1:名称1,ID2:名称2,..."
 * **注意**: 这里的“名称”必须与产品管理页面上显示的“产品名称”完全一致，以便脚本能正确匹配。
 *
 * - 名称: TG_BOT_TOKEN
 * 值: 您的 Telegram Bot 的 Token
 *
 * - 名称: TG_USER_ID
 * 值: 您的 Telegram 用户的 Chat ID
 *
 * =================================================================================
 */

// Node.js v18+ 已内置全局 fetch 函数，无需再导入 node-fetch 或 cheerio 模块。

let notificationSummary = '✨ ArcticCloud VPS 续期任务报告\n\n';

/**
 * 格式化日志输出
 * @param {string} message - 日志消息
 * @param {string} level - 日志级别 ('info', 'warn', 'error')
 */
function log(message, level = 'info') {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: "Asia/Shanghai", hour12: false });
    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    console.log(formattedMessage);
}

// 主执行函数
(async () => {
    try {
        log('🚀 开始执行 ArcticCloud VPS 续期脚本...');
        await randomDelay(30);

        if (!(await checkIpLocation())) {
            return;
        }

        const { ARCTICCLOUD_TOKEN, VPS_LIST } = process.env;

        if (!ARCTICCLOUD_TOKEN || !VPS_LIST) {
            const errorMsg = "❌ 关键环境变量缺失: `ARCTICCLOUD_TOKEN` 和 `VPS_LIST` 未设置。";
            log(errorMsg, 'error');
            notificationSummary += `❌ **错误**: ${errorMsg}\n`;
            return;
        }

        const [username, password] = ARCTICCLOUD_TOKEN.split(":");
        if (!username || !password) {
            const errorMsg = "❌ `ARCTICCLOUD_TOKEN` 格式错误，正确格式应为 `用户名:密码`。";
            log(errorMsg, 'error');
            notificationSummary += `❌ **错误**: ${errorMsg}\n`;
            return;
        }

        const { VPS_NAME, VPS_IDS } = parseVpsList(VPS_LIST);
        if (VPS_IDS.length === 0) {
            const errorMsg = "❌ `VPS_LIST` 格式错误或为空，请检查其格式是否为 `ID:名称,ID:名称`。";
            log(errorMsg, 'error');
            notificationSummary += `❌ **错误**: ${errorMsg}\n`;
            return;
        }

        await handleRenewal({ username, password, VPS_NAME, VPS_IDS });

    } catch (error) {
        log(`主程序发生严重错误: ${error.message}`, 'error');
        notificationSummary += `\n\n❌ **严重错误**: ${error.message}`;
    } finally {
        log('✅ 所有任务处理完毕。');
        notificationSummary += '\n\n✅ 所有任务处理完毕。';
        await sendTgNotify(notificationSummary);
    }
})();

/**
 * VPS 续期与信息提取主逻辑
 * @param {object} params - 包含所有必要配置的对象
 */
async function handleRenewal(params) {
    const { username, password, VPS_NAME, VPS_IDS } = params;
    const BASE_URL = "https://vps.polarbear.nyc.mn";

    try {
        log("正在尝试登录...");
        const loginResp = await fetch(`${BASE_URL}/index/login/`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `swapname=${encodeURIComponent(username)}&swappass=${encodeURIComponent(password)}`,
            redirect: "manual"
        });

        const cookieHeader = loginResp.headers.get("set-cookie");
        const match = /swapuuid=([^;]+)/.exec(cookieHeader || "");

        if (!match) {
            log("登录失败，请检查凭证。", 'error');
            notificationSummary += `❌ **登录失败**: 请检查您的用户名和密码是否正确。\n`;
            return;
        }

        const swapuuid = match[1];
        const cookie = `swapuuid=${swapuuid}`;
        log("登录成功。");
        notificationSummary += `✅ **登录状态**: \`成功\`\n\n---\n`;

        for (const id of VPS_IDS) {
            const name = VPS_NAME[id];
            log(`正在续期: ${name} (ID: ${id})`);

            const renewResp = await fetch(`${BASE_URL}/control/detail/${id}/pay/`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": cookie },
                redirect: "manual"
            });

            const location = renewResp.headers.get("location") || "";
            let status = "❌ 失败";
            let msg = "未知错误，无返回信息。";

            const successMatch = location.match(/success=([^&]+)/);
            const errorMatch = location.match(/error=([^&]+)/);

            if (successMatch) {
                msg = decodeURIComponent(successMatch[1]);
                status = "✅ 成功";
            } else if (errorMatch) {
                msg = decodeURIComponent(errorMatch[1]);
            }
            notificationSummary += `\n▶️ **VPS**: \`${name}\` (ID: ${id})\n   - **状态**: ${status}\n   - **信息**: \`${msg}\``;
        }

        await fetchAndParseExpiryDates(BASE_URL, cookie, VPS_NAME);

    } catch (error) {
        log(`脚本执行时发生意外错误: ${error.message}`, 'error');
        notificationSummary += `\n❌ **脚本执行时发生意外错误**\n   - **错误信息**: \`${error.message}\`\n`;
    }
}

/**
 * 访问主页，使用正则表达式解析并添加所有VPS的到期时间到通知中
 * @param {string} baseUrl - 网站基础URL
 * @param {string} cookie - 登录后的Cookie
 * @param {object} vpsNameMap - VPS ID到名称的映射
 */
async function fetchAndParseExpiryDates(baseUrl, cookie, vpsNameMap) {
    log('所有续期操作已完成，正在获取最新到期时间...');
    try {
        const response = await fetch(`${baseUrl}/control/index/`, {
            headers: { 'Cookie': cookie }
        });
        if (!response.ok) {
            throw new Error(`请求产品页面失败，状态码: ${response.status}`);
        }
        const html = await response.text();

        const expiryDates = {};
        const vpsNames = Object.values(vpsNameMap);
        
        // 使用正则表达式从HTML中提取表格行
        const tableRows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) || [];
        
        for (const row of tableRows) {
            const matchedName = vpsNames.find(name => row.includes(name));
            if (matchedName) {
                // 如果找到我们关心的VPS名称，则提取该行所有单元格
                const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
                if (cells.length >= 6) {
                    // 确认第二个单元格的内容确实是产品名称
                    const cellProductName = cells[1].replace(/<[^>]+>/g, '').trim();
                    if (cellProductName === matchedName) {
                        const expiryDate = cells[5].replace(/<[^>]+>/g, '').trim();
                        expiryDates[matchedName] = expiryDate;
                    }
                }
            }
        }

        log(`成功从页面提取 ${Object.keys(expiryDates).length} 条产品信息。`);

        let updatedSummary = '';
        const summaryLines = notificationSummary.split('\n');

        for (const line of summaryLines) {
            updatedSummary += line + '\n';
            if (line.startsWith('▶️ **VPS**')) {
                const nameMatch = line.match(/`([^`]+)`/);
                if (nameMatch && nameMatch[1]) {
                    const vpsName = nameMatch[1];
                    const date = expiryDates[vpsName];
                    if (date) {
                        updatedSummary = updatedSummary.trimEnd() + `\n   - **到期时间**: \`${date}\``;
                    }
                }
            }
        }
        notificationSummary = updatedSummary.trim();

    } catch (error) {
        log(`提取到期时间失败: ${error.message}`, 'error');
        notificationSummary += `\n\n⚠️ **警告**: 提取VPS最新到期时间失败: \`${error.message}\``;
    }
}


/**
 * 解析 VPS_LIST 字符串为 ID 数组和名称映射
 */
function parseVpsList(vpsListStr) {
    const map = {};
    const ids = [];
    if (!vpsListStr) return { VPS_NAME: map, VPS_IDS: ids };

    const pairs = vpsListStr.split(",").filter(p => p.includes(':'));
    for (const pair of pairs) {
        const [idStr, name] = pair.split(":");
        if (idStr && name) {
            const id = parseInt(idStr.trim(), 10);
            if (!isNaN(id)) {
                map[id] = name.trim();
                ids.push(id);
            }
        }
    }
    return { VPS_NAME: map, VPS_IDS: ids };
}

/**
 * 检查服务器的公网 IP 地址归属地
 */
async function checkIpLocation() {
    log('正在检查运行环境IP归属地...');
    try {
        const response = await fetch('http://ip-api.com/json', { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`API 请求失败，状态码: ${response.status}`);
        const data = await response.json();
        if (data.status !== 'success') throw new Error(`API 返回错误: ${data.message || '未知'}`);

        const { countryCode, query } = data;
        const message = `当前IP: ${query}, 国家: ${countryCode}`;
        if (countryCode === 'CN') {
            log(`✅ IP归属地检测通过。${message}`);
            notificationSummary += `📍 **IP检测**: \`✅ 检测通过, ${message}\`\n`;
            return true;
        } else {
            log(`❌ IP归属地检测不通过！${message}。脚本将停止运行。`, 'error');
            notificationSummary += `📍 **IP检测**: \`❌ 检测不通过, ${message}\`\n`;
            return false;
        }
    } catch (error) {
        log(`❌ IP归属地检测失败: ${error.message}，脚本将停止运行。`, 'error');
        notificationSummary += `📍 **IP检测**: \`❌ 检测失败, ${error.message}\`\n`;
        return false;
    }
}

/**
 * 随机延迟执行
 */
function randomDelay(maxMinutes) {
    const maxMs = maxMinutes * 60 * 1000;
    const delayMs = Math.floor(Math.random() * maxMs);
    
    if (delayMs > 0) {
        const delayMinutes = (delayMs / 60000).toFixed(2);
        log(`脚本将随机延迟 ${delayMinutes} 分钟后开始执行...`);
        return new Promise(resolve => setTimeout(resolve, delayMs));
    }
    log("无随机延迟，脚本立即开始执行...");
    return Promise.resolve();
}

/**
 * 通过 Telegram Bot 发送通知
 */
async function sendTgNotify(message) {
    const token = process.env.TG_BOT_TOKEN;
    const chatId = process.env.TG_USER_ID;

    if (!token || !chatId) {
        log("未配置 Telegram Bot Token 或 User ID，跳过发送通知。", "warn");
        return;
    }
    
    const MAX_LENGTH = 4096;
    const truncatedMessage = message.length > MAX_LENGTH ? message.substring(0, MAX_LENGTH - 15) + '\n...日志过长...' : message;

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = {
        chat_id: chatId,
        text: truncatedMessage,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (result.ok) {
            log('✅ Telegram 通知已发送。');
        } else {
            log(`❌ 发送 Telegram 通知失败: ${result.description}`, 'error');
        }
    } catch (err) {
        log(`❌ 发送 Telegram 通知时连接出错：${err.message}`, 'error');
    }
}

