const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const WL = db.collection('whitelist');

exports.main = async (event) => {
  const { targetOpenid, name = '', role = 'staff' } = event;
  if (!targetOpenid) return { ok: false, msg: 'targetOpenid required' };
  const exist = await WL.where({ openid: targetOpenid }).count();
  if (exist.total > 0) return { ok: true, msg: 'already exists' };
  await WL.add({ data: { openid: targetOpenid, name, role, createdAt: Date.now() } });
  return { ok: true };
};
