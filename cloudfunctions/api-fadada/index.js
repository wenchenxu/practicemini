// 云函数入口文件
const cloud = require('wx-server-sdk');
const axios = require('axios');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const ECS_BASE = 'https://tusifu.cn';
const ECS_INTERNAL_TOKEN = process.env.ECS_INTERNAL_TOKEN;

// ========== 环境与SDK初始化工具 ==========
const APP_ID = process.env.FADADA_APP_ID;
const APP_SECRET = process.env.FADADA_APP_SECRET;

async function post(path, data) {
    const url = `${ECS_BASE}${path}`;
    const res = await axios.post(url, data, {
      headers: { 'x-internal-token': ECS_INTERNAL_TOKEN, 'content-type': 'application/json' },
      timeout: 10000
    });
    return res.data;
}

exports.main = async (event, context) => {
  try {
    const { action, payload = {} } = event || {};
    switch (action) {
      case 'ping': return { success: true, data: { ok: true, ts: Date.now() } };
      case 'getToken': return { success: true, data: await post('/api/esign/getToken', {}) };
      case 'getAuthUrl': return { success: true, data: await post('/api/esign/getAuthUrl', payload) };
      case 'createSignTask': return { success: true, data: await post('/api/esign/createTask', payload) };
      case 'getSignUrl': return { success: true, data: await post('/api/esign/getSignUrl', payload) };
      case 'uploadFileByUrl':
        return { success: true, data: await post('/api/esign/uploadFileByUrl', payload) };
      case 'diag':
        return {
            success: true,
            data: await post('/api/esign/ping', {}) // 先打 ping 看是否能通
        };
      default: return { success: false, error: `未知 action：${action}` };
    }
  } catch (e) {
    console.error('[Proxy ERROR]', e);
    return { success: false, error: e.message || String(e) };
  }
};