// pages/vehicle-detail/index.js
const db = wx.cloud.database();
const vehiclesCol = db.collection('vehicles');
const driversCol  = db.collection('drivers');
const contractsCol = db.collection('contracts');
const BIZ_TZ = 'Asia/Shanghai';

// 🛠️ 工具函数：将 Date 对象转为 'YYYY-MM-DD' (强制上海时区)
// 替代了之前的 formatDateStr
function formatBizDate(dateInput) {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return '';
  
    // 使用 Intl 强制使用上海时区格式化
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: BIZ_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
  
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;
    return `${y}-${m}-${d}`;
  }
  
// 🛠️ 工具函数：将 'YYYY-MM-DD' 字符串转为 Date 对象 (强制上海时区0点)
// 替代了之前的 parseDateStr
function parseBizDate(str) {
    if (!str) return null;
    // 核心修改：显式加上 +08:00 时区偏移，防止被解析为 UTC 或 本地时区
    // 这样生成的 Date 对象，其绝对时间戳就是当天的 00:00:00 (上海时间)
    return new Date(`${str}T00:00:00+08:00`);
  }

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
    statusText: '',           // “已租”、"闲置"、“已租 · 维修中”等
    showInsEdit: false, // 控制弹窗显示
    editIns: {},        // 编辑时的临时对象（存字符串格式 'YYYY-MM-DD'）
    // 新增：年审弹窗控制
    showAnnualEdit: false,
    editAnnualDate: '' // 暂存编辑时的日期字符串
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

      // 使用新的 formatBizDate 处理显示
      // 无论用户手机在哪个国家，看到的都是上海时间的日期
      veh.liabInsStartStr = formatBizDate(veh.liabInsStart);
      veh.liabInsEndStr   = formatBizDate(veh.liabInsEnd);
      veh.commInsStartStr = formatBizDate(veh.commInsStart);
      veh.commInsEndStr   = formatBizDate(veh.commInsEnd);

      //年审
      veh.annualInspectionDateStr = formatBizDate(veh.annualInspectionDate);
      this.setData({ vehicle: veh });

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

  // 「标记已售/报废」：从所有活跃视图中隐藏车辆（双重确认）
  onMarkRetired() {
    const { vehicle, rentStatus, opBusy } = this.data;
    if (opBusy) return;
    if (!vehicle || !vehicle._id) return;

    if (rentStatus === 'rented') {
      wx.showToast({ title: '请先退租再标记', icon: 'none' });
      return;
    }

    // 第一次确认：说明操作内容
    wx.showModal({
      title: '确认标记已售/报废',
      content: `车辆「${vehicle.plate}」将被标记为已售或报废。\n\n该车辆将不再出现在车辆列表和统计中，但数据会保留在数据库中。\n\n是否继续？`,
      confirmColor: '#ee0a24',
      success: (res) => {
        if (!res.confirm) return;

        // 第二次确认：强调不可逆
        wx.showModal({
          title: '⚠️ 最终确认',
          content: '此操作不可撤销！\n\n车辆一旦标记为已售/报废，将永久从所有列表、统计和可选车辆中移除。\n\n请再次确认是否继续？',
          confirmText: '确认报废',
          confirmColor: '#ee0a24',
          success: (res2) => {
            if (!res2.confirm) return;
            this._doUpdateStatus('retired').then(() => {
              setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
            });
          }
        });
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
      // url: `/pages/vehicle-history/index?vehicleId=${vehicle._id}`
    });
  },

  // 1. 点击按钮：打开编辑窗口，并复制当前数据到临时对象
  onStartEditIns() {
    const v = this.data.vehicle || {};
    this.setData({
      showInsEdit: true,
      editIns: {
        liabInsStart: v.liabInsStartStr || '',
        liabInsEnd:   v.liabInsEndStr || '',
        commInsStart: v.commInsStartStr || '',
        commInsEnd:   v.commInsEndStr || '',
      }
    });
  },

  onCloseInsEdit() {
    this.setData({ showInsEdit: false });
  },

  // 智能日期计算 (加一年减一天) - 适配时区版
  calcEndDate(startDateStr) {
    if (!startDateStr) return '';
    
    // 1. 先转成上海时区 0点的 Date 对象
    const d = parseBizDate(startDateStr); 
    
    // 2. 进行日期计算 (JS Date 会自动处理闰年/大小月)
    d.setFullYear(d.getFullYear() + 1);
    d.setDate(d.getDate() - 1);
    
    // 3. 再转回上海时区的字符串
    return formatBizDate(d);
  },

  // 监听日期变化
  onInsDateChange(e) {
    const field = e.currentTarget.dataset.field;
    const val = e.detail.value; // Picker 返回的是 'YYYY-MM-DD'
    
    const updates = {};
    updates[`editIns.${field}`] = val;

    // 智能填充逻辑
    if (field === 'liabInsStart') {
        updates['editIns.liabInsEnd'] = this.calcEndDate(val);
        // wx.showToast({ title: '已自动计算结束日', icon: 'none' });
    }
    if (field === 'commInsStart') {
        updates['editIns.commInsEnd'] = this.calcEndDate(val);
        // wx.showToast({ title: '已自动计算结束日', icon: 'none' });
    }

    this.setData(updates);
  },

  // 2. 点击编辑窗口的“确定” -> 触发二次确认弹窗
  onConfirmInsEdit() {
    // 编辑窗口会自动关闭，我们紧接着弹出一个系统确认框
    const { editIns } = this.data;
    const content = `请核对即将保存的日期：\r\n
        交强险：${editIns.liabInsStart || '-'} 至 ${editIns.liabInsEnd || '-'}
        商业险：${editIns.commInsStart || '-'} 至 ${editIns.commInsEnd || '-'}

        确认无误并写入数据库？`;
    wx.showModal({
      title: '确认修改',
      content: content,
      confirmText: '确认保存',
      confirmColor: '#07c160',
      success: (res) => {
        if (res.confirm) {
          // 用户点了“是”，才真正去执行保存
          this._doSaveInsuranceToDb();
        } else {
          // 用户点了“否”，什么都不做，刚才的修改作废
          wx.showToast({ title: '已取消', icon: 'none' });
        }
      }
    });
  },

  // 3. 真正的保存逻辑（云函数版）
  async _doSaveInsuranceToDb() {
    const { editIns, vehicle } = this.data;
    
    // 注意：这里不需要前端 parseBizDate 了，直接传字符串给云函数
    // 云函数会处理时区和 Date 转换，这样更安全
    
    wx.showLoading({ title: '写入中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'vehicleOps',
        data: {
          action: 'updateInsurance',
          payload: {
            vehicleId: vehicle._id,
            insuranceData: editIns // 直接传 { liabInsStart: '2025-xx-xx', ... }
          }
        }
      });

      const result = res.result;
      if (!result || !result.ok) {
        throw new Error(result?.error || '云函数执行异常');
      }

      // 保存完立刻刷新页面数据
      await this.fetchDetail();

      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
      
    } catch (err) {
      console.error(err);
      wx.hideLoading();
      wx.showModal({ title: '保存失败', content: err.message || String(err), showCancel: false });
    }
  },

  // --- 年审相关逻辑 ---

  // 1. 打开年审编辑窗
  onStartEditAnnual() {
    const v = this.data.vehicle || {};
    this.setData({
      showAnnualEdit: true,
      editAnnualDate: v.annualInspectionDateStr || ''
    });
  },

  // 关闭年审弹窗
  onCloseAnnualEdit() {
    this.setData({ showAnnualEdit: false });
  },

  // 监听年审日期变化
  onAnnualDateChange(e) {
    this.setData({ editAnnualDate: e.detail.value });
  },

  // 2. 点击确定 -> 二次确认
  onConfirmAnnualEdit() {
    const { editAnnualDate } = this.data;
    const content = `请核对年审日期：\r\n
        年审到期日：${editAnnualDate || '未选择'}

        确认无误并写入数据库？`;

    wx.showModal({
      title: '确认修改',
      content: content,
      confirmText: '确认保存',
      confirmColor: '#07c160',
      success: (res) => {
        if (res.confirm) {
          this._doSaveAnnualToDb();
        } else {
          wx.showToast({ title: '已取消', icon: 'none' });
        }
      }
    });
  },

  // 3. 调用云函数保存
  async _doSaveAnnualToDb() {
    const { editAnnualDate, vehicle } = this.data;
    wx.showLoading({ title: '写入中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'vehicleOps',
        data: {
          action: 'updateAnnualInspection',
          payload: {
            vehicleId: vehicle._id,
            dateStr: editAnnualDate // 直接传字符串 '2025-xx-xx'
          }
        }
      });

      const result = res.result;
      if (!result || !result.ok) throw new Error(result?.error || '云函数异常');

      await this.fetchDetail(); // 刷新

      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
      
    } catch (err) {
      console.error(err);
      wx.hideLoading();
      wx.showModal({ title: '保存失败', content: err.message, showCancel: false });
    }
  }
});
