// 引入 axios 用于发起网络请求
const axios = require('axios');
// 引入青龙面板自带的通知模块
// 注意：请确保你的脚本在青龙的 scripts 目录下，因为青龙默认会在该目录下提供 sendNotify.js
const notify = require('./sendNotify'); 

// 目标链接数组 (请将此处替换为你自己的实际采集链接)
const urls = [
  "http://你的域名/api.php/provide/vod/?ac=list",
  "链接2",
  "链接3"
];

// 主函数：检查所有链接并统一发送通知
async function checkUrls() {
  console.log('🚀 开始触发 CMS 采集链接...');
  let resultMessage = '🔍 采集触发检查结果:\n\n';
  let hasFailure = false; // 标志位，用于判断是否有链接失败

  for (const url of urls) { 
    console.log(`➡️ 正在访问: ${url}`);
    try {
      // 优化1: 增加 15秒 超时限制 (timeout: 15000)，防止目标服务器卡死导致脚本无限期挂起
      // 优化2: 增加 User-Agent，模拟电脑浏览器请求，降低被拦截的概率
      const response = await axios.get(url, { 
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (response.status === 200) {
        resultMessage += `✅ 成功: ${url}\n`;
        console.log(`✅ 成功: ${url}`);
      } else {
        resultMessage += `❌ 失败: ${url} (状态码: ${response.status})\n`;
        console.error(`❌ 失败: ${url} (状态码: ${response.status})`);
        hasFailure = true; 
      }
    } catch (error) {
      resultMessage += `⚠️ 异常: ${url} (错误: ${error.message})\n`;
      console.error(`⚠️ 异常: ${url} (错误: ${error.message})`);
      hasFailure = true; 
    }

    resultMessage += '\n'; // 换行分隔
  }

  console.log('📦 所有采集链接触发完成...');

  // 优化3: 只有当有链接失败时才调用青龙通知
  if (hasFailure) {
    console.log('⚠️ 检测到失败任务，正在调用青龙面板通知...');
    // 调用青龙自带通知，第一个参数是消息标题，第二个是正文
    await notify.sendNotify("⚠️ 苹果影视站采集异常", resultMessage);
  } else {
    console.log('✅ 所有采集任务均触发成功，本次无需通知。');
  }
  
  console.log('🎉 脚本执行结束');
}

// 执行脚本
checkUrls();
