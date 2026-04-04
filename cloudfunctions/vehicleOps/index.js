// 云函数入口文件
const cloud = require('wx-server-sdk');
const Papa = require('papaparse');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

/**
 * 展示用 status 推导
 */
function deriveStatus(rentStatus, maintenanceStatus) {
  if (maintenanceStatus === 'in_maintenance') return 'maintenance';
  if (rentStatus === 'rented') return 'rented';
  return 'available';
}

exports.main = async (event, context) => {
  // --- 拦截定时触发器 ---
  if (event.Type === 'Timer' && event.TriggerName === 'dailyAutoReturn') {
    return await autoReturnExpired();
  }

  const { action, payload = {} } = event || {};

  try {
    switch (action) {
      case 'updateStatus':
        return await updateStatus(payload);
      case 'importOfflineContracts':
        return await importOfflineContracts(payload);
      case 'deduplicate': // <--- 新增这个 case
        return await deduplicateVehicles(payload);
      case 'fixDates':
        return await fixCreatedAt();
      case 'deleteByCity':
        return await deleteByCity(payload);
      case 'importCsv':
        return await upsertVehiclesFromCsv(payload);
      case 'updateInsurance':
        return await updateInsurance(payload);
      case 'updateAnnualInspection':
        return await updateAnnualInspection(payload);
      case 'getDashboardStats':
        return await getDashboardStats(payload);
      case 'getAllCitiesStats':
        return await getAllCitiesStats();
      case 'listAvailable':
        return await listAvailable(payload);
      case 'exportCsv':
        return await exportVehiclesToCsv(payload);
      case 'renamePlate':
        return await renamePlate(payload);
      case 'migrateBranches':
        return await migrateBranches();
      case 'autoReturnExpired':
        return await autoReturnExpired();
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
  if (!newStatus || !['available', 'maintenance', 'retired'].includes(newStatus)) {
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
    updateData.maintenanceStartAt = _.remove();
  } else if (newStatus === 'maintenance') {
    // 切维修状态：判断是开始还是结束
    if (oldMaintenanceStatus === 'in_maintenance') {
      // 原来在维修 -> 现在结束维修
      newMaintenanceStatus = 'none';
      eventType = 'maintenance_end';
      updateData.maintenanceStartAt = _.remove();
    } else {
      // 原来正常 -> 现在开始维修
      newMaintenanceStatus = 'in_maintenance';
      eventType = 'maintenance_start';
      updateData.maintenanceStartAt = now;
    }
  } else if (newStatus === 'retired') {
    // 标记为已售/报废：车辆必须先退租才能报废
    if (oldRentStatus === 'rented') {
      throw new Error('vehicle-still-rented');
    }
    eventType = 'vehicle_retired';
    newRentStatus = 'available'; // 保持原状
    updateData.retired = true;
    updateData.retiredAt = now;
    updateData.currentDriverId = _.remove();
    updateData.currentDriverName = _.remove();
    updateData.currentDriverPhone = _.remove();
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
  const toStatusLabel = formatStatusLabel(newRentStatus, newMaintenanceStatus);

  await db.collection('vehicle_history').add({
    data: {
      vehicleId: veh._id,
      plate: veh.plate || '',
      eventType,
      fromStatus: fromStatusLabel,
      toStatus: toStatusLabel,
      // 注意：veh 是更新前的快照，所以退租时这里依然有旧司机的名字
      driverClientId: driverSnapshot,     // 记录变化发生时的司机，是谁退的租
      driverName: veh.currentDriverName || null,
      contractId: null,                                  // 这里通常是「结束租赁/维修」操作，没有新合同
      operator: payload.operator || null,
      createdAt: now
    }
  });

  // 5) 如果是退租操作，标记关联合同为 '退租'（仅限手动操作，定时器有自己的标记逻辑）
  if (eventType === 'rent_end' && payload.operator !== 'system-timer') {
    try {
      const plate = veh.plate;
      if (plate) {
        const contractCol = db.collection('contracts');
        const latestContract = await contractCol
          .where(db.command.and([
            { 'fields.carPlate': plate },
            { deleted: db.command.neq(true) },
            db.command.or([
              { contractStatus: 'active' },
              { contractStatus: db.command.exists(false) },
              { contractStatus: null }
            ])
          ]))
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();

        if (latestContract.data && latestContract.data.length > 0) {
          const contractDoc = latestContract.data[0];
          await contractCol.doc(contractDoc._id).update({
            data: {
              contractStatus: 'terminated',
              terminatedAt: now
            }
          });
          console.log(`[updateStatus] Marked contract ${contractDoc._id} as terminated (退租)`);
        }
      }
    } catch (contractErr) {
      console.error('[updateStatus] Failed to mark contract as terminated:', contractErr);
      // 不影响主流程，仅记录错误
    }
  }

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
  while (true) {
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
      } catch (e) {
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
    // 空单元格默认是 "" (空字符串)，完全符合你的需求，无需转 null

    const plate = row.plate ? row.plate.trim() : '';
    if (!plate) continue; // 跳过没车牌的行

    // 强制更新时间
    const updateData = { ...row };
    updateData.updatedAt = now;
    delete updateData._id;
    delete updateData.currentDriverClientId;

    try {
      const exist = await vehiclesCol.where({ plate }).get();

      if (exist.data.length > 0) {
        const docId = exist.data[0]._id;
        await vehiclesCol.doc(docId).update({ data: updateData });
        updatedCount++;
      } else {
        updateData.createdAt = now;
        await vehiclesCol.add({ data: updateData });
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

/**
 * 内部工具：强制转为上海时区0点的 Date 对象
 */
function parseBizDateCloud(str) {
  if (!str) return null;
  return new Date(`${str}T00:00:00+08:00`);
}

async function importOfflineContracts(payload) {
  const { fileID } = payload;
  if (!fileID) throw new Error('fileID required');

  // 1. Download CSV
  const downloadRes = await cloud.downloadFile({ fileID });
  const csvContent = downloadRes.fileContent.toString('utf8');

  // 2. Parse CSV (trim headers to avoid stray whitespace/tab issues)
  const parseResult = Papa.parse(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim()
  });

  if (parseResult.errors.length > 0) {
    console.warn('[importOffline] CSV parse warnings:', parseResult.errors);
  }

  const rows = parseResult.data;
  if (!rows || rows.length === 0) return { ok: false, msg: 'empty-csv' };

  // Log detected headers for debugging
  console.log('[importOffline] Detected CSV headers:', Object.keys(rows[0]));

  let successCount = 0;
  let errorCount = 0;
  const errorDetails = [];

  const typeMapping = {
    'offline_std_monthly': '线下月付',
    'offline_std_weekly': '线下周付',
    'offline_zeroDown': '线下零首付',
    'offline': '线下合同'
  };

  // Now expecting both cityCode and branchCode cleanly from CSV
  // No branchToCity mapping needed anymore.

  const cityCodeToName = {
    guangzhou: '广州',
    suzhou: '苏州',
    foshan: '佛山',
    huizhou: '惠州',
    jiaxing: '嘉兴',
    shaoxing: '绍兴',
    changzhou: '常州',
    nantong: '南通'
  };

  const BATCH_SIZE = 10;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (row, idx) => {
      const realIndex = i + idx;

      // 防御性 trim 所有值
      const t = (v) => (v == null ? '' : String(v).trim());

      const safePlate          = t(row.plate);
      const safeClientId       = t(row.clientId);
      const safeClientName     = t(row.clientName);
      const safeClientPhone    = t(row.clientPhone);
      const safeBranchCode     = t(row.branchCode);
      const safeCityCode       = t(row.cityCode);           // CSV 可能直接带 cityCode
      const safeContractType   = t(row.contractType) || 'offline';
      const safeTypeName       = t(row.contractTypeName);
      const safeStart          = t(row.contractValidPeriodStart);
      const safeEnd            = t(row.contractValidPeriodEnd);
      const safeRent           = t(row.rentMonthly);
      const safeDeposit        = t(row.deposit);

      if (!safePlate || !safeClientId) {
        errorCount++;
        errorDetails.push(`Row ${realIndex + 1}: Missing plate or clientId`);
        return; // Equivalent to continue in a map
      }

      // 推导 cityCode/branchCode: 严格提取自 CSV
      const derivedCityCode = safeCityCode; // Take directly from CSV
      const derivedTypeName = safeTypeName || (typeMapping[safeContractType] || '线下合同');
      const derivedCityName = cityCodeToName[derivedCityCode] || '';

      try {
        // ★ 关键修复：每行事务创建独立的 serverDate，避免跨事务复用同一指令对象
        const now = db.serverDate();

        await db.runTransaction(async tx => {
          const driversTx  = tx.collection('drivers');
          const vehiclesTx = tx.collection('vehicles');
          const historyTx  = tx.collection('vehicle_history');
          const contractsTx = tx.collection('contracts');

          // ==== 1. Driver Upsert ====
          const drvRes = await driversTx.where({ clientId: safeClientId }).get();
          if (!drvRes.data || drvRes.data.length === 0) {
            await driversTx.add({
              data: {
                clientId: safeClientId,
                name: safeClientName,
                phone: safeClientPhone,
                status: '租车中',
                cityCode: derivedCityCode,
                cityName: derivedCityName, // Added City Name
                branchCode: safeBranchCode,
                createdAt: now,
                updatedAt: now
              }
            });
          } else {
            const doc = drvRes.data[0];
            await driversTx.doc(doc._id).update({
              data: {
                name: safeClientName || doc.name || '',
                phone: safeClientPhone || doc.phone || '',
                status: '租车中',
                cityCode: derivedCityCode || doc.cityCode || '',
                cityName: derivedCityName || doc.cityName || '', // Added City Name
                branchCode: safeBranchCode || doc.branchCode || '',
                updatedAt: now
              }
            });
          }

          // ==== 2. Vehicle Update (允许覆盖已租车辆) ====
          const vRes = await vehiclesTx.where({ plate: safePlate }).get();
          if (!vRes.data || vRes.data.length === 0) {
            throw new Error(`Vehicle not found: ${safePlate}`);
          }
          const veh = vRes.data[0];

          // 不再阻止已租车辆，直接覆盖绑定关系
          await vehiclesTx.doc(veh._id).update({
            data: {
              rentStatus: 'rented',
              currentDriverId: safeClientId,
              currentDriverName: safeClientName,
              updatedAt: now
            }
          });

          // ==== 3. Vehicle History ====
          const wasRented = veh.rentStatus === 'rented';
          await historyTx.add({
            data: {
              vehicleId: veh._id,
              plate: veh.plate || '',
              eventType: 'offline_rent_start',
              fromStatus: wasRented ? '已租' : '闲置',
              toStatus: '已租',
              driverClientId: safeClientId,
              driverName: safeClientName,
              contractId: null,
              operator: 'system-offline-import',
              createdAt: now
            }
          });

          const inputType = safeContractType; // Original CSV input type
          let derivedType = 'rent_std'; // default fallback for the system
          if (inputType.includes('std')) derivedType = 'rent_std';
          if (inputType.includes('zeroDown')) derivedType = 'rent_zeroDown';

          // ==== 4. Contract 'Ghost' Record ====
          const addContractRes = await contractsTx.add({
            data: {
              contractType: derivedType,
              contractTypeName: derivedTypeName,
              deleted: false,
              contractStatus: 'active',
              cityCode: derivedCityCode,
              cityName: derivedCityName,  // Added City Name
              branchCode: safeBranchCode,
              createdAt: now,
              updatedAt: now,
              fields: {
                carPlate: safePlate,
                clientName: safeClientName,
                clientPhone: safeClientPhone,
                clientId: safeClientId,
                branchCode: safeBranchCode,
                contractValidPeriodStart: safeStart,
                contractValidPeriodEnd: safeEnd,
                rentMonthly: safeRent,
                deposit: safeDeposit
              }
            }
          });

          // ==== 5. Link Contract to Driver ====
          const contractId = addContractRes._id;
          const drvAfter = await driversTx.where({ clientId: safeClientId }).get();
          if (drvAfter.data && drvAfter.data.length > 0) {
            await driversTx.doc(drvAfter.data[0]._id).update({
              data: {
                lastContractId: contractId,
                cityName: derivedCityName, // Ensure driver has cityName
                updatedAt: now
              }
            });
          }
        });

        successCount++;
      } catch (err) {
        errorCount++;
        errorDetails.push(`Row ${realIndex + 1} (${safePlate}): ${err.message}`);
        console.error(`[importOffline] Row ${realIndex + 1} failed:`, err);
      }
    }));
  }

  return {
    ok: true,
    total: rows.length,
    success: successCount,
    errors: errorCount,
    errorDetails
  };
}


async function updateInsurance(payload) {
  const { vehicleId, insuranceData } = payload;

  const dataToUpdate = {
    liabInsStart: parseBizDateCloud(insuranceData.liabInsStart),
    liabInsEnd: parseBizDateCloud(insuranceData.liabInsEnd),
    commInsStart: parseBizDateCloud(insuranceData.commInsStart),
    commInsEnd: parseBizDateCloud(insuranceData.commInsEnd),
    updatedAt: db.serverDate()
  };

  await db.collection('vehicles').doc(vehicleId).update({
    data: dataToUpdate
  });

  return { ok: true };
}

async function updateAnnualInspection(payload) {
  const { vehicleId, dateStr } = payload;

  await db.collection('vehicles').doc(vehicleId).update({
    data: {
      annualInspectionDate: parseBizDateCloud(dateStr),
      updatedAt: db.serverDate()
    }
  });

  return { ok: true };
}

async function getDashboardStats(payload) {
  const { cityCode, timeRange, startDate, endDate } = payload;

  // 重新引用一下，确保作用域安全
  const db = cloud.database();
  const _ = db.command;
  const $ = db.command.aggregate;

  // 1. 计算时间窗口
  let startT = new Date();
  let endT = new Date(); // 默认为 now

  // 重置到当天 00:00:00
  startT.setHours(0, 0, 0, 0);
  endT.setHours(23, 59, 59, 999);

  if (timeRange === 'week') {
    const day = startT.getDay() || 7;
    startT.setDate(startT.getDate() - day + 1); // 本周一
  } else if (timeRange === 'month') {
    startT.setDate(1); // 本月1号
  } else if (timeRange === 'custom' && startDate && endDate) {
    startT = new Date(startDate);
    endT = new Date(endDate);
  }

  // 2. 准备查询条件
  // 追加排除已售/报废条件的匹配
  const baseMatch = { retired: _.neq(true) };
  if (cityCode) {
    baseMatch.cityCode = cityCode;
  }

  // ----------------------------------------------------
  // A. 存量快照 (Snapshot)
  // ----------------------------------------------------
  const snapshotRes = await db.collection('vehicles').aggregate()
    .match(baseMatch)
    .group({
      _id: null,
      total: $.sum(1),
      rented: $.sum($.cond({
        if: $.eq(['$rentStatus', 'rented']), then: 1, else: 0
      })),
      available: $.sum($.cond({
        if: $.eq(['$rentStatus', 'available']), then: 1, else: 0
      })),
      maintenance: $.sum($.cond({
        if: $.eq(['$maintenanceStatus', 'in_maintenance']), then: 1, else: 0
      }))
    })
    .end();

  const stats = snapshotRes.list[0] || { total: 0, rented: 0, available: 0, maintenance: 0 };

  // ----------------------------------------------------
  // B. 流量流水 (Flow) - 联表查询
  // ----------------------------------------------------
  const flowRes = await db.collection('vehicle_history').aggregate()
    .match({
      createdAt: _.gte(startT).and(_.lte(endT))
    })
    .lookup({
      from: 'vehicles',
      localField: 'vehicleId',
      foreignField: '_id',
      as: 'vehicleInfo'
    })
    // 过滤城市
    .match(cityCode ? { 'vehicleInfo.0.cityCode': cityCode } : {})
    .sort({ createdAt: -1 })
    .project({
      plate: 1,
      eventType: 1,
      createdAt: 1,
      driverClientId: 1,
      driverName: 1,
      clientName: 1, //以防万一存的是 clientName
    })
    .limit(100)
    .end();

  const historyList = flowRes.list;
  const flowStats = {
    rentOut: historyList.filter(x => x.eventType === 'rent_start'),
    return: historyList.filter(x => ['rent_end', 'rent_end_ocr'].includes(x.eventType)),
    maintenanceIn: historyList.filter(x => x.eventType === 'maintenance_start'),
    maintenanceOut: historyList.filter(x => x.eventType === 'maintenance_end')
  };

  // ----------------------------------------------------
  // C. 到期预警 (Expirations)
  // ----------------------------------------------------
  const future30d = new Date();
  future30d.setDate(future30d.getDate() + 30);
  const minDate = new Date('2000-01-01');

  const expiringRes = await db.collection('vehicles').where(
    _.and([
      baseMatch,
      _.or([
        { liabInsEnd: _.gte(new Date()).and(_.lte(future30d)) },
        { annualInspectionDate: _.gte(new Date()).and(_.lte(future30d)) }
      ])
    ])
  )
    .field({ plate: 1, liabInsEnd: 1, annualInspectionDate: 1 })
    .limit(20)
    .get();

  return {
    ok: true,
    dateRange: { start: startT, end: endT },
    snapshot: stats,
    flow: flowStats,
    expiring: expiringRes.data
  };
}

// 获取所有城市的存量概览 (分组统计)
async function getAllCitiesStats() {
  const db = cloud.database();
  const $ = db.command.aggregate;

  // 聚合查询：按 cityCode 和 branchCode 分组
  const res = await db.collection('vehicles').aggregate()
    .match({
      retired: db.command.neq(true) // 排除已售/报废
    })
    .group({
      _id: {
        cityCode: '$cityCode',
        branchCode: $.ifNull(['$branchCode', ''])
      },
      total: $.sum(1),
      rented: $.sum($.cond({
        if: $.eq(['$rentStatus', 'rented']), then: 1, else: 0
      })),
      available: $.sum($.cond({
        if: $.eq(['$rentStatus', 'available']), then: 1, else: 0
      })),
      maintenance: $.sum($.cond({
        if: $.eq(['$maintenanceStatus', 'in_maintenance']), then: 1, else: 0
      }))
    })
    .end();

  // 整理数据，计算出租率
  const list = (res.list || []).map(item => {
    const total = item.total;
    const rented = item.rented;
    let rate = 0;
    if (total > 0) {
      rate = (rented / total) * 100;
    }
    return {
      cityCode: item._id.cityCode,
      branchCode: item._id.branchCode,
      ...item,
      utilization: rate.toFixed(1),
      utilizationRate: rate
    };
  });

  return { ok: true, list };
}

// --- 新增的辅助函数 ---
async function listAvailable(payload) {
  const { cityCode, branchCode } = payload || {};
  if (!cityCode) return { ok: false, error: 'missing-cityCode' };

  const _ = db.command; // 确保能使用指令

  try {
    const where = {
      cityCode,
      rentStatus: 'available',
      retired: _.neq(true), // 排除已售/报废
      // 排除维修状态 (兼容 none, 空字符串, null, 或字段不存在)
      maintenanceStatus: _.or([
        _.eq('none'),
        _.eq(''),
        _.eq(null),
        _.exists(false)
      ])
    };

    // 2. 核心修改：如果前端传了分公司代码，就加入过滤条件
    if (branchCode) {
      where.branchCode = branchCode;
    }

    // 云函数端 limit 最大支持 1000，解决小程序端 20 条限制
    const res = await db.collection('vehicles')
      .where(where)
      .orderBy('plate', 'asc')
      .limit(1000)
      .get();

    return { ok: true, list: res.data };
  } catch (e) {
    console.error('[vehicleOps] listAvailable error', e);
    return { ok: false, error: e.message };
  }
}

async function migrateBranches() {
  const collections = ['vehicles', 'drivers', 'contracts'];
  const db = cloud.database();
  const _ = db.command;

  const updates = [
    { cityCode: 'suzhou', branchCode: 'suz_a', branchName: '苏州兔斯夫' },
    { cityCode: 'foshan', branchCode: 'fos_b', branchName: '佛山老宾' }
  ];

  let summary = {};

  try {
    for (const target of updates) {
      for (const colName of collections) {
        const res = await db.collection(colName).where({
          cityCode: target.cityCode,
          branchCode: _.or([_.eq(null), _.exists(false), _.eq('')])
        }).update({
          data: {
            branchCode: target.branchCode,
            branchName: target.branchName,
            updatedAt: db.serverDate()
          }
        });
        summary[`${colName}_${target.cityCode}`] = res.stats.updated;
      }
    }
    return { ok: true, summary };
  } catch (err) {
    console.error('[migrateBranches] error', err);
    return { ok: false, error: err.message };
  }
}

// ==========================================
// 定时任务：逾期自动退车 (Cron Job)
// ==========================================
async function autoReturnExpired() {
  const collectionVehicles = db.collection('vehicles');
  const collectionContracts = db.collection('contracts');

  let processedCount = 0;
  let returnedCount = 0;
  const errors = [];

  try {
    // 1. 获取所有在租的车辆
    // 注意：云函数单次 limit 1000。如果您的车队非常大，请改成循环分页。
    const vehRes = await collectionVehicles.where({ rentStatus: 'rented' }).limit(1000).get();
    const rentedVehicles = vehRes.data || [];

    const now = Date.now(); // 绝对时间戳

    for (const veh of rentedVehicles) {
      if (!veh.plate) continue;
      processedCount++;

      // 2. 找到该车辆【最新】且【有效】的合同
      // 排除已经被软删除 (deleted: true) 或者被作废/异常终止的合同
      const _ = db.command;
      const contractRes = await collectionContracts
        .where(_.and([
          { 'fields.carPlate': veh.plate },
          { deleted: _.neq(true) }, // 必须未被删除
          _.or([ // E-sign 状态必须不是作废或终止，或者根本没有 E-sign
            { 'esign.signTaskStatus': _.exists(false) },
            { 'esign.signTaskStatus': null },
            { 'esign.signTaskStatus': _.nin(['revoked', 'task_terminated', 'abolishing']) }
          ])
        ]))
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      if (!contractRes.data || contractRes.data.length === 0) continue;

      const latestContract = contractRes.data[0];
      const endDateStr = latestContract.fields?.contractValidPeriodEnd; // e.g. '2025-10-15'

      if (!endDateStr) continue;

      // 3. 构建该合同的绝对过期时间阈值
      // 用户的要求：在 expiry day 的 早上 6:00 (UTC+8) 到期
      // 拼接成标准 ISO8601，带有 +08:00 时区偏移，这样 new Date 就会绝对精确，不受云函数本地 Node 环境时区影响
      const expireTimeString = `${endDateStr}T06:00:00+08:00`;
      const expireTimeMs = new Date(expireTimeString).getTime();

      // 4. 判断是否过期
      // 如果当前绝对时间已经超过了设定的过期时间，自动触发还车
      if (now >= expireTimeMs) {
        try {
          console.log(`[AutoReturn] Vehicle ${veh.plate} expired at ${expireTimeString}. Triggering return.`);
          // 复用现成的 updateStatus 来优雅地结束租赁、解绑司机、写历史记录
          await updateStatus({
            vehicleId: veh._id,
            newStatus: 'available',
            operator: 'system-timer'
          });

          // 标记该合同为 '已到期'
          try {
            await collectionContracts.doc(latestContract._id).update({
              data: {
                contractStatus: 'expired',
                expiredAt: db.serverDate()
              }
            });
            console.log(`[AutoReturn] Marked contract ${latestContract._id} as expired`);
          } catch (cErr) {
            console.error(`[AutoReturn] Failed to mark contract as expired:`, cErr);
          }

          returnedCount++;
        } catch (updateErr) {
          console.error(`[AutoReturn] Failed to auto-return ${veh.plate}:`, updateErr);
          errors.push(`Plate: ${veh.plate}, Error: ${updateErr.message}`);
        }
      }
    }

    const result = {
      ok: true,
      processed: processedCount,
      returned: returnedCount,
      errors
    };
    console.log('[AutoReturn] Completed:', result);
    return result;

  } catch (err) {
    console.error('[AutoReturn] Fatal Error:', err);
    return { ok: false, error: err.message };
  }
}

async function exportVehiclesToCsv(payload) {
  const { cityCode, branchCode } = payload || {};
  if (!cityCode) throw new Error('cityCode required');

  const _ = db.command;
  const where = { cityCode };
  if (branchCode) {
    where.branchCode = branchCode;
  }

  let allVehicles = [];
  let page = 0;
  const MAX_LIMIT = 1000;
  const vehiclesCol = db.collection('vehicles');

  while (true) {
    const res = await vehiclesCol.where(where).skip(page * MAX_LIMIT).limit(MAX_LIMIT).get();
    const list = res.data;
    if (!list || list.length === 0) break;
    allVehicles = allVehicles.concat(list);
    page++;
    if (list.length < MAX_LIMIT) break;
  }

  if (allVehicles.length === 0) {
    throw new Error('No vehicles found for the selected criteria.');
  }

  // Sanitize array: remove _id to prevent upsert issues later if they re-import
  const cleanData = allVehicles.map(v => {
    delete v._id;
    delete v._openid;
    
    // Normalize date objects to avoid [object Object] in CSV
    for (const key in v) {
      if (v[key] instanceof Date) {
        v[key] = v[key].toISOString();
      }
    }
    return v;
  });

  const csvStr = Papa.unparse(cleanData);

  // Upload to Temporary File with UTF-8 BOM
  const uploadRes = await cloud.uploadFile({
    cloudPath: `temp_exports/vehicles_${cityCode}_${branchCode || 'all'}_${Date.now()}.csv`,
    fileContent: Buffer.from('\ufeff' + csvStr, 'utf8')
  });

  const fileID = uploadRes.fileID;

  // Get Temp URL
  const tmp = await cloud.getTempFileURL({
    fileList: [fileID],
    maxAge: 60 * 60 * 1 // 1 hour validity
  });

  const url = tmp?.fileList?.[0]?.tempFileURL;
  if (!url) throw new Error('Cannot acquire download URL');

  return { ok: true, url, total: allVehicles.length };
}

async function renamePlate(payload) {
  const { oldPlate, newPlate } = payload || {};
  const cleanOld = (oldPlate || '').trim();
  const cleanNew = (newPlate || '').trim();

  if (!cleanOld || !cleanNew) {
    throw new Error('oldPlate and newPlate required');
  }

  const vehiclesCol = db.collection('vehicles');
  const historyCol = db.collection('vehicle_history');
  const contractsCol = db.collection('contracts');

  // 1. Check if new plate already exists
  const existRes = await vehiclesCol.where({ plate: cleanNew }).limit(1).get();
  if (existRes.data && existRes.data.length > 0) {
    throw new Error(`目标车牌（${cleanNew}）已经存在于数据库中，无法执行合并替换以防数据损毁！`);
  }

  // 2. Find old vehicle
  const targetRes = await vehiclesCol.where({ plate: cleanOld }).limit(1).get();
  if (!targetRes.data || targetRes.data.length === 0) {
    throw new Error(`找不到原车辆（${cleanOld}），请核对车牌号。`);
  }
  const oldDocId = targetRes.data[0]._id;

  // 3. Update vehicles collection (1 document)
  await vehiclesCol.doc(oldDocId).update({
    data: {
      plate: cleanNew,
      updatedAt: db.serverDate()
    }
  });

  // 4. Mass update vehicle histories
  const hisRes = await historyCol.where({ plate: cleanOld }).update({
    data: { plate: cleanNew }
  });

  // 5. Mass update contracts
  const conRes = await contractsCol.where({ 'fields.carPlate': cleanOld }).update({
    data: { 'fields.carPlate': cleanNew, updatedAt: db.serverDate() }
  });

  return {
    ok: true,
    updates: {
      historyCount: hisRes.stats.updated || 0,
      contractsCount: conRes.stats.updated || 0
    }
  };
}
