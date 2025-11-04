Page({
    data: { openid: '' },
  
    async onLoad() {
      // 获取自己的 openid（通过云函数）
      try {
        const { result } = await wx.cloud.callFunction({ name: 'auth_checkAccess' });
        // 不返回 OPENID，本页仅做复制引导；如需 OPENID，可写一个 getOpenid 函数返回 OPENID
        // 这里给一个简单实现（安全性足够MVP用）：
        const { result: idRet } = await wx.cloud.callFunction({ name: 'auth_getOpenid' });
        this.setData({ openid: idRet?.openid || '' });
      } catch (e) {}
    },
  
    copyOpenid() {
      if (!this.data.openid) return;
      wx.setClipboardData({ data: this.data.openid });
    }
  });
  