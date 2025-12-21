// 增加dev环境的app.js版本，whitelist会出错
App({
    _readyCbs: [],
    $whenReady(cb) {
      if (this.globalData.initialized) cb();
      else this._readyCbs.push(cb);
    },
  
    async onLaunch() {
        // 1. 定义两个环境的 ID (请替换成你实际的 ID)
        const ENV_PROD = 'cloudbase-9gvp1n95af42e30d'; // 旧环境ID (线上)
        const ENV_DEV  = 'dev-4gzrr3qf9d8c8caa';  // 新环境ID (测试)

        let envId = ENV_DEV; // 默认为开发环境

        // 2. 检测当前运行版本
        try {
        const info = wx.getAccountInfoSync();
        const envVersion = info.miniProgram.envVersion; 
        // envVersion 有三个值：
        // 'develop': 开发者工具、开发版
        // 'trial':   体验版
        // 'release': 正式版

        // 策略：正式版和体验版连 Prod，开发版连 Dev
        if (envVersion === 'release' || envVersion === 'trial') {
            envId = ENV_PROD;
            this.globalData.isProd = true;
        } else {
            envId = ENV_DEV;
            this.globalData.isProd = false;
        }

        // 警告：直连生产服务器，操作需谨慎！！
        /*
        envId = ENV_PROD; 
        this.globalData.isProd = true;
        console.warn('🚨🚨🚨 当前已强制连接到【生产环境 Prod】，请小心操作！ 🚨🚨🚨'); */

        console.log(`[onLaunch] Current envVersion: ${envVersion}, using env: ${envId}`);
        
        } catch (e) {
        console.error('环境检测失败，降级使用 Dev 环境', e);
        envId = ENV_DEV;
        this.globalData.isProd = false;
        }

        // 3. 初始化云环境 (这是最关键的一步)
        wx.cloud.init({
        env: envId, // <--- 显式指定环境 ID
        traceUser: true,
        });

      // 访问者以及审核人员授权流程
      try {
        // const { result } = await wx.cloud.callFunction({ name: 'auth_checkAccess' });
        const { result } = await wx.cloud.callFunction({
            name: 'auth-service',
            data: { action: 'checkAccess' } // 告诉它执行 checkAccess 逻辑
          });
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
  