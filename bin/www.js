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
var urlArr = []; //url数组

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
  // 命令 ep 重复监听 emit事件(get_topic_html)，当get_topic_html爬取完毕之后执行
  ep.after("get_topic_html", 1, function(eps) {
    var concurrencyCount = 0;
    var num = -4; //因为是5个并发，所以需要减4

    // 利用callback函数将结果返回去，然后在结果中取出整个结果数组。
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

          // 对获取的结果进行处理函数
          getDownloadLink($, function(obj) {
            res.write("<br/>");
            res.write("url-->  " + myurl);
            res.write("<br/>");
            res.write("House number-->  " + obj.houseNum);
            res.write("<br/>");
            res.write("house name-->  " + obj.houses[0].name + " 等");
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

    // 控制最大并发数为5，在结果中取出callback返回来的整个结果数组。
    // mapLimit(arr, limit, iterator, [callback])
    async.mapLimit(
      urlArr,
      5,
      function(myurl, callback) {
        fetchUrl(myurl, callback);
      },
      function(err, result) {
        // 爬虫结束后的回调，可以做一些统计结果
        console.log("抓包结束，一共抓取了-->" + urlArr.length + "条数据");
        urlArr = [];
        return false;
      }
    );
  });
  (function(page) {
    //先抓取链家广州二手房首页
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
         *当区域链接爬取完毕之后，我们就开始爬取各区二手房
         */
        ep.emit("get_topic_html", "get " + page + " successful");
      });
  })(baseUrl);
});

// 获取下载链接
function getDownloadLink($, callback) {
  var houseNum = $(".total span").text();

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

    houses.push(house);
    console.log(houseInfo);
  });

  var obj = {
    houseNum: houseNum,
    houses: houses
  };
  if (!houseNum) {
    houseNum = "暂无房源";
  }
  callback(obj);
}

// app.get("/", function(req, res) {
//   request("https://gz.lianjia.com/ershoufang/", function(
//     error,
//     response,
//     body
//   ) {
//     if (!error && response.statusCode == 200) {
//       $ = cheerio.load(body);
//       // 区域数组
//       var position = [];
//       $(".position dl")
//         .eq(1)
//         .find("dd div div")
//         .eq(0)
//         .find("a")
//         .each(function() {
//           var tem = {};
//           tem.name = $(this).text(); //区名
//           tem.href = "https://gz.lianjia.com" + $(this).attr("href"); //url
//           position.push(tem);
//         });

//       //二手房对象数组
//       var houses = [];
//       var houses_list = $(".LOGCLICKDATA");
//       $(".LOGCLICKDATA").each(function() {
//         var house = {};
//         //标题
//         house.titleName = decodeUnicode(
//           $(this)
//             .find(".info .title")
//             .find("a")
//             .html()
//         );
//         //楼盘名
//         house.name = decodeUnicode(
//           $(this)
//             .find(".houseInfo")
//             .find("a")
//             .html()
//         );

//         var houseInfo = [];
//         houseInfo = decodeUnicode(
//           $(this)
//             .find(".houseInfo")
//             .text()
//         ).split(" | ");
//         //房屋户型
//         house.layout = houseInfo[1];
//         //大小
//         house.size = houseInfo[2];
//         //朝向
//         house.toward = houseInfo[3];
//         //装修
//         house.decoration = houseInfo[4];
//         //电梯
//         house.elevator = houseInfo[5] ? houseInfo[5] : "";

//         //地址
//         house.positionInfo = decodeUnicode(
//           $(this)
//             .find(".positionInfo")
//             .find("a")
//             .html()
//         );
//         //控制台输出楼盘名
//         // console.log(house.name);
//         houses.push(house);
//       });

//       res.json({
//         position: position
//       });

//       const positionJson = { position: position };
//       var positionFilename = "D:\\pro_gra_sample\\express_demo\\position.json";
//       fs.writeFileSync(positionFilename, JSON.stringify(positionJson));

//       // const houseJson = { houses: houses };
//       // var houseFilename = "D:\\pro_gra_sample\\express_demo\\houses.json";
//       // fs.writeFileSync(houseFilename, JSON.stringify(houseJson));
//     }
//   });
// });

var server = app.listen(8080, function() {
  console.log("listening at 8080");
});
