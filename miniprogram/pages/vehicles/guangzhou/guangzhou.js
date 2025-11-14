const { ensureAdmin } = require('../../../utils/guard');

Page({
  data: {
    vehicles: [],
    allVehicles: [],
    statusValueOptions: ['renting', 'available', 'repair'],
    statusLabelOptions: ['已租', '闲置', '维修'],
    statusIndexMap: { renting: 0, available: 1, repair: 2 },
    statusDisplayMap: { renting: '已租', available: '闲置', repair: '维修' },
    filterLabelOptions: ['全部', '闲置', '维修', '已租'],
    filterValueOptions: ['', 'available', 'repair', 'renting'],
    filterIndex: 0,
    form: { vin: '', plate: '', statusIndex: 1 }
  },

  onShow() {
    if (!ensureAdmin()) return;
    this.refresh();
  },

  async refresh() {
    await this.loadList();
  },

  async loadList() {
    try {
      const { result } = await wx.cloud.callFunction({ name: 'vehicles', data: { action: 'list' } });
      if (result && result.ok) {
        const list = result.data || [];
        this.setData({ allVehicles: list });
        this.applyFilter();
      }
    } catch (e) {}
  },

  onStatusChange(e) {
    const id = e.currentTarget.dataset.id;
    const idx = Number(e.detail.value);
    const status = this.data.statusValueOptions[idx];
    wx.showLoading({ title: '更新中...' });
    wx.cloud.callFunction({
      name: 'vehicles',
      data: { action: 'updateStatus', data: { id, status } }
    }).then(({ result }) => {
      if (result && result.ok) {
        const all = this.data.allVehicles.map(v => v._id === id ? { ...v, status } : v);
        this.setData({ allVehicles: all });
        this.applyFilter();
      } else {
        wx.showToast({ title: '更新失败', icon: 'none' });
      }
    }).catch(() => {
      wx.showToast({ title: '更新失败', icon: 'none' });
    }).finally(() => wx.hideLoading());
  },

  onVin(e) { this.setData({ 'form.vin': e.detail.value.trim() }); },
  onPlate(e) { this.setData({ 'form.plate': e.detail.value.trim() }); },
  onStatusPick(e) { this.setData({ 'form.statusIndex': Number(e.detail.value) }); },

  create() {
    const { vin, plate, statusIndex } = this.data.form;
    if (!vin || !plate) { wx.showToast({ title: '请输入 VIN 和车牌', icon: 'none' }); return; }
    const status = this.data.statusValueOptions[statusIndex];
    wx.showLoading({ title: '创建中...' });
    wx.cloud.callFunction({
      name: 'vehicles',
      data: { action: 'create', data: { vin, plate, status } }
    }).then(({ result }) => {
      if (result && result.ok) {
        wx.showToast({ title: '创建成功', icon: 'success' });
        this.setData({ form: { vin: '', plate: '', statusIndex: 1 } });
        this.refresh();
      } else if (result && result.msg === 'exists') {
        wx.showToast({ title: '已存在', icon: 'none' });
      } else {
        wx.showToast({ title: '创建失败', icon: 'none' });
      }
    }).catch(() => wx.showToast({ title: '创建失败', icon: 'none' }))
      .finally(() => wx.hideLoading());
  },

  onFilterTap(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ filterIndex: index });
    this.applyFilter();
  },

  applyFilter() {
    const idx = this.data.filterIndex;
    if (idx === 0) {
      this.setData({ vehicles: this.data.allVehicles });
      return;
    }
    const val = this.data.filterValueOptions[idx];
    const filtered = (this.data.allVehicles || []).filter(v => v.status === val);
    this.setData({ vehicles: filtered });
  }
});
