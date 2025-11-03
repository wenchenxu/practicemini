// 云函数入口文件
const cloud = require('wx-server-sdk');
const axios = require('axios');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const ECS_BASE = process.env.ECS_BASE_URL || 'http://121.40.234.100:3001';
const INTERNAL_TOKEN = process.env.ECS_INTERNAL_TOKEN;

// ========== 环境与SDK初始化工具 ==========
const APP_ID = process.env.FADADA_APP_ID;
const APP_SECRET = process.env.FADADA_APP_SECRET;

// 旧版 post，未使用官方格式，可用
async function post(path, data) {
    const url = `${ECS_BASE}${path}`;
    try {
      const res = await axios.post(url, data, {
        headers: { 'x-internal-token': INTERNAL_TOKEN, 'content-type': 'application/json' },
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

// 根据官方文档的格式，未调用，待测试
async function post2(path, data) {
    const base = process.env.ECS_BASE_URL;
    const resp = await axios.post(base + path, data, {
      headers: {
        'x-internal-token': process.env.INTERNAL_TOKEN
      },
      timeout: 10000
    });
    return resp.data;
  }

exports.main = async (event, context) => {
  try {
    const { action, payload = {} } = event || {};
    switch (action) {
      case 'ping': return { success: true, data: { ok: true, ts: Date.now() } };
      // 签合同最简流程
      case 'getToken': return { success: true, data: await post('/api/esign/getToken', {}) };
      case 'uploadFileByUrl':
        return { success: true, data: await post('/api/esign/uploadFileByUrl', payload) };
      case 'convertFddUrlToFileId':
        return { success: true, data: await post('/api/esign/convertFddUrlToFileId', payload) }; 
      case 'createSignTaskV51':
        return { success: true, data: await post('/api/esign/createTaskV51', payload) };
      case 'getActorUrl': 
        return { success: true, data: await post('/api/esign/getActorUrl', payload) };
      //其他功能，待验证，未使用官方 Pre-request Script
      case 'getCorpAuthUrl':
        return { success: true, data: await post('/api/esign/getCorpAuthUrl', payload) };
      case 'getCorpAuthStatus':
        return { success: true, data: await post('/api/esign/getCorpAuthStatus?clientCorpId=' + encodeURIComponent(payload.clientCorpId), {}) };
      case 'getAuthUrl': return { success: true, data: await post('/api/esign/getAuthUrl', payload) };
      case 'createSignTask': return { success: true, data: await post('/api/esign/createTask', payload) };
      case 'getSignUrl': return { success: true, data: await post('/api/esign/getSignUrl', payload) };
      case 'getUploadUrl':       // 直传本地文件，不使用
        return { success: true, data: await post('/api/esign/getUploadUrl', payload) }; 
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