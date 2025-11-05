// app.js
App({
    _readyCbs: [],
    $whenReady(cb) {
      if (this.globalData.initialized) cb();
      else this._readyCbs.push(cb);
    },
  
    async onLaunch() {
      wx.cloud.init({ traceUser: true });
  
      try {
        const { result } = await wx.cloud.callFunction({ name: 'auth_checkAccess' });
        const { allowed, role = 'guest' } = result || {};
        this.globalData.allowed = !!allowed;
        this.globalData.role = role;
      } catch (e) {
        this.globalData.allowed = false;
        this.globalData.role = 'guest';
      } finally {
        // 审核“续期”兜底：如果云端不允许，但本地审核通道还在有效期内，则临时放行
        if (!this.globalData.allowed) {
          const until = wx.getStorageSync('audit_pass_until');
          if (until && Date.now() < until) {
            this.globalData.allowed = true;
            if (this.globalData.role !== 'admin') this.globalData.role = 'staff';
          }
        }
  
        this.globalData.initialized = true;
        this._readyCbs.forEach(fn => fn());
        this._readyCbs = [];
      }
    },
  
    globalData: {
      initialized: false,
      allowed: false,
      role: 'guest',
    }
  });
  