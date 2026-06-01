/*
 * @name         ArcticCloud VPS 自动续期 - 青龙修复版
 * @version      2.0
 * @description  修复了因网站 SSL 证书异常导致无法连接的问题。适用于青龙面板。
 * @author       (Your Name)
 * @script-type  nodejs
 *
 * =================================================================================
 * * 修复说明：
 * 1. 针对 vps.polarbear.nyc.mn 证书错误，添加了忽略 TLS 校验的全局设置。
 * 2. 保持无外部依赖特性，仅需 Node.js 18+。
 *
 * =================================================================================
 */

// 【关键修复】忽略 HTTPS 证书错误，解决 "异常错误凭证" 导致 fetch 失败的问题
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let notificationSummary = '✨ ArcticCloud VPS 续期任务报告\n\n';

/**
 * 格式化日志输出
 */
function log(message, level = 'info') {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: "Asia/Shanghai", hour12: false });
    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    console.log(formattedMessage);
}

// 主执行函数
(async () => {
    try {
        log('🚀 开始执行 ArcticCloud VPS 续期脚本 (SSL 忽略模式已开启)...');
        
        // 随机延迟防屏蔽 (默认0-50分钟，可根据需要调整)
        await randomDelay(1); 

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
            const errorMsg = "❌ `VPS_LIST` 格式错误或为空，请检查其格式。";
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
 */
async function handleRenewal(params) {
    const { username, password, VPS_NAME, VPS_IDS } = params;
    // 使用 HTTPS，但因为设置了 NODE_TLS_REJECT_UNAUTHORIZED='0'，它会忽略报错
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
            log("登录失败，可能是账号密码错误或网站验证码拦截。", 'error');
            notificationSummary += `❌ **登录失败**: 请确认账号密码，或检查网站是否开启了额外验证。\n`;
            return;
        }

        const swapuuid = match[1];
        const cookie = `swapuuid=${swapuuid}`;
        log("登录成功。");
        notificationSummary += `✅ **登录状态**: \`成功 (已绕过SSL校验)\`\n\n---\n`;

        for (const id of VPS_IDS) {
            const name = VPS_NAME[id];
            log(`正在续期: ${name} (ID: ${id})`);

            const renewResp = await fetch(`${BASE_URL}/control/detail/${id}/pay//`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": cookie },
                redirect: "manual"
            });

            const location = renewResp.headers.get("location") || "";
            let status = "❌ 失败";
            let msg = "未知错误，无重定向信息。";

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
        log(`请求过程出错: ${error.message}`, 'error');
        notificationSummary += `\n❌ **连接错误**: \`${error.message}\` (可能由于证书彻底失效或网站宕机)\n`;
    }
}

/**
 * 提取到期时间
 */
async function fetchAndParseExpiryDates(baseUrl, cookie, vpsNameMap) {
    log('正在获取最新到期时间...');
    try {
        const response = await fetch(`${baseUrl}/control/index/`, {
            headers: { 'Cookie': cookie }
        });
        if (!response.ok) throw new Error(`状态码: ${response.status}`);
        
        const html = await response.text();
        const expiryDates = {};
        const vpsNames = Object.values(vpsNameMap);
        
        const tableRows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) || [];
        
        for (const row of tableRows) {
            const matchedName = vpsNames.find(name => row.includes(name));
            if (matchedName) {
                const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
                if (cells.length >= 6) {
                    const cellProductName = cells[1].replace(/<[^>]+>/g, '').trim();
                    if (cellProductName === matchedName) {
                        const expiryDate = cells[5].replace(/<[^>]+>/g, '').trim();
                        expiryDates[matchedName] = expiryDate;
                    }
                }
            }
        }

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
        log(`到期时间获取失败: ${error.message}`, 'error');
    }
}

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

async function checkIpLocation() {
    log('正在检查运行环境IP归属地...');
    try {
        const response = await fetch('http://ip-api.com/json', { signal: AbortSignal.timeout(10000) });
        const data = await response.json();
        const { countryCode, query } = data;
        const message = `当前IP: ${query}, 国家: ${countryCode}`;
        if (countryCode === 'CN') {
            log(`✅ IP归属地检测通过。${message}`);
            return true;
        } else {
            log(`❌ IP检测未通过: ${message}。脚本停止运行。`, 'error');
            notificationSummary += `📍 **IP检测**: \`❌ 不通过, ${message}\`\n`;
            return false;
        }
    } catch (error) {
        log(`❌ IP检测接口请求失败: ${error.message}，默认继续运行。`, 'warn');
        return true; 
    }
}

function randomDelay(maxMinutes) {
    const delayMs = Math.floor(Math.random() * maxMinutes * 60 * 1000);
    if (delayMs > 0) {
        log(`随机延迟 ${(delayMs / 60000).toFixed(2)} 分钟...`);
        return new Promise(resolve => setTimeout(resolve, delayMs));
    }
    return Promise.resolve();
}

async function sendTgNotify(message) {
    const token = process.env.TG_BOT_TOKEN;
    const chatId = process.env.TG_USER_ID;
    if (!token || !chatId) return;
    
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' })
        });
        log('✅ Telegram 通知已发送。');
    } catch (err) {
        log(`❌ 通知发送失败: ${err.message}`, 'error');
    }
}
