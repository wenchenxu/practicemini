const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action, id, fields } = event || {};
  const now = db.serverDate();

  if (!action) return { ok: false, error: 'missing action' };

  try {
    if (action === 'delete') {
      if (!id) return { ok: false, error: 'missing id' };
      const res = await db.collection('contracts').doc(id).update({
        data: { deleted: true, deletedAt: now }
      });
      return { ok: true, updated: res.stats?.updated || 0 };
    }

    if (action === 'update') {
      if (!id || !fields || typeof fields !== 'object') {
        return { ok: false, error: 'missing id or fields' };
      }
      // 只允许更新 fields 与 updatedAt（白名单）
      const payload = { fields, updatedAt: now };
      const res = await db.collection('contracts').doc(id).update({ data: payload });
      return { ok: true, updated: res.stats?.updated || 0 };
    }

    return { ok: false, error: 'unknown action' };
  } catch (e) {
    console.error('contractOps error:', e);
    return { ok: false, error: e?.message || 'update failed' };
  }
};
