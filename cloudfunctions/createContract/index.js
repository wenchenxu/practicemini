console.log('[createContract boot] build=2025-09-22T12:00:00Z');
// 云函数入口文件
const cloud = require('wx-server-sdk')
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

const BRANCH_BY_CODE = {
    guangzhou: { 
      aa:'GZ', 
      branchName:'兔斯夫汽车服务（广州）有限公司', 
      branchAddress:'', 
      branchManagerName:'',
      branchLicense:'', 
      branchPhone:'', 
      branchBankAccount:'', 
      branchBankName:''
    }
};

// 可选：按城市选择不同模板（fileID）
const TEMPLATE_BY_CODE = {
    guangzhou: 'cloud://cloudbase-9gvp1n95af42e30d.636c-cloudbase-9gvp1n95af42e30d-1379075990/contractTemplate/guangzhou0.docx',
    foshan: 'cloud://cloudbase-9gvp1n95af42e30d.636c-cloudbase-9gvp1n95af42e30d-1379075990/contractTemplate/foshan0.docx',
    jiaxing: 'cloud://cloudbase-9gvp1n95af42e30d.636c-cloudbase-9gvp1n95af42e30d-1379075990/contractTemplate/jiaxing0.docx',
    shaoxing: 'cloud://cloudbase-9gvp1n95af42e30d.636c-cloudbase-9gvp1n95af42e30d-1379075990/contractTemplate/shaoxing0.docx',
    nantong: 'cloud://cloudbase-9gvp1n95af42e30d.636c-cloudbase-9gvp1n95af42e30d-1379075990/contractTemplate/nantong0.docx',
    changzhou: 'cloud://cloudbase-9gvp1n95af42e30d.636c-cloudbase-9gvp1n95af42e30d-1379075990/contractTemplate/changzhou0.docx',
    suzhou: 'cloud://cloudbase-9gvp1n95af42e30d.636c-cloudbase-9gvp1n95af42e30d-1379075990/contractTemplate/suzhou0.docx',    
};
// 默认模板（若没配到城市专属模板时使用）
const DEFAULT_TEMPLATE_FILE_ID = 'cloud://cloudbase-9gvp1n95af42e30d.636c-cloudbase-9gvp1n95af42e30d-1379075990/contractStorage/test_batman.docx';


exports.main = async (event) => {
    const cityCode = String(event?.cityCode || '').trim().toLowerCase(); // e.g., "guangzhou"
    const cityName = event?.cityName || ''; // 用于显示/落库
    const payload = event?.payload || {};

    console.log('[createContract] cityCode=', cityCode, 'cityName=', cityName);
    const branch = BRANCH_BY_CODE[cityCode] || null;
    const aa = branch ? branch.aa : 'XX';

    // 用服务端时间，避免前端时区
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}`;


    // 事务，生成每日流水，写库
    const resRun = await db.runTransaction(async tx => {
        const key = `SERIAL#${aa}#${dateStr}`;
        const serialCol = tx.collection('serials');
        const doc = await serialCol.doc(key).get().catch(() => null);

        let seq = 1;
        if (!doc || !doc.data) {
            await serialCol.doc(key).set({ data:{ seq:1 } });
        } else {
            seq = doc.data.seq + 1;
            await serialCol.doc(key).update({ data:{ seq } });
        }

        const seqStr = pad(seq, 3);
        const serialFormatted = `TSFZX-${aa}-${dateStr}-${seqStr}`;
        // const serialFormatted = `hello there!`;

        // 服务器端最终字段组装（以 DB 门店为准；formal 由服务端生成）
        // 门店信息这期“写死”注入；也可以完全不存，只用于渲染
        const fields = {
            ...payload,
            ...(branch ? {
                branchName: branch.branchName,
                branchAddress: branch.branchAddress,
                branchManagerName: branch.branchManagerName,
                branchPhone: branch.branchPhone,
                branchBankAccount: branch.branchBankAccount,
                branchBankName: branch.branchBankName,
                branchCityCode: aa,
            } : {}),

            // formal 金额（覆盖前端送来的）
            rentMonthlyFormal: numberToCN(payload.rentMonthly ?? 0),
            rentTodayFormal: numberToCN(payload.rentToday ?? 0),
            depositFormal: numberToCN(payload.deposit ?? 0),
            depositServiceFeeFormal: numberToCN(payload.depositServiceFee ?? 0),
    
            // 合同号（数值型 contractSerialNumber 可继续保留；也可只保留格式化字符串）
            contractSerialNumber: seq, // 需要数字流水
            contractSerialNumberFormatted: serialFormatted,
        };

        const addRes = await tx.collection('contracts').add({
            data: { 
                cityCode,
                cityName,
                fields,
                deleted: false,     // 软删除标记（默认 false）
                createdAt: db.serverDate(), 
                updatedAt: db.serverDate() 
            }
        });
      
        console.log('contracts.add ok:', addRes._id, serialFormatted);
        return { _id: addRes._id, serialFormatted, fields };
    });

    const contractId = resRun._id;
    const serialFormatted = resRun.serialFormatted;
    const finalFields = resRun.fields;

    // 选择模板：城市专属（云存储）
    const TEMPLATE_FILE_ID = TEMPLATE_BY_CODE[cityCode] || DEFAULT_TEMPLATE_FILE_ID;
    console.log('[tpl] use', TEMPLATE_FILE_ID);

    // 下载模板
    const tplBufRes = await cloud.downloadFile({ fileID: TEMPLATE_FILE_ID });

    // 使用 docxtemplater 渲染
    const zip = new PizZip(tplBufRes.fileContent);
    const doc = new Docxtemplater(zip, { 
        paragraphLoop: true, 
        linebreaks: true,
        delimiters: { start: '[[', end: ']]' }   // ← 关键：改定界符
    });

    // 可用变量：把需要的字段都展开（示例）
    const dataForDocx = {
        contractNo: serialFormatted,
        contractDate: finalFields.contractDate || `${yyyy}-${mm}-${dd}`,

        // 门店 (直接用 branch 常量；如果 branch 可能为 null，加个判断）
        ...(branch ? {
        branchName: branch.branchName,
        branchAddress: branch.branchAddress,
        branchManagerName: branch.branchManagerName,
        branchPhone: branch.branchPhone,
        branchBankAccount: branch.branchBankAccount,
        branchBankName: branch.branchBankName,
        } : {}),

        // 客户/车辆/租期/金额
        clientName: finalFields.clientName,
        clientId: finalFields.clientId,
        clientPhone: finalFields.clientPhone,
        clientAddress: finalFields.clientAddress,
        clientEmergencyContact: finalFields.clientEmergencyContact,
        clientEmergencyPhone: finalFields.clientEmergencyPhone,

        carModel: finalFields.carModel,
        carColor: finalFields.carColor,
        carPlate: finalFields.carPlate,
        carVin: finalFields.carVin,
        carRentalCity: finalFields.carRentalCity,

        contractValidPeriodStart: finalFields.contractValidPeriodStart,
        contractValidPeriodEnd: finalFields.contractValidPeriodEnd,
        rentDurationMonth: finalFields.rentDurationMonth,

        rentMonthly: finalFields.rentMonthly,
        rentMonthlyFormal: finalFields.rentMonthlyFormal,
        rentToday: finalFields.rentToday,
        rentTodayFormal: finalFields.rentTodayFormal,
        rentPaybyDayInMonth: finalFields.rentPaybyDayInMonth,

        deposit: finalFields.deposit,
        depositFormal: finalFields.depositFormal,
        depositInitial: finalFields.depositInitial,
        depositServiceFee: finalFields.depositServiceFee,
        depositServiceFeeFormal: finalFields.depositServiceFeeFormal,
    };

    try { doc.setData(dataForDocx); doc.render(); }
    catch (e) {
        console.error('DOCX render error:', e)
        console.error('DOCX render error keys:', Object.keys(e));
        if (e.properties && e.properties.errors) {
            e.properties.errors.forEach(err => {
              console.error('Docxtemplater sub-error:', err);
            });
        }     
        return { _id: contractId, contractSerialNumberFormatted: serialFormatted, fileID: '' };
    }

    const outBuf = doc.getZip().generate({ type: 'nodebuffer' });

    // 上传渲染结果到云存储
    // 用当前城市作为目录（你也可以直接写死，比如 const folder = 'NT';）
    const uploadRes = await cloud.uploadFile({
        cloudPath: `contracts/${aa}/${serialFormatted}.docx`,
        fileContent: outBuf,
    });
    console.log('upload ok:', uploadRes.fileID);

    // 把文件 fileID 记到合同文档里（方便列表里“查看/下载”）
    await db.collection('contracts').doc(contractId).update({
        data: { file: { docxFileID: uploadRes.fileID } }
    });

    return { 
        _id: contractId,
        contractSerialNumberFormatted: serialFormatted, 
        fileID: uploadRes.fileID 
    };
};
