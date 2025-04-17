// 此脚本的作用是基于cms10苹果影视站的定时采集功能 结合此脚本进行访问采集链接 从而实现自动采集
// 建议脚本运行规则设置为 0 */6 * * *  即 每六个小时运行一次 
const axios = require('axios');

// 目标链接数组
const urls = [
  "链接1",
  "链接2",
  "链接3"
];

// Telegram Bot 配置
const TELEGRAM_TOKEN = 'TG TOKEN';
const TELEGRAM_CHAT_ID = 'TG ID';

// 发送 Telegram 消息的函数
async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
    });
    console.log('📩 Telegram 通知发送成功');
  } catch (error) {
    console.error('发送 Telegram 消息失败:', error);
  }
}

// 主函数：检查所有链接并统一发送通知
async function checkUrls() {
  console.log('🚀 开始链接检查');
  let resultMessage = '🔍 链接检查结果:\n\n';

  for (const url of urls) {
    console.log(`➡️ 正在访问: ${url}`);
    try {
      const response = await axios.get(url);

      if (response.status === 200) {
        resultMessage += `✅ 链接成功: ${url}\n`;
        console.log(`✅ 链接成功: ${url}`);
      } else {
        resultMessage += `❌ 链接失败: ${url}, 状态码: ${response.status}\n`;
        console.error(`❌ 链接失败: ${url}, 状态码: ${response.status}`);
      }
    } catch (error) {
      resultMessage += `⚠️ 访问异常: ${url}, 错误: ${error.message}\n`;
      console.error(`⚠️ 访问异常: ${url}, 错误: ${error.message}`);
    }

    resultMessage += '\n'; // 空行分隔
  }

  console.log('📦 所有链接检查完成，发送通知...');
  await sendTelegramMessage(resultMessage);
  console.log('✅ 执行完成');
}

// 执行
checkUrls();
