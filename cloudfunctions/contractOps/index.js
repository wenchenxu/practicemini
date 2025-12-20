const cloud = require('wx-server-sdk');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const fetch = require('node-fetch');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL = db.collection('contracts');

// —— 公用工具（与 createContract 保持一致）——
function pad(n, width = 2) { return String(n).padStart(width, '0'); }

function sanitizePathComponent(input) {
  if (!input) return '';
  return String(input).trim().replace(/[\\/]/g, '-');
}

function buildContractFolderPath(opts) {
  const { cityCode, branchCode, contractType, serialFormatted, driverName } = opts;
  const branchFolder = branchCode || 'default';
  const typeFolder = contractType || 'default';
  const safeName = sanitizePathComponent(driverName);
  const folderName = safeName ? `${serialFormatted}-${safeName}` : serialFormatted;
  return `contracts/${cityCode}/${branchFolder}/${typeFolder}/${folderName}`;
}

function numberToCN(n) {
  // 与前端一致的版本（可复用/精简）
  if (n === null || n === undefined || n === '') return '';
  const units = '仟佰拾亿仟佰拾万仟佰拾元角分';
  const chars = '零壹贰叁肆伍陆柒捌玖';
  let s = (Math.round(Number(n) * 100)).toString();
  if (!/^\d+$/.test(s)) return '';
  if (s === '0') return '零元整';
  let u = units.slice(units.length - s.length);
  let str = '';
  for (let i = 0; i < s.length; i++) str += chars[Number(s[i])] + u[i];
  str = str.replace(/零角零分$/, '整').replace(/零分$/, '整')
    .replace(/零角/g, '零').replace(/零仟|零佰|零拾/g, '零')
    .replace(/零{2,}/g, '零').replace(/零亿/g, '亿')
    .replace(/零万/g, '万').replace(/零元/g, '元')
    .replace(/亿万/g, '亿').replace(/零整$/, '整');
  return str;
}

function toNum(x) {
  // 支持字符串/空值，返回数字，非法则为 0
  const n = Number(x);
  return isFinite(n) ? n : 0;
}


// 业务时区（与 createContract 一致）
const BIZ_TZ = 'Asia/Shanghai';
function nowInTZ(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return { y, m, d, ymd: `${y}${m}${d}` };
}

// 模板映射 
const ENV_BASE = 'cloud://cloudbase-9gvp1n95af42e30d.636c-cloudbase-9gvp1n95af42e30d-1379075990';

const TPL_DIR = {
  branch: 'contractTemplate/branches', // branches/<branchCode>/<contractType>.docx
  city: 'contractTemplate/cities',   // cities/<cityCode>/<contractType>.docx
  type: 'contractTemplate/types',    // types/<contractType>.docx
  def: 'contractTemplate/defaults/default.docx' // 最终兜底
};

// 顺序尝试下载模板：分公司+类型 → 城市+类型 → 类型 → 默认
async function pickTemplateBuffer(opts) {
  const { cityCode, branchCode, contractType } = opts;

  // 按你的环境前缀与目录约定来（请确保 ENV_BASE 正确）
  const candidates = [];
  if (branchCode) {
    candidates.push(`${ENV_BASE}/${TPL_DIR.branch}/${branchCode}/${contractType}.docx`);
  }
  candidates.push(`${ENV_BASE}/${TPL_DIR.city}/${cityCode}/${contractType}.docx`);
  candidates.push(`${ENV_BASE}/${TPL_DIR.type}/${contractType}.docx`);
  candidates.push(`${ENV_BASE}/${TPL_DIR.def}`);

  for (const fileID of candidates) {
    try {
      const res = await cloud.downloadFile({ fileID });
      // console.log('[tpl] use', fileID);
      return { fileID, buffer: res.fileContent }; // 命中后直接带回 buffer
    } catch (e) {
      // console.log('[tpl] miss', fileID);
    }
  }
  throw new Error('no template available');
}

// 渲染并覆盖上传（不改编号、不改路径）

async function renderDocxForContract(doc) {
  const { cityCode, branchCode, contractType, fields, cityName, branchName, contractTypeName, _id } = doc;
  const serialFormatted = fields.contractSerialNumberFormatted;

  // 修正这里的命名
  const { y, m, d } = nowInTZ(BIZ_TZ);

  const folderBase = buildContractFolderPath({
    cityCode,
    branchCode,
    contractType,
    serialFormatted,
    driverName: fields.clientName
  });

  // 1) 选模板并渲染 DOCX
  const { fileID: TEMPLATE_FILE_ID, buffer: content } = await pickTemplateBuffer({ cityCode, branchCode, contractType });
  const zip = new PizZip(content);
  const docx = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: '[[', end: ']]' } });

  const dataForDocx = {
    contractNo: serialFormatted,
    contractDate: `${y}-${m}-${d}`,
    cityName: cityName,
    branchName: branchName || '',
    contractTypeName: contractTypeName,

    clientName: fields.clientName,
    clientId: fields.clientId,
    clientPhone: fields.clientPhone,
    clientAddress: fields.clientAddress,
    clientEmergencyContact: fields.clientEmergencyContact,
    clientEmergencyPhone: fields.clientEmergencyPhone,

    carModel: fields.carModel,
    carColor: fields.carColor,
    carPlate: fields.carPlate,
    carVin: fields.carVin,

    contractValidPeriodStart: fields.contractValidPeriodStart,
    contractValidPeriodEnd: fields.contractValidPeriodEnd,
    rentDurationMonth: fields.rentDurationMonth,

    rentMonthly: fields.rentMonthly,
    rentMonthlyFormal: fields.rentMonthlyFormal,
    rentToday: fields.rentToday,
    rentTodayFormal: fields.rentTodayFormal,
    rentPaybyDayInMonth: fields.rentPaybyDayInMonth,

    deposit: fields.deposit,
    depositFormal: fields.depositFormal,
    depositToday: fields.depositToday,
    depositTodayFormal: fields.depositTodayFormal,
    depositServiceFee: fields.depositServiceFee,
    depositServiceFeeFormal: fields.depositServiceFeeFormal,

    depositRemaining: fields.depositRemaining,
  };

  try { docx.render(dataForDocx); }
  catch (e) {
    console.error('DOCX render error:', e);
    return { ok: false, error: 'render-failed' };
  }

  const outBuf = docx.getZip().generate({ type: 'nodebuffer' });

  // 2) 覆盖上传 DOCX
  const upDocx = await cloud.uploadFile({
    cloudPath: `${folderBase}/${serialFormatted}.docx`,
    fileContent: outBuf,
  });
  const docxFileID = upDocx.fileID;
  // console.log('[render] upload docx ok:', docxFileID);

  // 3) 通过 CI 把 DOCX 转 PDF （拿临时 URL + ci-process）
  const tmp = await cloud.getTempFileURL({ fileList: [docxFileID] });
  const docxUrl = tmp?.fileList?.[0]?.tempFileURL;
  if (!docxUrl) {
    console.error('[render] getTempFileURL failed', tmp);
    // 至少回写 docx，避免前端完全没法打开
    await COL.doc(_id).update({
      data: { file: { docxFileID }, updatedAt: db.serverDate() }
    });
    return { ok: true, fileID: docxFileID, docxFileID, warning: 'tempfileurl-failed' };
  }

  const ciUrl = docxUrl + (docxUrl.includes('?') ? '&' : '?') + 'ci-process=doc-preview&dstType=pdf';

  let pdfBuf = null;
  try {
    const resp = await fetch(ciUrl);
    const ctype = resp.headers.get('content-type') || '';
    const buf = await resp.buffer();

    // 粗检：必须是 PDF 且非空
    if (!resp.ok || !/application\/pdf/i.test(ctype) || buf.length < 10 || buf.slice(0, 5).toString() !== '%PDF-') {
      console.error('[render] CI convert not pdf:', { ok: resp.ok, status: resp.status, ctype, head: buf.slice(0, 5).toString(), size: buf.length });
      // 回写 docx，返回成功（前端可回退打开 docx）
      await COL.doc(_id).update({
        data: { file: { docxFileID }, updatedAt: db.serverDate() }
      });
      return { ok: true, fileID: docxFileID, docxFileID, warning: 'pdf-invalid' };
    }
    pdfBuf = buf;
  } catch (e) {
    console.error('[render] CI convert failed:', e);
    await COL.doc(_id).update({
      data: { file: { docxFileID }, updatedAt: db.serverDate() }
    });
    return { ok: true, fileID: docxFileID, docxFileID, warning: 'pdf-fetch-failed' };
  }

  // 4) 上传 PDF 并回写
  const upPdf = await cloud.uploadFile({
    cloudPath: `${folderBase}/${serialFormatted}.pdf`,
    fileContent: pdfBuf,
  });
  const pdfFileID = upPdf.fileID;
  // console.log('[render] upload pdf ok:', pdfFileID);

  await COL.doc(_id).update({
    data: {
      file: { pdfFileID },
      updatedAt: db.serverDate()
    }
  });

  try {
    await cloud.deleteFile({ fileList: [docxFileID] });
  } catch (e) {
    console.warn('[render] delete docx after pdf upload failed', e);
  }

  // 5) 返回给前端：优先 pdf
  return { ok: true, fileID: pdfFileID, pdfFileID };
}

exports.main = async (event, context) => {
  const { action } = event || {};
  try {
    if (action === 'update') {
      const { id, fields } = event;
      if (!id || !fields) return { ok: false, error: 'missing-id-or-fields' };

      // —— 服务器端轻量复算（与 createContract 一致）
      const rentMonthlyNum = toNum(fields.rentMonthly);
      const depositTodayNum = toNum(fields.depositToday);
      const depositRemaining = +(rentMonthlyNum - depositTodayNum).toFixed(2);

      const patched = Object.assign({}, fields, {
        rentMonthlyFormal: numberToCN(rentMonthlyNum),
        rentTodayFormal: numberToCN(toNum(fields.rentToday)),
        depositFormal: numberToCN(toNum(fields.deposit)),
        depositTodayFormal: numberToCN(toNum(fields.depositToday)),
        depositServiceFeeFormal: numberToCN(toNum(fields.depositServiceFee)),
        depositRemaining,
      });

      const up = await COL.doc(id).update({
        data: { fields: patched, updatedAt: db.serverDate() }
      });

      return { ok: true, updated: up.stats ? up.stats.updated : 1 };
    }

    if (action === 'render') {
      const { id } = event;
      if (!id) return { ok: false, error: 'missing-id' };

      const getRes = await COL.doc(id).get();
      if (!getRes || !getRes.data) return { ok: false, error: 'not-found' };

      const doc = getRes.data;
      const rr = await renderDocxForContract(doc);
      return rr;
    }

    if (action === 'delete') {
      const { id } = event;
      if (!id) return { ok: false, error: 'missing-id' };

      const db = cloud.database();
      const COL = db.collection('contracts');

      try {
        const up = await COL.doc(id).update({
          data: {
            deleted: true,
            deletedAt: db.serverDate(),
            // deletedBy: openid  // 如需记录操作者，可在前端把 openid 传进来或在云端从 context 取
          }
        });
        // console.log('[contractOps] delete ok', id, up);
        return { ok: true, deleted: (up.stats ? up.stats.updated : 1) };
      } catch (e) {
        console.error('[contractOps] delete error', e);
        return { ok: false, error: e.message || 'delete-failed' };
      }
    }

    return { ok: false, error: 'unknown-action' };
  } catch (e) {
    console.error('[contractOps error]', e);
    return { ok: false, error: e && e.message ? e.message : 'failed' };
  }
};
