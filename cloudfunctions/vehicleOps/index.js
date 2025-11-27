// 云函数入口文件
const cloud = require('wx-server-sdk');
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
      // 维修轴保持不变
      // 如果有司机，解绑
      if (veh.currentDriverClientId) {
        updateData.currentDriverClientId = _.remove();
        updateData.driverClientId =_.remove();
      }
    } else if (newStatus === 'maintenance') {
      // 切维修状态：toggle
      eventType = 'maintenance_toggle';
  
      newMaintenanceStatus =
        oldMaintenanceStatus === 'in_maintenance' ? 'none' : 'in_maintenance';
      // 这里不动租赁轴，也不碰 currentDriverClientId
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
    const fromStatusLabel = formatStatusLabel(oldRentStatus, oldMaintenanceStatus);
    const toStatusLabel   = formatStatusLabel(newRentStatus, newMaintenanceStatus);
  
    await db.collection('vehicle_history').add({
      data: {
        vehicleId: veh._id,
        plate: veh.plate || '',
        eventType,
        fromStatus: fromStatusLabel,
        toStatus: toStatusLabel,
        driverClientId: veh.currentDriverClientId || null, // 记录变化发生时的司机
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

async function updateStatus0(payload) {
    const { vehicleId, newStatus } = payload || {};
  
    if (!vehicleId) throw new Error('vehicleId-required');
    if (!newStatus || !['available', 'maintenance'].includes(newStatus)) {
      throw new Error('invalid-status');
    }
  
    const vehicles = db.collection('vehicles');
    const history  = db.collection('vehicle_history');
  
    // 1) 取当前车辆
    const res = await vehicles.doc(vehicleId).get();
    if (!res.data) throw new Error('vehicle-not-found');
  
    const veh = res.data;
    const now = db.serverDate();
  
    // 2) 当前双轴状态（不再从 status 推导）
    let oldRentStatus        = veh.rentStatus || 'available';
    let oldMaintenanceStatus = veh.maintenanceStatus || 'none';
  
    let rentStatus        = oldRentStatus;
    let maintenanceStatus = oldMaintenanceStatus;
  
    // 记录用：变化前的展示 status
    const displayBefore = deriveStatus(oldRentStatus, oldMaintenanceStatus);
  
    // ============================================================
    // 分支 1：进入维修（newStatus === 'maintenance'）
    // ============================================================
    if (newStatus === 'maintenance') {
      // 只有从非维修 → 维修 时才写一条 maintenance_start
      if (oldMaintenanceStatus !== 'in_maintenance') {
        await history.add({
          data: {
            vehicleId,
            plate: veh.plate || '',
            eventType: 'maintenance_start',
            fromStatus: displayBefore,
            toStatus:   'maintenance',
            driverClientId: veh.currentDriverClientId || null,
            contractId: null,
            operator: null,
            createdAt: now
          }
        });
      }
  
      maintenanceStatus = 'in_maintenance';
      // 注意：不动 rentStatus，不解绑司机
    }
  
    // ============================================================
    // 分支 2：设为可出租（newStatus === 'available'）
    //   这里要分两种：
    //   A. 当前在维修 → 结束维修（只动维修轴，不结束租赁）
    //   B. 当前不在维修 → 结束租赁（租赁轴变 available，并解绑司机）
    // ============================================================
    if (newStatus === 'available') {
  
      if (oldMaintenanceStatus === 'in_maintenance') {
        // A. 从维修状态退出来（不管是 rented+maintenance 还是 available+maintenance）
  
        // 写 maintenance_end
        await history.add({
          data: {
            vehicleId,
            plate: veh.plate || '',
            eventType: 'maintenance_end',
            fromStatus: displayBefore,                   // 一定是 'maintenance'
            toStatus:   deriveStatus(oldRentStatus, 'none'),
            driverClientId: veh.currentDriverClientId || null,
            contractId: null,
            operator: null,
            createdAt: now
          }
        });
  
        maintenanceStatus = 'none';
        // 注意：租赁轴 rentStatus 保持不变（rented 或 available）
        // 也不解绑司机 —— 你说“修好车之后再决定要不要取消租赁”
  
      } else {
        // B. 不在维修中，此时“设为可出租” = 结束租赁
  
        if (oldRentStatus === 'rented') {
          // 写 rent_end
          await history.add({
            data: {
              vehicleId,
              plate: veh.plate || '',
              eventType: 'rent_end',
              fromStatus: displayBefore,                 // 一般是 'rented'
              toStatus:   deriveStatus('available', oldMaintenanceStatus),
              driverClientId: veh.currentDriverClientId || null,
              contractId: null,
              operator: null,
              createdAt: now
            }
          });
        }
  
        rentStatus = 'available';
  
        // 结束租赁时，解绑司机 —— 对应你说的“第二条 rented -> available 司机名字应该清除”
        // maintenanceStatus 保持为 none（按我们约定，既然不在维修中 oldMaintenanceStatus 就是 'none'）
      }
    }
  
    // 3) 推导展示用 status（给 vehicle-center / vehicle-detail 用）
    const status = deriveStatus(rentStatus, maintenanceStatus);
  
    // 4) 写回 vehicles
    const updateData = {
      rentStatus,
      maintenanceStatus,
      status,
      updatedAt: now
    };
  
    // 只有在“结束租赁”的那个分支才解绑司机
    if (newStatus === 'available' && oldMaintenanceStatus === 'none') {
      updateData.currentDriverClientId = _.remove(); // 真正解绑
    }
  
    await vehicles.doc(vehicleId).update({ data: updateData });
  
    return {
      ok: true,
      vehicleId,
      newStatus,
      rentStatus,
      maintenanceStatus,
      status
    };
}