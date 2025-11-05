// cloudfunctions/removeWhitelist/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const WL = db.collection('whitelist');

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { targetOpenid } = event || {};
  if (!targetOpenid) return { ok: false, msg: 'targetOpenid required' };

  // 只有管理员能删
  const me = await WL.where({ openid: OPENID }).limit(1).get();
  if (!me.data.length || (me.data[0].role !== 'admin')) {
    return { ok: false, msg: 'no-permission' };
  }

  // 防止把自己删了（可选）
  if (targetOpenid === OPENID) {
    return { ok: false, msg: 'cannot-remove-self' };
  }

  const ret = await WL.where({ openid: targetOpenid }).remove();
  return { ok: true, deleted: ret.stats.removed };
};
