// 云函数入口文件
const cloud = require('wx-server-sdk');
const axios = require('axios');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/* 旧环境设置
// 环境变量, prod / dev
const ENV = process.env.FADADA_ENV || 'dev'; // 默认 dev 分支
const IS_PROD = ENV === 'prod'; 
*/

// 动态识别当前运行的云开发环境ID (如 'prod-123456' 或 'test-789012')
// 如果你手动在 .env 中设置了 FORCE_FADADA_ENV，则优先使用手动设置
const TCB_ENV = process.env.TCB_ENV || '';
const FORCE_ENV = process.env.FORCE_FADADA_ENV || '';

// 【修改这里】如果你的正式云环境ID不包含 'prod' 或 'release'，请直接填在下面！
// 比如 'tusifu-9g8x7...'
const EXACT_PROD_ENV_ID = 'cloudbase-9gvp1n95af42e30d';

// 只要云环境ID匹配，就自动切换为生产环境
const IS_PROD = FORCE_ENV === 'prod' ||
  TCB_ENV.includes('prod') ||
  TCB_ENV.includes('release') ||
  TCB_ENV === EXACT_PROD_ENV_ID;

const APP_ID = IS_PROD
  ? process.env.FADADA_APP_ID_PROD
  : process.env.FADADA_APP_ID_DEV;

const BASE_URL = IS_PROD
  ? process.env.FADADA_BASE_URL_PROD
  : process.env.FADADA_BASE_URL_DEV;

const ECS_BASE = IS_PROD
  ? process.env.ECS_BASE_URL_PROD
  : process.env.ECS_BASE_URL_DEV;

// console.log(`[api-fadada] Using ${IS_PROD ? 'PROD' : 'DEV'} Fadada config`, { APP_ID, BASE_URL, });

// const ECS_BASE = process.env.ECS_BASE_URL || 'http://121.40.234.100:3001';
const INTERNAL_TOKEN = process.env.ECS_INTERNAL_TOKEN;

// 环境与SDK初始化工具 
// 现用 post，未使用官方格式，目前所有模块依赖此版本
async function post(path, data) {
  const url = `${ECS_BASE}${path}`;
  // [新增] 调试日志：拦截创建签署任务的请求，打印完整参数
  // 判断路径里是否包含 'createTask'，这样只拦截签署相关的接口，避免日志爆炸
  /*
  if (path.includes('createTask')) {
      console.log(`【调试-Fadada-Request】正在请求: ${path}`);
      console.log('【调试-Fadada-Payload】完整参数如下:');
      console.log(JSON.stringify(data, null, 2)); // 格式化打印 JSON
  }  */
  try {
    const res = await axios.post(url, data, {
      headers: { 'x-internal-token': INTERNAL_TOKEN, 'content-type': 'application/json' },
      timeout: 10000
    });
    return res.data;
  } catch (e) {
    if (e.response) {
      // 把平台返回体透出来，前端能看到 code/msg
      /*
      if (path.includes('createTask')) {
          console.error('【调试-Fadada-Error】API报错详情:', JSON.stringify(e.response.data, null, 2));
      }*/
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
async function saveContractEsignOld(payload) {
  const db = cloud.database();
  const { contractId, fileId, signTaskId, actorUrl, signTaskStatus } = payload || {};

  // 1) 强校验 + 打点
  // console.log('[saveContractEsign] payload =', payload);
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
  if (signTaskStatus) {
    data['esign.signTaskStatus'] = signTaskStatus;
  }

  // 统一更新时间（无论写了哪个字段）
  data['esign.updatedAt'] = db.serverDate();

  if (Object.keys(data).length === 1) { // 只有 updatedAt
    throw new Error('nothing to update');
  }

  // 3) 真正写库 + 打点
  const ret = await db.collection('contracts').doc(contractId).update({ data });
  // console.log('[saveContractEsign] update ret =', ret);

  return { ok: true, matched: ret.stats?.updated || ret.stats?.updatedDocs || 0 };
}

// [修改版] 支持旧格式 + 新格式(带.路径) + 动态字段
async function saveContractEsign(payload) {
  const db = cloud.database();
  // 1. 分离 contractId，剩下的都是要更新的数据
  const { contractId, ...updates } = payload || {};

  // console.log('[saveContractEsign] raw payload:', payload);

  if (!contractId) throw new Error('contractId required');

  const data = {};

  // 2. 遍历 payload 里的所有字段，智能处理
  for (const key in updates) {
    const val = updates[key];
    // 过滤掉无意义的值
    if (val === undefined || val === null) continue;

    // 【情况 A：新格式】如果 key 已经包含了 "esign." (例如 "esign.signTaskId", "esign.attach1FileId")
    // 直接存入，不需要处理
    if (key.startsWith('esign.')) {
      data[key] = val;
    }
    // 【情况 B：旧格式兼容】如果是旧的简写字段，手动映射到 esign.xxx
    else if (key === 'fileId') {
      data['esign.fileId'] = val;
    }
    else if (key === 'signTaskId') {
      data['esign.signTaskId'] = val;
    }
    else if (key === 'actorUrl') {
      data['esign.lastActorUrl'] = val; // 注意旧逻辑这里有改名
    }
    else if (key === 'signTaskStatus') {
      data['esign.signTaskStatus'] = val;
    }
    // 如果还有其他旧字段，可以在这里继续加 else if...
  }

  // 3. 统一更新时间
  data['esign.updatedAt'] = db.serverDate();

  // 4. 检查是否有实质更新
  // 只有 updatedAt 一个字段说明没提取到任何有效数据
  if (Object.keys(data).length === 1) {
    console.warn('[saveContractEsign] No valid fields found to update. Payload keys:', Object.keys(updates));
    // 这里返回个 ok 避免前端报错，但打印警告
    return { ok: true, matched: 0, msg: 'nothing to update' };
  }

  console.log('[saveContractEsign] Final data to update:', data);

  // 5. 执行更新
  const ret = await db.collection('contracts').doc(contractId).update({ data });

  return {
    ok: true,
    matched: ret.stats?.updated || ret.stats?.updatedDocs || 0
  };
}

async function orchestrateSignTask(payload) {
  const { contractId, fileData, esignData, mainWxFileId, signerName, signerPhone, cityCode, branchCode } = payload;

  let signTaskId = esignData?.signTaskId;
  const updatesToDb = {};
  const fddAttachs = [];

  async function processFddFile(wxFileId, realFileName, fileType) {
    const tempRes = await cloud.getTempFileURL({ fileList: [wxFileId] });
    if (!tempRes.fileList[0].tempFileURL) throw new Error(`无法获取文件临时链接: ${realFileName}`);
    const tempUrl = tempRes.fileList[0].tempFileURL;

    const upRes = await post('/api/esign/uploadFileByUrl', { url: tempUrl, fileName: realFileName, fileType });
    if (upRes.error) throw new Error(`上传 ${realFileName} 失败: ` + JSON.stringify(upRes.data || upRes));
    const fddFileUrl = upRes.result?.data?.fddFileUrl || upRes.result?.fddFileUrl;
    if (!fddFileUrl) throw new Error(`${fileType === 'attach' ? '附件' : '文档'} ${realFileName} 上传失败 (无 fddFileUrl)`);

    const cvRes = await post('/api/esign/convertFddUrlToFileId', { fddFileUrl, fileType, fileName: realFileName });
    if (cvRes.error) throw new Error(`转换 ${realFileName} ID失败: ` + JSON.stringify(cvRes.data || cvRes));
    const fddFileId = cvRes.result?.data?.fileIdList?.[0]?.fileId || cvRes.result?.fileIdList?.[0]?.fileId;
    if (!fddFileId) throw new Error(`${fileType === 'attach' ? '附件' : '文档'} ${realFileName} ID转换失败 (无 fileId)`);

    return fddFileId;
  }

  if (!signTaskId) {
    const attachKeys = Object.keys(fileData).filter(k => k.startsWith('attach') && k.endsWith('FileId'));
    const tasks = [];
    const taskKeys = [];

    for (const key of attachKeys) {
      const wxFileId = fileData[key];
      const match = key.match(/attach(\d+)FileId/);
      const indexStr = match ? match[1] : '0';

      let realFileName = `attach${indexStr}.docx`;
      if (wxFileId && typeof wxFileId === 'string') {
        const parts = wxFileId.split('/');
        if (parts.length > 0) realFileName = parts[parts.length - 1];
      }

      if (esignData?.[key]) {
        fddAttachs.push({
          attachId: `attach${indexStr}`,
          attachName: realFileName,
          attachFileId: esignData[key]
        });
        continue;
      }

      tasks.push(processFddFile(wxFileId, realFileName, 'attach'));
      taskKeys.push({ type: 'attach', key, currentAttachId: `attach${indexStr}`, currentAttachName: realFileName });
    }

    let docFileId = esignData?.docFileId || esignData?.fileId;
    if (!docFileId) {
      if (!mainWxFileId) throw new Error('未找到主合同文件');
      const safeName = signerName || `contract_${contractId.slice(-4)}`;
      const fileName = `${safeName}.pdf`;

      tasks.push(processFddFile(mainWxFileId, fileName, 'doc'));
      taskKeys.push({ type: 'doc', key: 'docFileId' });
    }

    if (tasks.length > 0) {
      const results = await Promise.all(tasks);
      for (let i = 0; i < results.length; i++) {
        const fddFileId = results[i];
        const meta = taskKeys[i];
        updatesToDb[`esign.${meta.key}`] = fddFileId;

        if (meta.type === 'attach') {
          fddAttachs.push({
            attachId: meta.currentAttachId,
            attachName: meta.currentAttachName,
            attachFileId: fddFileId
          });
        } else if (meta.type === 'doc') {
          docFileId = fddFileId;
        }
      }
    }

    const taskPayload = {
      docFileId: docFileId,
      subject: `${signerName}-租车合同`,
      signerName: signerName,
      signerId: signerPhone,
      signerPhone: signerPhone,
      cityCode: cityCode,
      branchCode: branchCode, // 暂时注释掉 branchCode，避免影响目前的苏州线上业务逻辑
      attachs: fddAttachs
    };

    const taskRes = await post('/api/esign/createTaskV51', taskPayload);
    if (taskRes.error || (!taskRes.ok && !taskRes.success)) throw new Error(taskRes.msg || JSON.stringify(taskRes.data || taskRes));

    signTaskId = taskRes.data?.signTaskId || taskRes.signTaskId || taskRes.data?.data?.signTaskId;
    if (!signTaskId) throw new Error('未返回 signTaskId');

    updatesToDb['esign.signTaskId'] = signTaskId;
    updatesToDb['esign.signTaskStatus'] = 'sent';
  }

  const actorRes = await post('/api/esign/getActorUrl', {
    signTaskId,
    actorId: signerPhone,
    clientUserId: `driver:${signerPhone}`
  });
  if (actorRes.error || (!actorRes.ok && !actorRes.success && actorRes.code !== '100000')) throw new Error(JSON.stringify(actorRes.data || actorRes));

  const actorUrl = actorRes.data?.actorSignTaskEmbedUrl || actorRes.actorSignTaskEmbedUrl || actorRes.data?.data?.actorSignTaskEmbedUrl;
  if (!actorUrl) throw new Error('未返回签署链接');

  updatesToDb['esign.lastActorUrl'] = actorUrl;

  if (Object.keys(updatesToDb).length > 0) {
    await saveContractEsign({ contractId, ...updatesToDb });
  }

  return { actorUrl, signTaskId, updatesToDb };
}

// 违章转移 / 终止违章转移 签署流程
// 文件上传已在前端完成，这里只负责 createTask + getActorUrl
async function orchestrateViolationSign(payload) {
  const { contractType, docFileId, signerName, signerPhone, cityCode, branchCode, plate } = payload;

  // 城市开通名单（在云函数控制，前端也有本地判断）
  const SUPPORTED_CITIES = ['foshan', 'huizhou'];
  if (!SUPPORTED_CITIES.includes((cityCode || '').toLowerCase())) {
    return {
      unavailable: true,
      msg: `该功能暂未在当前城市开通。`
    };
  }

  if (!signerPhone) throw new Error('缺少承租人手机号');
  if (!signerName) throw new Error('缺少承租人姓名');
  if (!docFileId) throw new Error('缺少文件 ID（docFileId），请确保前端已完成文件上传');

  const contractTypeName = contractType === 'violation_transfer' ? '违章转移' : '终止违章转移';
  const subject = `${plate || signerName}-${contractTypeName}申请`;

  // 1. 创建签署任务（使用自定义关键词）
  const taskPayload = {
    docFileId,
    subject,
    signerName,
    signerId: signerPhone,
    signerPhone,
    cityCode,
    branchCode,
    corpSealKeyword: '申请单位',   // 违章合同中公司盖章关键词
    personSignKeyword: '承租司机',    // 违章合同中个人签名关键词
    dateSignKeyword: '',             // 违章合同无日期控件
    crossPageSeal: false,            // 违章合同无骑缝章
    attachs: [],
    contractType                     // 传递给 ECS，以便其根据合同类型加载特定章
  };

  const taskRes = await post('/api/esign/createTaskV51', taskPayload);
  if (taskRes.error || (!taskRes.ok && !taskRes.success)) throw new Error(taskRes.msg || JSON.stringify(taskRes.data || taskRes));

  const signTaskId = taskRes.data?.signTaskId || taskRes.signTaskId || taskRes.data?.data?.signTaskId;
  if (!signTaskId) throw new Error('未返回 signTaskId');

  // 2. 获取签署链接
  const actorRes = await post('/api/esign/getActorUrl', {
    signTaskId,
    actorId: signerPhone,
    clientUserId: `driver:${signerPhone}`
  });
  if (actorRes.error || (!actorRes.ok && !actorRes.success && actorRes.code !== '100000')) throw new Error(JSON.stringify(actorRes.data || actorRes));

  const actorUrl = actorRes.data?.actorSignTaskEmbedUrl || actorRes.actorSignTaskEmbedUrl || actorRes.data?.data?.actorSignTaskEmbedUrl;
  if (!actorUrl) throw new Error('未返回签署链接');

  return { actorUrl, signTaskId };
}

// 返回违章模板的 cloud:// 文件 ID（前端用来 getTempFileURL）
function getViolationFileId(payload) {
  const { contractType } = payload;
  const storageBase = IS_PROD
    ? process.env.CLOUD_STORAGE_BASE_PROD
    : process.env.CLOUD_STORAGE_BASE_DEV;
  const relativePath = contractType === 'violation_transfer'
    ? process.env.VIOLATION_TRANSFER_DOCX_PATH
    : process.env.VIOLATION_TERMINATION_DOCX_PATH;

  if (!storageBase || !relativePath) throw new Error(`缺少模板文件配置（${contractType}），请检查云函数环境变量`);

  return { wxFileId: `${storageBase}/${relativePath}` };
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
      case 'getSignTaskDetail':
        return { success: true, data: await post('/api/esign/getSignTaskDetail', payload) };
      case 'saveContractEsign':
        return { success: true, data: await saveContractEsign(payload) };
      case 'orchestrateSignTask':
        return { success: true, data: await orchestrateSignTask(payload) };
      case 'orchestrateViolationSign': {
        const violationResult = await orchestrateViolationSign(payload);
        if (violationResult.unavailable) return { success: false, unavailable: true, msg: violationResult.msg };
        return { success: true, data: violationResult };
      }
      case 'getViolationFileId':
        return { success: true, data: getViolationFileId(payload) };
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
      case 'getCorpEntityList':
        return { success: true, data: await post('/api/esign/getCorpEntityList', payload) };
      case 'getBusinessIdList':
        return { success: true, data: await post('/api/esign/getBusinessIdList', payload) };
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