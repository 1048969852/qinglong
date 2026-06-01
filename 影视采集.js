// 引入 axios 用于发起网络请求
const axios = require('axios');
// 引入青龙面板自带的通知模块
const notify = require('./sendNotify'); 

// 目标链接数组 (请将此处替换为你自己的实际采集链接)
const urls = [
  "http://你的域名/api.php/provide/vod/?ac=list",
  "链接2",
  "链接3"
];

// 辅助函数：延时等待 (用于重试前缓冲)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 主函数：检查所有链接
async function checkUrls() {
  console.log('🚀 开始触发 CMS 采集链接...');
  
  // 只记录失败信息的变量
  let failureMessage = '🔍 以下采集链接经多次尝试后依然失败:\n\n';
  let hasFailure = false; // 判断是否有最终失败的链接

  const maxRetries = 2; // 设置失败后重试的次数（不包含首次正常访问）

  for (const url of urls) { 
    console.log(`\n➡️ 开始处理: ${url}`);
    let isSuccess = false;
    let lastErrorDetails = ''; // 记录最后一次失败的具体原因

    // 循环访问：首次(0) + 重试次数
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let attemptLabel = attempt === 0 ? "首次访问" : `第 ${attempt} 次重试`;
      
      try {
        const response = await axios.get(url, { 
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });

        if (response.status === 200) {
          console.log(`✅ ${attemptLabel}成功!`);
          isSuccess = true;
          break; // 成功则跳出当前链接的重试循环
        } else {
          lastErrorDetails = `状态码: ${response.status}`;
          console.error(`❌ ${attemptLabel}失败 (${lastErrorDetails})`);
        }
      } catch (error) {
        lastErrorDetails = `错误: ${error.message}`;
        console.error(`⚠️ ${attemptLabel}异常 (${lastErrorDetails})`);
      }

      // 如果还没成功，且还有重试次数，则等待 3 秒后再试
      if (!isSuccess && attempt < maxRetries) {
        console.log(`⏳ 等待 3 秒后进行重试...`);
        await sleep(3000);
      }
    }

    // 经历所有重试后，依然没有成功，则记录到失败通知列表中
    if (!isSuccess) {
      hasFailure = true;
      failureMessage += `🔗 链接: ${url}\n❌ 原因: ${lastErrorDetails}\n\n`;
    }
  }

  console.log('\n📦 所有采集链接处理完成...');

  // 只有当有最终失败的链接时才调用青龙通知，并且内容只包含失败的链接
  if (hasFailure) {
    console.log('⚠️ 存在最终失败的任务，正在发送青龙面板通知...');
    await notify.sendNotify("⚠️ 苹果影视站采集失败", failureMessage);
  } else {
    console.log('🎉 所有采集任务均已成功触发（无失败记录），本次不发送通知。');
  }
}

// 执行脚本
checkUrls();
