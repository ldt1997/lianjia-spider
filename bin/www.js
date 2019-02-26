var express = require("express");
var app = express();
var spiderRouter = require("../routes/spider");

//调用router中间件
app.use("/", spiderRouter);

var server = app.listen(8080, function() {
  var host = server.address().address;
  var port = server.address().port;

  console.log("链家爬虫，访问地址为 http://%s:%s", host, port);
});
server.setTimeout(0); //将服务器端的超时机制关闭
