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

var baseUrl = "https://gz.lianjia.com/ershoufang/"; //初始网页
var errLength = []; //统计出错的链接数
var urlArr = []; //区块url数组
var urlPage = []; //各区块全部页数url数组

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

app.get("/", function(req, res, next) {
  // 命令 ep 重复监听 emit事件(get_district_html)，当get_district_html爬取完毕之后执行
  ep.after("get_district_html", 1, function(eps) {
    var concurrencyCount = 0;
    var num = -4; //因为是5个并发，所以需要减4

    // 爬取各区块全部页数
    var fetchUrl = function(myurl, callback) {
      var fetchStart = new Date().getTime();
      concurrencyCount++;
      num += 1;
      console.log("现在的并发数是", concurrencyCount, "，正在抓取的是", myurl);
      superagent
        .get(myurl)
        .charset("utf-8") //解决编码问题
        .end(function(err, ssres) {
          if (err) {
            callback(err, myurl + " error happened!");
            errLength.push(myurl);
            return next(err);
          }

          var time = new Date().getTime() - fetchStart;
          console.log("抓取 " + myurl + " 成功", "，耗时" + time + "毫秒");
          concurrencyCount--;

          var $ = cheerio.load(ssres.text);

          // 获取总页数
          var totalPage = $(".house-lst-page-box")
            .attr("page-data")
            .split(",")[0]
            .split(":")[1];

          //生成各区块全部页数url数组
          for (let i = 1; i <= 3; i++) {
            urlPage.push(myurl + "pg" + i + "/");
          }

          var result = {
            movieLink: myurl
          };
          callback(null, result);
        });
    };

    // 控制最大并发数为5，在结果中取出callback返回来的整个结果数组。
    // mapLimit(arr, limit, iterator, [callback])
    async.mapLimit(
      urlArr,
      5,
      function(myurl, callback) {
        fetchUrl(myurl, callback);
      },
      function(err, result) {
        //爬取全部页面url结束后，对各页面url数组二次爬取房源信息
        // 爬取房源信息
        var concurrencyCount1 = 0;
        var num1 = -5; //因为是6个并发，所以需要减5

        var fetchInfo = function(myurl, callback) {
          var fetchStart1 = new Date().getTime();
          concurrencyCount1++;
          num1 += 1;
          console.log(
            "现在的并发数是",
            concurrencyCount1,
            "，正在抓取的是",
            myurl
          );

          superagent
            .get(myurl)
            .charset("utf-8") //解决编码问题
            .end(function(err, ssres) {
              if (err) {
                callback(err, myurl + " error happened!");
                errLength.push(myurl);
                return next(err);
              }

              var time1 = new Date().getTime() - fetchStart1;
              console.log("抓取 " + myurl + " 成功", "，耗时" + time1 + "毫秒");
              concurrencyCount1--;

              var $ = cheerio.load(ssres.text);

              // 对每页获取的结果进行处理函数
              getDownloadLink($, function(obj) {
                res.write("<br/>");
                res.write("url-->  " + myurl);
                res.write("<br/>");

                //存为json文件
                var fileName =
                  "D:\\pro_gra_sample\\express_demo\\" +
                  myurl.split("/")[4] +
                  ".json";
                fs.writeFileSync(fileName, JSON.stringify(obj));
              });

              var result = {
                movieLink: myurl
              };
              callback(null, result);
            });
        };
        async.mapLimit(
          urlPage,
          6,
          function(myurl, callback) {
            fetchInfo(myurl, callback);
          },
          function(err, result) {
            // 爬虫结束后的回调，可以做一些统计结果
            console.log("抓包结束，一共抓取了-->" + urlPage.length + "条数据");
            urlArr = []; //清空url数组
            urlPage = [];
            return false;
          }
        );
        // return false;
      }
    );
  });
  (function(page) {
    //先抓取链家广州二手房首页地区信息
    superagent
      .get(page)
      .charset("utf-8")
      .end(function(err, sres) {
        // 常规的错误处理
        if (err) {
          console.log("抓取" + page + "这条信息的时候出错了");
          return next(err);
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
            tem.href = "https://gz.lianjia.com" + $(this).attr("href"); //url
            urlArr.push(tem.href);
            position.push(tem);
          });
        /*
         *流程控制语句
         *当区域链接爬取完毕之后，开始爬取各区二手房
         */
        const positionJson = { position: position };
        var positionFilename =
          "D:\\pro_gra_sample\\express_demo\\position.json";
        fs.writeFileSync(positionFilename, JSON.stringify(positionJson));
        ep.emit("get_district_html", "get " + page + " successful");
      });
  })(baseUrl);
});

// 获取房源信息
function getDownloadLink($, callback) {
  // var houseNum = $(".total span").text();
  // var housePage = $(".house-lst-page-box")
  //   .attr("page-data")
  //   .split(",")[0]
  //   .split(":")[1];

  var houses = [];
  $(".LOGCLICKDATA").each(function() {
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
        .find(".houseInfo")
        .find("a")
        .html()
        .replace(/\s+/g, "")
    );

    var houseInfo = [];
    houseInfo = decodeUnicode(
      $(this)
        .find(".houseInfo")
        .text()
    ).split(" | ");
    //房屋户型
    house.layout = houseInfo[1];
    //大小
    house.size = houseInfo[2];
    //朝向
    house.toward = houseInfo[3];
    //装修
    house.decoration = houseInfo[4];
    //电梯
    house.elevator = houseInfo[5] ? houseInfo[5] : "";

    //地址
    house.positionInfo = decodeUnicode(
      $(this)
        .find(".positionInfo")
        .find("a")
        .html()
    );
    //房子总价
    house.totalPrice = decodeUnicode(
      $(this)
        .find(".totalPrice span")
        .text()
    );
    // 房子单价
    house.unitPrice = decodeUnicode(
      $(this)
        .find(".unitPrice")
        .attr("data-price")
    );

    houses.push(house);
  });

  var obj = {
    // houseNum: houseNum,
    // housePage: housePage,
    houses: houses
  };
  // if (!houseNum) {
  //   houseNum = "暂无房源";
  // }
  callback(obj);
}
var server = app.listen(8080, function() {
  console.log("listening at 8080");
});
