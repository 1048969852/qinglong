
/**
 * 脚本说明:
 * 1. 功能: 自动使用环境变量中的账号密码登录56IDC，并通过OCR技术自动识别和输入验证码。登录成功后会抓取服务主机名。
 * 2. 环境变量:
 * - `IDC_ACCOUNTS`: 必需。格式为 "邮箱----密码"。多个账户请使用换行符分隔。
 * 例如:
 * user1@example.com----password123
 * user2@example.com----password456
 * - `TG_BOT_TOKEN`: 可选。用于发送通知的 Telegram Bot Token。
 * - `TG_USER_ID`: 可选。用于接收通知的 Telegram User ID。
 * 3. 新增功能:
 * - IP检测: 脚本运行时会先检查服务器的出口IP。如果IP归属地不是中国或检测失败，脚本将自动停止运行。
 * - 随机延迟: 脚本启动时会随机延迟0-15分钟，账户间会延迟1-2分钟。
 * - OCR优化: 内置字符白名单和单行识别模式，提高验证码识别准确率。
 * - 服务抓取: 登录成功后会记录账户下的主机名列表，并包含在TG通知中。
 * - 浏览器重启重试: 每个账号会分5轮尝试，每轮启动新浏览器并尝试3次，共15次机会。
 * 4. 依赖:
 * - NodeJs: playwright, axios, tesseract.js
 * - Linux: chromium (或 chromium-browser, 取决于您的系统)
 */

const { chromium } = require('playwright');
const axios = require('axios');
const Tesseract = require('tesseract.js');

// ==================== 全局变量 ====================
let notificationSummary = '✨ 56IDC 登录脚本执行报告\n\n';

// ==================== 工具函数 ====================
function log(message, level = 'info') {
    const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    console.log(formattedMessage);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendTgNotification(message) {
    const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
    const TG_USER_ID = process.env.TG_USER_ID;

    if (!TG_BOT_TOKEN || !TG_USER_ID) {
        log('Telegram通知环境变量未完全设置，跳过发送通知。', 'warn');
        return;
    }
    
    const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
    const MAX_LENGTH = 4096;
    const truncatedMessage = message.length > MAX_LENGTH ? message.substring(0, MAX_LENGTH - 10) + '\n...日志过长...' : message;

    const payload = {
        chat_id: TG_USER_ID,
        text: truncatedMessage,
        disable_web_page_preview: true,
        parse_mode: 'Markdown'
    };

    try {
        await axios.post(url, payload, { timeout: 10000 });
        log('✅ Telegram 通知已发送。');
    } catch (error) {
        log(`❌ 发送 Telegram 通知失败: ${error.message}`, 'error');
    }
}

async function checkIPLocation() {
    log('正在检查运行环境IP归属地...');
    try {
        const response = await axios.get('http://ip-api.com/json', { timeout: 10000 });
        const { countryCode, query } = response.data;
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
        return false; // **关键修改**: 检测失败时返回 false，停止脚本
    }
}

// ==================== 核心功能 ====================

async function loginWithRetry(page, username, password, worker, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            log(`账号 ${username} 正在进行第 ${attempt}/${maxRetries} 次登录尝试...`);
            await page.goto('https://56idc.net/login', { waitUntil: 'domcontentloaded', timeout: 35000 });

            await page.waitForSelector('#inputEmail', { timeout: 35000 });
            await page.fill('#inputEmail', username);
            await page.fill('#inputPassword', password);

            const captchaElement = await page.locator('#inputCaptchaImage');
            if (!captchaElement) throw new Error('未能找到验证码图片元素。');
            
            const imageBuffer = await captchaElement.screenshot();
            const { data: { text } } = await worker.recognize(imageBuffer);
            const captchaCode = text.replace(/[^a-zA-Z0-9]/g, '').trim();
            
            if (!captchaCode) {
                 log(`第 ${attempt} 次尝试，验证码识别结果为空，即将重试...`, 'warn');
                 await delay(2000);
                 continue;
            }
            log(`第 ${attempt} 次尝试，识别出的验证码是: ${captchaCode}`);
            await page.fill('#inputCaptcha', captchaCode);
            
            await page.locator('#login').click({ noWaitAfter: true });
            log('登录按钮已点击，正在等待成功页面...');

            await page.waitForSelector('h1:has-text("My Dashboard")', { state: 'visible', timeout: 35000 });

            log(`✅ 账号 ${username} 登录成功！`, 'info');
            
            const hostnames = await page.locator("//div[@menuitemname='Active Products/Services']//span[contains(@class, 'text-domain')]").evaluateAll(elements =>
                elements.map(el => el.innerText.trim())
            );
            
            log(`📊 账号 ${username} 下找到 ${hostnames.length} 个主机。`);

            return { success: true, services: hostnames };

        } catch (error) {
            log(`账号 ${username} 第 ${attempt} 次登录尝试出错: ${error.message}`, 'error');
        }

        if (attempt < maxRetries) {
            const waitTime = Math.floor(Math.random() * 10001) + 5000;
            log(`等待 ${waitTime / 1000} 秒后重试...`);
            await delay(waitTime);
        }
    }
    return { success: false, services: [] };
}

// ==================== 主程序 ====================

async function main() {
    log('🚀 开始执行 56IDC 登录脚本 (终极JS版)...');

    const initialDelayMinutes = Math.floor(Math.random() * 16);
    if (initialDelayMinutes > 0) {
        log(`⏰ 脚本将随机延迟 ${initialDelayMinutes} 分钟后开始执行...`);
        await delay(initialDelayMinutes * 60 * 1000);
    }

    if (!(await checkIPLocation())) {
        return;
    }

    const accountsStr = process.env.IDC_ACCOUNTS;
    if (!accountsStr) {
        log('❌ 错误: 环境变量 IDC_ACCOUNTS 未设置！', 'error');
        notificationSummary += '❌ **错误**: 环境变量 `IDC_ACCOUNTS` 未设置。';
        return;
    }

    const accounts = accountsStr.trim().split('\n').map(line => {
        const parts = line.split('----');
        return parts.length === 2 ? { username: parts[0].trim(), password: parts[1].trim() } : null;
    }).filter(Boolean);

    if (accounts.length === 0) {
        log('❌ 错误: 解析 IDC_ACCOUNTS 后未得到有效的账号信息。', 'error');
        notificationSummary += '❌ **错误**: 解析 `IDC_ACCOUNTS` 后未得到有效账号。';
        return;
    }

    log(`✅ 成功读取 ${accounts.length} 个账号信息。`);
    
    log('🔧 正在初始化OCR引擎...');
    const worker = await Tesseract.createWorker('eng', 1, {
        logger: m => { if (m.progress) log(`[Tesseract] ${m.status}: ${(m.progress * 100).toFixed(0)}%`); }
    });
    await worker.setParameters({
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });
    log('✅ OCR引擎初始化完成。');
    
    try {
        for (let i = 0; i < accounts.length; i++) {
            const account = accounts[i];
            const { username, password } = account;
            const maskedUsername = username.substring(0, 3) + '***';
            
            let result = { success: false, services: [] };
            const MAX_BROWSER_RESTARTS = 5;

            for (let restartCycle = 1; restartCycle <= MAX_BROWSER_RESTARTS; restartCycle++) {
                log(`\n🚀 开始处理账号: ${username} (浏览器启动周期 ${restartCycle}/${MAX_BROWSER_RESTARTS})`);
                let browser = null;
                try {
                    browser = await chromium.launch({
                        executablePath: '/usr/bin/chromium-browser', 
                        headless: true,
                        args: [
                            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                            '--disable-gpu', '--no-zygote', '--single-process'
                        ]
                    });
                    const context = await browser.newContext();
                    const page = await context.newPage();
                    
                    result = await loginWithRetry(page, username, password, worker, 3);
                    
                } catch (error) {
                    log(`处理账号 ${username} 的周期 ${restartCycle} 中发生严重错误: ${error.message}`, 'error');
                } finally {
                    if (browser) {
                        await browser.close();
                    }
                }
                
                if (result.success) {
                    log(`✅ 账号 ${username} 成功登录！`);
                    break; 
                } else if (restartCycle < MAX_BROWSER_RESTARTS) {
                    log(`⚠️ 账号 ${username} 在浏览器周期 ${restartCycle} 中未能成功登录，将重启浏览器并重试...`， 'warn');
                    await delay(5000);
                }
            }

            if (result.success) {
                notificationSummary += `\n✅ **账号**: \`${maskedUsername}\`\n   - **状态**: 登录成功`;
                if (result。services。length > 0) {
                    notificationSummary += '\n   - **主机列表**:\n' + result.services.map(s => `     - \`${s}\``).join('\n');
                } else {
                    notificationSummary += '\n   - **主机列表**: `无`';
                }
            } else {
                notificationSummary += `\n❌ **账号**: \`${maskedUsername}\`\n   - **状态**: 登录失败 (已达最大重试次数)`;
            }

            if (i < accounts.length - 1) {
                const interAccountDelay = Math.floor(Math.random() * (120000 - 60000 + 1)) + 60000;
                log(`⏳ 当前账户处理完毕，将随机延迟 ${Math。round(interAccountDelay / 60000)} 分钟后处理下一个账户...`);
                await delay(interAccountDelay);
            }
        }
    } catch (error) {
        log(`主程序发生严重错误: ${error.message}`, 'error');
        notificationSummary += `\n\n❌ **严重错误**: ${error.message}`;
    } finally {
        await worker。terminate();
        log('✅ OCR引擎已关闭。');
        log('✅ 所有账号处理完毕。');
        notificationSummary += '\n\n✅ 所有账号处理完毕。';
    }
}

// ==================== 启动 ====================
main()。finally(() => {
    sendTgNotification(notificationSummary);
});

