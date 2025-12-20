// app.js
App({
    _readyCbs: [],
    $whenReady(cb) {
      if (this.globalData.initialized) cb();
      else this._readyCbs.push(cb);
    },
  
    async onLaunch() {
      wx.cloud.init({ traceUser: true });
  
      // 环境检测：判断是否正式版
      try {
        const info = wx.getAccountInfoSync();
        const envVersion = info.miniProgram.envVersion; // 'develop' | 'trial' | 'release'
        this.globalData.isProd = (envVersion === 'release' || envVersion === 'trial');
        // console.log('当前小程序环境版本:', envVersion);
        // console.log('isProd:', this.globalData.isProd);
      } catch (e) {
        this.globalData.isProd = false; // 容错：默认当作开发环境
      }

      // 访问者以及审核人员授权流程
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

        if (!this.globalData.allowed) {
            wx.reLaunch({ url: '/pages/no-access/no-access' });
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
      isProd: false
    }
  });
  