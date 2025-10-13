Page({
    data: {
      clientUserId: 'driver_123',
      redirectUrl: 'https://example.com/after-auth',
      subject: '司机租车合同-测试',
      fileId: '',
      signTaskId: '',
      log: ''
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
        wx.showToast({ title: 'Token OK', icon: 'success' });
      } catch (e) {
        this.appendLog(`Token Error: ${e.message || e}`);
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
  