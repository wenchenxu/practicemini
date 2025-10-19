console.log('[createContract boot]');
// 云函数入口文件
const cloud = require('wx-server-sdk');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
// const _ = db.command;

function pad(n, width=2){ return String(n).padStart(width,'0'); }

//人民币自动转换成大写
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

// 业务时区
const BIZ_TZ = 'Asia/Shanghai';
function nowInTZ(tz) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;
    return { y, m, d, ymd: `${y}${m}${d}` };
}

// 模板映射 
const ENV_BASE = 'cloud://cloudbase-9gvp1n95af42e30d.636c-cloudbase-9gvp1n95af42e30d-1379075990';

// 约定的模板目录（按需修改二级目录名即可）
const TPL_DIR = {
    branch:  'contractTemplate/branches', // branches/<branchCode>/<contractType>.docx
    city:    'contractTemplate/cities',   // cities/<cityCode>/<contractType>.docx
    type:    'contractTemplate/types',    // types/<contractType>.docx
    def:     'contractTemplate/defaults/default.docx' // 最终兜底
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
      console.log('[tpl] use', fileID);
      return { fileID, buffer: res.fileContent }; // 命中后直接带回 buffer
    } catch (e) {
      console.log('[tpl] miss', fileID);
    }
  }
  throw new Error('no template available');
}

exports.main = async function (event, context) {
  try {
    var cityCode       = event.cityCode;
    var cityName       = event.cityName || '';
    var branchCode     = event.branchCode || null;
    var branchName     = event.branchName || '';
    var contractType   = event.contractType || 'rent_std';
    var contractTypeName = event.contractTypeName || '标准租赁合同';
    var payload        = event.payload || {};

    if (!cityCode) throw new Error('cityCode required');

    // 用服务端时间，避免前端时区
    const { y: yyyy, m: mm, d: dd, ymd: dateStr } = nowInTZ(BIZ_TZ);
    console.log('[ts]', `${yyyy}-${mm}-${dd}`, 'dateStr=', dateStr, 'tz=', BIZ_TZ);

    // === 编号 aa 与流水作用域 ===
    var AA_BY_BRANCH = { gzh_a: 'GZ1', gzh_b: 'GZ2' };
    var AA_DEFAULT_PER_CITY = { guangzhou:'GZ', foshan:'FS', huizhou: 'HZ', jiaxing: 'JX', shaoxing: 'SX', changzhou: 'CZ', nantong: 'NT', suzhou: 'SZ'};
    var aa = (branchCode && AA_BY_BRANCH[branchCode]) || AA_DEFAULT_PER_CITY[cityCode] || 'XX';
    var scopeKey = branchCode || cityCode; // 分公司优先，否则用城市
    var serialKey = 'SERIAL#' + scopeKey + '#' + dateStr;

    // —— 事务里生成 seq + 写入 contracts（贴回你的事务体）——
    // 事务返回 { _id, serialFormatted, fields }
    var runRes = await db.runTransaction(async function (tx) {
        const serialCol = tx.collection('serials');
        const doc = await serialCol.doc(serialKey).get().catch(() => null);
        const rentMonthlyNum = toNum(payload.rentMonthly);
        const depositInitialNum = toNum(payload.depositInitial);

        // 合同序列号
        let seq = 1;
        if (!doc || !doc.data) await serialCol.doc(serialKey).set({ data:{ seq:1 } });
        else { seq = doc.data.seq + 1; await serialCol.doc(serialKey).update({ data:{ seq } }); }

        var seqStr = pad(seq, 3);
        var serialFormatted = `TSFZX-${aa}-${dateStr}-${seqStr}`;
  
        // 计算零租金的剩余应补押金
        const depositRemaining = rentMonthlyNum - depositInitialNum;

        var fields = Object.assign({}, payload, {
          // 金额自动大写转换
          rentMonthlyFormal: numberToCN(payload.rentMonthly || 0),
          rentTodayFormal: numberToCN(payload.rentToday || 0),
          depositFormal: numberToCN(payload.deposit || 0),
          depositServiceFeeFormal: numberToCN(payload.depositServiceFee || 0),

          // 剩余押金（数值）
          depositRemaining: depositRemaining,

          contractSerialNumber: seq,
          contractSerialNumberFormatted: serialFormatted,
        });
  
        var addRes = await tx.collection('contracts').add({
          data: {
            cityCode: cityCode,
            cityName: cityName,
            branchCode: branchCode,
            branchName: branchName,
            contractType: contractType,
            contractTypeName: contractTypeName,
            fields: fields,
            deleted: false,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
        console.log('contracts.add ok:', addRes._id, serialFormatted);
        return { _id: addRes._id, serialFormatted: serialFormatted, fields: fields };
      });
  
      var contractId = runRes._id;
      var serialFormatted = runRes.serialFormatted;
      var finalFields = runRes.fields;
  
      // —— 选择模板（命名约定）——
      const { fileID: TEMPLATE_FILE_ID, buffer: content } = await pickTemplateBuffer({
        cityCode, branchCode, contractType
      });

      // —— 渲染 —— 
      const zip = new PizZip(content);
      const doc = new Docxtemplater(zip, { 
          paragraphLoop: true, 
          linebreaks: true, 
          delimiters: { start: '[[', end: ']]' },
      });
  
      var dataForDocx = {
        contractNo: serialFormatted,
        contractDate: yyyy + '-' + mm + '-' + dd,
        cityName: cityName,
        branchName: branchName || '',
        contractTypeName: contractTypeName, 
        
        clientName: finalFields.clientName,
        clientId: finalFields.clientId,
        clientPhone: finalFields.clientPhone,
        clientAddress: finalFields.clientAddress,
        clientAddressCurrent: finalFields.clientAddressCurrent,
        clientEmergencyContact: finalFields.clientEmergencyContact,
        clientEmergencyPhone: finalFields.clientEmergencyPhone,

        carModel: finalFields.carModel,
        carColor: finalFields.carColor,
        carPlate: finalFields.carPlate,
        carVin: finalFields.carVin,

        contractValidPeriodStart: finalFields.contractValidPeriodStart,
        contractValidPeriodEnd: finalFields.contractValidPeriodEnd,
        rentDurationMonth: finalFields.rentDurationMonth,
        rentMonthly: finalFields.rentMonthly,
        rentMonthlyFormal: finalFields.rentMonthlyFormal,
        rentToday: finalFields.rentToday,
        rentTodayFormal: finalFields.rentTodayFormal,
        rentPaybyDayInMonth: finalFields.rentPaybyDayInMonth,
        rentCustomized: finalFields.rentCustomized,

        deposit: finalFields.deposit,
        depositFormal: finalFields.depositFormal,
        depositInitial: finalFields.depositInitial,
        depositServiceFee: finalFields.depositServiceFee,
        depositServiceFeeFormal: finalFields.depositServiceFeeFormal,
        depositUnpaidMonthly: finalFields.depositUnpaidMonthly,
        depositRemaining: finalFields.depositRemaining,
      };
  
      try {
        doc.render(dataForDocx);
      } catch (e) {
        console.error('DOCX render error:', e);
        return { _id: contractId, contractSerialNumberFormatted: serialFormatted, fileID: '' };
      }
  
      var outBuf = doc.getZip().generate({ type: 'nodebuffer' });
  
      // —— 上传（按  城市/分公司/类型/编号 归档）——
      var folderBranch = branchCode || 'default';
      var folderType = contractType || 'default';
      var uploadRes = await cloud.uploadFile({
        cloudPath: 'contracts/' + cityCode + '/' + folderBranch + '/' + folderType + '/' + serialFormatted + '.docx',
        fileContent: outBuf
      });
      console.log('upload ok:', uploadRes.fileID);
  
      await db.collection('contracts').doc(contractId).update({
        data: { file: { docxFileID: uploadRes.fileID } }
      });
  
      return { _id: contractId, contractSerialNumberFormatted: serialFormatted, fileID: uploadRes.fileID };
    } catch (err) {
      console.error('[createContract error]', err);
      return { errorCode: -1, errorMessage: err && err.message ? err.message : 'failed' };
    }
};
