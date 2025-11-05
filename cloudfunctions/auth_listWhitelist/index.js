// cloudfunctions/listWhitelist/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const WL = db.collection('whitelist');

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  // 只有管理员能查看
  const me = await WL.where({ openid: OPENID }).limit(1).get();
  if (!me.data.length || (me.data[0].role !== 'admin')) {
    return { ok: false, msg: 'no-permission' };
  }

  const { page = 1, pageSize = 50, keyword = '' } = event || {};
  const _ = db.command;
  const cond = keyword
    ? _.or([
        { name: db.RegExp({ regexp: keyword, options: 'i' }) },
        { openid: db.RegExp({ regexp: keyword, options: 'i' }) },
        { role: db.RegExp({ regexp: keyword, options: 'i' }) },
      ])
    : {};

  const count = (await WL.where(cond).count()).total;
  const data = (await WL.where(cond)
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()).data;

  return { ok: true, data, count, page, pageSize };
};
