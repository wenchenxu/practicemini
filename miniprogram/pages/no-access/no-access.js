// pages/no-access/no-access.js
Page({
    data: {
      openid: '',
      showAudit: false,
      auditToken: ''
    },
  
    async onLoad() {
      try {
        // 取 openid 用于复制（方便你加白名单）
        const { result: idRet } = await wx.cloud.callFunction({ name: 'auth_getOpenid' });
        this.setData({ openid: idRet?.openid || '' });
      } catch (e) {}
    },
  
    copyOpenid() {
      if (!this.data.openid) return;
      wx.setClipboardData({ data: this.data.openid });
    },
  
    showAudit() { this.setData({ showAudit: true }); },
    onAuditInput(e) { this.setData({ auditToken: (e.detail.value || '').trim() }); },
  
    async tryAudit() {
      const auditToken = this.data.auditToken;
      if (!auditToken) return wx.showToast({ title: '请输入审核口令', icon: 'none' });
  
      try {
        const { result } = await wx.cloud.callFunction({
          name: 'auth_checkAccess',
          data: { auditToken }
        });
  
        if (result?.allowed) {
          // 通过：写入全局 + 可选写入本地“有效期”
          const app = getApp();
          app.globalData.allowed = true;
          app.globalData.role = result.role || 'staff';
          if (result.ttlHours) {
            wx.setStorageSync('audit_pass_until', Date.now() + result.ttlHours * 3600 * 1000);
          }
          wx.showToast({ title: '审核通道已开启', icon: 'success' });
          setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 400);
        } else {
          wx.showToast({ title: '口令无效', icon: 'none' });
        }
      } catch (e) {
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    }
  });
  