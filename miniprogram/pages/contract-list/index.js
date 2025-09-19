const db = wx.cloud.database();
const _ = db.command;
const COL = db.collection('contracts');
const PAGE_SIZE = 20;

Page({
  data: { city: '', list: [], loading: false, hasMore: true, lastId: '' },

  onLoad(query) {
    const city = decodeURIComponent(query.city || '');
    this.setData({ city });
    wx.setNavigationBarTitle({ title: `${city} - 合同历史` });
    this.refresh();
  },

  async refresh() {
    this.setData({ list: [], hasMore: true, lastId: '' });
    await this.fetch();
  },

  async fetch() {
    if (!this.data.hasMore || this.data.loading) return;
    this.setData({ loading: true });

    try {
      let condition = COL.where({ city: this.data.city });
      if (this.data.lastId) {
        condition = condition.where({ _id: _.lt(this.data.lastId) });
      }

      const res = await condition.orderBy('_id', 'desc').limit(PAGE_SIZE).get();

      const newList = this.data.list.concat(
        res.data.map(d => ({
          ...d,
          _createTime: this.formatTime(d.createdAt)
        }))
      );

      this.setData({
        list: newList,
        hasMore: res.data.length === PAGE_SIZE,
        lastId: res.data.length ? res.data[res.data.length - 1]._id : this.data.lastId
      });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  loadMore() { this.fetch(); },

  viewOne(e) {
    const id = e.currentTarget.dataset.id;
    const { city } = this.data;
    wx.navigateTo({ url: `/pages/contract-new/index?city=${encodeURIComponent(city)}&mode=view&id=${id}` });
  },

  editOne(e) {
    const id = e.currentTarget.dataset.id;
    const { city } = this.data;
    wx.navigateTo({ url: `/pages/contract-new/index?city=${encodeURIComponent(city)}&mode=edit&id=${id}` });
  },

  async delOne(e) {
    const id = e.currentTarget.dataset.id;
    const confirm = await wx.showModal({ title: '删除确认', content: '确定删除该合同吗？', confirmText: '删除' });
    if (!confirm.confirm) return;

    try {
      await COL.doc(id).remove();
      wx.showToast({ title: '已删除' });
      const idx = this.data.list.findIndex(i => i._id === id);
      if (idx > -1) {
        const list = this.data.list.slice();
        list.splice(idx, 1);
        this.setData({ list });
      }
    } catch (e2) {
      console.error(e2);
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  formatTime(serverDate) {
    if (!serverDate) return '';
    try {
      const ts = serverDate instanceof Date ? serverDate : new Date(serverDate);
      const pad = n => String(n).padStart(2, '0');
      return `${ts.getFullYear()}-${pad(ts.getMonth()+1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}`;
    } catch { return ''; }
  }
});
