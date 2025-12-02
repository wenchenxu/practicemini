// cloudfunctions/contractV2/index.js

const cloud = require('wx-server-sdk');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const fetch = require('node-fetch');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db   = cloud.database();
const COL_CONTRACTS = db.collection('contracts');
const COL_DRIVERS   = db.collection('drivers');
const COL_VEHICLES  = db.collection('vehicles');
const BIZ_TZ        = 'Asia/Shanghai';

// ========== 公共工具（直接复用你现有的） ==========

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function numberToCN(n) {
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
  const n = Number(x);
  return isFinite(n) ? n : 0;
}

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

// ===== 模板映射（和你现有 createContract 完全一致） =====

const ENV_BASE = 'cloud://cloudbase-9gvp1n95af42e30d.636c-cloudbase-9gvp1n95af42e30d-1379075990';

const TPL_DIR = {
  branch:  'contractTemplate/branches', // branches/<branchCode>/<contractType>.docx
  city:    'contractTemplate/cities',   // cities/<cityCode>/<contractType>.docx
  type:    'contractTemplate/types',    // types/<contractType>.docx
  def:     'contractTemplate/defaults/default.docx'
};

async function pickTemplateBuffer(opts) {
  const { cityCode, branchCode, contractType } = opts;
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
      return { fileID, buffer: res.fileContent };
    } catch (e) {
      // miss，继续下一候选
    }
  }
  throw new Error('no-template-available');
}

// ========== 主入口 ==========

exports.main = async (event, context) => {
  try {
    const {
      cityCode,
      cityName = '',
      branchCode = null,
      branchName = '',
      contractType = 'rent_std',
      contractTypeName = '标准租赁合同',
      payload = {}
    } = event || {};

    if (!cityCode) {
      return { ok: false, error: 'cityCode-required' };
    }

    const { y: yyyy, m: mm, d: dd, ymd: dateStr } = nowInTZ(BIZ_TZ);

    // 序列号作用域：分公司优先，否则城市
    const AA_BY_BRANCH = { gzh_a: 'GZ1', gzh_b: 'GZ2' };
    const AA_DEFAULT_PER_CITY = {
      guangzhou: 'GZ',
      foshan:    'FS',
      huizhou:   'HZ',
      jiaxing:   'JX',
      shaoxing:  'SX',
      changzhou: 'CZ',
      nantong:   'NT',
      suzhou:    'SZ'
    };
    const aa = (branchCode && AA_BY_BRANCH[branchCode]) ||
               AA_DEFAULT_PER_CITY[cityCode] || 'XX';
    const scopeKey  = branchCode || cityCode;
    const serialKey = 'SERIAL#' + scopeKey + '#' + dateStr;

    // === 事务：生成合同 + 更新/创建司机 + 更新车辆 ===
    const txResult = await db.runTransaction(async tx => {
      const serialCol   = tx.collection('serials');
      const contractsTx = tx.collection('contracts');
      const driversTx   = tx.collection('drivers');
      const vehiclesTx  = tx.collection('vehicles');
      const vehiclesHistoryTx = tx.collection('vehicle_history');
      const now = db.serverDate();

      // 1) 生成连续流水号
      const doc = await serialCol.doc(serialKey).get().catch(() => null);
      let seq = 1;
      if (!doc || !doc.data) {
        await serialCol.doc(serialKey).set({ data: { seq: 1 } });
      } else {
        seq = doc.data.seq + 1;
        await serialCol.doc(serialKey).update({ data: { seq } });
      }
      const seqStr = pad(seq, 3);
      const serialFormatted = `TSFZX-${aa}-${dateStr}-${seqStr}`;

      // 2) 解析金额并计算各种字段（与原 createContract 一致）
      const rentMonthlyNum     = toNum(payload.rentMonthly);
      const depositTodayNum    = toNum(payload.depositToday);
      const depositRemaining   = rentMonthlyNum - depositTodayNum;

      const fields = Object.assign({}, payload, {
        rentMonthlyFormal:        numberToCN(payload.rentMonthly || 0),
        rentTodayFormal:          numberToCN(payload.rentToday || 0),
        depositFormal:            numberToCN(payload.deposit || 0),
        depositTodayFormal:       numberToCN(payload.depositToday || 0),
        depositServiceFeeFormal:  numberToCN(payload.depositServiceFee || 0),
        depositRemaining,
        contractSerialNumber:            seq,
        contractSerialNumberFormatted:   serialFormatted
      });

      // ★ 关键字段：
      const clientId   = payload.clientId;     // 身份证号
      const clientName = payload.clientName;
      const clientPhone= payload.clientPhone;
      const carPlate   = payload.carPlate;
      const carVin     = payload.carVin;

      if (!clientId)  throw new Error('driver-clientId-required');
      if (!carPlate)  throw new Error('vehicle-plate-required');

      // 3) 司机 upsert（按 clientId）
      const drvRes = await driversTx.where({ clientId }).get();
      if (!drvRes.data || drvRes.data.length === 0) {
        // 新司机
        await driversTx.add({
          data: {
            clientId,
            name:   clientName || '',
            phone:  clientPhone || '',
            cityCode,
            cityName,
            addressRegistered:   payload.clientAddress || '',
            addressCurrent:      payload.clientAddressCurrent || '',
            emergencyContactName:  payload.clientEmergencyContact || '',
            emergencyContactPhone: payload.clientEmergencyContactPhone || '',
            status: 'active',
            lastContractId: null,
            createdAt: now,
            updatedAt: now
          }
        });
      } else {
        // 老司机，增量更新
        const driverDoc = drvRes.data[0];
        await driversTx.doc(driverDoc._id).update({
          data: {
            name:   clientName || driverDoc.name || '',
            phone:  clientPhone || driverDoc.phone || '',
            cityCode,
            cityName,
            addressRegistered:   payload.clientAddress || driverDoc.addressRegistered || '',
            addressCurrent:      payload.clientAddressCurrent || driverDoc.addressCurrent || '',
            emergencyContactName:  payload.clientEmergencyContact || driverDoc.emergencyContactName || '',
            emergencyContactPhone: payload.clientEmergencyContactPhone || driverDoc.emergencyContactPhone || '',
            status: 'active',
            updatedAt: now
          }
        });
      }

      // 4) 车辆检查 + 更新状态
      const vehRes = await vehiclesTx.where({ plate: carPlate }).get();
      if (!vehRes.data || vehRes.data.length === 0) {
        throw new Error('vehicle-not-found');
      }
      const vehicle = vehRes.data[0];
      
      // 旧状态轴（兼容老数据，没值就默认闲置 + 不在维修）
      const oldRentStatus =
        vehicle.rentStatus || 'available';          // 'available' | 'rented'
      const oldMaintenanceStatus =
        vehicle.maintenanceStatus || 'none';        // 'none' | 'in_maintenance'
      
      // 只要这车已经在「已租」，就不允许再新签合同
      if (oldRentStatus === 'rented') {
        throw new Error('vehicle-not-available');
      }
      
      // 新合同生效 = 标记为已租，维修轴保持不变
      const newRentStatus = 'rented';
      const newMaintenanceStatus = oldMaintenanceStatus;
      
      // 更新车辆（注意：不再写 status）
      await vehiclesTx.doc(vehicle._id).update({
        data: {
          rentStatus: newRentStatus,
          maintenanceStatus: newMaintenanceStatus,
          currentDriverClientId: clientId,
          updatedAt: now
        }
      });
      
      // ===== 4.5 写一条车辆历史（只写一条，不要再重复） =====
      // 小工具：把 rentStatus + maintenanceStatus 转成一句中文
      function formatStatusLabel(rentStatus, maintenanceStatus) {
        if (maintenanceStatus === 'in_maintenance') {
          return rentStatus === 'rented' ? '已租 · 维修中' : '闲置 · 维修中';
        }
        return rentStatus === 'rented' ? '已租' : '闲置';
      }
      
      const fromStatusLabel = formatStatusLabel(oldRentStatus, oldMaintenanceStatus);
      const toStatusLabel   = formatStatusLabel(newRentStatus, newMaintenanceStatus);
      
      // 没有的话先写 null，以后再补。
      await vehiclesHistoryTx.add({
        data: {
          vehicleId: vehicle._id,
          plate: vehicle.plate || '',
          eventType: 'rent_start',
          fromStatus: fromStatusLabel,
          toStatus: toStatusLabel,
          driverClientId: clientId,
          contractId: contractSerialNumberFormatted,
          operator: payload.operator || null,
          createdAt: now
        }
      });

      // 5) 创建合同记录
      const addRes = await contractsTx.add({
        data: {
          cityCode,
          cityName,
          branchCode,
          branchName,
          contractType,
          contractTypeName,
          fields,
          deleted: false,
          createdAt: now,
          updatedAt: now
        }
      });

      const contractId = addRes._id;

      // 顺手把 lastContractId 写回 driver（简单起见重新查一遍）
      const drvAfter = await driversTx.where({ clientId }).get();
      if (drvAfter.data && drvAfter.data.length > 0) {
        await driversTx.doc(drvAfter.data[0]._id).update({
          data: {
            lastContractId: contractId,
            updatedAt: now
          }
        });
      }

      return { contractId, serialFormatted, finalFields: fields };
    });

    const { contractId, serialFormatted, finalFields } = txResult;

    // === 事务外：渲染 DOCX + PDF（直接复用你原 createContract 的逻辑） ===

    const { fileID: TEMPLATE_FILE_ID, buffer: content } = await pickTemplateBuffer({
      cityCode,
      branchCode,
      contractType
    });

    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '[[', end: ']]' },
    });

    const dataForDocx = {
      contractNo: serialFormatted,
      contractDate: `${yyyy}-${mm}-${dd}`,
      cityName,
      branchName: branchName || '',
      contractTypeName,

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
      depositToday: finalFields.depositToday,
      depositTodayFormal: finalFields.depositTodayFormal,
      depositServiceFee: finalFields.depositServiceFee,
      depositServiceFeeFormal: finalFields.depositServiceFeeFormal,
      depositUnpaidMonthly: finalFields.depositUnpaidMonthly,
      depositRemaining: finalFields.depositRemaining,
    };

    try {
      doc.render(dataForDocx);
    } catch (e) {
      console.error('[createWithDriverVehicle] DOCX render error:', e);
      return {
        ok: false,
        error: 'render-failed',
        _id: contractId,
        contractSerialNumberFormatted: serialFormatted
      };
    }

    const outBuf = doc.getZip().generate({ type: 'nodebuffer' });

    const branchFolder = branchCode || 'default';
    const typeFolder   = contractType || 'default';
    const basePath     = `contracts/${cityCode}/${branchFolder}/${typeFolder}/${serialFormatted}`;

    const uploadDocxRes = await cloud.uploadFile({
      cloudPath: `${basePath}.docx`,
      fileContent: outBuf
    });
    const docxFileID = uploadDocxRes.fileID;

    // 先写回 DOCX
    await COL_CONTRACTS.doc(contractId).update({
      data: { file: { docxFileID }, updatedAt: db.serverDate() }
    });

    // 再尝试 CI → PDF
    let pdfFileID = '';
    try {
      const tmp = await cloud.getTempFileURL({ fileList: [docxFileID] });
      const docxUrl = tmp?.fileList?.[0]?.tempFileURL;
      if (!docxUrl) throw new Error('tempFileURL failed');

      const ciUrl = docxUrl + (docxUrl.includes('?') ? '&' : '?') +
        'ci-process=doc-preview&dstType=pdf';

      const resp = await fetch(ciUrl);
      const ctype = resp.headers.get('content-type') || '';
      const buf   = await resp.buffer();

      if (!resp.ok || !/application\/pdf/i.test(ctype) ||
          buf.length < 10 || buf.slice(0, 5).toString() !== '%PDF-') {

        console.error('[createWithDriverVehicle] CI not pdf:', {
          ok: resp.ok, status: resp.status, ctype,
          head: buf.slice(0, 5).toString(), size: buf.length
        });
      } else {
        const upPdf = await cloud.uploadFile({
          cloudPath: `${basePath}.pdf`,
          fileContent: buf,
        });
        pdfFileID = upPdf.fileID;

        await COL_CONTRACTS.doc(contractId).update({
          data: { file: { docxFileID, pdfFileID }, updatedAt: db.serverDate() }
        });

        return {
          ok: true,
          _id: contractId,
          contractSerialNumberFormatted: serialFormatted,
          fileID: pdfFileID,
          docxFileID,
          pdfFileID
        };
      }
    } catch (e) {
      console.error('[createWithDriverVehicle] PDF convert fail:', e);
    }

    // PDF 挂掉就只返回 DOCX
    return {
      ok: true,
      _id: contractId,
      contractSerialNumberFormatted: serialFormatted,
      fileID: docxFileID,
      docxFileID
    };

  } catch (err) {
    console.error('[contract_createWithDriverVehicle error]', err);
    return {
      ok: false,
      error: err && err.message ? err.message : 'failed'
    };
  }
};
