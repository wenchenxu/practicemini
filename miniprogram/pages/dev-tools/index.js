// pages/dev-tools/index.js
const { ensureAdmin } = require('../../utils/guard');

Page({
  data: {
    loading: false,
    delCity: '',
    delConfirm: '',
    canDelete: false
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
  },

  // 监听城市输入
  onInputDeleteCity(e) {
    const val = e.detail.value.trim();
    this.setData({ delCity: val }, this.checkDeleteBtn);
  },

  // 监听口令输入
  onInputDeleteConfirm(e) {
    const val = e.detail.value.trim();
    this.setData({ delConfirm: val }, this.checkDeleteBtn);
  },

  // 检查是否可以启用删除按钮
  checkDeleteBtn() {
    const { delCity, delConfirm } = this.data;
    // 规则：口令必须是 "confirmDelete" + 首字母大写的城市名 (或者直接全拼接，看你喜好)
    // 这里为了简单且符合你要求：直接比对 'confirmDelete' + delCity (忽略大小写可能更方便，或者严格匹配)
    
    // 让我们做严格匹配： confirmDelete + delCity (例如 suzhou -> confirmDeleteSuzhou)
    // 首字母大写处理
    const expected = 'confirmDelete' + delCity.charAt(0).toUpperCase() + delCity.slice(1);
    
    // 或者如果你想简单点，直接全小写匹配也可以，这里按你描述的 CamelCase 来
    this.setData({
      canDelete: delCity && delConfirm === expected
    });
  },

  async onDeleteByCity() {
    const { delCity } = this.data;
    const that = this;

    wx.showModal({
      title: '最后警告',
      content: `确定要删除 [${delCity}] 的所有车辆吗？此操作无法恢复！`,
      confirmColor: '#d93025',
      confirmText: '删！',
      success: async (res) => {
        if (!res.confirm) return;

        that.setData({ loading: true });
        
        try {
          const { result } = await wx.cloud.callFunction({
            name: 'vehicleOps',
            data: { 
              action: 'deleteByCity',
              payload: { cityCode: delCity }
            }
          });

          that.setData({ loading: false });

          if (result && result.ok) {
            wx.showModal({
              title: '删除成功',
              content: `已清理 ${delCity} 共 ${result.deleted} 条数据。`,
              showCancel: false,
              success: () => {
                // 清空输入框
                that.setData({ delCity: '', delConfirm: '', canDelete: false });
              }
            });
          } else {
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        } catch (e) {
          console.error(e);
          that.setData({ loading: false });
          wx.showToast({ title: '调用异常', icon: 'none' });
        }
      }
    });
  },

  async onImportCsvUpsert() {
    const that = this;
    
    // 1. 选择文件
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv'],
      success: async (chooseRes) => {
        const filePath = chooseRes.tempFiles[0].path;
        
        that.setData({ loading: true });
        wx.showLoading({ title: '上传中...' });

        try {
          // 2. 上传到云存储 (临时中转)
          const cloudPath = `temp_imports/${Date.now()}_import.csv`;
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath,
            filePath,
          });
          
          const fileID = uploadRes.fileID;
          
          wx.showLoading({ title: '正在处理数据...' });

          // 3. 调用云函数处理
          const { result } = await wx.cloud.callFunction({
            name: 'vehicleOps',
            data: { 
              action: 'importCsv',
              payload: { fileID }
            }
          });

          that.setData({ loading: false });
          wx.hideLoading();

          if (result && result.ok) {
            wx.showModal({
              title: '导入完成',
              content: `共处理 ${result.total} 条。\n更新: ${result.updated} 条\n新增: ${result.inserted} 条\n失败: ${result.errors} 条`,
              showCancel: false
            });
          } else {
            wx.showModal({ title: '导入失败', content: result.msg || '未知错误', showCancel: false });
          }

        } catch (e) {
          console.error(e);
          that.setData({ loading: false });
          wx.hideLoading();
          wx.showToast({ title: '异常', icon: 'none' });
        }
      }
    });
  }
});