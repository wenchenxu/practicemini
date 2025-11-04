const { ensureAdmin } = require('../../../utils/guard');

Page({
  data: {
    roles: ['staff', 'admin'],
    role: 'staff',
    openid: '',
    name: '',
    keyword: '',
    list: [],
    page: 1,
    pageSize: 50,
    count: 0,
  },

  onShow() {
    if (!ensureAdmin()) return;
    this.reload();
  },

  onOpenidInput(e) { this.setData({ openid: e.detail.value.trim() }); },
  onNameInput(e) { this.setData({ name: e.detail.value.trim() }); },
  onRoleChange(e) { this.setData({ role: this.data.roles[Number(e.detail.value)] }); },
  onKeyword(e) { this.setData({ keyword: e.detail.value.trim() }); },

  async reload() {
    try {
      const { page, pageSize, keyword } = this.data;
      const { result } = await wx.cloud.callFunction({
        name: 'auth_listWhitelist',
        data: { page, pageSize, keyword }
      });
      if (result && result.ok) {
        this.setData({ list: result.data || [], count: result.count || 0 });
      } else {
        wx.showToast({ title: '无权限或加载失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async addMember() {
    const { openid, name, role } = this.data;
    if (!openid) return wx.showToast({ title: '请输入 OpenID', icon: 'none' });

    try {
      const { result } = await wx.cloud.callFunction({
        name: 'auth_grantByOpenid',
        data: { targetOpenid: openid, name, role }
      });
      if (result?.ok) {
        wx.showToast({ title: result.msg === 'already-exists' ? '已存在' : '已添加', icon: 'none' });
        this.setData({ openid: '', name: '' });
        this.reload();
      } else {
        wx.showToast({ title: result?.msg || '添加失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '添加失败', icon: 'none' });
    }
  },

  async remove(e) {
    const { openid } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: '删除后该成员将无法访问小程序',
      success: async (ret) => {
        if (!ret.confirm) return;
        try {
          const { result } = await wx.cloud.callFunction({
            name: 'auth_removeWhitelist',
            data: { targetOpenid: openid }
          });
          if (result?.ok) {
            wx.showToast({ title: '已删除', icon: 'none' });
            this.reload();
          } else {
            wx.showToast({ title: result?.msg || '删除失败', icon: 'none' });
          }
        } catch (e) {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    });
  }
});
