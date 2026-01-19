// pages/contract-detail/index.js
const db = wx.cloud.database();

Page({
  data: {
    contract: null,
    giftDays: '', // 默认为空字符串，方便显示 placeholder
    giftDaysNotes: '',
    contractRealEndDate: '', 
    saving: false,
    // 编辑弹窗用的临时数据
    showEditModal: false,
    editGiftDays: '',
    editGiftNotes: '',
    editRealEndDate: '',
    // --- 租金支付设置 (展示用) ---
    rentPayFrequency: 'month', // 默认月付
    rentPayDates: [],          // 默认空
    rentFrequencyMap: {
      'month': '按月支付',
      'week': '按周支付',
      'day': '按日支付'
    },
    // --- 租金编辑弹窗 (临时数据) ---
    showRentEditModal: false,
    editRentFrequency: 'month',
    editRentDates: [],
    savingRent: false,
    // --- 换车模块 ---
    showSwapModal: false,
    swapReason: '',
    availableVehicles: [],
    loadingVehicles: false,
    selectedNewVehicleId: '',
    swapping: false,
    // 二次确认弹窗控制
    showSwapConfirmDialog: false,
    selectedNewVehiclePlate: '',
  },

  onLoad(options) {
    const { id } = options;
    if (id) {
      this.fetchDetail(id);
    }
  },

  async fetchDetail(id) {
    wx.showLoading({ title: '加载中...' });
    try {
      // 获取 contracts 集合中的单条记录
      const res = await db.collection('contracts').doc(id).get();
      // 数据通常在 res.data 中。数据结构可能是 res.data 只有一层，也可能所有字段都在 res.data.fields 里
      // 根据你之前的代码 (contract-new)，数据似乎是平铺在 data 下，或者在 fields 下。这里做一个兼容处理：
      const data = res.data;
      const displayData = {
        ...data,
        ...(data.fields || {})
      };

      // 新增：计算默认支付日期
      // 1. 尝试获取已保存的设置
      let savedDates = displayData.rentPayDates;
      
      // 2. 如果没保存过，则取合同上的“每月支付日”作为默认值
      if (!savedDates || savedDates.length === 0) {
          const defaultDay = Number(displayData.rentPaybyDayInMonth);
          // 只有当它是有效数字 (1-31) 时才使用
          if (defaultDay && !isNaN(defaultDay)) {
              savedDates = [defaultDay];
          } else {
              savedDates = [];
          }
      }

      this.setData({ 
        contract: displayData,
        giftDays: displayData.giftDays || '',
        giftDaysNotes: displayData.giftDaysNotes || '',
        // 如果数据库里有算好的日期就用，没有就重新算一遍
        contractRealEndDate: displayData.contractRealEndDate || displayData.contractValidPeriodEnd,
        rentPayFrequency: displayData.rentPayFrequency || 'month',
        rentPayDates: savedDates,
      });

      // 如果有默认天数，触发一次计算以确保日期显示正确
      /*
      if(displayData.giftDays) {
        this._calcDate(displayData.giftDays, displayData.contractValidPeriodEnd);
      }*/

    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // --- 核心逻辑：日期计算 (纯函数，不依赖 this.data) ---
  _calcDate(addDays, baseDateStr) {
    if (!baseDateStr) return baseDateStr;
    const days = parseInt(addDays);
    if (isNaN(days) || !addDays) return baseDateStr;

    const date = new Date(baseDateStr);
    date.setDate(date.getDate() + days);
    
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  // 1. 点击“编辑”按钮
  onOpenEdit() {
    const { giftDays, giftDaysNotes, contract, contractRealEndDate } = this.data;
    
    // 将当前展示的值，复制给编辑用的临时变量
    this.setData({
      showEditModal: true,
      editGiftDays: giftDays, // 回显天数
      editGiftNotes: giftDaysNotes, // 回显备注
      // 回显计算好的日期，或者基于合同原结束日重算
      editRealEndDate: contractRealEndDate || contract.contractValidPeriodEnd
    });
  },

  // 2. 关闭弹窗
  onCloseEdit() {
    this.setData({ showEditModal: false });
  },

  // 3. 弹窗内输入天数
  onEditDaysInput(e) {
    const val = e.detail.value;
    const baseDate = this.data.contract.contractValidPeriodEnd;
    
    // 实时计算新的结束日期
    const newDate = this._calcDate(val, baseDate);

    this.setData({ 
      editGiftDays: val,
      editRealEndDate: newDate
    });
  },

  // 4. 弹窗内输入备注
  onEditNotesInput(e) {
    this.setData({ editGiftNotes: e.detail.value });
  },

  // 5. 点击弹窗“确定” -> 保存
  async onConfirmEdit(e) {
    // 这里的 e.detail.dialog 是 Vant Dialog 实例，用于控制 loading
    // const { dialog } = e.detail; 
    
    const { contract, editGiftDays, editGiftNotes, editRealEndDate } = this.data;
    if (!contract || !contract._id) {
        this.setData({ showEditModal: false });
        return;
    }

    // 开启按钮 loading
    this.setData({ saving: true });

    try {
      // 开启按钮 loading (如果使用了 async-close)
      // Vant Dialog 默认在 confirm 时会自动变为 loading 状态 (如果 async-close=true)
      const res = await wx.cloud.callFunction({
        name: 'contractOps',
        data: {
          action: 'updateGiftInfo',
          id: contract._id,
          payload: {
            giftDays: Number(editGiftDays) || 0,
            giftDaysNotes: editGiftNotes,
            contractRealEndDate: editRealEndDate
          }
        }
      });

      if (res.result && res.result.ok) {
        wx.showToast({ title: '保存成功', icon: 'success' });
        
        // 保存成功后，把“编辑值”同步给“展示值”
        this.setData({
          giftDays: editGiftDays,
          giftDaysNotes: editGiftNotes,
          contractRealEndDate: editRealEndDate,
          showEditModal: false,
          saving: false
        });
      } else {
        throw new Error(res.result?.error || '保存失败');
      }
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '保存失败', icon: 'none' });
      // 失败：只停止 loading，不关闭弹窗，方便用户重试
      this.setData({ saving: false });
    }
  },

  // 1. 打开租金编辑弹窗
  onOpenRentEdit() {
    const { rentPayFrequency, rentPayDates } = this.data;
    this.setData({
      showRentEditModal: true,
      editRentFrequency: rentPayFrequency || 'month',
      // 深拷贝一下数组，防止直接修改 data
      editRentDates: rentPayDates ? [...rentPayDates] : []
    });
  },

  onCloseRentEdit() {
    this.setData({ showRentEditModal: false });
  },

  // 2. 切换频率 (月/周/日)
  onChangeFrequency(e) {
    const type = e.currentTarget.dataset.type;
    if (type === this.data.editRentFrequency) return;
    
    // 切换时清空已选日期，避免逻辑混乱
    this.setData({
      editRentFrequency: type,
      editRentDates: [] 
    });
  },

  // 3. 切换月付日期 (1-28 多选)
  onToggleMonthDate(e) {
    const day = e.currentTarget.dataset.day; // 数字 1-28
    let dates = this.data.editRentDates || [];
    
    if (dates.includes(day)) {
      // 如果已存在，则移除
      dates = dates.filter(d => d !== day);
    } else {
      // 如果不存在，则添加
      dates.push(day);
    }
    
    // 排序一下，好看
    dates.sort((a, b) => a - b);
    
    this.setData({ editRentDates: dates });
  },

  // 4. 选择周几 (单选)
  onSelectWeekDay(e) {
    const day = e.currentTarget.dataset.day; // "周一"
    this.setData({ editRentDates: [day] }); // 数组里只存一个值
  },

  // 5. 保存租金设置
  async onConfirmRentEdit() {
    const { contract, editRentFrequency, editRentDates } = this.data;
    
    // 简单的校验
    if (editRentFrequency !== 'day' && (!editRentDates || editRentDates.length === 0)) {
       wx.showToast({ title: '请至少选择一个日期', icon: 'none' });
       return;
    }

    this.setData({ savingRent: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'contractOps',
        data: {
          action: 'updateRentSettings', // <--- 新增的 Action
          id: contract._id,
          payload: {
            rentPayFrequency: editRentFrequency,
            rentPayDates: editRentDates
          }
        }
      });

      if (res.result && res.result.ok) {
        wx.showToast({ title: '保存成功', icon: 'success' });
        this.setData({
          rentPayFrequency: editRentFrequency,
          rentPayDates: editRentDates,
          showRentEditModal: false,
          savingRent: false
        });
      } else {
        throw new Error(res.result?.error || '保存失败');
      }
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '保存失败', icon: 'none' });
      this.setData({ savingRent: false });
    }
  },

  // 1. 打开弹窗
  onOpenSwapModal() {
    this.setData({ 
      showSwapModal: true,
      swapReason: '',
      selectedNewVehicleId: '',
      availableVehicles: [] // 先清空，防止显示旧数据
    });
    // 加载当前城市可用车辆
    this.loadAvailableVehicles();
  },

  onCloseSwapModal() {
    this.setData({ showSwapModal: false });
  },

  // 2. 加载可用车辆 (调用 vehicleOps)
  async loadAvailableVehicles() {
    const { contract } = this.data;
    
    // 获取城市代码。如果合同数据太旧没有 cityCode，尝试用 cityName 顶一下（视你的数据情况而定）
    // 注意：vehicleOps 里的 listAvailable 强依赖 'cityCode' 字段
    const cityCode = contract.cityCode || contract.cityName;

    if (!cityCode) {
        wx.showToast({ title: '合同缺少城市信息', icon: 'none' });
        return;
    }

    this.setData({ loadingVehicles: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'vehicleOps',
        data: {
          action: 'listAvailable',
          payload: { cityCode } // 重点：参数名必须是 cityCode
        }
      });

      const result = res.result || {};
      
      // 检查业务层面的错误
      if (!result.ok) {
        throw new Error(result.error || '加载失败');
      }

      // 重点：vehicleOps 返回的是 list
      const list = result.list || []; 

      this.setData({ availableVehicles: list });

    } catch (e) {
      console.error('[contract-detail] loadAvailableVehicles error', e);
      wx.showToast({ title: '加载车辆失败', icon: 'none' });
    } finally {
      this.setData({ loadingVehicles: false });
    }
  },

  // 3. 输入原因
  onInputSwapReason(e) {
    this.setData({ swapReason: e.detail.value });
  },

  // 4. 选择新车
  onSelectNewVehicle(e) {
    this.setData({ selectedNewVehicleId: e.detail.value });
  },

  // 5. 提交换车
  async onConfirmSwap() {
    const { contract, swapReason, selectedNewVehicleId, availableVehicles } = this.data;
    
    if (!swapReason) return wx.showToast({ title: '请填写换车原因', icon: 'none' });
    if (!selectedNewVehicleId) return wx.showToast({ title: '请选择新车', icon: 'none' });

    // 找到新车的详情对象 (为了传给后端做冗余存储)
    const newVehicleObj = availableVehicles.find(v => v._id === selectedNewVehicleId);
    if (!newVehicleObj) return;

    this.setData({ swapping: true });
    wx.showLoading({ title: '正在处理...' });

    try {
      const res = await wx.cloud.callFunction({
        name: 'contractOps', // 所有的重逻辑都放在 contractOps
        data: {
          action: 'swapVehicle',
          id: contract._id,
          payload: {
            newVehicleId: selectedNewVehicleId,
            newVehicleData: newVehicleObj, // 把新车完整信息传过去，方便后端提取 plate/model 等
            reason: swapReason
          }
        }
      });

      if (res.result.ok) {
        wx.showToast({ title: '换车成功', icon: 'success' });
        this.setData({ showSwapModal: false });
        // 刷新页面数据
        this.fetchDetail(contract._id); 
      } else {
        throw new Error(res.result.error || '失败');
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '换车失败', icon: 'none' });
    } finally {
      this.setData({ swapping: false });
      wx.hideLoading();
    }
  },

  // ▼▼▼ 修改：点击“确认换车”按钮，先校验并弹出确认框 ▼▼▼
  onPreConfirmSwap() {
    const { swapReason, selectedNewVehicleId, availableVehicles } = this.data;
    
    if (!swapReason) return wx.showToast({ title: '请填写换车原因', icon: 'none' });
    if (!selectedNewVehicleId) return wx.showToast({ title: '请选择新车', icon: 'none' });

    // 找到新车对象，提取车牌号用于展示
    const newVehicle = availableVehicles.find(v => v._id === selectedNewVehicleId);
    if (!newVehicle) return;

    this.setData({
      selectedNewVehiclePlate: newVehicle.plate,
      showSwapConfirmDialog: true
    });
  },

  // 关闭确认框
  onCloseSwapConfirmDialog() {
    this.setData({ showSwapConfirmDialog: false });
  },

  // ▼▼▼ 重命名：真正的提交逻辑 (点击确认框的“确定”后触发) ▼▼▼
  async onRealConfirmSwap() {
    const { contract, swapReason, selectedNewVehicleId, availableVehicles } = this.data;
    const newVehicleObj = availableVehicles.find(v => v._id === selectedNewVehicleId);

    // 关闭确认弹窗
    this.setData({ showSwapConfirmDialog: false });
    
    // 显示全局 Loading (因为此时弹窗已关)
    wx.showLoading({ title: '正在处理...', mask: true });
    this.setData({ swapping: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'contractOps',
        data: {
          action: 'swapVehicle',
          id: contract._id,
          payload: {
            newVehicleId: selectedNewVehicleId,
            newVehicleData: newVehicleObj,
            reason: swapReason
          }
        }
      });

      if (res.result.ok) {
        wx.showToast({ title: '换车成功', icon: 'success' });
        // 成功后：关闭大弹窗，并刷新页面
        this.setData({ showSwapModal: false });
        this.fetchDetail(contract._id); 
      } else {
        throw new Error(res.result.error || '失败');
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '换车失败', icon: 'none' });
    } finally {
      this.setData({ swapping: false });
      wx.hideLoading();
    }
  }
});