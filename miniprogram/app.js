// app.js
App({
    _readyCbs: [],
    $whenReady(cb) {
      if (this.globalData.initialized) cb();
      else this._readyCbs.push(cb);
    },

    async onLaunch() {
        wx.cloud.init();
        try {
            const { result } = await wx.cloud.callFunction({ name: 'checkAccess' });
            const { allowed, role = 'guest' } = result || {};
            this.globalData.allowed = !!allowed;
            this.globalData.role = role;
        } catch (e) {
            this.globalData.allowed = false;
            this.globalData.role = 'guest';
        } finally {
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
