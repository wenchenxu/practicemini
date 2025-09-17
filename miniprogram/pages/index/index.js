// index.js
const db = wx.cloud.database({
    env:"cloudbase-9gvp1n95af42e30d"
})

Page({
  data: {

  },
  onLoad(options){
    db.collection("user").get({
        success:function(res){
            console.log(res.data);
        },
        fail(err) {
            console.error(err);
        }
    })
  }
})