var userAgents = require("../userAgent"); // 动态请求头
var express = require("express");
var app = express();
var superagent = require("superagent");
var charset = require("superagent-charset");
charset(superagent);
var async = require("async"); //异步抓取
var eventproxy = require("eventproxy"); //流程控制
var ep = eventproxy();
var request = require("request");
var cheerio = require("cheerio");
var fs = require("fs");
var MongoClient = require("mongodb").MongoClient; //数据库
var urldb = "mongodb://localhost:27017/"; //数据库地址

var baseUrl = "https://gz.lianjia.com/chengjiao/"; //初始网页
var errUrl = []; //统计出错的链接数
var urlArr = []; //区块url数组
var urlPage = []; //各区块全部页数url数组

var concurrencyCount = 0;
var num = -4; //因为是5个并发，所以需要减4
var concurrencyCount1 = 0;
var num1 = -5; //因为是6个并发，所以需要减5

// 将Unicode转化为中文
function decodeUnicode(str) {
  return str
    ? unescape(
        str
          .toString()
          .replace(/&#x/g, "%u")
          .replace(/;/g, "")
      )
    : null;
}

//延时函数
function sleep(delay) {
  var start = new Date().getTime();
  while (new Date().getTime() - start < delay) {
    continue;
  }
}

app.get("/", function(req, res, next) {
  // 命令 ep 重复监听 emit事件(getUrlQueue)，当getUrlQueue爬取完毕之后执行
  ep.after("getUrlQueue", 1, function(list) {
    // var concurrencyCount = 0;
    // var num = -4; //因为是5个并发，所以需要减4

    // 控制最大并发数为5，在结果中取出callback返回来的整个结果数组。
    async.mapLimit(
      urlArr,
      5,
      function(myurl, callback) {
        fetchUrl(myurl, callback);
      },
      function(err, result) {
        //爬取全部页面url结束后，对各页面url数组二次爬取房源信息
        // var concurrencyCount1 = 0;
        // var num1 = -5; //因为是6个并发，所以需要减5

        async.mapLimit(
          urlPage,
          6,
          function(myurl, callback) {
            //加个延时防止页面加载慢爬到空页面
            // sleep(500);
            DownloadHtml(res, myurl, callback);
          },
          function(err, result) {
            // 爬虫结束后的回调，可以做一些统计结果
            console.log("抓包结束，一共抓取了-->" + urlPage.length + "条数据");
            urlArr = []; //清空url数组
            urlPage = [];
            errUrl = []; // 清空错误数组
            return false;
          }
        );
        // return false;
      }
    );
  });
  (function(page) {
    //先抓取链家广州二手房首页地区信息
    GetUrlQueue(page);
  })(baseUrl);
});

//******************************************************************************* */

//从种子 url 页面获取各区块 url 地址
function GetUrlQueue(page) {
  superagent
    .get(page)
    .buffer(true)
    .charset("utf-8")
    .end(function(err, sres) {
      // 常规的错误处理
      if (err) {
        console.log("抓取" + page + "这条信息的时候出错了");
        // return next(err);
      }
      var $ = cheerio.load(sres.text);
      // 区域数组
      var position = [];
      $(".position dl")
        .eq(1)
        .find("dd div div")
        .eq(0)
        .find("a")
        .each(function() {
          var tem = {};
          tem.name = $(this).text(); //区名
          tem.code = $(this).attr("href");
          tem.href = "https://gz.lianjia.com" + $(this).attr("href"); //url
          urlArr.push(tem.href);
          position.push(tem);
        });
      /*
       *流程控制语句
       *当区域链接爬取完毕之后，开始爬取各区二手房
       */
      //存入数据库
      MongoClient.connect(urldb, function(err, db) {
        if (err) throw err;
        var dbo = db.db("lianjiaSpider");
        // 初始化数据库
        dbo
          .dropDatabase()
          .then(res => {
            console.log("数据库初始化成功");
          })
          .catch(err => {
            console.log("数据库初始化失败");
          });
        dbo.collection("position").insertMany(position, function(err, res) {
          if (err) throw err;
          console.log("插入的文档数量为: " + res.insertedCount);
          db.close();
        });
      });

      ep.emit("getUrlQueue", "get " + page + " successful");
    });
}

// 爬取各区块全部页数
var fetchUrl = function(myurl, callback) {
  var fetchStart = new Date().getTime();
  concurrencyCount++;
  num += 1;
  console.log("现在的并发数是", concurrencyCount, "，正在抓取的是", myurl);
  let userAgent = userAgents[parseInt(Math.random() * userAgents.length)]; //动态请求头
  superagent
    .get(myurl)
    .set({ "User-Agent": userAgent })
    .buffer(true)
    .charset("utf-8") //解决编码问题
    .end(function(err, ssres) {
      if (err) {
        callback(err, myurl + " error happened!");
        errUrl.push(myurl);
        console.log("抓取", myurl, "这条信息时出错了");
        // return next(err);
      }
      var time = new Date().getTime() - fetchStart;
      console.log("抓取 " + myurl + " 成功", "，耗时" + time + "毫秒");
      concurrencyCount--;

      var $ = cheerio.load(ssres.text);

      // 获取总页数
      var totalPage = $(".house-lst-page-box").attr("page-data")
        ? JSON.parse($(".house-lst-page-box").attr("page-data")).totalPage
        : 1;
      // totalPage = totalPage >= 75 ? 75 : totalPage;

      //生成各区块全部页数url数组
      for (let i = 1; i <= totalPage; i++) {
        urlPage.push(myurl + "pg" + i + "/");
      }

      var result = {
        movieLink: myurl
      };
      callback(null, result);
    });
};

// 循环爬取 positionUrl 队列，从页面中获取各区块数据总页数，生成子url
function GetPageQueue() {
  var concurrencyCount = 0;
  var num = -4; //因为是5个并发，所以需要减4
  // 控制最大并发数为5，在结果中取出callback返回来的整个结果数组。
  async.mapLimit(
    urlArr,
    5,
    function(myurl, callback) {
      fetchUrl(myurl, callback);
    },
    function(err, result) {
      //获取全部url结束后，对各页面url数组二次爬取房源信息
      ep.emit("GetPageQueue", result);
    }
  );
}

// 获取房源信息
function AnalysisHtml($, callback) {
  var houses = [];
  $(".listContent li").each(function() {
    var house = {};
    //标题
    house.titleName = decodeUnicode(
      $(this)
        .find(".info .title")
        .find("a")
        .html()
    );
    //楼盘名
    house.name = decodeUnicode(
      $(this)
        .find(".info .title a")
        .text()
    ).split(" ")[0];
    //房屋户型
    house.layout = decodeUnicode(
      $(this)
        .find(".info .title a")
        .html()
    ).split(" ")[1];
    //大小面积
    house.size = $(this)
      .find(".info .title")
      .find("a")
      .html()
      .split(" ")[2]
      ? Number(
          decodeUnicode(
            $(this)
              .find(".info .title a")
              .html()
          )
            .split(" ")[2]
            .slice(0, -2)
        )
      : 0;

    //挂牌总价
    house.listedPrice = $(this)
      .find(".dealCycleTxt span")
      .eq(0)
      .text()
      .slice(2, -1)
      ? Number(
          $(this)
            .find(".dealCycleTxt span")
            .eq(0)
            .text()
            .slice(2, -1)
        )
      : 0;
    //成交周期
    house.dealPeriod = $(this)
      .find(".dealCycleTxt span")
      .eq(1)
      .text()
      ? Number(
          $(this)
            .find(".dealCycleTxt span")
            .eq(1)
            .text()
            .slice(4, -1)
        )
      : 0;

    //成交时间
    house.dealDate = $(this)
      .find(".dealDate")
      .text();

    //房子成交总价
    house.totalPrice = Number(
      $(this)
        .find(".totalPrice span")
        .text()
    );
    // 房子单价
    house.unitPrice = Number(
      $(this)
        .find(".unitPrice span")
        .text()
    );

    houses.push(house);
  });

  var curPage = $(".house-lst-page-box").attr("page-data")
    ? JSON.parse($(".house-lst-page-box").attr("page-data")).curPage
    : 1;

  for (let i = 0; i < houses.length; i++) {
    houses[i].curPage = curPage;
  }

  var obj = {
    houses: houses
  };
  callback(obj);
}

//异步并发爬取 pageUrl 队列，获取所需数据
function DownloadHtml(res, myurl, callback) {
  var fetchStart1 = new Date().getTime();
  concurrencyCount1++;
  num1 += 1;
  console.log("现在的并发数是", concurrencyCount1, "，正在抓取的是", myurl);

  superagent
    .get(myurl)
    .buffer(true)
    .charset("utf-8") //解决编码问题
    .end(function(err, ssres) {
      if (err) {
        errUrl.push(myurl);
        console.log("抓取", myurl, "这条信息时出错了");
        callback(err, myurl + " error happened!");
      }
      if (typeof ssres === "undefined") {
        errUrl.push(myurl);
        console.log("抓取", myurl, "这条信息时出错了,内容为空");
        callback(null, []);
      }

      var time1 = new Date().getTime() - fetchStart1;
      console.log("抓取 " + myurl + " 成功", "，耗时" + time1 + "毫秒");
      concurrencyCount1--;

      var $ = cheerio.load(ssres.text);

      // 对每页获取的结果进行处理函数
      AnalysisHtml($, function(obj) {
        res.write("<br/>");
        res.write("url-->  " + myurl);
        res.write("<br/>");

        // 存入数据库
        var colName = myurl.split("/")[4];
        MongoClient.connect(urldb, function(err, db) {
          if (err || obj.houses.length === 0) {
            console.log("数据库插入", myurl, "出错了");
            console.log("obj.houses:", obj.houses);
            errUrl.push(myurl);
            throw err;
          }
          var dbo = db.db("lianjiaSpider");
          dbo.collection(colName).insertMany(obj.houses, function(err, res) {
            if (err) {
              throw err;
            }
            console.log("插入的文档数量为: " + res.insertedCount);
            db.close();
          });
        });
      });

      var result = {
        movieLink: myurl
      };
      callback(null, result);
    });
}

var server = app.listen(8080, function() {
  console.log("listening at 8080");
});
