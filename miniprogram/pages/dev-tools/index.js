// pages/dev-tools/index.js
const { ensureAdmin } = require('../../utils/guard');

Page({
  data: {
    loading: false
  },

  onLoad() {
    // 只有管理员能进，虽然 guard 已经在 index 入口做了，这里双重保险
    ensureAdmin(); 
  },

  async onDeduplicateVehicles() {
    const that = this;
    wx.showModal({
      title: '高风险操作',
      content: '确定要扫描全库并删除重复车牌的车辆数据吗？此操作不可逆。',
      confirmText: '执行删除',
      confirmColor: '#d93025',
      success: async (res) => {
        if (!res.confirm) return;
        
        that.setData({ loading: true });
        wx.showLoading({ title: '处理中...', mask: true });

        try {
          const { result } = await wx.cloud.callFunction({
            name: 'vehicleOps',
            data: { action: 'deduplicate' }
          });

          wx.hideLoading();
          that.setData({ loading: false });

          if (result && result.ok) {
            wx.showModal({
              title: '处理完成',
              content: `共扫描 ${result.totalScanned} 条。\n成功删除 ${result.deleted} 条重复数据。`,
              showCancel: false
            });
          } else {
            wx.showToast({ title: '操作失败', icon: 'none' });
          }
        } catch (e) {
          console.error(e);
          wx.hideLoading();
          that.setData({ loading: false });
          wx.showToast({ title: '调用异常', icon: 'none' });
        }
      }
    });
  },

  async onFixDates() {
    const that = this;
    wx.showModal({
      title: '确认修复',
      content: '将把所有 "yyyy-mm-dd" 格式的字符串转换为日期对象。',
      success: async (res) => {
        if (!res.confirm) return;
        
        that.setData({ loading: true });
        wx.showLoading({ title: '修复中...', mask: true });

        try {
          const { result } = await wx.cloud.callFunction({
            name: 'vehicleOps',
            data: { action: 'fixDates' }
          });

          wx.hideLoading();
          that.setData({ loading: false });

          if (result && result.ok) {
            wx.showModal({
              title: '修复完成',
              content: `成功修复了 ${result.fixed} 条数据的日期格式。`,
              showCancel: false
            });
          } else {
            wx.showToast({ title: '操作失败', icon: 'none' });
          }
        } catch (e) {
          console.error(e);
          wx.hideLoading();
          that.setData({ loading: false });
          wx.showToast({ title: '调用异常', icon: 'none' });
        }
      }
    });
  }
});