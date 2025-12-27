// 云函数入口文件
const cloud = require('wx-server-sdk');
const Papa = require('papaparse');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _  = db.command;

/**
 * 展示用 status 推导
 */
function deriveStatus(rentStatus, maintenanceStatus) {
  if (maintenanceStatus === 'in_maintenance') return 'maintenance';
  if (rentStatus === 'rented') return 'rented';
  return 'available';
}

exports.main = async (event, context) => {
  const { action, payload = {} } = event || {};

  try {
    switch (action) {
      case 'updateStatus':
        return await updateStatus(payload);
      case 'deduplicate': // <--- 新增这个 case
        return await deduplicateVehicles(payload);
      case 'fixDates':
        return await fixCreatedAt();
      case 'deleteByCity':
        return await deleteByCity(payload);
      case 'importCsv':
        return await upsertVehiclesFromCsv(payload);
      case 'updateInsurance': {
        const { vehicleId, insuranceData } = payload;
        
        // 内部工具：强制转为上海时区0点的 Date 对象
        const parseBizDateCloud = (str) => {
            if (!str) return null;
            // 这里的逻辑和前端一致，确保存入的是上海时区 00:00:00 的绝对时间
            return new Date(`${str}T00:00:00+08:00`);
        };
    
        const dataToUpdate = {
            liabInsStart: parseBizDateCloud(insuranceData.liabInsStart),
            liabInsEnd:   parseBizDateCloud(insuranceData.liabInsEnd),
            commInsStart: parseBizDateCloud(insuranceData.commInsStart),
            commInsEnd:   parseBizDateCloud(insuranceData.commInsEnd),
            updatedAt:    db.serverDate()
        };
    
        await db.collection('vehicles').doc(vehicleId).update({
            data: dataToUpdate
        });
    
        return { ok: true };
        }
      case 'updateAnnualInspection': {
            const { vehicleId, dateStr } = payload;
            
            // 内部工具 (如果你之前已经在 updateInsurance 里定义过，可以提出来共用，或者这里再写一遍)
            const parseBizDateCloud = (str) => {
              if (!str) return null;
              return new Date(`${str}T00:00:00+08:00`);
            };
      
            await db.collection('vehicles').doc(vehicleId).update({
              data: {
                annualInspectionDate: parseBizDateCloud(dateStr),
                updatedAt: db.serverDate()
              }
            });
      
            return { ok: true };
        }
      default:
        return { ok: false, error: 'unknown-action' };
    }
  } catch (err) {
    console.error('[vehicleOps error]', err);
    return { ok: false, error: err.message || String(err) };
  }
};

function formatStatusLabel(rentStatus, maintenanceStatus) {
    if (maintenanceStatus === 'in_maintenance') {
      return rentStatus === 'rented' ? '已租 · 维修中' : '闲置 · 维修中';
    }
    return rentStatus === 'rented' ? '已租' : '闲置';
  }
  
async function updateStatus(payload) {
    const { vehicleId, newStatus } = payload || {};
  
    if (!vehicleId) throw new Error('vehicleId-required');
    // 这里 newStatus 仅仅是“操作类型”，不是要写进数据库的字段
    if (!newStatus || !['available', 'maintenance'].includes(newStatus)) {
      throw new Error('invalid-status');
    }
  
    const vehicles = db.collection('vehicles');
  
    // 1) 拿当前车辆
    const res = await vehicles.doc(vehicleId).get();
    if (!res.data) throw new Error('vehicle-not-found');
  
    const veh = res.data;
    const now = db.serverDate();
  
    // 2) 老的状态轴（兼容旧数据）
    const oldRentStatus =
      veh.rentStatus ||
      (veh.status === 'rented' ? 'rented' : 'available');  // status 以后你可以不再写，这里只是兜底
    const oldMaintenanceStatus =
      veh.maintenanceStatus ||
      (veh.status === 'maintenance' ? 'in_maintenance' : 'none');
  
    let newRentStatus = oldRentStatus;
    let newMaintenanceStatus = oldMaintenanceStatus;
  
    const updateData = { updatedAt: now };
    // 清理已废弃的旧字段，避免前端 fallback 到过期状态
    updateData.status = _.remove();

    let eventType = '';   // 写历史用
  
    if (newStatus === 'available') {
      // 你的语义：结束租赁，车辆恢复可出租，解绑司机
      eventType = 'rent_end';
      newRentStatus = 'available';

      // 如果有司机，解绑
      // 1. 标准字段 + CSV 导入的兼容字段
      updateData.currentDriverId = _.remove();
      updateData.currentDriverName = _.remove();
      updateData.currentDriverPhone = _.remove();
    } else if (newStatus === 'maintenance') {
      // 切维修状态：toggle
      eventType = 'maintenance_toggle';
      newMaintenanceStatus = oldMaintenanceStatus === 'in_maintenance' ? 'none' : 'in_maintenance';
      // 这里不动租赁轴，也不碰 currentDriverId
    }
  
    // 3) 更新车辆，只写 rentStatus / maintenanceStatus（不再写 status 字段）
    await vehicles.doc(vehicleId).update({
      data: {
        ...updateData,
        rentStatus: newRentStatus,
        maintenanceStatus: newMaintenanceStatus
      }
    });
  
    // 4) 记录车辆历史（保证有 fromStatus / toStatus）
    const driverSnapshot = veh.currentDriverId || veh.currentDriverName || null;
    const fromStatusLabel = formatStatusLabel(oldRentStatus, oldMaintenanceStatus);
    const toStatusLabel   = formatStatusLabel(newRentStatus, newMaintenanceStatus);
  
    await db.collection('vehicle_history').add({
      data: {
        vehicleId: veh._id,
        plate: veh.plate || '',
        eventType,
        fromStatus: fromStatusLabel,
        toStatus: toStatusLabel,
        driverClientId: driverSnapshot,     // 记录变化发生时的司机，是谁退的租
        contractId: null,                                  // 这里通常是「结束租赁/维修」操作，没有新合同
        operator: payload.operator || null,
        createdAt: now
      }
    });
  
    return {
      ok: true,
      vehicleId,
      rentStatus: newRentStatus,
      maintenanceStatus: newMaintenanceStatus
    };
  }

// --- 新增：去重函数 ---
async function deduplicateVehicles() {
    const vehiclesCol = db.collection('vehicles');
    const MAX_LIMIT = 1000;
    
    // 1. 拉取所有车辆 (循环分页)
    let allVehicles = [];
    let page = 0;
    while(true) {
      const res = await vehiclesCol.skip(page * MAX_LIMIT).limit(MAX_LIMIT).get();
      const list = res.data;
      if (!list || list.length === 0) break;
      allVehicles = allVehicles.concat(list);
      page++;
      if (list.length < MAX_LIMIT) break;
    }
  
    // 2. 内存中分组
    const map = {}; // { "粤A12345": [record1, record2] }
    const toDeleteIds = [];
  
    for (const v of allVehicles) {
      const p = (v.plate || '').trim();
      if (!p) continue; // 跳过无车牌的脏数据 (可选：也可以选择把它们删了)
      if (!map[p]) map[p] = [];
      map[p].push(v);
    }
  
    // 3. 筛选出重复项 ID
    for (const plate in map) {
      const list = map[plate];
      if (list.length > 1) {
        // 排序：按 updatedAt 倒序 (如果没有 updatedAt 则按 createdAt，最后按 _id)
        // 目的是：保留“最新”的那条，删除旧的
        list.sort((a, b) => {
          const tA = (a.updatedAt && new Date(a.updatedAt).getTime()) || (a.createdAt && new Date(a.createdAt).getTime()) || 0;
          const tB = (b.updatedAt && new Date(b.updatedAt).getTime()) || (b.createdAt && new Date(b.createdAt).getTime()) || 0;
          return tB - tA; 
        });
        
        // 保留 list[0]，把 list[1]...list[n] 加入删除名单
        for (let i = 1; i < list.length; i++) {
          toDeleteIds.push(list[i]._id);
        }
      }
    }
  
    // 4. 批量删除 (每批 100 条)
    const BATCH_SIZE = 100;
    let deletedCount = 0;
    
    if (toDeleteIds.length > 0) {
      for (let i = 0; i < toDeleteIds.length; i += BATCH_SIZE) {
        const batch = toDeleteIds.slice(i, i + BATCH_SIZE);
        try {
          await vehiclesCol.where({
            _id: _.in(batch)
          }).remove();
          deletedCount += batch.length;
        } catch(e) {
          console.error('Delete batch failed', e);
        }
      }
    }
  
    return { 
      ok: true, 
      totalScanned: allVehicles.length,
      duplicateGroups: toDeleteIds.length, // 这里粗略表示删除了多少条
      deleted: deletedCount 
    };
  }

async function fixCreatedAt() {
    const vehiclesCol = db.collection('vehicles');
    const MAX_LIMIT = 100; // 每次处理 100 条防止超时
    let page = 0;
    let fixedCount = 0;
    
    // 正则匹配 yyyy-mm-dd 格式 (例如 2025-10-25)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  
    while (true) {
      // 分页拉取
      const res = await vehiclesCol.skip(page * MAX_LIMIT).limit(MAX_LIMIT).get();
      const list = res.data;
      if (!list || list.length === 0) break;
  
      const tasks = [];
  
      for (const v of list) {
        // 检查是否为字符串且符合格式
        if (typeof v.createdAt === 'string' && dateRegex.test(v.createdAt)) {
          // 解析日期
          // 注意：new Date('2025-10-25') 默认为 UTC 0点。
          // 如果想存为 Date 对象，直接 new Date(str) 即可，数据库会存为 ISO Date。
          const d = new Date(v.createdAt);
          
          if (!isNaN(d.getTime())) {
            // 发起更新
            const task = vehiclesCol.doc(v._id).update({
              data: {
                createdAt: d,
                // 如果 updatedAt 也是这种格式，顺便也修了（可选）
                // updatedAt: (typeof v.updatedAt === 'string' && dateRegex.test(v.updatedAt)) ? new Date(v.updatedAt) : v.updatedAt
              }
            });
            tasks.push(task);
          }
        }
      }
  
      if (tasks.length > 0) {
        await Promise.all(tasks);
        fixedCount += tasks.length;
      }
  
      page++;
      if (list.length < MAX_LIMIT) break;
    }
  
    return { ok: true, fixed: fixedCount, totalScanned: page * MAX_LIMIT + (list ? list.length : 0) }; // 简单估算
  }

async function deleteByCity(payload) {
    const { cityCode } = payload || {};
    if (!cityCode) throw new Error('cityCode required');
  
    const vehiclesCol = db.collection('vehicles');
    let deletedCount = 0;
  
    // 这里的逻辑是：循环查找并删除，直到删光为止
    // 这种方式比一次性 where().remove() 更稳健，避免因数据量过大导致数据库操作超时或部分失败
    while (true) {
      // 每次查 1000 条 ID
      const res = await vehiclesCol.where({ cityCode }).limit(1000).field({ _id: true }).get();
      const list = res.data;
      
      if (!list || list.length === 0) {
        break; // 删完了
      }
  
      const ids = list.map(v => v._id);
      
      // 批量删
      await vehiclesCol.where({
        _id: _.in(ids)
      }).remove();
  
      deletedCount += list.length;
    }
  
    return { ok: true, cityCode, deleted: deletedCount };
  }

async function upsertVehiclesFromCsv(payload) {
    const { fileID } = payload;
    if (!fileID) throw new Error('fileID required');
  
    // 1. 下载 CSV 文件
    const downloadRes = await cloud.downloadFile({ fileID });
    const csvContent = downloadRes.fileContent.toString('utf8');
  
    // 2. 使用 PapaParse 解析
    // header: true 表示第一行是标题，会自动转成对象数组
    // skipEmptyLines: true 自动跳过空行
    const parseResult = Papa.parse(csvContent, {
      header: true,
      skipEmptyLines: true
    });
  
    if (parseResult.errors.length > 0) {
      console.warn('[CSV Parse Warning]', parseResult.errors);
    }
  
    const rows = parseResult.data; // 这是一个对象数组
    if (!rows || rows.length === 0) return { ok: false, msg: 'empty-csv' };
  
    const vehiclesCol = db.collection('vehicles');
    const now = db.serverDate();
    
    let updatedCount = 0;
    let insertedCount = 0;
    let errorCount = 0;
  
    // 3. 逐条 Upsert
    for (const row of rows) {
      // PapaParse 解析出来的对象，key 是表头，value 是单元格内容
      // 空单元格默认是 "" (空字符串)，完全符合你的需求，无需转 null
  
      const plate = row.plate ? row.plate.trim() : '';
      if (!plate) continue; // 跳过没车牌的行
  
      // 强制更新时间
      // 注意：这里我们构造一个新的 updateData 对象，而不是直接污染 row，
      // 这样可以避免把 _id 等不该更新的字段带进去
      const updateData = { ...row };
      
      updateData.updatedAt = now;
      
      // 清理不需要写入数据库的字段 (比如 CSV 里可能有的空列或者序号)
      // 如果 CSV 里有 _id 或者是空字符串的 _id，一定要删掉，否则会冲突
      delete updateData._id; 
  
      // 删除旧字段键（如果存在），保持数据库整洁
      delete updateData.currentDriverClientId;
  
      try {
        // 先查
        const exist = await vehiclesCol.where({ plate }).get();
        
        if (exist.data.length > 0) {
          // --- 更新 ---
          const docId = exist.data[0]._id;
          await vehiclesCol.doc(docId).update({
            data: updateData
          });
          updatedCount++;
        } else {
          // --- 新增 ---
          updateData.createdAt = now;
          await vehiclesCol.add({
            data: updateData
          });
          insertedCount++;
        }
      } catch (e) {
        console.error(`Error processing plate ${plate}:`, e);
        errorCount++;
      }
    }
  
    return { 
      ok: true, 
      total: rows.length, 
      updated: updatedCount, 
      inserted: insertedCount, 
      errors: errorCount 
    };
  }