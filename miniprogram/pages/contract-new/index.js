const db = wx.cloud.database();
const COL = db.collection('contracts');
import { BRANCH_OPTIONS_BY_CITY, TYPE_OPTIONS_BY_CITY } from '../../utils/config';

const FIELDS = [
  // ---- Branch ----
  { name:'branchName', label:'门店名称', type:'string', required:false,  maxLength:50, disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true},
  { name:'branchAddress', label:'门店地址', type:'string', required:false, maxLength:200, disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'branchManagerName', label:'门店负责人姓名', type:'string', required:false, maxLength:50, disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'branchLicense', label:'门店营业执照号', type:'string', required:false, maxLength:100, disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'branchPhone', label:'门店电话', type:'number', required:false, strLenMin:11, strLenMax:11, disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'branchBankAccount', label:'门店银行账号', type:'number', required:false, disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true},
  { name:'branchBankName', label:'开户行名称', type:'string', required:false, maxLength:100, disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },
  { name:'branchCityCode', label:'城市编码', type:'string', required:false, maxLength:10, disabled: true, hideOnCreate: true, hideOnEdit:true, hideOnView:true },

  // ---- Client ----
  { name:'clientName', label:'客户姓名', type:'string', required:true, maxLength:12 },
  { name:'clientId', label:'客户身份证号', type:'string', required:false, minLength: 18, maxLength:18},
  { name:'clientPhone', label:'客户电话', type:'number', required:false, min:0, strLenMin:11, strLenMax:11},
  { name:'clientAddress', label:'客户地址', type:'string', required:false, maxLength:60 },
  { name:'clientEmergencyContact', label:'紧急联系人姓名', type:'string', required:false, maxLength:12 },
  { name:'clientEmergencyPhone', label:'紧急联系人电话', type:'number', required:false, min:0, strLenMin:11, strLenMax:11},

  // ---- Car ----
  { name:'carModel', label:'车型', type:'string', required:false, maxLength:50 },
  { name:'carColor', label:'车身颜色', type:'string', required:false, maxLength:20 },
  { name:'carPlate', label:'车牌号', type:'string', required:false, minLength: 8, maxLength:8 },
  { name:'carVin', label:'车架号', type:'string', required:true, minLength:14, maxLength:14, help:'必须14位' },
  { name:'carRentalCity', label:'租赁城市', type:'string', required:false, maxLength:20 },

  // ---- Contract / Rent ----
  { name:'rentDurationMonth', label:'租期（月）', type:'number', required:true, min:1, max:60 },
  { name:'contractValidPeriodStart', label:'合同生效日期', type:'date', required:false },
  { name:'contractValidPeriodEnd', label:'合同结束日期', type:'date', required:false },
  { name:'rentMonthly', label:'月租金', type:'number', required:true, min:0 },
  { name:'rentMonthlyFormal', label:'月租（大写）', type:'string', required:false, disabled:true},
  { name:'rentToday', label:'首日支付金', type:'number', required:false, min:0 },
  { name:'rentTodayFormal', label:'首日支付（大写）', type:'string', required:false, disabled:true },
  { name:'rentPaybyDayInMonth', label:'每月支付日', type:'number', required:true, help: '1-31号', min:1, max:31 },

  // ---- Deposit ----
  { name:'deposit', label:'押金总额', type:'number', required:false, min:0 },
  { name:'depositInitial', label:'押金首付', type:'number', required:false, min:0 },
  { name:'depositFormal', label:'押金总额（大写）', type:'string', required:false, disabled:true },
  { name:'depositServiceFee', label:'服务费', type:'number', required:false, min:0 },
  { name:'depositServiceFeeFormal', label:'服务费（大写）', type:'string', required:false, disabled:true },

  // ---- Dates / Serial ----
  { name:'contractDate', label:'签约日期', type:'date', required:false },
  { name:'contractSerialNumber', label:'合同流水号', type:'number', required:false, disabled:true, hideOnCreate: true },
];

// 将数字自动换成中文大写
function numberToCN(n) {
    if (n === null || n === undefined || n === '') return '';
    const units = '仟佰拾亿仟佰拾万仟佰拾元角分';
    const chars = '零壹贰叁肆伍陆柒捌玖';
    let s = (Math.round(Number(n) * 100)).toString(); // 分为单位
    if (!/^\d+$/.test(s)) return '';
    if (s === '0') return '零元整';
    units.slice(-s.length); // 只是为了 linter
    let u = units.slice(units.length - s.length);
    let str = '';
    for (let i = 0; i < s.length; i++) {
      const num = Number(s[i]);
      str += chars[num] + u[i];
    }
    // 处理零与单位
    str = str
      .replace(/零角零分$/, '整')
      .replace(/零分$/, '整')
      .replace(/零角/g, '零')
      .replace(/零仟|零佰|零拾/g, '零')
      .replace(/零{2,}/g, '零')
      .replace(/零亿/g, '亿')
      .replace(/零万/g, '万')
      .replace(/零元/g, '元')
      .replace(/亿万/g, '亿')
      .replace(/零整$/, '整');
    return str;
  };

Page({
  data: {
    cityCode: '',
    city: '',
    mode: 'create', // create | view | edit
    id: '',
    // 新增：分公司/类型选择状态
    showBranchPicker: false,
    branchOptions: [],
    branchIndex: -1,          // 选中下标
    selectedBranchCode: '',   // 选中的 code
    selectedBranchName: '',

    showTypePicker: false,
    typeOptions: [],
    typeIndex: -1,
    selectedTypeCode: '',
    selectedTypeName: '',

    fields: FIELDS,
    form: {}
  },

  initVisibleFields(mode) {
    const all = this.data.fields || [];
    const visible = all.filter(f => {
      if (mode === 'create') return !f.hideOnCreate;
      if (mode === 'edit')   return !f.hideOnEdit;
      if (mode === 'view')   return !f.hideOnView;
      return true;
    });
    this.setData({ visibleFields: visible });
  },

  onLoad(query) {
    const cityCode = decodeURIComponent(query.cityCode || '');
    const city = decodeURIComponent(query.city || '');
    const mode = (query.mode || 'create');
    const id = query.id || '';
    this.setData({ cityCode, city, mode });
    this.initVisibleFields(mode);
    wx.setNavigationBarTitle({ title: `${city} - ${mode === 'create' ? '新增' : (mode === 'view' ? '查看' : '编辑')}` });
    
    // 分公司选项（仅广州）
    const branchOptions = BRANCH_OPTIONS_BY_CITY[cityCode] || [];
    const showBranchPicker = branchOptions.length > 0;

    // 合同类型选项（广州佛山多条、其他城市default一条）
    const typeOptions = TYPE_OPTIONS_BY_CITY[cityCode] || TYPE_OPTIONS_BY_CITY.default;
    const showTypePicker = typeOptions.length > 1; // 多于1才展示

    // 如果只有一个类型，自动选中
    const typeIndex = typeOptions.length === 1 ? 0 : -1;
    const selectedTypeCode = typeIndex>=0 ? typeOptions[typeIndex].code : '';
    const selectedTypeName = typeIndex>=0 ? typeOptions[typeIndex].name : '';

    this.setData({
      branchOptions, showBranchPicker,
      typeOptions, showTypePicker,
      typeIndex, selectedTypeCode, selectedTypeName,
    });

    if (id) this.fetchDetail(id);
    if (mode==='creat') this.autofillBranch();
  },

  // 分公司选择
  onPickBranch(e) {
    const idx = Number(e.detail.value);
    const opt = this.data.branchOptions[idx];
    this.setData({
        branchIndex: idx,
        selectedBranchCode: opt.code,
        selectedBranchName: opt.name,
    });
  },
    
  // 合同类型选择
  onPickType(e) {
    const idx = Number(e.detail.value);
    const opt = this.data.typeOptions[idx];
    this.setData({
        typeIndex: idx,
        selectedTypeCode: opt.code,
        selectedTypeName: opt.name,
    });
  },

  async fetchDetail(id) {
    try {
      const { data } = await COL.doc(id).get();
      // 兼容老数据结构
      const form = data.fields || {};
      this.setData({ form });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 文本输入
  onInput(e) {
    const name = e.currentTarget.dataset.name;
    const value = e.detail.value;
    this.setData({ [`form.${name}`]: value });
  },

  // 数字输入（保留字符串以便长度校验，再在保存时转为 Number）
  onInputNumber(e) {
    const name = e.currentTarget.dataset.name;
    const value = e.detail.value; // 先保留字符串
    const patch = { [`form.${name}`]: value };

    const map = {
        rentMonthly: 'rentMonthlyFormal',
        rentToday: 'rentTodayFormal',
        deposit: 'depositFormal',
        depositServiceFee: 'depositServiceFeeFormal'
    };
    if (map[name]) {
        patch[`form.${map[name]}`] = numberToCN(value);
    }
    this.setData(patch);
  },

  // 日期
  onDateChange(e) {
    const name = e.currentTarget.dataset.name;
    const value = e.detail.value; // yyyy-mm-dd
    this.setData({ [`form.${name}`]: value });
  },

  // 校验函数
  validate() {
    const { form } = this.data;
    for (const f of FIELDS) {
      const v = form[f.name];

      // 必填
      if (f.required) {
        if (f.type === 'string' && (!v || !String(v).trim())) {
          return `${f.label}为必填`;
        }
        if ((f.type === 'number' || f.type === 'date') && (v === undefined || v === null || v === '')) {
          return `${f.label}为必填`;
        }
      }

      // 类型与长度/范围
      if (f.type === 'string' && v) {
        const len = String(v).length;
        if (f.minLength && len < f.minLength) return `${f.label}长度需≥${f.minLength}`;
        if (f.maxLength && len > f.maxLength) return `${f.label}长度需≤${f.maxLength}`;
      }

      if (f.type === 'number' && (v !== '' && v !== undefined)) {
        const str = String(v);
        // 数字的“长度”要求（如账号/电话），先以字符串长度校验
        if (f.strLenMin && str.length < f.strLenMin) return `${f.label}长度需≥${f.strLenMin}`;
        if (f.strLenMax && str.length > f.strLenMax) return `${f.label}长度需≤${f.strLenMax}`;
        // 再转为数值检查范围
        const num = Number(v);
        if (!isFinite(num)) return `${f.label}必须为数字`;
        if (f.min !== undefined && num < f.min) return `${f.label}需≥${f.min}`;
        if (f.max !== undefined && num > f.max) return `${f.label}需≤${f.max}`;
      }

      if (f.type === 'date' && v) {
        // 简单校验格式 yyyy-mm-dd
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${f.label}格式不正确`;
      }
    }
    // 额外强约束：VIN 14位
    if ((form.carVin || '').length !== 14) return '车架号必须为 14 位';
    // 每月支付日 1-31（上面已校验 min/max，这里冗余保护）
    const payDay = Number(form.rentPaybyDayInMonth);
    if (!(payDay >= 1 && payDay <= 31)) return '每月支付日需在 1 到 31 之间';

    if (this.data.showBranchPicker && !this.data.selectedBranchCode) {
        return '请选择分公司';
    }
    if (!this.data.selectedTypeCode) {
        return '请选择合同类型';
    }
    return ''; // 通过
  },

  // 保存前转换数字
  toPersistObject() {
    const obj = {};
    for (const f of FIELDS) {
      const v = this.data.form[f.name];
      if (f.type === 'number') {
        obj[f.name] = (v === '' || v === undefined || v === null) ? null : Number(v);
      } else {
        obj[f.name] = v !== undefined ? v : null;
      }
    }
    return obj;
  },

  async onSubmit() {
    const data = this.data || {};
    const cityCode = data.cityCode;
    const city = data.city;
    const mode = data.mode;
    const id = data.id;
    const selectedBranchCode = data.selectedBranchCode;
    const selectedBranchName = data.selectedBranchName;
    const selectedTypeCode = data.selectedTypeCode;
    const selectedTypeName = data.selectedTypeName;
  
    const err = this.validate();
    if (err) { wx.showToast({ title: err, icon: 'none' }); return; }
  
    const payload = this.toPersistObject();
  
    if (this.submitting) return;
    this.submitting = true;
  
    try {
      if (mode === 'create') {
        const res = await wx.cloud.callFunction({
          name: 'createContract',
          data: {
            cityCode: cityCode,
            cityName: city,
            branchCode: selectedBranchCode || null,
            branchName: selectedBranchName || null,
            contractType: selectedTypeCode,
            contractTypeName: selectedTypeName,
            payload: payload
          }
        });
  
        const result = (res && res.result) ? res.result : {};
        const fileID = result.fileID || '';
  
        wx.showToast({ title: '合同已生成', icon: 'success' });
  
        if (fileID) {
          const dres = await wx.cloud.downloadFile({ fileID: fileID });
          await wx.openDocument({ filePath: dres.tempFilePath, fileType: 'docx' });
        } else {
          wx.showToast({ title: '合同已保存，但文档未生成，可稍后重试', icon: 'none' });
        }
      } else if (mode === 'edit' && id) {
        const res2 = await wx.cloud.callFunction({
          name: 'contractOps',
          data: { action: 'update', id: id, fields: payload }
        });
        const r2 = (res2 && res2.result) ? res2.result : {};
        if (r2.ok && r2.updated === 1) {
          wx.showToast({ title: '已更新' });
        } else {
          wx.showToast({ title: r2.error || '更新失败', icon: 'none' });
        }
      }
  
      setTimeout(function () { wx.navigateBack({ delta: 1 }); }, 300);
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.submitting = false;
    }
  }, // ← 注意：如果这是最后一个属性，这里不要再加逗号！
  
  /*
  async onSubmit() {
    console.log('[onSubmit enter]');
    const { cityCode, city, mode, id, selectedBranchCode, selectedBranchName, selectedTypeCode, selectedTypeName} = this.data;
    const err = this.validate();
    if (err) { wx.showToast({ title: err, icon: 'none' }); return; }

    const payload = this.toPersistObject();


    // 防重复提交
    if (this.submitting)return;
    this.submitting = true;

    try {
        if (mode === 'create') {
            const res = await wx.cloud.callFunction({
                name: 'createContract',
                data: {
                    cityCode, cityName: city, 
                    branchCode: selectedBranchCode || null,
                    branchName: selectedBranchName || null,
                    contractType: selectedTypeCode,
                    contractTypeName: selectedTypeName,
                    payload
                }
            });

            const { fileID } = res.result || {};
            wx.showToast({ title: '合同已生成', icon: 'success' });

            // 立即预览（DOCX在多数机型可用；若不行就提供“保存到本地”）
            if (fileID) {
                // 立即预览 DOCX
                const dres = await wx.cloud.downloadFile({ fileID });
                await wx.openDocument({ filePath: dres.tempFilePath, fileType: 'docx' });
            } else {
                // 合同已经写库，但文档没生成
                wx.showToast({ title: '合同已保存，但文档未生成，可稍后重试', icon: 'none' });
            }
        } else if (mode === 'edit' && id) {
            // 走云函数做字段白名单与复算
            const res = await wx.cloud.callFunction({
                name: 'contractOps',
                data: { action: 'update', id, fields: payload }
            });
            if (res.result?.ok && res.result.updated === 1) {
                wx.showToast({ title: '已更新' });
            } else {
                wx.showToast({ title: '更新失败', icon: 'none' });
            }
        }

        // 返回上一页
        setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
    } catch (e) {
        console.error(e);
        wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
        this.submitting = false;
    }
  },
  */

  async autofillBranch(){
    const db = wx.cloud.database();
    const res = await db.collection('branches').where({ city: this.data.city }).limit(1).get();
    if (res.data.length) {
      const b = res.data[0];
      this.setData({
        form: {
          ...this.data.form,
          branchName: b.branchName,
          branchAddress: b.branchAddress,
          branchManagerName: b.branchManagerName,
          branchPhone: String(b.branchPhone || ''),
          branchBankAccount: String(b.branchBankAccount || ''),
          branchBankName: b.branchBankName,
          branchCityCode: b.branchCityCode
        }
      });
    } else {
      wx.showToast({ title: '未找到门店资料', icon: 'none' });
    }
  },

  toEdit() {
    const { city, id } = this.data;
    wx.navigateTo({
      url: `/pages/contract-new/index?city=${encodeURIComponent(city)}&mode=edit&id=${id}`
    });
  }
});
