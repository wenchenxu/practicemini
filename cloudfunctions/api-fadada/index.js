// 云函数入口文件
const cloud = require('wx-server-sdk');
const axios = require('axios');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const ECS_BASE = 'http://121.40.234.100:3001';
const ECS_INTERNAL_TOKEN = process.env.ECS_INTERNAL_TOKEN;

// ========== 环境与SDK初始化工具 ==========
const APP_ID = process.env.FADADA_APP_ID;
const APP_SECRET = process.env.FADADA_APP_SECRET;

async function post(path, data) {
    const url = `${ECS_BASE}${path}`;
    try {
      const res = await axios.post(url, data, {
        headers: { 'x-internal-token': ECS_INTERNAL_TOKEN, 'content-type': 'application/json' },
        timeout: 10000
      });
      return res.data;
    } catch (e) {
      if (e.response) {
        // 把平台返回体透出来，前端能看到 code/msg
        return { error: true, status: e.response.status, data: e.response.data };
      }
      throw e;
    }
  }

exports.main = async (event, context) => {
  try {
    const { action, payload = {} } = event || {};
    switch (action) {
      case 'ping': return { success: true, data: { ok: true, ts: Date.now() } };
      case 'getToken': return { success: true, data: await post('/api/esign/getToken', {}) };
      case 'getCorpAuthUrl':
        return { success: true, data: await post('/api/esign/getCorpAuthUrl', payload) };
      case 'getCorpAuthStatus':
        return { success: true, data: await post('/api/esign/getCorpAuthStatus?clientCorpId=' + encodeURIComponent(payload.clientCorpId), {}) };
      case 'getAuthUrl': return { success: true, data: await post('/api/esign/getAuthUrl', payload) };
      case 'createSignTask': return { success: true, data: await post('/api/esign/createTask', payload) };
      case 'createSignTaskV51':
        return { success: true, data: await post('/api/esign/createTaskV51', payload) };
      case 'getSignUrl': return { success: true, data: await post('/api/esign/getSignUrl', payload) };
      case 'uploadFileByUrl':
        return { success: true, data: await post('/api/esign/uploadFileByUrl', payload) };
      case 'getUploadUrl':
        return { success: true, data: await post('/api/esign/getUploadUrl', payload) };
      case 'convertFddUrlToFileId':
        return { success: true, data: await post('/api/esign/convertFddUrlToFileId', payload) };  
      case 'diag':
        return {
            success: true,
            data: await post('/api/esign/ping', {})
        };
      default: return { success: false, error: `未知 action：${action}` };
    }
  } catch (e) {
    console.error('[Proxy ERROR]', e);
    return { success: false, error: e.message || String(e) };
  }
};