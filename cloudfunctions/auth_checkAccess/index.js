const cloud = require('wx-server-sdk');
cloud.init();

const db = cloud.database();
const WL = db.collection('whitelist');
const ST = db.collection('whitelist_setting'); // 自定义的集合名

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { auditToken } = event || {};

  // 0) 首访自动引导：空表时把首位访问者设为 admin
  const total = (await WL.count()).total;
  if (total === 0) {
    await WL.add({
      data: { openid: OPENID, name: 'Owner', role: 'admin', createdAt: Date.now() }
    });
    return { allowed: true, role: 'admin', bootstrap: true };
  }

  // 1) 正常白名单
  const me = await WL.where({ openid: OPENID }).limit(1).get();
  if (me.data.length) {
    return { allowed: true, role: me.data[0].role || 'staff' };
  }

  // 2) 审核模式（仅在你开启时）
  // 期待 whitelist_setting 集合里有一条记录：
  const stDoc = await ST.limit(1).get();
  const st = stDoc.data?.[0] || {};
  if (st.auditMode === true && auditToken && auditToken === st.auditCode) {
    // 审核放行：不写白名单，返回临时票据信息
    return {
      allowed: true,
      role: 'staff',
      auditGrant: true,
      ttlHours: st.ttlHours || 24
    };
  }

  // 3) 默认无权限
  return { allowed: false };
};
