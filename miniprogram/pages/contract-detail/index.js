// pages/contract-detail/index.js
const db = wx.cloud.database();

Page({
  data: {
    contract: null
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
      // 数据通常在 res.data 中。
      // 注意：你的数据结构可能是 res.data 只有一层，也可能所有字段都在 res.data.fields 里
      // 根据你之前的代码 (contract-new)，数据似乎是平铺在 data 下，或者在 fields 下
      // 这里做一个兼容处理：
      const data = res.data;
      const displayData = {
        ...data,
        ...(data.fields || {}) // 如果字段被包在 fields 里，解包出来
      };

      this.setData({ contract: displayData });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
});