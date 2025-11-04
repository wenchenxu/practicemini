// cloudfunctions/checkAccess/index.js
const cloud = require('wx-server-sdk');

// 如果你的项目有多个环境，指定 prod 环境：
// cloud.init({ env: 'tusifu-prod-xxx' });
cloud.init(); // 用当前环境即可

const db = cloud.database();
const WL = db.collection('whitelist');

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  // 1) 首访自动引导：如果白名单空表，首位访问者自动成为 admin（MVP 快速启动）
  const total = (await WL.count()).total;
  if (total === 0) {
    await WL.add({
      data: { openid: OPENID, name: 'Owner', role: 'admin', createdAt: Date.now() }
    });
    return { allowed: true, role: 'admin', bootstrap: true };
  }

  // 2) 正常校验
  const { data } = await WL.where({ openid: OPENID }).limit(1).get();
  if (data.length === 0) {
    return { allowed: false };
  }
  return { allowed: true, role: data[0].role || 'staff' };
};
