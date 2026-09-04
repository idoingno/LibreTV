const CUSTOMER_SITES = {
    qiqi: {
        api: 'https://www.qiqidys.com/api.php/provide/vod',
        name: '七七资源',
    },
    // 2026-09-04 实测可用的新增源（搜索关键词"流浪地球"验证通过）
    uku: {
        api: 'http://api.ukuapi.com/api.php/provide/vod',
        name: 'U酷资源',
    },
    zuida2: {
        api: 'http://zuidazy.me/api.php/provide/vod/',
        name: '最大资源(新)',
    },
    hongniu: {
        api: 'http://hongniuzy2.com/api.php/provide/vod',
        name: '红牛资源',
    },
    ffzy2: {
        api: 'http://cj.ffzyapi.com/api.php/provide/vod',
        name: '非凡影视(新)',
    },
    guangsu: {
        api: 'https://api.guangsuapi.com/api.php/provide/vod',
        name: '光速资源',
    },
    subo: {
        api: 'https://subocj.com/api.php/provide/vod',
        name: '速播资源',
    },
    taojin: {
        api: 'https://taopianapi.com/cjapi/mc/vod/json.html',
        name: '淘金资源',
    },
    jinying: {
        api: 'https://jyzyapi.com/provide/vod',
        name: '金鹰资源',
    },
    maoyan: {
        api: 'https://api.maoyanapi.top/api.php/provide/vod',
        name: '猫眼资源',
    }
};

// 调用全局方法合并
if (window.extendAPISites) {
    window.extendAPISites(CUSTOMER_SITES);
} else {
    console.error("错误：请先加载 config.js！");
}
