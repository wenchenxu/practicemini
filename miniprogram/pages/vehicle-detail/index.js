// pages/vehicle-detail/index.js
const db = wx.cloud.database();
const vehiclesCol = db.collection('vehicles');
const driversCol  = db.collection('drivers');
const contractsCol = db.collection('contracts');

Page({
  data: {
    id: '',
    vehicle: null,
    driverName: '',
    contractId: '',
    loading: true,
    opBusy: false, // 避免重复点击
    rentStatus: '',          // 'available' | 'rented'
    rentStatusText: '',
    maintenanceStatus: '',   // 'none' | 'in_maintenance'
    maintenanceStatusText: '',
    statusText: ''           // “已租”、"闲置"、“已租 · 维修中”等
  },

  onLoad(options) {
    const id = options.id;
    if (!id) {
      wx.showToast({ title: '缺少车辆ID', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    this.setData({ vehicleId: id });
    this.fetchDetail();
  },

  onPullDownRefresh() {
    this.fetchDetail().finally(() => wx.stopPullDownRefresh());
  },

  async fetchDetail() {
    const { vehicleId } = this.data;
    if (!vehicleId) return;

    this.setData({ loading: true });

    try {
      // 1) 取车辆
      const { data: veh } = await vehiclesCol.doc(vehicleId).get();
      if (!veh) {
        this.setData({ vehicle: null, loading: false });
        wx.showToast({ title: '车辆不存在', icon: 'none' });
        return;
      }

      // 2) 推导 rentStatus / maintenanceStatus（兼容旧数据）
      const rentStatus = veh.rentStatus || (veh.status === 'rented' ? 'rented' : 'available');
      const maintenanceStatus = veh.maintenanceStatus || (veh.status === 'maintenance' ? 'in_maintenance' : 'none');

      // 3) 生成展示文案
      const rentStatusText = rentStatus === 'rented' ? '已租' : '闲置';
      const maintenanceStatusText = maintenanceStatus === 'in_maintenance' ? '维修中' : '正常';

      // 4) 查司机名字（如果有绑定）
      // A. 优先使用车辆记录里的“快照”信息 (兼容 CSV 导入的数据)
      let driverName = veh.currentDriverName || '';
      let driverId =  veh.currentDriverId || '';
      let driverPhone = veh.currentDriverPhone || '';

      // B. 如果有身份证号，尝试去 drivers 集合查最新信息（主要是为了补全电话）
      if (driverId) {
        try {
          const drvRes = await driversCol
            .where({ clientId: driverId })
            .limit(1)
            .get();
          
          if (drvRes.data && drvRes.data.length > 0) {
            const drv = drvRes.data[0];
            // 如果司机表里有名字，优先用司机表的名字（通常更准确），当然如果司机表没名字就用车辆表的
            driverName = drv.name || driverName; 
            driverPhone = drv.phone || driverPhone || '';
          }
        } catch (err) {
          console.error('Fetch driver info failed', err);
          // 查不到也没关系，我们已经有 driverName 和 driverId 了
        }
      }

      // 5)（可选）查最近合同，你原来有就保留；没有可以不填
      let contractId = '';
      try {
        const { data: contracts } = await contractsCol
            .where({ 'fields.carPlate': veh.plate })
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();
        if (contracts && contracts.length > 0) {
            const latestContract = contracts[0];
            contractId = latestContract.fields?.contractSerialNumberFormatted || latestContract._id || '';
        } 
      } catch (e) { /* ignore */ }

      this.setData({
        vehicle: veh,
        driverName,
        driverId,
        driverPhone,
        contractId,
        rentStatus,
        rentStatusText,
        maintenanceStatus,
        maintenanceStatusText,
        loading: false
      });
    } catch (e) {
      console.error('[vehicle-detail] fetchDetail error', e);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

    // 「设为可出租」：结束租赁 & 解绑司机，不影响维修状态
  onMarkAvailable() {
    const { vehicle, rentStatus, maintenanceStatus, driverName, opBusy } = this.data;
    if (opBusy) return;
    if (!vehicle || !vehicle._id) return;

    const hasDriver = !!vehicle.currentDriverId;

    // 之后优化，暂时添加接口允许没有司机的车辆恢复闲置状态，方便工作流程
    // 如果已经是闲置状态，且没有司机，直接提示即可，不需要弹窗
    if (rentStatus === 'available' && !hasDriver) {
      wx.showToast({ title: '车辆已是闲置状态', icon: 'none' });
      return;
    }

    let content = '';
    if (maintenanceStatus === 'in_maintenance') {
      content = `该车辆当前处于维修中，并绑定司机「${driverName || '未知'}」。此操作只会结束租赁并解绑司机，车辆仍保持维修状态。是否继续？`;
    } else if (rentStatus === 'rented') {
      content = `该操作会结束当前租赁，并解绑司机「${driverName || '未知'}」，并将车辆设为可出租。是否继续？`;
    } else {
      // rentStatus 已经是 available 但仍有司机（理论上很少见）
      // 只有当 rentStatus == 'available' 且 hasDriver == true 时才会走到这里
      content = `当前车辆已标记为「闲置」，但仍绑定司机「${driverName || '未知'}」。此操作会解绑司机。是否继续？`;
    }

    wx.showModal({
      title: '确认结束租赁',
      content,
      success: (res) => {
        if (!res.confirm) return;
        this._doUpdateStatus('available');
      }
    });
  },

    // 「标记维修」：维修状态 toggle，不动租赁状态 / 司机
  onMarkMaintenance() {
    const { vehicle, rentStatus, maintenanceStatus, driverName, opBusy } = this.data;
    if (opBusy) return;
    if (!vehicle || !vehicle._id) return;

    const isRepairing = maintenanceStatus === 'in_maintenance';
    let title = '';
    let content = '';

    if (!isRepairing) {
      // 准备进入维修
      title = '标记维修';
      if (rentStatus === 'rented') {
        content = `当前车辆已出租给「${driverName || '未知'}」，确认标记为维修状态？\n（不会解绑司机）`;
      } else {
        content = '确认将车辆标记为维修状态？';
      }
    } else {
      // 准备结束维修
      title = '结束维修';
      content = '确认结束维修状态？';
    }

    wx.showModal({
      title,
      content,
      success: (res) => {
        if (!res.confirm) return;
        this._doUpdateStatus('maintenance');
      }
    });
  },

  // 真正调用云函数的内部方法
  async _doUpdateStatus(newStatus) {
    const { vehicle } = this.data;
    if (!vehicle || !vehicle._id) return;

    this.setData({ opBusy: true });

    try {
      const resp = await wx.cloud.callFunction({
        name: 'vehicleOps',
        data: {
          action: 'updateStatus',
          payload: {
            vehicleId: vehicle._id,
            newStatus  // 'available' | 'maintenance'
          }
        }
      });

      const result = resp && resp.result;
      if (!result || !result.ok) {
        const msg = (result && result.error) || '操作失败';
        wx.showToast({ title: msg, icon: 'none' });
        this.setData({ opBusy: false });
        return;
      }

      wx.showToast({ title: '已更新', icon: 'success' });
      // 更新完重新拉一次详情，刷新状态 / 司机显示
      await this.fetchDetail();
    } catch (e) {
      console.error('[vehicle-detail] updateStatus error', e);
      wx.showToast({ title: '操作异常', icon: 'none' });
    } finally {
      this.setData({ opBusy: false });
    }
  },

  toHistory() {
    const { vehicle } = this.data;
    wx.navigateTo({
      url: `/pages/vehicle-history/index?vehicleId=${vehicle._id}&plate=${vehicle.plate}`
    });
  }  
});
