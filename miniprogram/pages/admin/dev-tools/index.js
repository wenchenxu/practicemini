// pages/dev-tools/index.js
const { ensureAdmin } = require('../../../utils/guard');
const { CITY_CODE_MAP, BRANCH_OPTIONS_BY_CITY } = require('../../../utils/config');

Page({
  data: {
    loading: false,
    delCity: '',
    delConfirm: '',
    canDelete: false,
    
    // Export CSV pickers
    exportCities: [],
    exportBranches: [],
    exportCityIndex: -1,
    exportBranchIndex: -1,

    // Fix Plate Typo
    fixOldPlate: '',
    fixNewPlate: ''
  },

  onLoad() {
    // 只有管理员能进，虽然 guard 已经在 index 入口做了，这里双重保险
    ensureAdmin();

    // Initialize City Pickers
    const cities = Object.keys(CITY_CODE_MAP).map(k => ({
      code: k,
      name: CITY_CODE_MAP[k]
    }));
    this.setData({ exportCities: cities });
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
  },

  async onMigrateBranches() {
    const that = this;
    wx.showModal({
      title: '迁移确认',
      content: '确定要将现有的苏州记录分配给 "苏州兔斯夫(suz_a)"，将佛山记录分配给 "佛山老宾(fos_b)" 吗？',
      success: async (res) => {
        if (!res.confirm) return;

        that.setData({ loading: true });
        wx.showLoading({ title: '迁移中...', mask: true });

        try {
          const { result } = await wx.cloud.callFunction({
            name: 'vehicleOps',
            data: { action: 'migrateBranches' }
          });

          wx.hideLoading();
          that.setData({ loading: false });

          if (result && result.ok) {
            const summaryStr = JSON.stringify(result.summary, null, 2);
            wx.showModal({
              title: '迁移完成',
              content: `成功更新数据：\n${summaryStr}`,
              showCancel: false
            });
          } else {
            wx.showModal({ title: '操作失败', content: result?.error || '未知错误', showCancel: false });
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

  async onAutoReturnExpired() {
    const that = this;
    wx.showModal({
      title: '手动执行过期退车',
      content: '确定要扫描并处理所有合同过期的在租车辆吗？\n(注：系统每晚会自动执行一次)',
      success: async (res) => {
        if (!res.confirm) return;

        that.setData({ loading: true });
        wx.showLoading({ title: '扫描处理中...', mask: true });

        try {
          const { result } = await wx.cloud.callFunction({
            name: 'vehicleOps',
            data: { action: 'autoReturnExpired' }
          });

          wx.hideLoading();
          that.setData({ loading: false });

          if (result && result.ok) {
            wx.showModal({
              title: '处理完成',
              content: `在租车辆排查数：${result.processed} 辆\n成功强制退车数：${result.returned} 辆`,
              showCancel: false
            });
            if (result.errors && result.errors.length > 0) {
              console.warn('[AutoReturn] Errors:', result.errors);
            }
          } else {
            wx.showModal({ title: '操作失败', content: result?.error || '未知错误', showCancel: false });
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

  async onImportOfflineContracts() {
    const that = this;
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv'],
      success: async (chooseRes) => {
        const filePath = chooseRes.tempFiles[0].path;
        that.setData({ loading: true });
        wx.showLoading({ title: '上传中...' });

        try {
          const cloudPath = `temp_imports/${Date.now()}_offline_import.csv`;
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath,
            filePath,
          });

          const fileID = uploadRes.fileID;
          wx.showLoading({ title: '正在处理数据...' });

          const { result } = await wx.cloud.callFunction({
            name: 'vehicleOps',
            data: {
              action: 'importOfflineContracts',
              payload: { fileID }
            }
          });

          that.setData({ loading: false });
          wx.hideLoading();

          if (result && result.ok) {
            wx.showModal({
              title: '导入完成',
              content: `共处理 ${result.total} 条。\n成功: ${result.success} 条\n失败: ${result.errors} 条\n请在云日志查看具体失败原因。`,
              showCancel: false
            });
            if (result.errors > 0) {
              console.warn('[OfflineImport] Errors:', result.errorDetails);
            }
          } else {
            wx.showModal({ title: '导入失败', content: result.msg || result.error || '未知错误', showCancel: false });
          }
        } catch (e) {
          console.error(e);
          that.setData({ loading: false });
          wx.hideLoading();
          wx.showToast({ title: '异常', icon: 'none' });
        }
      }
    });
  },

  // --- Export Vehicles (CSV) Handlers ---

  onExportCityChange(e) {
    const idx = parseInt(e.detail.value, 10);
    const city = this.data.exportCities[idx];
    const branches = BRANCH_OPTIONS_BY_CITY[city.code] || [];
    
    this.setData({
      exportCityIndex: idx,
      exportBranchIndex: -1,
      exportBranches: branches
    });
  },

  onExportBranchChange(e) {
    this.setData({
      exportBranchIndex: parseInt(e.detail.value, 10)
    });
  },

  async onExportCsv() {
    const { exportCityIndex, exportBranchIndex, exportCities, exportBranches } = this.data;
    if (exportCityIndex < 0) {
      return wx.showToast({ title: '请选择城市', icon: 'none' });
    }

    const cityCode = exportCities[exportCityIndex].code;
    let branchCode = null;
    if (exportBranches && exportBranches.length > 0) {
      if (exportBranchIndex < 0) {
        return wx.showToast({ title: '请选择分公司', icon: 'none' });
      }
      branchCode = exportBranches[exportBranchIndex].code;
    }

    const that = this;
    that.setData({ loading: true });
    wx.showLoading({ title: '生成中...', mask: true });

    try {
      const { result } = await wx.cloud.callFunction({
        name: 'vehicleOps',
        data: {
          action: 'exportCsv',
          payload: { cityCode, branchCode }
        }
      });

      wx.hideLoading();
      that.setData({ loading: false });

      if (result && result.ok) {
        wx.showModal({
          title: '导出成功',
          content: '点击确定，复制下载链接到剪切板。在浏览器或微信中打开即可下载Excel文件。',
          showCancel: false,
          success: () => {
            wx.setClipboardData({
              data: result.url,
              success() {
                wx.showToast({ title: '链接已复制', icon: 'success' });
              }
            });
          }
        });
      } else {
        wx.showModal({ title: '导出失败', content: result?.error || '未知错误', showCancel: false });
      }
    } catch (e) {
      console.error(e);
      wx.hideLoading();
      that.setData({ loading: false });
      wx.showToast({ title: '调用异常', icon: 'none' });
    }
  },

  // --- Fix Plate Typo Handlers ---
  
  onInputOldPlate(e) {
    this.setData({ fixOldPlate: e.detail.value.trim().toUpperCase() });
  },

  onInputNewPlate(e) {
    this.setData({ fixNewPlate: e.detail.value.trim().toUpperCase() });
  },

  async onFixPlate() {
    const { fixOldPlate, fixNewPlate } = this.data;
    if (!fixOldPlate || !fixNewPlate) {
      return wx.showToast({ title: '参数不完整', icon: 'none' });
    }
    if (fixOldPlate === fixNewPlate) {
      return wx.showToast({ title: '新旧车牌不能一样', icon: 'none' });
    }

    const that = this;
    wx.showModal({
      title: '谨慎操作',
      content: `确定要把【${fixOldPlate}】修正为【${fixNewPlate}】吗？此操作将全面修改相关历史记录与合同关联，不可恢复！`,
      confirmColor: '#d93025',
      success: async (res) => {
        if (!res.confirm) return;

        that.setData({ loading: true });
        wx.showLoading({ title: '深层替换中...', mask: true });

        try {
          const { result } = await wx.cloud.callFunction({
            name: 'vehicleOps',
            data: {
              action: 'renamePlate',
              payload: { oldPlate: fixOldPlate, newPlate: fixNewPlate }
            }
          });

          wx.hideLoading();
          that.setData({ loading: false });

          if (result && result.ok) {
            wx.showModal({
              title: '修复成功',
              content: `已成功替换主记录。\n同步修正时间线: ${result.updates.historyCount} 条\n同步修正合同关联: ${result.updates.contractsCount} 条。`,
              showCancel: false,
              success: () => {
                that.setData({ fixOldPlate: '', fixNewPlate: '' });
              }
            });
          } else {
            wx.showModal({ title: '操作失败', content: result?.error || '未知错误', showCancel: false });
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

  async onBackfillOffline() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'vehicleOps',
        data: { action: 'backfillOffline' }
      });
      const data = res.result || {};
      if (data.ok) {
        wx.showModal({ title: '修复成功', content: data.msg, showCancel: false });
      } else {
        wx.showModal({ title: '执行失败', content: data.error || '未知错误', showCancel: false });
      }
    } catch (e) {
      console.error(e);
      wx.showModal({ title: '报错', content: e.message, showCancel: false });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onFixDuplicateContracts() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'vehicleOps',
        data: { action: 'fixDuplicateContracts' }
      });
      const data = res.result || {};
      if (data.ok) {
        wx.showModal({ title: '清理完成', content: data.msg, showCancel: false });
      } else {
        wx.showModal({ title: '执行失败', content: data.error || '未知错误', showCancel: false });
      }
    } catch (e) {
      console.error(e);
      wx.showModal({ title: '报错', content: e.message, showCancel: false });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onRevertDuplicateFix() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'vehicleOps',
        data: { action: 'revertDuplicateFix' }
      });
      const data = res.result || {};
      if (data.ok) {
        wx.showModal({ title: '回退完成', content: data.msg, showCancel: false });
      } else {
        wx.showModal({ title: '执行失败', content: data.error || '未知错误', showCancel: false });
      }
    } catch (e) {
      console.error(e);
      wx.showModal({ title: '报错', content: e.message, showCancel: false });
    } finally {
      this.setData({ loading: false });
    }
  }
});