const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const WL = db.collection('whitelist');
const ST = db.collection('whitelist_setting');

/**
 * 内部辅助函数：检查当前调用者是否为管理员
 * 这样 grant, remove, list 等操作可以复用这套逻辑
 */
async function checkAdmin(openid) {
  const me = await WL.where({ openid }).limit(1).get();
  return me.data.length > 0 && me.data[0].role === 'admin';
}

// 1. 鉴权逻辑 (整合自 auth_checkAccess)
async function handleCheckAccess(event, openid) {
  const { auditToken } = event || {};

  // 1.1 正常白名单查询
  const me = await WL.where({ openid }).limit(1).get();
  if (me.data.length) {
    return { allowed: true, role: me.data[0].role || 'staff' };
  }

  // 1.2 审核模式 (从设置表读取)
  const stDoc = await ST.orderBy('updatedAt', 'desc').limit(1).get();
  const st = stDoc.data?.[0] || {};
  const dbCode = String(st.auditCode || '').trim();
  const inputCode = String(auditToken || '').trim();

  if (st.auditMode === true && inputCode && inputCode === dbCode) {
    return {
      allowed: true,
      role: 'staff',
      auditGrant: true,
      ttlHours: Number(st.ttlHours) || 24
    };
  }
  return { allowed: false };
}

// 2. 获取白名单列表 (整合自 auth_listWhitelist)
async function handleListWhitelist(event, openid) {
  if (!(await checkAdmin(openid))) return { ok: false, msg: 'no-permission' };

  const { page = 1, pageSize = 50, keyword = '' } = event || {};
  const _ = db.command;
  const cond = keyword
    ? _.or([
        { name: db.RegExp({ regexp: keyword, options: 'i' }) },
        { openid: db.RegExp({ regexp: keyword, options: 'i' }) },
        { role: db.RegExp({ regexp: keyword, options: 'i' }) },
      ])
    : {};

  const countRes = await WL.where(cond).count();
  const listRes = await WL.where(cond)
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  return { ok: true, data: listRes.data, count: countRes.total, page, pageSize };
}

// 3. 授权/添加用户 (整合自 auth_grantByOpenid)
async function handleGrant(event, openid) {
  // 必须是管理员才能授权他人
  if (!(await checkAdmin(openid))) return { ok: false, msg: 'no-permission' };

  const { targetOpenid, name = '', role = 'staff' } = event;
  if (!targetOpenid) return { ok: false, msg: 'targetOpenid required' };

  const exist = await WL.where({ openid: targetOpenid }).count();
  if (exist.total > 0) return { ok: true, msg: 'already exists' };

  await WL.add({ 
    data: { 
      openid: targetOpenid, 
      name, 
      role, 
      createdAt: Date.now() 
    } 
  });
  return { ok: true };
}

// 4. 移除用户 (整合自 auth_removeWhitelist)
async function handleRemove(event, openid) {
  // 必须是管理员才能移除他人
  if (!(await checkAdmin(openid))) return { ok: false, msg: 'no-permission' };

  const { targetOpenid } = event;
  if (!targetOpenid) return { ok: false, msg: 'targetOpenid required' };

  // 防止把自己删了 (可选保护)
  if (targetOpenid === openid) return { ok: false, msg: 'cannot-remove-self' };

  const ret = await WL.where({ openid: targetOpenid }).remove();
  return { ok: true, deleted: ret.stats.removed };
}

// 5. 获取 OpenID (整合自 auth_getOpenid)
async function handleGetOpenid(openid) {
  return { openid };
}

// === 主入口 ===
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { action, payload } = event; // 建议前端传参格式：{ action: 'xxx', payload: { ... } }

  try {
    switch (action) {
      case 'checkAccess':
        return await handleCheckAccess(payload, OPENID);
      case 'listWhitelist':
        return await handleListWhitelist(payload, OPENID);
      case 'grant':
        return await handleGrant(payload, OPENID);
      case 'remove':
        return await handleRemove(payload, OPENID);
      case 'getOpenid':
        return await handleGetOpenid(OPENID);
      default:
        return { ok: false, msg: `Unknown action: ${action}` };
    }
  } catch (err) {
    console.error(`[authOps] Action ${action} failed:`, err);
    return { ok: false, msg: err.message };
  }
};