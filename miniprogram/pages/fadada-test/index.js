// 直传到 ECS：请先把 ECS 域名加入“小程序管理后台 -> 开发设置 -> uploadFile 合法域名”
const ECS_UPLOAD_URL = 'https://tusifu.cn/api/esign/uploadFile';
const ECS_INTERNAL_TOKEN = '8Ap130bab9oi1oihbqozbpoifuaoijgu85b4adoibua0b424bjahbanajkafyh';

Page({
    data: {
      token: '',
      fileUrl: '',
      fddFileUrl: '',
      directFddFileUrl: ''
    },
  
    // 小工具
    appendLog(obj) {
      const line = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
      this.setData({ log: `${this.data.log}\n${line}`.trim() });
    },
  
    onInputClientUserId(e) { this.setData({ clientUserId: e.detail.value }); },
    onInputRedirectUrl(e) { this.setData({ redirectUrl: e.detail.value }); },
    onInputSubject(e) { this.setData({ subject: e.detail.value }); },
    onInputFileId(e) { this.setData({ fileId: e.detail.value }); },
    onInputSignTaskId(e) { this.setData({ signTaskId: e.detail.value }); },
    onInputUrl(e) {
        this.setData({ fileUrl: e.detail.value })
      },
  
    call(action, payload) {
      return wx.cloud.callFunction({
        name: 'api-fadada',
        data: { action, payload }
      });
    },
  
    async onPing() {
      try {
        const { result } = await this.call('ping');
        this.appendLog(result);
      } catch (e) {
        this.appendLog(`Ping Error: ${e.message || e}`);
      }
    },
  
    async onGetToken() {
        try {
          const { result } = await this.call('getToken');
          this.appendLog(result);
          const ok = result?.success && result?.data?.accessToken;
          if (ok) {
            wx.showToast({ title: 'Token OK', icon: 'success' });
          } else {
            wx.showToast({ title: 'Token 获取失败', icon: 'none' });
          }
        } catch (e) {
          this.appendLog(`Token Error: ${e.message || e}`);
          wx.showToast({ title: 'Token 异常', icon: 'none' });
        }
    },
  
    async onGetAuthUrl() {
      try {
        const { clientUserId, redirectUrl } = this.data;
        const { result } = await this.call('getAuthUrl', { clientUserId, redirectUrl });
        this.appendLog(result);
        const url = result?.url || result?.data?.url;
        if (url) {
          wx.setClipboardData({ data: url });
          wx.showModal({
            title: '授权URL已复制',
            content: '已复制到剪贴板。测试环境验证码：111111（建议先用外部浏览器打开完成授权）',
            showCancel: false
          });
        }
      } catch (e) {
        this.appendLog(`GetAuthUrl Error: ${e.message || e}`);
      }
    },
  
    async onUploadPdf() {
        try {
          const choose = await wx.chooseMessageFile({
            count: 1,
            type: 'file',
            extension: ['pdf']
          });
          const file = choose?.tempFiles?.[0];
          if (!file) return;
    
          wx.showLoading({ title: '上传中...' });
    
          // 直传：wx.uploadFile
          const uploadRes = await wx.uploadFile({
            url: ECS_UPLOAD_URL,
            filePath: file.path,
            name: 'file',
            header: { 'x-internal-token': ECS_INTERNAL_TOKEN },
            formData: { } // 可附带 fileName 等
          });
    
          wx.hideLoading();
    
          // 解析返回
          let data = {};
          try { data = JSON.parse(uploadRes.data); } catch {}
          this.appendLog(data);
    
          const fileId = data?.fileId || data?.data?.fileId || data?.id;
          if (fileId) {
            this.setData({ fileId });
            wx.showToast({ title: '已拿到fileId', icon: 'success' });
          } else if (data?.error) {
            wx.showToast({ title: '上传失败', icon: 'none' });
          } else {
            wx.showToast({ title: '未知返回', icon: 'none' });
          }
        } catch (e) {
          wx.hideLoading();
          this.appendLog(`Upload Error: ${e.message || e}`);
          wx.showToast({ title: '上传异常', icon: 'none' });
        }
      },

    async onCreateSignTask() {
      try {
        const { subject, fileId, clientUserId } = this.data;
        if (!fileId) {
          wx.showToast({ title: '请先填 fileId', icon: 'none' });
          return;
        }
        const { result } = await this.call('createSignTask', {
          subject,
          fileId,
          signerClientUserId: clientUserId
        });
        this.appendLog(result);
        const taskId = result?.signTaskId || result?.data?.signTaskId || result?.id;
        if (taskId) {
          this.setData({ signTaskId: taskId });
          wx.showToast({ title: '任务已创建', icon: 'success' });
        }
      } catch (e) {
        this.appendLog(`CreateSignTask Error: ${e.message || e}`);
      }
    },
  
    async onGetSignUrl() {
      try {
        const { signTaskId } = this.data;
        if (!signTaskId) {
          wx.showToast({ title: '请先填 signTaskId', icon: 'none' });
          return;
        }
        const { result } = await this.call('getSignUrl', { signTaskId });
        this.appendLog(result);
        const url = result?.url || result?.data?.url;
        if (url) {
          wx.setClipboardData({ data: url });
          wx.showModal({
            title: '签署URL已复制',
            content: '已复制到剪贴板。可以在外部浏览器打开签署（测试验证码：111111）',
            showCancel: false
          });
        }
      } catch (e) {
        this.appendLog(`GetSignUrl Error: ${e.message || e}`);
      }
    }
  });
  