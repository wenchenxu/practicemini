// 云函数入口文件
const cloud = require('wx-server-sdk');
const axios = require('axios');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });


// 环境变量, prod / dev
const ENV = process.env.FADADA_ENV || 'dev'; // 默认 dev 分支
const IS_PROD = ENV === 'prod';

const APP_ID = IS_PROD
  ? process.env.FADADA_APP_ID_PROD
  : process.env.FADADA_APP_ID_DEV;

const BASE_URL = IS_PROD
  ? process.env.FADADA_BASE_URL_PROD
  : process.env.FADADA_BASE_URL_DEV;

const ECS_BASE = IS_PROD
  ? process.env.ECS_BASE_URL_PROD
  : process.env.ECS_BASE_URL_DEV;

console.log(`[api-fadada] Using ${IS_PROD ? 'PROD' : 'DEV'} Fadada config`, {
    APP_ID,
    BASE_URL,
  });

// const ECS_BASE = process.env.ECS_BASE_URL || 'http://121.40.234.100:3001';
const INTERNAL_TOKEN = process.env.ECS_INTERNAL_TOKEN;

// 环境与SDK初始化工具 
// 现用 post，未使用官方格式，目前所有模块依赖此版本
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

// （未使用）官方文档格式 post，需要按需修改 getToken, uploadFileByUrl 和convertFddUrlToFileId。否则会崩
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

// 仅针对 TCB 写库，不经 ECS
async function saveContractEsign(payload) {
    const db = cloud.database();
    const { contractId, fileId, signTaskId, actorUrl } = payload || {};
  
    // 1) 强校验 + 打点
    console.log('[saveContractEsign] payload =', payload);
    if (!contractId) throw new Error('contractId required');
  
    // 2) 只构造“有值”的字段（避免 undefined 写进去）
    const data = {};
    if (fileId) {
      data['esign.fileId'] = fileId;
    }
    if (signTaskId) {
      data['esign.signTaskId'] = signTaskId;
    }
    if (actorUrl) {
      data['esign.lastActorUrl'] = actorUrl;
    }
    // 统一更新时间（无论写了哪个字段）
    data['esign.updatedAt'] = db.serverDate();
  
    if (Object.keys(data).length === 1) { // 只有 updatedAt
      throw new Error('nothing to update');
    }
  
    // 3) 真正写库 + 打点
    const ret = await db.collection('contracts').doc(contractId).update({ data });
    console.log('[saveContractEsign] update ret =', ret);
  
    return { ok: true, matched: ret.stats?.updated || ret.stats?.updatedDocs || 0 };
  }
  
exports.main = async (event, context) => {
  try {
    const { action, payload = {} } = event || {};
    switch (action) {
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
      case 'saveContractEsign':
        return { success: true, data: await saveContractEsign(payload) };
      case 'getOwnerDownloadUrl':
        return { success: true, data: await post('/api/esign/getOwnerDownloadUrl', payload) };            
      //其他功能，未使用官方 Pre-request Script，待验证/修改
      case 'getCorpAuthUrl':
        return { success: true, data: await post('/api/esign/getCorpAuthUrl', payload) };
      case 'getCorpAuthStatus':
        return { success: true, data: await post('/api/esign/getCorpAuthStatus?clientCorpId=' + encodeURIComponent(payload.clientCorpId), {}) };
      case 'getAuthUrl': return { success: true, data: await post('/api/esign/getAuthUrl', payload) };
      case 'createSignTask': return { success: true, data: await post('/api/esign/createTask', payload) };
      case 'getSignUrl': return { success: true, data: await post('/api/esign/getSignUrl', payload) };
      case 'getUploadUrl':       // 直传本地文件，不使用
        return { success: true, data: await post('/api/esign/getUploadUrl', payload) }; 
      case 'getEnvInfo':
        return { success: true, env: process.env.FADADA_ENV || 'dev' };
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