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

      this.setData({ 
        contract: displayData,
        giftDays: displayData.giftDays || '',
        giftDaysNotes: displayData.giftDaysNotes || '',
        // 如果数据库里有算好的日期就用，没有就重新算一遍
        contractRealEndDate: displayData.contractRealEndDate || displayData.contractValidPeriodEnd 
      });

      // 如果有默认天数，触发一次计算以确保日期显示正确
      if(displayData.giftDays) {
        this._calcDate(displayData.giftDays, displayData.contractValidPeriodEnd);
      }

    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  /*
  // 输入天数
  onGiftDaysInput(e) {
    let val = e.detail.value;
    this.setData({ giftDays: val });
    
    // 触发计算
    if (this.data.contract && this.data.contract.contractValidPeriodEnd) {
      this.calculateEndDate(val, this.data.contract.contractValidPeriodEnd);
    }
  },

  // 输入备注
  onGiftNotesInput(e) {
    this.setData({ giftDaysNotes: e.detail.value });
  },

  // 核心：计算日期
  calculateEndDate(addDays, baseDateStr) {
    if (!baseDateStr) return;
    const days = parseInt(addDays);
    
    // 如果输入的不是数字，或者为空，则恢复为原结束日期
    if (isNaN(days) || !addDays) {
      this.setData({ contractRealEndDate: baseDateStr });
      return;
    }

    // JS 日期计算
    const date = new Date(baseDateStr);
    date.setDate(date.getDate() + days);
    
    // 格式化回 YYYY-MM-DD
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    
    this.setData({ contractRealEndDate: `${y}-${m}-${d}` });
  },

  // 保存数据
  async onSaveGift() {
    if (this.data.saving) return;
    const { contract, giftDays, giftDaysNotes, contractRealEndDate } = this.data;

    if (!contract || !contract._id) return;

    this.setData({ saving: true });

    try {
      // 直接调用云函数更新，或者简单点直接用 db.update (如果在客户端有权限)
      // 为了安全和日志，建议走 contractOps 云函数
      // 这里我们需要去 cloudfunctions/contractOps/index.js 增加一个 case
      const res = await wx.cloud.callFunction({
        name: 'contractOps',
        data: {
          action: 'updateGiftInfo', // <--- 我们需要去后端加这个 action
          id: contract._id,
          payload: {
            giftDays: Number(giftDays) || 0,
            giftDaysNotes,
            contractRealEndDate
          }
        }
      });

      if (res.result && res.result.ok) {
        wx.showToast({ title: '保存成功', icon: 'success' });
      } else {
        throw new Error(res.result?.error || '保存失败');
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }, */

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
  }
});