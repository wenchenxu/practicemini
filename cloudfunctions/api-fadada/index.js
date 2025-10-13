// 云函数入口文件
const cloud = require('wx-server-sdk');
const Fadada = require('@fddnpm/fasc-openapi-node-sdk');
const path = require('path');

// 加载 .env （云函数部署后也可在环境变量里配置，优先级自行把控）
require('dotenv').config({ path: path.join(__dirname, '.env') });

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// ========== 环境与SDK初始化工具 ==========
const APP_ID = process.env.FADADA_APP_ID;
const APP_SECRET = process.env.FADADA_APP_SECRET;
const BASE_URL = process.env.FADADA_BASE_URL || 'https://uat-api.fadada.com/api/v5/';

if (!APP_ID || !APP_SECRET) {
  console.warn('[FADADA] 请在 .env 中配置 FADADA_APP_ID/FADADA_APP_SECRET');
}

// 统一创建 client 的工厂（按模块复用）
function makeClient(ClientCtor, accessToken = '') {
  return new ClientCtor({
    credential: {
      appId: APP_ID,
      appSecret: APP_SECRET,
      accessToken
    },
    serverUrl: BASE_URL
  });
}

// 简易内存 token 缓存（云函数实例有冷启动，命中率够用；生产可改 redis）
let tokenCache = { value: '', exp: 0 };

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.value && tokenCache.exp - now > 5_000) return tokenCache.value;

  const ServiceClient = Fadada.serviceClient?.Client || Fadada.ServiceClient?.Client;
  if (!ServiceClient) throw new Error('SDK中缺少 ServiceClient 模块');

  const serviceClient = makeClient(ServiceClient);
  // 注意：具体方法名以你下载的 SDK 为准，有的叫 getAccessToken / getAuthToken
  const resp = await serviceClient.getAccessToken();
  const token = resp?.data?.accessToken || resp?.accessToken;
  const expiresIn = resp?.data?.expiresIn || resp?.expiresIn || 3600;

  if (!token) throw new Error('获取 accessToken 失败：返回为空');

  tokenCache = { value: token, exp: now + expiresIn * 1000 };
  return token;
}

// ========== 业务动作实现（最小可跑通） ==========
async function actionPing() {
  return { ok: true, ts: Date.now() };
}

async function actionGetToken() {
  const accessToken = await getAccessToken();
  return { accessToken };
}

async function actionGetAuthUrl({ clientUserId, redirectUrl, authScopes }) {
  if (!clientUserId) throw new Error('缺少 clientUserId');

  const accessToken = await getAccessToken();
  const EUIClient = Fadada.euiClient?.Client || Fadada.EUIClient?.Client;
  if (!EUIClient) throw new Error('SDK中缺少 EUIClient 模块');

  const eui = makeClient(EUIClient, accessToken);

  // 字段名以 SDK 文档为准：示例常见为 getUserAuthUrl
  const payload = {
    clientUserId,
    requestAuthScope: authScopes || ['ident_info', 'signtask_init', 'signtask_info', 'signtask_file'],
    redirectUrl: redirectUrl || 'https://example.com/after-auth'
  };

  const resp = await eui.getUserAuthUrl(payload);
  // 常见返回 { data: { url: 'xxx' } }；兼容多种包体
  return resp?.data || resp;
}

async function actionCreateSignTask({ subject, fileId, signerClientUserId }) {
  if (!subject) subject = `测试合同-${new Date().toISOString().slice(0, 10)}`;
  if (!fileId) throw new Error('缺少 fileId（建议先在法大大侧准备一个测试文件/模板并拿到 fileId）');
  if (!signerClientUserId) throw new Error('缺少 signerClientUserId');

  const accessToken = await getAccessToken();
  const SignTaskClient = Fadada.signTaskClient?.Client || Fadada.SignTaskClient?.Client;
  if (!SignTaskClient) throw new Error('SDK中缺少 SignTaskClient 模块');

  const signTask = makeClient(SignTaskClient, accessToken);

  // 重要：不同SDK字段可能略有差异，这里给出“最常见形态”
  const reqBody = {
    subject,
    files: [{ fileId }],
    signers: [{ clientUserId: signerClientUserId, signOrder: 1 }]
    // 你也可以增加回调地址、截止时间等字段
  };

  const resp = await signTask.createTask(reqBody);
  return resp?.data || resp;
}

async function actionGetSignUrl({ signTaskId }) {
  if (!signTaskId) throw new Error('缺少 signTaskId');

  const accessToken = await getAccessToken();
  const EUIClient = Fadada.euiClient?.Client || Fadada.EUIClient?.Client;
  if (!EUIClient) throw new Error('SDK中缺少 EUIClient 模块');

  const eui = makeClient(EUIClient, accessToken);

  // 字段名以 SDK 为准，常见为 getSignTaskPageUrl({ signTaskId })
  const resp = await eui.getSignTaskPageUrl({ signTaskId });
  return resp?.data || resp;
}

// 云函数入口
exports.main = async (event, context) => {
  try {
    const { action, payload = {} } = event || {};
    switch (action) {
      case 'ping': return { success: true, data: await actionPing() };
      case 'getToken': return { success: true, data: await actionGetToken() };
      case 'getAuthUrl': return { success: true, data: await actionGetAuthUrl(payload) };
      case 'createSignTask': return { success: true, data: await actionCreateSignTask(payload) };
      case 'getSignUrl': return { success: true, data: await actionGetSignUrl(payload) };
      default:
        return { success: false, error: `未知 action：${action}` };
    }
  } catch (err) {
    console.error('[FADADA ERROR]', err);
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
};
